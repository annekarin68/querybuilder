import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { Facet } from "../model";
import {
  FACET_OPERATOR_IDS,
  fieldsOfFacet,
  findField,
  findOperator,
  isFacetLevel,
  operatorName,
  OPERATORS,
  type FieldCatalog,
} from "../query/fieldCatalog";
import {
  addChild,
  countConditions,
  findNode,
  newCondition,
  newGroup,
  removeNode,
  updateNode,
} from "../query/tree";
import { nextCondition } from "../query/conditionEdit";
import { DRAG_MIME, parseDragItem, type DragItem } from "../query/drop";
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
  return `<div class="ui warning message qb-notice" role="status">
      <i class="close icon" data-action="dismiss-notice" role="button" tabindex="0" aria-label="Dismiss"></i>
      <p>${escapeHtml(notice)}</p>
    </div>`;
}

/** A node's drag handle: carries `{type: "node", nodeId}`. The id is kept in
 *  `data-node-item` and the drag payload is built from it in the dragstart
 *  handler, so no JSON lives in the DOM. */
function nodeGrip(nodeId: string): string {
  return `<span class="qb-grip" draggable="true" data-node-item="${escapeHtml(nodeId)}" aria-hidden="true" title="Drag to move"><i class="grip vertical icon"></i></span>`;
}

function iconButton(action: string, label: string, icon: string, extra = ""): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"${extra}><i class="${icon} icon"></i></button>`;
}

/** The three dropdowns of a condition row, in order, and their labels. */
const ROW_DROPDOWNS = { facet: "Facet", field: "Field", operator: "Operator" };

/**
 * One of a condition row's dropdowns: `part` is "facet", "field" or
 * "operator". Every one is a search dropdown — there can be many facets and
 * fields, so typing filters the list — and is disabled until the dropdown
 * before it has a choice.
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

/** The Field dropdown's value for "no field — about the facet itself". "" means
 *  nothing chosen yet; real fields are `FIELD_PREFIX` + id, so no field can
 *  ever collide with this value (or with a field literally named "Any field"). */
export const NO_FIELD = "none";
export const FIELD_PREFIX = "f:";

/** The row's Field dropdown: nothing chosen, the no-field choice, then the fields. */
export function fieldDropdown(
  fields: { id: string; name: string }[],
  selectedId: string | null,
  facetOnly: boolean,
  enabled: boolean,
): string {
  const opts = optionsHtml(
    fields,
    (f) => FIELD_PREFIX + f.id,
    (f) => f.name,
    (f) => f.id === selectedId,
  );
  const noField = `<option value="${NO_FIELD}"${facetOnly ? " selected" : ""}>— no field (facet only) —</option>`;
  // Fomantic copies the <select>'s classes onto the dropdown it builds, so
  // `qb-field-select` limits the "no field" styling to this dropdown (a facet
  // or operator whose id is "none" is left alone) and `qb-no-field` styles the
  // shown text when that choice is selected.
  return `<select class="ui search selection dropdown qb-field-select${facetOnly ? " qb-no-field" : ""}" data-part="field" aria-label="Field"${enabled ? "" : " disabled"}><option value="">Field…</option>${noField}${opts}</select>`;
}

/** Read the Field dropdown's value (see NO_FIELD / FIELD_PREFIX): the no-field
 *  choice, a real field's id, or nothing chosen yet. */
export function decodeFieldValue(value: string | null): {
  facetOnly: boolean;
  fieldId: string | null;
} {
  if (value === NO_FIELD) return { facetOnly: true, fieldId: null };
  const fieldId = value?.startsWith(FIELD_PREFIX) ? value.slice(FIELD_PREFIX.length) : "";
  return { facetOnly: false, fieldId: fieldId || null };
}

/** Where the cursor goes after a choice in a condition row's dropdown, so a
 *  whole condition can be built from the keyboard. */
const NEXT_PART: Record<string, string> = { facet: "field", field: "operator", operator: "value" };

/**
 * Put the cursor in `part` of condition `nodeId`'s row, opening it if it is a
 * dropdown. The value is a dropdown, one or two text boxes or a toggle: the
 * cursor goes to the first. Does nothing for a value the operator doesn't take.
 */
function focusPart(container: HTMLElement, nodeId: string, part: string): void {
  const row = container.querySelector(`.qb-condition[data-node-id="${CSS.escape(nodeId)}"]`);
  const slot =
    part === "value"
      ? row?.querySelector<HTMLElement>(".qb-value")
      : row?.querySelector(`select[data-part="${part}"]`)?.closest<HTMLElement>(".ui.dropdown");
  if (!slot) return;
  const dropdown = slot.matches(".ui.dropdown")
    ? slot
    : slot.querySelector<HTMLElement>(".ui.dropdown");
  if (dropdown) openDropdown(dropdown);
  else slot.querySelector("input")?.focus();
}

function conditionHtml(ctx: BuilderCtx, c: Condition): string {
  const field = findField(ctx.catalog, c.facetId, c.fieldId);
  const operator = findOperator(c.operatorId);
  const fields = fieldsOfFacet(ctx.catalog, c.facetId).map((f) => ({
    id: f.fieldId,
    name: f.fieldName,
  }));
  const facetLevel = isFacetLevel(c);
  const operators = facetLevel
    ? OPERATORS.filter((o) => FACET_OPERATOR_IDS.includes(o.id))
    : field
      ? OPERATORS.filter((o) => field.operatorIds.includes(o.id))
      : [];
  const operatorChoices = operators.map((o) => ({ id: o.id, name: operatorName(o, facetLevel) }));
  return `<div class="qb-condition" data-node-id="${escapeHtml(c.id)}">
    <div class="qb-cond-row">
      ${nodeGrip(c.id)}
      <div class="qb-cond-grid">
        ${rowDropdown("facet", ctx.facets ?? [], c.facetId, true)}
        ${fieldDropdown(fields, c.fieldId, facetLevel, Boolean(c.facetId))}
        ${rowDropdown("operator", operatorChoices, c.operatorId, field !== undefined || facetLevel)}
        <div class="qb-value">${renderValueControl(field, operator, c.value)}</div>
        ${iconButton("remove-node", "Remove condition", "times")}
      </div>
    </div>
    ${issuesHtml(c.id, ctx.issues)}
  </div>`;
}

/** Put the cursor on group `nodeId`'s fold/unfold button. */
function focusCollapseButton(container: HTMLElement, nodeId: string): void {
  container
    .querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(nodeId)}"] > .qb-group-head .qb-collapse-btn`,
    )
    ?.focus();
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
 */
export function groupHtml(ctx: BuilderCtx, g: Group, isRoot: boolean): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  if (g.collapsed) {
    const text = queryToText(g, ctx.catalog);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head" data-action="toggle-collapse" title="Click to expand">
        ${isRoot ? "" : nodeGrip(g.id)}
        ${collapseButton(true)}
        <span class="qb-op-badge">${matchWord}</span>
        <span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        <span class="qb-count">${countLabel(countConditions(g), "condition")}</span>
        ${remove}
      </div>
      ${issuesHtml(g.id, ctx.issues)}
    </div>`;
  }
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children.map((child) => nodeHtml(ctx, child, false)).join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${isRoot ? "" : nodeGrip(g.id)}
      ${collapseButton(false)}
      <span class="qb-group-label">Match</span>
      <span class="qb-logic" role="group" aria-label="Combine conditions with">
        <button type="button" class="qb-logic-btn${g.operator === "AND" ? " is-on" : ""}" data-action="set-and" aria-pressed="${g.operator === "AND"}">ALL</button>
        <button type="button" class="qb-logic-btn${g.operator === "OR" ? " is-on" : ""}" data-action="set-or" aria-pressed="${g.operator === "OR"}">ANY</button>
      </span>
      <span class="qb-group-label">of the following</span>
      <span class="qb-spacer"></span>
      <button type="button" class="ui mini basic button" data-action="add-condition"><i class="plus icon"></i>Condition</button>
      <button type="button" class="ui mini basic button" data-action="add-group"><i class="plus icon"></i>Group</button>
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
  const ctx: BuilderCtx = { catalog: state.catalog, facets: state.facets, issues };
  paint(
    el,
    `${noticeHtml(state.dropNotice)}<div class="qb-card qb-query" tabindex="-1">
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
  drops: { onDrop(item: DragItem | null, targetNodeId: string): void; onDismissNotice(): void },
): (state: AppState) => void {
  /** `changedPart`: the dropdown just used ("facet", "field", …), if any. */
  function handleRowChange(row: HTMLElement, changedPart?: string): void {
    const { query, catalog } = getState();
    const cond = findNode(query, row.dataset.nodeId!);
    if (!catalog || !cond || cond.kind !== "condition") return;
    const picked = (part: string) =>
      row.querySelector<HTMLSelectElement>(`select[data-part="${part}"]`)?.value || null;
    const { facetOnly, fieldId } = decodeFieldValue(picked("field"));
    const nextPart = changedPart && picked(changedPart) ? NEXT_PART[changedPart] : undefined;
    const patch = nextCondition(
      cond,
      {
        facetId: picked("facet"),
        fieldId,
        operatorId: picked("operator"),
        facetOnly,
      },
      catalog,
      (arity, valueType) => readValueControl(row, arity, valueType),
    );
    onChange(updateNode(query, cond.id, patch));
    // onChange repaints at once, replacing the row, so the cursor is lost:
    // put it in the next part of the new row.
    if (nextPart) focusPart(container, cond.id, nextPart);
  }

  /** Dismiss the warning. The repaint removes the ✕ the user was on, which
   *  would drop their keyboard focus, so move focus to the query card. */
  function dismissNotice(): void {
    drops.onDismissNotice();
    container.querySelector<HTMLElement>(".qb-query")?.focus();
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
      case "add-condition":
        return onChange(addChild(q, nodeId, newCondition()));
      case "add-group":
        return onChange(addChild(q, nodeId, newGroup()));
      case "remove-node":
        return onChange(removeNode(q, nodeId));
      case "set-and":
        return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or":
        return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "toggle-collapse": {
        const node = findNode(q, nodeId);
        onChange(updateNode(q, nodeId, { collapsed: !(node?.kind === "group" && node.collapsed) }));
        // The repaint replaced the button that had focus; put it back on the
        // same group's (new) collapse button, as focusPart does for a condition.
        focusCollapseButton(container, nodeId);
        return;
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
    drops.onDrop(parseDragItem(e.dataTransfer!.getData(DRAG_MIME)), target.dataset.nodeId!);
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
    if (row) handleRowChange(row);
  });

  return (state) => {
    paintQueryBuilder(container, state);
    onDropdownChange(container, (el) => {
      const row = el.closest<HTMLElement>(".qb-condition[data-node-id]");
      if (row) handleRowChange(row, el.querySelector("select")?.dataset.part);
    });
  };
}
