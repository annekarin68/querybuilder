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
  newCondition,
  newGroup,
  removeNode,
  updateNode,
  type Direction,
  type NodePatch,
} from "../query/tree";
import { announcementAfterChange, cursorAfterChange, nextCondition } from "../query/conditionEdit";
import { DRAG_MIME, parseDragItem, type DragItem } from "../query/drop";
import { placeIssues } from "../query/issues";
import { queryToText } from "../query/summary";
import { createAfterPointer } from "../util/afterPointer";
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
 *  handler, so no JSON lives in the DOM. A group's grip looks different from a
 *  condition's (`qb-grip-group`, drawn in the group's colour) and its tooltip
 *  says what it moves: the two sit at the same left edge, so otherwise a user
 *  cannot tell which one carries the whole group. */
function nodeGrip(nodeId: string, kind: "group" | "condition"): string {
  const cls = kind === "group" ? "qb-grip qb-grip-group" : "qb-grip";
  return `<span class="${cls}" draggable="true" data-node-item="${escapeHtml(nodeId)}" aria-hidden="true" title="Drag to move this ${kind}"><i class="grip vertical icon"></i></span>`;
}

function iconButton(action: string, label: string, icon: string, extra = ""): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"${extra}><i class="${icon} icon"></i></button>`;
}

/** Where a node stands among its siblings: `index` counts from 1. */
interface Position {
  index: number;
  count: number;
}

/**
 * The Move up / Move down pair: the keyboard's way to reorder a node (dragging
 * needs a mouse). A narrow vertical stack of two small buttons next to the grip.
 * The first node's Up and the last node's Down are `disabled` rather than
 * hidden, so the pair keeps its shape and a screen reader says why nothing
 * happens. `kind` ("condition" or "group") names what moves, because a page
 * has many pairs and "Move up" alone would not say which node it is for.
 */
export function moveButtons(kind: "condition" | "group", position: Position): string {
  const button = (direction: Direction, disabled: boolean) => {
    const label = `Move ${kind} ${direction}`;
    const title = `Move ${direction}`;
    return `<button type="button" class="qb-icon-btn" data-action="move-${direction}" aria-label="${label}" title="${title}"${disabled ? " disabled" : ""}><i class="angle ${direction} icon"></i></button>`;
  };
  return `<span class="qb-move" role="group" aria-label="Move this ${kind}">${button("up", position.index <= 1)}${button("down", position.index >= position.count)}</span>`;
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

/** Where the cursor stood inside a condition row, in terms that survive a
 *  repaint (the element itself does not). `range` is "from" or "to" in a
 *  Between pair. */
interface CursorSpot {
  nodeId: string;
  part: string;
  range: string | null;
}

/**
 * The cursor's place if it is on a dropdown or a text or number box of a
 * condition row, else null (a button needs no help: `paint` restores it).
 */
function cursorSpot(container: HTMLElement): CursorSpot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active)) return null;
  const nodeId = active.closest<HTMLElement>(".qb-condition[data-node-id]")?.dataset.nodeId;
  // The dropdown's typing box (the focused element) has no data-part; its
  // <select> beside it has.
  const dropdownPart = active.closest(".ui.dropdown")?.querySelector("select")?.dataset.part;
  const part = dropdownPart ?? active.dataset.part;
  return nodeId && part ? { nodeId, part, range: active.dataset.range ?? null } : null;
}

/** Put the cursor back where `cursorSpot` found it, in the repainted row. */
function restoreCursorSpot(container: HTMLElement, spot: CursorSpot): void {
  if (spot.range) {
    // focusPart would choose the first box, not the "to" one.
    nodeOf(container, spot.nodeId)
      ?.querySelector<HTMLElement>(`input[data-range="${spot.range}"]`)
      ?.focus();
  } else {
    focusPart(container, spot.nodeId, spot.part);
  }
}

function conditionHtml(ctx: BuilderCtx, c: Condition, position: Position): string {
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
      ${moveButtons("condition", position)}
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

/** Put the cursor on group `nodeId`'s fold/unfold button. */
function focusCollapseButton(container: HTMLElement, nodeId: string): void {
  nodeOf(container, nodeId)
    ?.querySelector<HTMLElement>(":scope > .qb-group-head .qb-collapse-btn")
    ?.focus();
}

/**
 * After a keyboard press on a ✕ the node and its button are gone, so `paint`
 * has nothing to put the cursor back on. Put it on the "+ Condition" button of
 * the group the node was in: the user is most likely to go on editing there.
 */
function focusAddConditionButton(container: HTMLElement, groupId: string): void {
  nodeOf(container, groupId)
    ?.querySelector<HTMLElement>(":scope > .qb-group-head [data-action='add-condition']")
    ?.focus();
}

/**
 * After a keyboard press on group or condition `nodeId`'s Move up / Move down
 * button the repaint replaced it: put the cursor on the same node's button for
 * the same `direction`, so the user can press it again to keep moving. When the
 * node has reached an end that button is now disabled and can't take focus, so
 * use the other one (the user can only go back the way they came).
 */
function focusMoveButton(container: HTMLElement, nodeId: string, direction: Direction): void {
  const pair = nodeOf(container, nodeId)?.querySelector<HTMLElement>(
    ":scope > .qb-cond-row > .qb-move, :scope > .qb-group-head > .qb-move",
  );
  const same = pair?.querySelector<HTMLButtonElement>(`[data-action="move-${direction}"]`);
  const other = pair?.querySelector<HTMLButtonElement>(
    `[data-action="move-${direction === "up" ? "down" : "up"}"]`,
  );
  (same?.disabled ? other : same)?.focus();
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
export function groupHtml(
  ctx: BuilderCtx,
  g: Group,
  isRoot: boolean,
  position: Position | null = null,
): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  // The root has no siblings to pass, so it has no buttons.
  const move = position ? moveButtons("group", position) : "";
  if (g.collapsed) {
    const text = queryToText(g, ctx.catalog);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head" data-action="toggle-collapse" title="Click to expand">
        ${isRoot ? "" : nodeGrip(g.id, "group")}
        ${move}
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
  const children = g.children
    .map((child, i) => nodeHtml(ctx, child, false, { index: i + 1, count: g.children.length }))
    .join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${isRoot ? "" : nodeGrip(g.id, "group")}
      ${move}
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

/** `position` is null only for the root, the one node with no siblings. */
function nodeHtml(
  ctx: BuilderCtx,
  node: QueryNode,
  isRoot: boolean,
  position: Position | null,
): string {
  if (node.kind === "group") return groupHtml(ctx, node, isRoot, position);
  // A condition is never the root, so it always has a position.
  return conditionHtml(ctx, node, position!);
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
       ${nodeHtml(ctx, state.query, true, null)}
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
    /** The Move up / Move down buttons: swap a node with its neighbour. */
    onMove(nodeId: string, direction: Direction): void;
    onDismissNotice(): void;
    /** Say something to screen-reader users (the shell's live region). */
    announce(message: string): void;
  },
): (state: AppState) => void {
  /** What a change in `row` amounts to: the condition as it is on screen now
   *  and the patch to apply. `changedPart`: the dropdown just used ("facet",
   *  "field", …), if any. Null when the row is not a condition we know. */
  function readRowEdit(row: HTMLElement, changedPart?: string) {
    const { query, catalog } = getState();
    const cond = findNode(query, row.dataset.nodeId!);
    if (!catalog || !cond || cond.kind !== "condition") return null;
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
    // Read the changed dropdown now: the caller repaints at once and replaces
    // this row, so it must not be read afterwards.
    const hasChoice = Boolean(changedPart && picked(changedPart));
    return { query, catalog, cond, patch, hasChoice };
  }

  function handleRowChange(row: HTMLElement, changedPart?: string): void {
    const edit = readRowEdit(row, changedPart);
    if (!edit) return;
    const { query, catalog, cond, patch, hasChoice } = edit;
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

  // A typed value is committed later than the `change` that announced it; see
  // the "Wiring" paragraph in docs/ARCHITECTURE.md for why. Document-wide, so
  // a press on any button in the page counts, not only one in this panel.
  let pointerIsDown = false;
  const afterPointer = createAfterPointer({
    isPointerDown: () => pointerIsDown,
    schedule: (task) => setTimeout(task, 0),
  });
  const pointerEnded = () => {
    pointerIsDown = false;
    afterPointer.pointerReleased();
  };
  const listenOptions = { capture: true, passive: true };
  // Only the primary button: a right-click opens a menu and may never send the
  // matching pointerup, which would hold every later commit for ever.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button === 0) pointerIsDown = true;
    },
    listenOptions,
  );
  document.addEventListener("pointerup", pointerEnded, listenOptions);
  document.addEventListener("pointercancel", pointerEnded, listenOptions);

  /**
   * Commit a typed value. The patch was read when `change` fired (the row was
   * still on screen), but it is applied to the LATEST query by node id: a click
   * that happened in between may have changed the tree. A node removed in the
   * meantime drops the edit silently.
   */
  function commitTypedValue(nodeId: string, patch: NodePatch): void {
    const { query } = getState();
    if (!findNode(query, nodeId)) return;
    // By now the browser has moved the focus to where the user was going; the
    // repaint destroys that control unless it is put back.
    const spot = cursorSpot(container);
    onChange(updateNode(query, nodeId, patch));
    if (spot) restoreCursorSpot(container, spot);
  }

  /** Dismiss the warning. The repaint removes the ✕ the user was on, which
   *  would drop their keyboard focus, so move focus to the query card. */
  function dismissNotice(): void {
    hooks.onDismissNotice();
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
    // A disabled Move button (an end of the list) must do nothing, not even
    // toggle the folded group whose header it sits in.
    if (btn.hasAttribute("disabled")) return;
    const q = getState().query;
    switch (btn.dataset.action) {
      case "add-condition":
        return onChange(addChild(q, nodeId, newCondition()));
      case "add-group":
        return onChange(addChild(q, nodeId, newGroup()));
      case "remove-node": {
        // Find the parent first: the repaint removes the node from the page.
        const groupId = nodeOf(container, nodeId)?.parentElement?.closest<HTMLElement>(
          "[data-node-id]",
        )?.dataset.nodeId;
        onChange(removeNode(q, nodeId));
        if (e.detail === 0 && groupId) focusAddConditionButton(container, groupId);
        return;
      }
      case "set-and":
        return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or":
        return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "move-up":
      case "move-down": {
        const direction = btn.dataset.action === "move-up" ? "up" : "down";
        hooks.onMove(nodeId, direction);
        // The repaint replaced the pressed button: as for the collapse button,
        // give the keyboard user's cursor back (a mouse click needs none).
        if (e.detail === 0) focusMoveButton(container, nodeId, direction);
        return;
      }
      case "toggle-collapse": {
        const node = findNode(q, nodeId);
        onChange(updateNode(q, nodeId, { collapsed: !(node?.kind === "group" && node.collapsed) }));
        // The repaint replaced the button that had focus; after a keyboard
        // press (a click event with detail 0) put it back on the same group's
        // (new) collapse button, as focusPart does for a condition. A mouse
        // click (detail >= 1) needs no focus ring on the new button.
        if (e.detail === 0) focusCollapseButton(container, nodeId);
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
    // <input>s (text/number, the range pair and the boolean toggle's checkbox),
    // and those commit through afterPointer, not at once.
    if (target instanceof HTMLSelectElement || target.closest(".ui.dropdown")) return;
    const row = target.closest<HTMLElement>(".qb-condition[data-node-id]");
    const edit = row && readRowEdit(row);
    if (edit) afterPointer.run(() => commitTypedValue(edit.cond.id, edit.patch));
  });

  return (state) => {
    paintQueryBuilder(container, state);
    onDropdownChange(container, (el) => {
      const row = el.closest<HTMLElement>(".qb-condition[data-node-id]");
      if (row) handleRowChange(row, el.querySelector("select")?.dataset.part);
    });
  };
}
