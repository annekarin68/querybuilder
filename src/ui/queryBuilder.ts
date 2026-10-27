import type { AppState, PanelTab } from "../state";
import type { FacetBlock, Group } from "../query/types";
import {
  addChild,
  findNode,
  groupContents,
  newBlock,
  newGroup,
  removeCondition,
  removeNode,
  setNegated,
  ungroup,
  ungroupBlocker,
  UNGROUP_BLOCKED_MESSAGE,
  updateNode,
  type Direction,
} from "../query/tree";
import { findField } from "../query/fieldCatalog";
import { cursorAfterOperator, nextFieldCondition, queryAfterFieldEdit } from "../query/fieldEdit";
import {
  ADDED_GROUP_MESSAGE,
  addedNodesMessage,
  DRAG_MIME,
  dropLandsInBlock,
  groupedMessage,
  parseDragItem,
  UNGROUPED_MESSAGE,
  type DragItem,
  type FieldRef,
} from "../query/drop";
import { placeIssues } from "../query/issues";
import { isEdited } from "../query/saved";
import {
  createAfterPointer,
  shouldFlushBeforeClick,
  type ClickTargetDescription,
} from "../util/afterPointer";
import { RESTORED_MESSAGE } from "../util/keptQuery";
import { escapeHtml, paint } from "./panel";
import { aboutCtxOf } from "./aboutPanel";
import { footerHtml, groupHtml, type BlockCtx } from "./blockHtml";
import { pickedOperatorId } from "./fieldRows";
import { onDropdownChange, openDropdown } from "./fomantic";
import { forgetDrag, draggedItem } from "./dragMemory";
import { hoverTitle } from "./format";
import { readValueControl } from "./valueControl";

/** The dismissible warning for a drop that couldn't be done in full. */
export function noticeHtml(notice: string | null): string {
  if (!notice) return "";
  return `<div class="ui warning message qb-notice">
      <i class="close icon" data-action="dismiss-notice" role="button" tabindex="0" aria-label="Dismiss"></i>
      <p>${escapeHtml(notice)}</p>
    </div>`;
}

/**
 * The notice that this page load brought the query back (a reload, a Back
 * from the login page: `restoredNotice`, set by `app.start`). Information, not
 * a warning, with **Start fresh** and a ✕, both real buttons. It has no
 * live-region role: `app.start` already says the same words through
 * `announce`, and a role would read them twice.
 */
export function restoredNoticeHtml(restored: boolean): string {
  if (!restored) return "";
  return `<div class="ui info message qb-restored">
      <p>${escapeHtml(RESTORED_MESSAGE)}</p>
      <button type="button" class="ui mini basic button" data-action="start-fresh">Start fresh</button>
      <button type="button" class="qb-icon-btn" data-action="dismiss-restored" aria-label="Dismiss" title="Dismiss"><i class="close icon"></i></button>
    </div>`;
}

/** Describe the element a click landed on for `shouldFlushBeforeClick`. */
function describeClickTarget(el: Element): ClickTargetDescription {
  return {
    inButton: el.closest("button") !== null,
    inLink: el.closest("a[href]") !== null,
    inDataAction: el.closest("[data-action]") !== null,
    inDropdown: el.closest(".ui.dropdown") !== null,
    inCheckbox: el.closest(".ui.checkbox") !== null,
  };
}

/** The element of node `nodeId` (a group, a facet block or a set field's
 *  row), or null if it is not on screen. Ids are unique, so one lookup serves
 *  all three. */
function nodeOf(container: HTMLElement, nodeId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
}

/**
 * Scrolls node `nodeId` into view and moves focus to it (the "Show" button of
 * the statistics panel). A row, block or group is not focusable by itself, so
 * it gets `tabindex="-1"` first: focusable by script, not a stop for the Tab
 * key. The builder repaints on every edit, which drops the attribute with the
 * element.
 */
export function revealNode(container: HTMLElement, nodeId: string): void {
  const node = nodeOf(container, nodeId);
  if (!node) return;
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  node.scrollIntoView({ block: "center" });
  node.focus();
}

/** The row of field `fieldId` in block `blockId`, or null if it is not on
 *  screen. (A stray row for the same field, `.is-stray`, is not that row.) */
function fieldRowOf(container: HTMLElement, blockId: string, fieldId: string): HTMLElement | null {
  return (
    nodeOf(container, blockId)?.querySelector<HTMLElement>(
      `.qb-field-row:not(.is-stray)[data-field-id="${CSS.escape(fieldId)}"]`,
    ) ?? null
  );
}

/** The `.ui.dropdown` Fomantic built from the row's operator `<select>`. */
function operatorDropdownOf(row: HTMLElement | null): HTMLElement | null {
  return (
    row?.querySelector('select[data-part="operator"]')?.closest<HTMLElement>(".ui.dropdown") ?? null
  );
}

/**
 * Put the cursor in the value of field `fieldId`'s row in block `blockId`,
 * opening it if it is a dropdown. The value is a dropdown, one or two text
 * boxes or a toggle: the cursor goes to the first.
 */
function focusValue(container: HTMLElement, blockId: string, fieldId: string): void {
  const slot = fieldRowOf(container, blockId, fieldId)?.querySelector<HTMLElement>(".qb-value");
  if (!slot) return;
  const dropdown = slot.querySelector<HTMLElement>(".ui.dropdown");
  if (dropdown) openDropdown(dropdown);
  else slot.querySelector("input")?.focus();
}

/**
 * Put the keyboard focus in field `fieldId`'s row of block `blockId`: after a
 * repaint that changed the row's shape (it was set or cleared, or an unset row
 * was opened or closed), where focus memory cannot find the control again and
 * would send the focus to the group's "+ Group", and after a mouse drop that
 * opened the row. The operator dropdown's typing box gets it (its menu stays
 * closed), or an unset row's button. Does nothing if the focus is in the row
 * already.
 */
function keepFocusInRow(container: HTMLElement, blockId: string, fieldId: string): void {
  const row = fieldRowOf(container, blockId, fieldId);
  if (!row || row.contains(document.activeElement)) return;
  const target =
    operatorDropdownOf(row)?.querySelector<HTMLElement>("input.search") ??
    row.querySelector<HTMLElement>('[data-action="edit-field"]');
  target?.focus();
}

/**
 * The query card's title row: "Query", the open saved query's name and
 * "(edited)" once the query or the database selection differs from what was
 * last saved or opened, then **Save…** and **Saved queries** (docs/ARCHITECTURE.md,
 * "Saved queries — `savedQueries.ts`"). A logged-out user who presses either
 * button is asked to log in first, in the saved-queries dialog (`loginHtml`,
 * src/ui/savedQueries.ts).
 *
 * The two buttons only exist once startup has loaded the databases and the
 * field catalog: start() sets the query and selection when it ends, so a saved
 * query opened before that would be overwritten.
 */
export function queryTitleHtml(state: AppState): string {
  const open = state.openSaved;
  const name = open
    ? ` <span class="qb-open-name" title="${escapeHtml(open.name)}">· ${escapeHtml(open.name)}</span>`
    : "";
  const edited =
    open && isEdited(open, state.query, state.selectedDatabaseIds)
      ? ` <span class="qb-muted">(edited)</span>`
      : "";
  const drawn = Boolean(state.catalog && state.databases);
  const buttons = drawn
    ? `<button type="button" class="ui mini basic button" data-action="open-save-dialog" aria-haspopup="dialog">Save…</button>
         <button type="button" class="ui mini basic button" data-action="open-saved-list" aria-haspopup="dialog">Saved queries</button>`
    : "";
  return `<div class="qb-query-head">
      <h2 class="qb-card-title">Query${name}${edited}</h2>
      <span class="qb-spacer"></span>
      ${buttons}
    </div>`;
}

/**
 * The state keys the builder's painter listens to in main.ts. Not
 * `selectedField`: the builder draws the About panels with it, but a change
 * of it alone repaints only those (`paintAboutPanels`, `ABOUT_PANEL_KEYS`).
 * Selecting happens on every focus move into a row, and a builder repaint
 * would close the dropdown the focus just moved into.
 */
export const QUERY_BUILDER_KEYS: (keyof AppState)[] = [
  "catalog",
  "databases",
  "query",
  "expandedBlockIds",
  "openField",
  "panelTab",
  "issues",
  "serverIssues",
  "facets",
  "dropNotice",
  "restoredNotice",
  "openSaved",
  "selectedDatabaseIds",
];

function paintQueryBuilder(el: HTMLElement, state: AppState): void {
  if (!state.catalog) {
    paint(el, `<div class="qb-card"><div class="ui active centered inline loader"></div></div>`);
    return;
  }
  // Local issues (src/query/validate.ts) and the backend's, each on a node that is drawn.
  const issues = placeIssues(state.query, [...state.issues, ...state.serverIssues]);
  const ctx: BlockCtx = {
    // The facets, the event total and the selected field, for About.
    ...aboutCtxOf(state),
    catalog: state.catalog,
    issues,
    query: state.query,
    expandedBlockIds: state.expandedBlockIds,
    openField: state.openField,
    panelTab: state.panelTab,
  };
  paint(
    el,
    `${restoredNoticeHtml(state.restoredNotice)}${noticeHtml(state.dropNotice)}<div class="qb-card qb-query" tabindex="-1" data-focus-landing>
       ${queryTitleHtml(state)}
       ${groupHtml(ctx, state.query, true)}
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
    /** Returns the field row the drop opened (null: none), which then gets
     *  the keyboard focus. */
    onDrop(item: DragItem | null, targetNodeId: string): FieldRef | null;
    /** The Move up / Move down buttons: swap a node with its neighbour. */
    onMove(nodeId: string, direction: Direction): void;
    onDismissNotice(): void;
    /** Show a warning above the query (a refused action, not a drop). */
    onNotice(message: string): void;
    /** Say something to screen-reader users (the shell's live region). */
    announce(message: string): void;
    /** The title's **Save…** and **Saved queries** (src/ui/savedQueries.ts shows the dialogs). */
    onOpenSaveDialog(): void;
    onOpenSavedList(): void;
    /** The Restored notice's **Start fresh** and ✕. */
    onStartFresh(): void;
    onDismissRestored(): void;
    /** Open a field row for editing (`AppState.openField`), or close the
     *  open one (null). Not a query edit. */
    openFieldRow(ref: FieldRef | null): void;
    /** "+ N more fields" / "Show fewer fields" on a block. Not a query edit. */
    toggleFields(blockId: string): void;
    /** A panel tab pressed (the open one again: hide the panel). */
    setPanelTab(tab: PanelTab): void;
    /** The field About describes (null: the block's facet). Repaints only
     *  the About panels, never the rows. */
    selectFieldForPanel(ref: FieldRef | null): void;
  },
): (state: AppState) => void {
  /** The facet block a field row (or anything else inside a block) belongs
   *  to, as it is in the query now; null if it is gone. */
  function blockOf(el: HTMLElement): FacetBlock | null {
    const blockId = el.closest<HTMLElement>(".qb-block[data-node-id]")?.dataset.nodeId;
    const block = blockId ? findNode(getState().query, blockId) : null;
    return block?.kind === "facet" ? block : null;
  }

  /**
   * The user picked an operator in a field row, or "Not filtered", which
   * clears the field. Everything is read from the row before `onChange`,
   * which repaints at once and replaces the row.
   */
  function handleOperatorChange(row: HTMLElement): void {
    const { query, catalog } = getState();
    const block = blockOf(row);
    const fieldId = row.dataset.fieldId;
    if (!catalog || !block || !fieldId) return;
    const picked = row.querySelector<HTMLSelectElement>('select[data-part="operator"]')?.value;
    // The condition this very row stands for (an unset row has none), never
    // another one on the same field: a stray duplicate has a row of its own.
    const existing = block.conditions.find((c) => c.id === row.dataset.nodeId);
    const next = nextFieldCondition(
      existing,
      block.facetId,
      fieldId,
      pickedOperatorId(picked ?? ""),
      catalog,
      (arity, valueType) => readValueControl(row, arity, valueType),
    );
    // "Not filtered": the row goes back to a plain unset one, so it is no
    // longer the open row.
    if (!next) hooks.openFieldRow(null);
    onChange(queryAfterFieldEdit(query, block, existing?.id, next, catalog));
    // The repaint lost the cursor (the row changed shape): on to the value if
    // the operator takes one, otherwise stay in the row.
    if (cursorAfterOperator(next?.operatorId ?? null) === "value") {
      focusValue(container, block.id, fieldId);
    } else {
      keepFocusInRow(container, block.id, fieldId);
    }
  }

  /** Apply the value shown in field row `row` to its condition. Only a set
   *  row with an operator has a value control. */
  function commitValue(row: HTMLElement): void {
    const { query, catalog } = getState();
    const block = blockOf(row);
    const fieldId = row.dataset.fieldId;
    // The condition this very row was drawn for, found by the row's node id
    // (as in handleOperatorChange). The row may have been repainted since (see
    // afterPointer below): its boxes still hold what was typed, and if that
    // condition is gone by now the typed value goes with it.
    const existing = block?.conditions.find((c) => c.id === row.dataset.nodeId);
    if (!catalog || !block || !fieldId || !existing?.operatorId) return;
    // A field the catalog doesn't know has no value box to read.
    if (!findField(catalog, block.facetId, fieldId)) return;
    const next = nextFieldCondition(
      existing,
      block.facetId,
      fieldId,
      existing.operatorId,
      catalog,
      (arity, valueType) => readValueControl(row, arity, valueType),
    );
    if (next) onChange(queryAfterFieldEdit(query, block, existing.id, next, catalog));
  }

  /** "+ Facet": a new block for the picked facet at the end of the group.
   *  paint() keeps the focus on the picker, so the user can add another. */
  function handleAddFacet(picker: HTMLElement): void {
    const facetId = picker.querySelector("select")?.value;
    const groupId = picker.closest<HTMLElement>(".qb-group[data-node-id]")?.dataset.nodeId;
    if (!facetId || !groupId) return;
    const block = newBlock(facetId);
    onChange(addChild(getState().query, groupId, block));
    // The new block is not where the focus is: say what happened.
    hooks.announce(addedNodesMessage([block]));
  }

  /**
   * Commit what was typed in `row`. A click on a dropdown is not flushed early
   * (see `shouldFlushBeforeClick`), so its menu is already open when this runs,
   * and the repaint closes it under the user's pointer. paint() puts the focus
   * back in that dropdown, so its menu is opened again.
   */
  function commitTypedValue(row: HTMLElement): void {
    const menuWasOpen = Boolean(document.activeElement?.closest(".ui.dropdown.active"));
    commitValue(row);
    const dropdown = document.activeElement?.closest<HTMLElement>(".ui.dropdown");
    if (menuWasOpen && dropdown && container.contains(dropdown)) openDropdown(dropdown);
  }

  // A typed value is committed later than the `change` that announced it, at
  // the moment `afterPointer` picks (src/util/afterPointer.ts says why; so does
  // "Centre — `queryBuilder.ts`" in docs/ARCHITECTURE.md). These listeners are
  // on `document` and never removed, which is fine because wireQueryBuilder is
  // called once.
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
  // matching pointerup.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button === 0) pointerIsDown = true;
    },
    listenOptions,
  );
  document.addEventListener("pointerup", pointerEnded, listenOptions);
  document.addEventListener("pointercancel", pointerEnded, listenOptions);
  // The pointer-up can also go missing when the window loses focus (a context
  // menu, Alt+Tab): without this the edit would wait for ever.
  window.addEventListener("blur", () => {
    pointerIsDown = false;
    afterPointer.flush();
  });
  // A button or link must see the typed value when it reads the query (Run
  // would search without it, and the login / compliance links would save a
  // query without it), so a click on one applies the held edit first.
  // `capture`: before the handlers on the panels and on `document`. Which
  // clicks that covers is decided by `shouldFlushBeforeClick`.
  document.addEventListener(
    "click",
    (e) => {
      if (!(e.target instanceof Element)) return;
      if (shouldFlushBeforeClick(describeClickTarget(e.target))) afterPointer.flush();
    },
    listenOptions,
  );

  /** Dismiss the warning. The repaint removes the ✕ the user was on, so
   *  paint() moves their keyboard focus to the query card (its
   *  `data-focus-landing`). */
  function dismissNotice(): void {
    hooks.onDismissNotice();
  }

  /** An action that worked clears an older warning (such as a refused Ungroup),
   *  the way a fully successful drop does: it is not about the query any more. */
  function clearOldNotice(): void {
    if (getState().dropNotice) hooks.onDismissNotice();
  }

  container.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='dismiss-notice']")) {
      return dismissNotice();
    }
    // The grip is for dragging; a click on it must not also toggle a folded group.
    if ((e.target as HTMLElement).closest(".qb-grip")) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    // A drag across a folded group's or block's line to select its text ends in
    // a click on that line: that is not a request to unfold it. (Only the
    // header itself, not a button of its own, is a toggle by a click anywhere
    // on its line.)
    const isFoldedHead = btn?.matches(".qb-group-head, .qb-block-head") ?? false;
    if (isFoldedHead && window.getSelection()?.toString()) return;
    // The title's buttons and the Restored notice's sit outside every row and
    // group, so they are handled before the node lookup below.
    if (btn?.dataset.action === "open-save-dialog") return hooks.onOpenSaveDialog();
    if (btn?.dataset.action === "open-saved-list") return hooks.onOpenSavedList();
    if (btn?.dataset.action === "start-fresh") return hooks.onStartFresh();
    if (btn?.dataset.action === "dismiss-restored") return hooks.onDismissRestored();
    // The panel's tabs switch the panel of every block, not one node.
    if (btn?.dataset.action === "panel-seen") return hooks.setPanelTab("seen");
    if (btn?.dataset.action === "panel-about") return hooks.setPanelTab("about");
    if (btn?.dataset.action === "about-facet") return hooks.selectFieldForPanel(null);
    // A field's name selects it for About. The name is plain text, not a
    // control, so the focus does not move there and `focusin` below misses it.
    const label = (e.target as HTMLElement).closest<HTMLElement>(".qb-field-label");
    if (label) return selectRowForPanel(label);
    // The group, block or set field row the button sits in.
    const nodeId = btn?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!btn || !nodeId) return;
    // An unavailable Move button (an end of the list) must do nothing, not even
    // toggle the folded group whose header it sits in. It is `aria-disabled`
    // rather than `disabled` so that it keeps keyboard focus (see moveButtons).
    // (Only Move: an aria-disabled Ungroup is pressed to hear why it is refused.)
    const isMove = btn.dataset.action === "move-up" || btn.dataset.action === "move-down";
    if (isMove && btn.getAttribute("aria-disabled") === "true") return;
    const q = getState().query;
    switch (btn.dataset.action) {
      // paint() keeps the keyboard focus on "+ Group", so pressing it again
      // adds another; the new group is not where the focus is, so it is announced.
      case "add-group":
        onChange(addChild(q, nodeId, newGroup()));
        return hooks.announce(ADDED_GROUP_MESSAGE);
      case "group-contents": {
        const node = findNode(q, nodeId);
        // A click from a stale repaint (the group is gone): nothing to group,
        // and "Grouped 0 items." would be wrong.
        if (node?.kind !== "group") return;
        onChange(groupContents(q, nodeId));
        clearOldNotice();
        return hooks.announce(groupedMessage(node.children.length));
      }
      case "ungroup": {
        const next = ungroup(q, nodeId);
        // Refused: say why (the button is aria-disabled, not disabled, so
        // keyboard and screen-reader users can reach it and hear the reason).
        if (!next) return hooks.onNotice(ungroupBlocker(q, nodeId) ?? UNGROUP_BLOCKED_MESSAGE);
        onChange(next);
        clearOldNotice();
        return hooks.announce(UNGROUPED_MESSAGE);
      }
      // A group's or a block's ✕. The focus goes to the group's "+ Group"
      // (its data-focus-landing), never to a neighbour's ✕.
      case "remove-node":
        return onChange(removeNode(q, nodeId));
      // ALL / ANY: a group's, or a block's over its set fields.
      case "set-and":
        return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or":
        return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "set-has":
        return onChange(setNegated(q, nodeId, false));
      case "set-has-no":
        return onChange(setNegated(q, nodeId, true));
      // paint() keeps the keyboard focus on the pressed button (the same node's
      // button for the same direction), so pressing it again keeps moving.
      case "move-up":
        return hooks.onMove(nodeId, "up");
      case "move-down":
        return hooks.onMove(nodeId, "down");
      case "toggle-collapse": {
        // paint() puts the focus back on this group's or block's (new) collapse button.
        const node = findNode(q, nodeId);
        return onChange(updateNode(q, nodeId, { collapsed: !node?.collapsed }));
      }
      case "toggle-fields": {
        const block = blockOf(btn);
        return block ? hooks.toggleFields(block.id) : undefined;
      }
      // An unset row's empty slot: open the row (its dropdowns are drawn once
      // it is the open field) with the operator list showing.
      case "edit-field": {
        const block = blockOf(btn);
        const fieldId = btn.dataset.fieldId;
        if (!block || !fieldId) return;
        hooks.openFieldRow({ blockId: block.id, fieldId });
        const dropdown = operatorDropdownOf(fieldRowOf(container, block.id, fieldId));
        return dropdown ? openDropdown(dropdown) : undefined;
      }
      // A stray row's ✕ (a field the dictionary no longer has, or a field set
      // twice): only that condition goes, `nodeId` is its row's.
      case "remove-condition": {
        const block = blockOf(btn);
        return block ? onChange(removeCondition(q, block.id, nodeId)) : undefined;
      }
    }
  });

  /** Select the field of the row `el` sits in for the About panel. A stray
   *  row counts too: About then says the dictionary does not know it. */
  function selectRowForPanel(el: HTMLElement): void {
    const row = el.closest<HTMLElement>(".qb-field-row");
    const block = blockOf(el);
    const fieldId = row?.dataset.fieldId;
    if (block && fieldId) hooks.selectFieldForPanel({ blockId: block.id, fieldId });
  }

  // The focus moving into a row (Tab, a click on its slot or dropdown)
  // selects its field for About. This repaints only the About panels, so the
  // dropdown being opened stays open.
  container.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".qb-field-row")) selectRowForPanel(target);
  });

  // Escape inside a block closes the open field row (an open dropdown menu
  // takes the first Escape itself: Fomantic stops it there). An open unset
  // row goes back to a plain one then, so the focus is kept in that row.
  // It also takes About back to the block's facet (spec, section 5).
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement;
    const block = blockOf(target);
    if (block && getState().selectedField?.blockId === block.id) hooks.selectFieldForPanel(null);
  });
  container.addEventListener("keydown", (e) => {
    const open = getState().openField;
    if (e.key !== "Escape" || !open) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".qb-block")) return;
    const wasInRow = fieldRowOf(container, open.blockId, open.fieldId)?.contains(target) ?? false;
    // A value still being typed is committed first, as a click elsewhere would
    // have done (its `change` has not fired yet): the repaint below would
    // throw the typed text away.
    afterPointer.flush();
    // (A stray row has no value box: its `.is-stray` is not a row to commit.)
    const typedRow = target.closest<HTMLElement>(".qb-field-row:not(.is-stray)[data-node-id]");
    if (typedRow) commitValue(typedRow);
    hooks.openFieldRow(null);
    if (wasInRow) keepFocusInRow(container, open.blockId, open.fieldId);
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
  /**
   * How to mark `target` while a drag is over it. A drop on a group lands at
   * its end (outline). A drop on a block lands just before it (a bar), except
   * a dictionary field or value of the block's own facet, which lands inside
   * the block: that block is the target (outline), as a bar would promise a
   * new block. The browser hides the drag's data until the drop, so the
   * dictionary item comes from `draggedItem`; when it is unknown (a drag
   * from elsewhere) the bar stays.
   */
  const dropMark = (target: HTMLElement): "is-drop-before" | "is-drop-target" => {
    if (!target.classList.contains("qb-block")) return "is-drop-target";
    const node = findNode(getState().query, target.dataset.nodeId!);
    const inside = node?.kind === "facet" && dropLandsInBlock(draggedItem(), node);
    return inside ? "is-drop-target" : "is-drop-before";
  };
  /** Where a drop at `el` lands: the nearest block or group. (A field row's
   *  `data-node-id` is its condition's, which is never a drop target: a field
   *  row never moves, and a dictionary item dropped on it is about its block.) */
  const targetOf = (el: EventTarget | null) =>
    el instanceof Element
      ? el.closest<HTMLElement>(".qb-block[data-node-id], .qb-group[data-node-id]")
      : null;

  container.addEventListener("dragstart", (e) => {
    if (!(e.target instanceof Element)) return; // e.g. a Text node
    const grip = e.target.closest<HTMLElement>("[data-node-item]");
    if (!grip || !e.dataTransfer) return;
    forgetDrag(); // a drag of our own, not a dictionary item
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
      target.classList.add(dropMark(target));
    }
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget as Node | null)) unmark();
  });

  container.addEventListener("drop", (e) => {
    if (!isOurs(e)) return;
    e.preventDefault();
    unmark();
    forgetDrag();
    const target = targetOf(e.target);
    if (!target) return;
    // An unreadable payload arrives as null; the app explains it to the user.
    const opened = hooks.onDrop(
      parseDragItem(e.dataTransfer!.getData(DRAG_MIME)),
      target.dataset.nodeId!,
    );
    // A drop that opened a row (a field, or a value that filled a row) moves
    // the keyboard focus into it, without opening its menu: the user goes on
    // with the keyboard where the mouse left off. (The dictionary's "Add to
    // query" does not come through here: its focus stays in the dictionary.)
    if (opened) keepFocusInRow(container, opened.blockId, opened.fieldId);
  });

  container.addEventListener("dragend", unmark);

  // The hover title of a value box follows what is typed: the box is only
  // repainted when the value is committed (on change), and until then the
  // title would show the old value. An emptied box loses the attribute, as a
  // box rendered empty has none.
  container.addEventListener("input", (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.dataset.part !== "value") return;
    const title = hoverTitle(box.value);
    if (title) box.title = title;
    else box.removeAttribute("title");
  });

  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    // Fomantic dispatches a native bubbling "change" on the <select> behind each
    // dropdown *before* calling its onChange. Handling both would run
    // the row's handler twice, the second time on a detached row, and write back
    // stale values. So every <select> is handled ONLY via onDropdownChange below.
    // A search dropdown's own typing box (input.search) fires "change" too, when
    // it loses focus on the mousedown before a menu click; repainting then would
    // remove the item under the pointer before the click lands. So anything
    // inside a .ui.dropdown is skipped, and this listener handles only the plain
    // <input>s (text/number, the range pair and the boolean toggle's checkbox).
    if (target instanceof HTMLSelectElement || target.closest(".ui.dropdown")) return;
    const row = target.closest<HTMLElement>(".qb-field-row[data-node-id]");
    // A box's "change" fires as it loses focus, before the user's next action
    // has finished, so the commit is held (see afterPointer above). The row may
    // be repainted by then; its boxes still hold what was typed, and the
    // commit applies them to the latest query by the row's node id.
    if (!row) return;
    afterPointer.run(() => commitTypedValue(row));
  });

  return (state) => {
    paintQueryBuilder(container, state);
    onDropdownChange(container, (el) => {
      const part = el.querySelector("select")?.dataset.part;
      if (part === "add-facet") return handleAddFacet(el);
      const row = el.closest<HTMLElement>(".qb-field-row");
      if (!row) return;
      if (part === "operator") handleOperatorChange(row);
      else commitValue(row); // a value chosen from a list
    });
  };
}
