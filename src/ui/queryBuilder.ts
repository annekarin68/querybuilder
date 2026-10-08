import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { Facet } from "../model";
import {
  FACET_OPERATOR_IDS,
  FACET_OPERATORS,
  fieldsOfFacet,
  findField,
  findOperator,
  isFacetLevel,
  isFacetTest,
  operatorName,
  OPERATORS,
  type FieldCatalog,
} from "../query/fieldCatalog";
import {
  addChild,
  countConditions,
  findNode,
  groupContents,
  newCondition,
  newGroup,
  removeNode,
  ungroup,
  ungroupBlocker,
  UNGROUP_BLOCKED_MESSAGE,
  updateNode,
} from "../query/tree";
import { announcementAfterChange, cursorAfterChange, nextCondition } from "../query/conditionEdit";
import {
  ADDED_GROUP_MESSAGE,
  addedMessage,
  DRAG_MIME,
  groupedMessage,
  parseDragItem,
  UNGROUPED_MESSAGE,
  type DragItem,
} from "../query/drop";
import { placeIssues } from "../query/issues";
import { queryToText } from "../query/summary";
import { escapeHtml, optionsHtml, paint } from "./panel";
import { onDropdownChange, openDropdown } from "./fomantic";
import { countLabel } from "./format";
import { readValueControl, renderValueControl } from "./valueControl";

/** What every part of the tree's HTML needs, passed down the recursion. */
interface BuilderCtx {
  catalog: FieldCatalog;
  facets: Facet[] | null;
  issues: Issue[];
  /** The whole query: a group's Ungroup button needs its parent's ALL/ANY. */
  query: Group;
}

/**
 * Unfinished parts are quiet grey hints — the user simply isn't done yet. Only
 * an invalid query is shown in red. Both kinds still block running (validate.ts).
 * Issues come from validate.ts and from the backend (src/query/issues.ts).
 */
function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const text = (kind: Issue["kind"]) =>
    mine
      .filter((i) => i.kind === kind)
      .map((i) => escapeHtml(i.message))
      .join(" ");
  const incomplete = text("incomplete");
  const invalid = text("invalid");
  return (
    (incomplete ? `<div class="qb-hint">${incomplete}</div>` : "") +
    (invalid
      ? `<div class="qb-invalid"><i class="exclamation circle icon"></i>${invalid}</div>`
      : "")
  );
}

/** The dismissible warning for a drop that couldn't be done in full. */
export function noticeHtml(notice: string | null): string {
  if (!notice) return "";
  return `<div class="ui warning message qb-notice">
      <i class="close icon" data-action="dismiss-notice" role="button" tabindex="0" aria-label="Dismiss"></i>
      <p>${escapeHtml(notice)}</p>
    </div>`;
}

/** A node's drag handle: carries `{type: "node", nodeId}`. The id is kept in
 *  `data-node-item` and the drag payload is built from it in the dragstart
 *  handler, so no JSON lives in the DOM. A group's grip looks different from a
 *  condition's (`qb-grip-group`, drawn in the group's colour) and its tooltip
 *  says what it moves: the two sit at the same left edge, so otherwise a user
 *  cannot tell which one carries the whole group. */
function nodeGrip(nodeId: string, kind: "group" | "condition"): string {
  const cls = kind === "group" ? "qb-grip qb-grip-group" : "qb-grip";
  return `<span class="${cls}" draggable="true" data-node-item="${escapeHtml(nodeId)}" aria-hidden="true" title="Drag to move this ${kind}"><i class="grip vertical icon"></i></span>`;
}

function iconButton(action: string, label: string, icon: string): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"><i class="${icon} icon"></i></button>`;
}

/** The condition row's plain dropdowns and their labels. The Field dropdown
 *  is not here: it holds two kinds of choice and has its own builder,
 *  `fieldDropdown`. */
const ROW_DROPDOWNS = { facet: "Facet", operator: "Operator" };

/**
 * One of a condition row's plain dropdowns: `part` is "facet" or "operator".
 * Both are search dropdowns — there can be many facets, so typing filters the
 * list — and the Operator is disabled until a field is chosen.
 */
export function rowDropdown(
  part: keyof typeof ROW_DROPDOWNS,
  choices: { id: string; name: string }[],
  selectedId: string | null,
  enabled: boolean,
): string {
  const label = ROW_DROPDOWNS[part];
  const opts = optionsHtml(
    choices,
    (c) => c.id,
    (c) => c.name,
    (c) => c.id === selectedId,
  );
  return `<select class="ui search selection dropdown" data-part="${part}" aria-label="${label}"${enabled ? "" : " disabled"}><option value="">${label}…</option>${opts}</select>`;
}

/** The Field dropdown holds two kinds of choice, told apart by a prefix so no
 *  field id can ever collide with a test: a whole-facet test is
 *  `FACET_TEST_PREFIX` + the operator ("op:present"), a field is `FIELD_PREFIX`
 *  + its id ("f:size"), and "" is nothing chosen yet. */
export const FACET_TEST_PREFIX = "op:";
export const FIELD_PREFIX = "f:";

/**
 * The row's second dropdown: nothing chosen, then what to say about the whole
 * facet ("Is present" / "Is absent"), then the facet's fields. One list, so a
 * user who wants a field and one who wants the facet look in the same place.
 */
export function fieldDropdown(
  fields: { id: string; name: string }[],
  selectedId: string | null,
  facetOperatorId: string | null,
  enabled: boolean,
): string {
  const testOpts = optionsHtml(
    FACET_OPERATORS,
    (o) => FACET_TEST_PREFIX + o.id,
    (o) => operatorName(o, true),
    (o) => o.id === facetOperatorId,
  );
  const fieldOpts = optionsHtml(
    fields,
    (f) => FIELD_PREFIX + f.id,
    (f) => f.name,
    (f) => f.id === selectedId,
  );
  // Fomantic turns an <optgroup> into a header in the menu. A facet without
  // fields has nothing to put under the second header, so it gets none.
  const fieldGroup = fields.length ? `<optgroup label="About a field">${fieldOpts}</optgroup>` : "";
  // Fomantic copies the <select>'s classes onto the dropdown it builds, so
  // `qb-field-select` lets styles.css restyle this dropdown's menu and its
  // width on a whole-facet row without touching the other dropdowns.
  return `<select class="ui search selection dropdown qb-field-select" data-part="field" aria-label="Field, or presence of the facet"${enabled ? "" : " disabled"}><option value="">Choose…</option><optgroup label="About the whole facet">${testOpts}</optgroup>${fieldGroup}</select>`;
}

/** Read the Field dropdown's value (see FACET_TEST_PREFIX / FIELD_PREFIX). The
 *  value comes from the page, so a test a whole facet can't take counts as
 *  nothing chosen. */
export function decodeFieldValue(value: string | null): {
  facetOperatorId: string | null;
  fieldId: string | null;
} {
  if (value?.startsWith(FACET_TEST_PREFIX)) {
    const operatorId = value.slice(FACET_TEST_PREFIX.length);
    const known = FACET_OPERATOR_IDS.includes(operatorId);
    return { facetOperatorId: known ? operatorId : null, fieldId: null };
  }
  const fieldId = value?.startsWith(FIELD_PREFIX) ? value.slice(FIELD_PREFIX.length) : "";
  return { facetOperatorId: null, fieldId: fieldId || null };
}

/** The condition row or group of node `nodeId`, or null if it is not on screen.
 *  Ids are unique, so one lookup serves rows and groups alike. */
function nodeOf(container: HTMLElement, nodeId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
}

/** The `.ui.dropdown` Fomantic built from the row's `<select data-part=…>`. */
function dropdownOf(row: HTMLElement | null, part: string): HTMLElement | null {
  return (
    row?.querySelector(`select[data-part="${part}"]`)?.closest<HTMLElement>(".ui.dropdown") ?? null
  );
}

/**
 * Put the cursor in `part` of condition `nodeId`'s row, opening it if it is a
 * dropdown. The value is a dropdown, one or two text boxes or a toggle: the
 * cursor goes to the first. Does nothing for a value the operator doesn't take.
 */
function focusPart(container: HTMLElement, nodeId: string, part: string): void {
  const row = nodeOf(container, nodeId);
  const slot =
    part === "value" ? row?.querySelector<HTMLElement>(".qb-value") : dropdownOf(row, part);
  if (!slot) return;
  const dropdown = slot.matches(".ui.dropdown")
    ? slot
    : slot.querySelector<HTMLElement>(".ui.dropdown");
  if (dropdown) openDropdown(dropdown);
  else slot.querySelector("input")?.focus();
}

/** Put the cursor in condition `nodeId`'s Field dropdown without opening it. */
function focusFieldDropdown(container: HTMLElement, nodeId: string): void {
  dropdownOf(nodeOf(container, nodeId), "field")
    ?.querySelector<HTMLElement>("input.search")
    ?.focus();
}

function conditionHtml(ctx: BuilderCtx, c: Condition): string {
  const field = findField(ctx.catalog, c.facetId, c.fieldId);
  const operator = findOperator(c.operatorId);
  const fields = fieldsOfFacet(ctx.catalog, c.facetId).map((f) => ({
    id: f.fieldId,
    name: f.fieldName,
  }));
  const facetLevel = isFacetLevel(c);
  const operatorChoices = OPERATORS.filter((o) => field?.operatorIds.includes(o.id)).map((o) => ({
    id: o.id,
    name: o.name,
  }));
  // A whole-facet test ("Is present") is the whole sentence: it was picked in
  // the Field dropdown and takes no value, so the row has no Operator or Value
  // slot (`.is-facet-level` keeps the ✕ at the row's end). A malformed one
  // (foreign operator, or a value) is drawn the same way but its Field dropdown
  // shows "Choose…" (isFacetTest), where picking a test repairs it.
  const operatorAndValue = facetLevel
    ? ""
    : `${rowDropdown("operator", operatorChoices, c.operatorId, field !== undefined)}
        <div class="qb-value">${renderValueControl(field, operator, c.value)}</div>`;
  return `<div class="qb-condition" data-node-id="${escapeHtml(c.id)}">
    <div class="qb-cond-row">
      ${nodeGrip(c.id, "condition")}
      <div class="qb-cond-grid${facetLevel ? " is-facet-level" : ""}">
        ${rowDropdown("facet", ctx.facets ?? [], c.facetId, true)}
        ${fieldDropdown(fields, c.fieldId, isFacetTest(c) ? c.operatorId : null, Boolean(c.facetId))}
        ${operatorAndValue}
        ${iconButton("remove-node", "Remove condition", "times")}
      </div>
    </div>
    ${issuesHtml(c.id, ctx.issues)}
  </div>`;
}

/**
 * The group's fold/unfold button: a bordered chevron (down while open, right
 * while folded — the same arrows the data dictionary uses), so it reads as
 * something to click.
 */
export function collapseButton(collapsed: boolean): string {
  const label = collapsed ? "Expand group" : "Collapse group";
  const icon = collapsed ? "angle right" : "angle down";
  return `<button type="button" class="qb-icon-btn qb-collapse-btn" data-action="toggle-collapse" aria-label="${label}" title="${label}" aria-expanded="${!collapsed}"><i class="${icon} icon"></i></button>`;
}

/**
 * A group is drawn as a coloured bracket with a faint tint (green = ALL/AND,
 * mustard = ANY/OR — see styles.css). Between its children sits a small AND/OR
 * "joiner" on the bracket line. A collapsed group folds to one line: its
 * plain-English summary and how many conditions it holds. That whole line is a
 * click target for unfolding it (buttons and the grip inside keep their own jobs).
 *
 * "+ Condition" is the group's `data-focus-landing`: when the control that had
 * the keyboard focus is removed (a row's or a sub-group's ✕), focus goes there,
 * in the same group, and not onto a neighbour's ✕ where a second Enter would
 * delete something else (see focusMemory.ts).
 */
export function groupHtml(ctx: BuilderCtx, g: Group, isRoot: boolean): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  if (g.collapsed) {
    const text = queryToText(g, ctx.catalog);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head" data-action="toggle-collapse" title="Click to expand">
        ${isRoot ? "" : nodeGrip(g.id, "group")}
        ${collapseButton(true)}
        <span class="qb-op-badge">${matchWord}</span>
        <span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        <span class="qb-count">${countLabel(countConditions(g), "condition")}</span>
        ${remove}
      </div>
      ${issuesHtml(g.id, ctx.issues)}
    </div>`;
  }
  // With two or more items, "Group contents" is the way to put a sibling group
  // next to them (e.g. to mix ALL and ANY). Ungroup is always drawn on a
  // non-root group, but is aria-disabled with the reason when it would change
  // what the query means: not `disabled`, so keyboard and screen-reader users
  // can still reach the button and hear why.
  const groupContentsButton =
    g.children.length >= 2
      ? `<button type="button" class="ui mini basic button" data-action="group-contents" title="Put this group's conditions and groups into a new group inside it"><i class="object group outline icon" aria-hidden="true"></i>Group contents</button>`
      : "";
  const blocked = isRoot ? null : ungroupBlocker(ctx.query, g.id);
  const ungroupButton = isRoot
    ? ""
    : `<button type="button" class="ui mini basic button" data-action="ungroup"${blocked ? ` aria-disabled="true" title="${escapeHtml(blocked)}"` : ` title="Put this group's items into the group around it"`}><i class="object ungroup outline icon" aria-hidden="true"></i>Ungroup</button>`;
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children.map((child) => nodeHtml(ctx, child, false)).join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${isRoot ? "" : nodeGrip(g.id, "group")}
      ${collapseButton(false)}
      <span class="qb-group-label">Match</span>
      <span class="qb-logic" role="group" aria-label="Combine conditions with">
        <button type="button" class="qb-logic-btn${g.operator === "AND" ? " is-on" : ""}" data-action="set-and" aria-pressed="${g.operator === "AND"}">ALL</button>
        <button type="button" class="qb-logic-btn${g.operator === "OR" ? " is-on" : ""}" data-action="set-or" aria-pressed="${g.operator === "OR"}">ANY</button>
      </span>
      <span class="qb-group-label">of the following</span>
      <span class="qb-spacer"></span>
      <button type="button" class="ui mini basic button" data-action="add-condition" data-focus-landing><i class="plus icon"></i>Condition</button>
      <button type="button" class="ui mini basic button" data-action="add-group"><i class="plus icon"></i>Group</button>
      ${groupContentsButton}
      ${ungroupButton}
      ${remove}
    </div>
    ${issuesHtml(g.id, ctx.issues)}
    <div class="qb-children">${children}</div>
  </div>`;
}

function nodeHtml(ctx: BuilderCtx, node: QueryNode, isRoot: boolean): string {
  return node.kind === "group" ? groupHtml(ctx, node, isRoot) : conditionHtml(ctx, node);
}

/** The query card's footer: the whole query in plain English once nothing
 *  needs attention, otherwise how many parts do. `issues` are placed
 *  (placeIssues), so the count matches what is on screen. */
export function footerHtml(query: Group, issues: Issue[], catalog: FieldCatalog): string {
  if (countConditions(query) === 0) {
    return `<span class="qb-muted">Add a condition to start building the query.</span>`;
  }
  const pending = new Set(issues.map((i) => i.nodeId)).size;
  if (pending > 0) {
    const what =
      pending === 1
        ? "1 part of the query still needs"
        : `${pending} parts of the query still need`;
    return `<span class="qb-muted">${what} attention.</span>`;
  }
  const text = queryToText(query, catalog);
  return `<span class="qb-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

function paintQueryBuilder(el: HTMLElement, state: AppState): void {
  if (!state.catalog) {
    paint(el, `<div class="qb-card"><div class="ui active centered inline loader"></div></div>`);
    return;
  }
  // Local issues (validate.ts) and the backend's, each on a node that is drawn.
  const issues = placeIssues(state.query, [...state.issues, ...state.serverIssues]);
  const ctx: BuilderCtx = {
    catalog: state.catalog,
    facets: state.facets,
    issues,
    query: state.query,
  };
  paint(
    el,
    `${noticeHtml(state.dropNotice)}<div class="qb-card qb-query" tabindex="-1" data-focus-landing>
       <h2 class="qb-card-title">Query</h2>
       ${nodeHtml(ctx, state.query, true)}
       <div class="qb-query-foot">${footerHtml(state.query, issues, state.catalog)}</div>
     </div>`,
  );
}

/**
 * Install the query builder's behaviour on `container` (the persistent centre
 * panel). Call ONCE at startup. The handlers read the current tree through
 * `getState()` when an event fires, so they never go stale across repaints.
 *
 * Returns the query builder's render function — the only way to paint it.
 * Rendering and binding must happen together: Fomantic dropdowns don't emit a
 * usable native "change", so their onChange is bound per element, and every
 * paint replaces those elements.
 */
export function wireQueryBuilder(
  container: HTMLElement,
  getState: () => AppState,
  onChange: (next: Group) => void,
  hooks: {
    onDrop(item: DragItem | null, targetNodeId: string): void;
    onDismissNotice(): void;
    /** Show a warning above the query (a refused action, not a drop). */
    onNotice(message: string): void;
    /** Say something to screen-reader users (the shell's live region). */
    announce(message: string): void;
  },
): (state: AppState) => void {
  /** `changedPart`: the dropdown just used ("facet", "field", …), if any. */
  function handleRowChange(row: HTMLElement, changedPart?: string): void {
    const { query, catalog } = getState();
    const cond = findNode(query, row.dataset.nodeId!);
    if (!catalog || !cond || cond.kind !== "condition") return;
    const picked = (part: string) =>
      row.querySelector<HTMLSelectElement>(`select[data-part="${part}"]`)?.value || null;
    const { facetOperatorId, fieldId } = decodeFieldValue(picked("field"));
    const patch = nextCondition(
      cond,
      {
        facetId: picked("facet"),
        fieldId,
        operatorId: picked("operator"),
        facetOperatorId,
      },
      catalog,
      (arity, valueType) => readValueControl(row, arity, valueType),
    );
    // Read the changed dropdown now: onChange repaints at once and replaces
    // this row, so it must not be read afterwards.
    const hasChoice = Boolean(changedPart && picked(changedPart));
    onChange(updateNode(query, cond.id, patch));
    // The repaint also lost the cursor: put it back where cursorAfterChange
    // says, judging by the committed patch (the row's dropdowns may still show
    // the previous facet's choice).
    const target = cursorAfterChange(changedPart, hasChoice, patch);
    if (target === "field-closed") focusFieldDropdown(container, cond.id);
    else if (target) focusPart(container, cond.id, target);
    const spoken = announcementAfterChange(changedPart, hasChoice, { ...cond, ...patch }, catalog);
    if (spoken) hooks.announce(spoken);
  }

  /** The condition row whose value box lost the focus and is waiting for its
   *  tick to be committed (see the `change` listener). */
  let pendingRow: HTMLElement | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  /** Commit the waiting value now, if there is one. Safe to call at any time. */
  function commitPendingValue(): void {
    clearTimeout(pendingTimer);
    const row = pendingRow;
    pendingRow = null;
    if (row) handleRowChange(row);
  }

  /** Dismiss the warning. The repaint removes the ✕ the user was on, so
   *  paint() moves their keyboard focus to the query card (its
   *  `data-focus-landing`). */
  function dismissNotice(): void {
    hooks.onDismissNotice();
  }

  container.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='dismiss-notice']")) {
      return dismissNotice();
    }
    // The grip is for dragging; a click on it must not also toggle a folded group.
    if ((e.target as HTMLElement).closest(".qb-grip")) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    // A drag across a folded group's line to select its text ends in a click on
    // that line: that is not a request to unfold it. (Only the header itself,
    // not a button of its own, is a toggle by a click anywhere on its line.)
    if (btn?.classList.contains("qb-group-head") && window.getSelection()?.toString()) return;
    const nodeId = btn?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!btn || !nodeId) return;
    const q = getState().query;
    switch (btn.dataset.action) {
      // paint() keeps the keyboard focus on the "+" button, so pressing it
      // again adds another; the new row itself is not visible to a screen
      // reader user, so it is announced (like the dictionary's "+").
      case "add-condition":
        onChange(addChild(q, nodeId, newCondition()));
        return hooks.announce(addedMessage(1));
      case "add-group":
        onChange(addChild(q, nodeId, newGroup()));
        return hooks.announce(ADDED_GROUP_MESSAGE);
      case "group-contents": {
        const node = findNode(q, nodeId);
        onChange(groupContents(q, nodeId));
        return hooks.announce(groupedMessage(node?.kind === "group" ? node.children.length : 0));
      }
      case "ungroup": {
        const next = ungroup(q, nodeId);
        // Refused: say why (the button is aria-disabled, not disabled, so
        // keyboard and screen-reader users can reach it and hear the reason).
        if (!next) return hooks.onNotice(ungroupBlocker(q, nodeId) ?? UNGROUP_BLOCKED_MESSAGE);
        onChange(next);
        return hooks.announce(UNGROUPED_MESSAGE);
      }
      case "remove-node":
        return onChange(removeNode(q, nodeId));
      case "set-and":
        return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or":
        return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "toggle-collapse": {
        // paint() puts the focus back on this group's (new) collapse button.
        const node = findNode(q, nodeId);
        return onChange(
          updateNode(q, nodeId, { collapsed: !(node?.kind === "group" && node.collapsed) }),
        );
      }
    }
  });

  // The warning's ✕ is an icon, not a <button>, so Enter/Space need wiring.
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!(e.target as HTMLElement).closest("[data-action='dismiss-notice']")) return;
    e.preventDefault();
    dismissNotice();
  });

  /** Whether the drag in progress is one of ours (seen via the data type). */
  const isOurs = (e: DragEvent) => e.dataTransfer?.types.includes(DRAG_MIME) ?? false;
  let marked: HTMLElement | null = null;
  const unmark = () => {
    marked?.classList.remove("is-drop-target", "is-drop-before");
    marked = null;
  };
  /** Where a drop at `el` lands: the nearest group or condition. */
  const targetOf = (el: EventTarget | null) =>
    el instanceof Element ? el.closest<HTMLElement>("[data-node-id]") : null;

  container.addEventListener("dragstart", (e) => {
    if (!(e.target instanceof Element)) return; // e.g. a Text node
    const grip = e.target.closest<HTMLElement>("[data-node-item]");
    if (!grip || !e.dataTransfer) return;
    const nodeId = grip.dataset.nodeItem!;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: "node", nodeId }));
    e.dataTransfer.effectAllowed = "move";
    const card = grip.closest<HTMLElement>("[data-node-id]");
    if (card) e.dataTransfer.setDragImage(card, 12, 12);
  });

  container.addEventListener("dragover", (e) => {
    if (!isOurs(e)) return; // not ours: no drop target, the browser shows "not allowed"
    const target = targetOf(e.target);
    if (!target) {
      unmark(); // no longer over a node: clear a stale highlight
      return;
    }
    e.preventDefault();
    e.dataTransfer!.dropEffect = e.dataTransfer!.effectAllowed === "move" ? "move" : "copy";
    if (target !== marked) {
      unmark();
      marked = target;
      target.classList.add(
        target.classList.contains("qb-condition") ? "is-drop-before" : "is-drop-target",
      );
    }
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget as Node | null)) unmark();
  });

  container.addEventListener("drop", (e) => {
    if (!isOurs(e)) return;
    e.preventDefault();
    unmark();
    const target = targetOf(e.target);
    if (!target) return;
    // An unreadable payload arrives as null; the app explains it to the user.
    hooks.onDrop(parseDragItem(e.dataTransfer!.getData(DRAG_MIME)), target.dataset.nodeId!);
  });

  container.addEventListener("dragend", unmark);

  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    // Fomantic dispatches a native bubbling "change" on the <select> behind each
    // dropdown *before* calling its onChange. Handling both would run
    // handleRowChange twice, the second time on a detached row, and write back
    // stale values. So every <select> is handled ONLY via onDropdownChange below.
    // A search dropdown's own typing box (input.search) fires "change" too, when
    // it loses focus on the mousedown before a menu click; repainting then would
    // remove the item under the pointer before the click lands. So anything
    // inside a .ui.dropdown is skipped, and this listener handles only the plain
    // <input>s (text/number, the range pair and the boolean toggle's checkbox).
    if (target instanceof HTMLSelectElement || target.closest(".ui.dropdown")) return;
    const row = target.closest<HTMLElement>(".qb-condition[data-node-id]");
    // A box's "change" fires as it loses focus (Tab, or a click on "To"),
    // BEFORE the focus reaches the next control. Repainting now would remove
    // that control and drop the focus to the page. So the value is committed
    // on the next tick, once the focus has landed, and paint() keeps it there.
    // The row may be repainted by then; its boxes still hold what was typed.
    if (!row) return;
    // Only one value waits at a time. If another row's box changes first,
    // commit the earlier one now rather than lose it.
    if (pendingRow && pendingRow !== row) commitPendingValue();
    clearTimeout(pendingTimer);
    pendingRow = row;
    pendingTimer = setTimeout(commitPendingValue);
  });

  // A quick click on a button right after typing (press and release inside the
  // one-tick wait above) would run its handler on the OLD query: Run would
  // search without the value, and the login / compliance links would save a
  // query without it. So any click, before anything else sees it, first
  // commits the value waiting for its tick. (`capture`: it must run before the
  // handlers on the panels and on `document`.)
  document.addEventListener("click", commitPendingValue, true);

  return (state) => {
    paintQueryBuilder(container, state);
    onDropdownChange(container, (el) => {
      const row = el.closest<HTMLElement>(".qb-condition[data-node-id]");
      if (row) handleRowChange(row, el.querySelector("select")?.dataset.part);
    });
  };
}
