import type { Facet } from "../model";
import type { FieldCatalog } from "../query/fieldCatalog";
import type { FieldRef } from "../query/drop";
import { blockText, queryToText } from "../query/summary";
import { countBlocks, ungroupBlocker } from "../query/tree";
import type { FacetBlock, Group, Issue, QueryNode } from "../query/types";
import type { PanelTab } from "../state";
import {
  collapseButton,
  iconButton,
  issuesHtml,
  moveButtons,
  nodeGrip,
  type Position,
} from "./builderParts";
import { aboutPanelHtml, aboutTitle, type AboutCtx } from "./aboutPanel";
import {
  CAPTION,
  coRowHtml,
  hasCoRow,
  offersSeenTogether,
  seenTogetherHtml,
  type CoCtx,
} from "./coOccurrenceHtml";
import { legendHtml, legendToggleHtml } from "./legendHtml";
import { facetNameOrId } from "./facetWords";
import { fieldRowsHtml } from "./fieldRows";
import { countLabel } from "./format";
import { escapeHtml } from "./panel";
import { popoverId } from "./popover";

// The HTML of the facet-block builder's tree: groups, facet blocks and the
// footer line. Pure strings, so the Node-only tests can reach them;
// queryBuilder.ts paints them and wires their buttons.

/** What every part of the tree's HTML needs, passed down the recursion.
 *  (`AboutCtx`: what each block's About panel needs.) */
export interface BlockCtx extends AboutCtx {
  catalog: FieldCatalog;
  /** The facets the "+ Facet" picker offers; null while they are loading. */
  facets: Facet[] | null;
  issues: Issue[];
  /** The whole query: a group's Ungroup button needs its parent's ALL/ANY. */
  query: Group;
  /** Blocks whose folded field list is open ("+ N more fields"). */
  expandedBlockIds: readonly string[];
  /** The field row drawn open for editing: an unset one gets its dropdowns. */
  openField: FieldRef | null;
  /** The tab open in every block's panel; null: no panel. */
  panelTab: PanelTab | null;
  /** The co-occurrence row and chart; null while the dictionary loads or
   *  without colours (`coCtxOf`). */
  co: CoCtx | null;
}

/** How many set fields a block needs before its ALL / ANY is drawn: with
 *  one field, ALL and ANY mean the same. */
const MIN_FIELDS_TO_COMBINE = 2;

/**
 * The block's colour class (styles.css): its *own* ALL / ANY, not its
 * group's, since its Has / ALL / ANY buttons are about this block. Only while
 * those buttons are drawn, though: with fewer than two set fields the block
 * is always in the ALL colour, so it never shows the ANY colour without an ANY
 * button to explain it (a saved ANY block, or one whose second field was
 * cleared, keeps its operator).
 */
function blockTone(block: FacetBlock): "qb-block-and" | "qb-block-or" {
  const combines = block.conditions.length >= MIN_FIELDS_TO_COMBINE;
  return combines && block.operator === "OR" ? "qb-block-or" : "qb-block-and";
}

/** A toggle button of a Has / Has no or ALL / ANY pair. */
function logicButton(on: boolean, action: string, label: string): string {
  return `<button type="button" class="qb-logic-btn${on ? " is-on" : ""}" data-action="${action}" aria-pressed="${on}">${label}</button>`;
}

/**
 * The panel's two tabs. They are toggle buttons (`aria-pressed`), not ARIA
 * tabs: pressing the open one hides the panel (for every block), which a tab
 * never does, and its title says so. Each has its own `data-action`, so the
 * focus stays on the pressed one across the repaint ("Keyboard focus across
 * repaints").
 */
function panelTabsHtml(open: PanelTab | null, offersSeen: boolean): string {
  const tab = (tab: PanelTab, label: string) => {
    const on = open === tab;
    const hide = on ? ` title="Hide panel"` : "";
    return `<button type="button" class="qb-tab-btn${on ? " is-on" : ""}" data-action="panel-${tab}" aria-pressed="${on}"${hide}>${label}</button>`;
  };
  const seen = offersSeen ? tab("seen", "Seen together") : "";
  return `<span class="qb-panel-tabs" role="group" aria-label="Panel beside the fields">${seen}${tab("about", "About")}</span>`;
}

/**
 * The tab the blocks show: `AppState.panelTab`, except that Seen together
 * is only offered when there is co-occurrence data (`offersSeenTogether`);
 * without it a block shows About in its place. The state is left as it is,
 * so the chart comes back by itself once data arrives.
 */
export function shownPanelTab(open: PanelTab | null, offersSeen: boolean): PanelTab | null {
  return open === "seen" && !offersSeen ? "about" : open;
}

/** The block's facet's name: the field catalog's, or its id when the
 *  catalog does not know it. (The catalog, not the dictionary: it is there
 *  as soon as the builder is drawn.) */
function facetNameOf(ctx: BlockCtx, block: FacetBlock): string {
  return facetNameOrId(ctx.catalog.facets, block.facetId);
}

/** The "?" that opens the colour legend, for the row (`row`) or the Seen
 *  together tab (`seen`): both explain the same colours. */
function legendButton(co: CoCtx, block: FacetBlock, name: string, where: "row" | "seen"): string {
  const action = where === "row" ? "legend" : "legend-seen";
  return legendToggleHtml(
    popoverId(block.id, where),
    action,
    legendHtml(name, co.tokens, co.showNames),
  );
}

/** Whether the block draws a co-occurrence row: there is a context (colour
 *  tokens, a loaded dictionary), some facet is seen with another, and the
 *  block's own facet has data (`hasCoRow`). */
function hasRow(co: CoCtx | null, block: FacetBlock): co is CoCtx {
  return co !== null && hasCoRow(co, block);
}

/**
 * The line above the head (spec, section 6, decision 22): the co-occurrence
 * row and the legend's "?" at its end. The "?" is the row's neighbour, not
 * inside it, so the row's arrow keys never land on it; and it is outside the
 * head, so a click on it does not unfold a folded block. No row, no line:
 * the legend explains the row's colours, and without a row (no
 * co-occurrence data, or no colour tokens) there are none, so the line would
 * only take room (decided 2026-10-28, to be confirmed by the maintainers:
 * they asked for a "?" on every block). The row's caption is not here but
 * in the head's first line (`rowCaption`).
 */
function coTopHtml(ctx: BlockCtx, block: FacetBlock): string {
  if (!hasRow(ctx.co, block)) return "";
  const row = coRowHtml(ctx.co, block);
  return `<div class="qb-co-top">${row}${legendButton(ctx.co, block, facetNameOf(ctx, block), "row")}</div>`;
}

/** The caption of the row's cell under the pointer or the focus (`CAPTION`),
 *  at the end of the head's first line: styles.css hangs it under that line,
 *  so it never covers the grip, Move or fold buttons. Only with a row. */
function rowCaption(ctx: BlockCtx, block: FacetBlock): string {
  return hasRow(ctx.co, block) ? CAPTION : "";
}

/**
 * The head's second line: which occurrence the block means. With no field
 * set it says that the block asks only whether the facet is there, in the
 * words of the query's summary ("Thing is present"): users did not know
 * that empty fields are a valid filter (maintainers, 2026-10-29). ALL / ANY
 * only once two fields are set, as with one they change nothing
 * (MIN_FIELDS_TO_COMBINE).
 */
function matchLineHtml(block: FacetBlock, facetName: string): string {
  const setCount = block.conditions.length;
  if (setCount === 0) {
    const state = block.negated ? "is absent" : "is present";
    return `<div class="qb-block-line qb-block-match"><span class="qb-group-label">No field set: matches every event where <strong>${escapeHtml(facetName)} ${state}</strong>.</span></div>`;
  }
  const words =
    setCount < MIN_FIELDS_TO_COMBINE
      ? `<span class="qb-group-label">an occurrence where the set field matches</span>`
      : `<span class="qb-group-label">an occurrence where</span><span class="qb-logic" role="group" aria-label="Combine the set fields with">${logicButton(block.operator === "AND", "set-and", "ALL")}${logicButton(block.operator === "OR", "set-or", "ANY")}</span><span class="qb-group-label">of the set fields match</span>`;
  return `<div class="qb-block-line qb-block-match">${words}</div>`;
}

/** The panel beside (or under) a block's rows: the tab that is open, or
 *  nothing when the panel is hidden. Seen together is the square pie chart
 *  (`seenTogetherHtml`); About is `aboutPanelHtml`, also repainted on its own
 *  (`paintAboutPanels`). `tabindex="-1"`: About takes the focus by script when
 *  the button the focus was on goes ("← About"); its `aria-label` names it
 *  for screen readers and for focus memory across a builder repaint. */
function panelHtml(ctx: BlockCtx, block: FacetBlock, tab: PanelTab | null): string {
  const id = escapeHtml(block.id);
  // "seen" is only shown with a context (`shownPanelTab`); `ctx.co` says so
  // to TypeScript too.
  if (tab === "seen" && ctx.co) {
    // The tab's own "?" only with a row, like the row's (coTopHtml).
    const legend = hasRow(ctx.co, block)
      ? legendButton(ctx.co, block, facetNameOf(ctx, block), "seen")
      : "";
    const chart = seenTogetherHtml(ctx.co, block, legend);
    return `<div class="qb-panel"><div class="qb-seen" data-block-id="${id}">${chart}</div></div>`;
  }
  if (tab === "about") {
    return `<div class="qb-panel"><div class="qb-about" data-block-id="${id}" tabindex="-1" role="group" aria-label="${escapeHtml(aboutTitle(ctx, block))}">${aboutPanelHtml(ctx, block)}</div></div>`;
  }
  return "";
}

/**
 * A facet block (spec, section 5): the co-occurrence row with the legend's
 * "?" (`coTopHtml`, also on a folded block), a head of two lines, its
 * issues, then its field rows with the panel beside them. Line 1: grip,
 * Move, fold, the facet's name, Has / Has no, then on the right the panel's
 * tabs and ✕. Line 2 (`matchLineHtml`): which occurrence it means.
 * The facet is fixed: to filter on another facet the user adds a block.
 */
export function blockHtml(ctx: BlockCtx, block: FacetBlock, position: Position): string {
  const name = facetNameOf(ctx, block);
  const tone = blockTone(block);
  const id = escapeHtml(block.id);
  const start = `${nodeGrip(block.id, "facet")}${moveButtons(name, position)}${collapseButton(Boolean(block.collapsed), "facet")}<span class="qb-block-name">${escapeHtml(name)}</span>`;
  const remove = iconButton("remove-node", `Remove ${name}`, "times");
  const coTop = coTopHtml(ctx, block);
  if (block.collapsed) {
    // A folded block's whole head is a click target for unfolding it, as a
    // folded group's line is (its buttons and grip keep their own jobs). It
    // has no rows and no panel, so no tabs either: they would switch nothing.
    const text = blockText(block, ctx.catalog);
    const summary = `<span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    return `<div class="qb-block ${tone} is-collapsed" data-node-id="${id}">${coTop}<div class="qb-block-head" data-action="toggle-collapse" title="Click to expand"><div class="qb-block-line">${start}${summary}<span class="qb-spacer"></span>${remove}${rowCaption(ctx, block)}</div></div>${issuesHtml(block.id, ctx.issues)}</div>`;
  }
  const has = `<span class="qb-logic" role="group" aria-label="Has or has no ${escapeHtml(name)}">${logicButton(!block.negated, "set-has", "Has")}${logicButton(block.negated, "set-has-no", "Has no")}</span>`;
  // The tabs and ✕ share one right-aligned box (as a group's actions
  // do): when the line wraps they move together and stay on the right, so the
  // ✕ is never alone at the start of a line.
  const offersSeen = offersSeenTogether(ctx.co);
  const tab = shownPanelTab(ctx.panelTab, offersSeen);
  const actions = `<span class="qb-block-actions">${panelTabsHtml(tab, offersSeen)}${remove}</span>`;
  const line1 = `<div class="qb-block-line">${start}${has}${actions}${rowCaption(ctx, block)}</div>`;
  const expanded = ctx.expandedBlockIds.includes(block.id);
  const openFieldId = ctx.openField?.blockId === block.id ? ctx.openField.fieldId : null;
  const rows = fieldRowsHtml(
    { catalog: ctx.catalog, issues: ctx.issues },
    block,
    expanded,
    openFieldId,
  );
  const panel = panelHtml(ctx, block, tab);
  // `shows-about`: a field's name selects it for About, so styles.css gives
  // the names a pointer cursor then. (With Seen together a click on a name
  // still selects, but nothing on screen would show it.)
  const bodyClasses = ["qb-block-body"];
  if (panel) bodyClasses.push("has-panel");
  if (tab === "about") bodyClasses.push("shows-about");
  const body = `<div class="${bodyClasses.join(" ")}"><div class="qb-field-rows">${rows}</div>${panel}</div>`;
  return `<div class="qb-block ${tone}" data-node-id="${id}">${coTop}<div class="qb-block-head">${line1}${matchLineHtml(block, name)}</div>${issuesHtml(block.id, ctx.issues)}${body}</div>`;
}

/** The "+ Facet" picker: one choice per facet. Choosing one adds a block to
 *  the group (the wiring resets the picker to its first, empty choice). */
function addFacetPicker(facets: Facet[] | null): string {
  const options = (facets ?? [])
    .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`)
    .join("");
  return `<select class="ui search selection dropdown qb-add-facet" data-part="add-facet" aria-label="Add a facet to this group"><option value="">+ Facet</option>${options}</select>`;
}

/**
 * A group is drawn as a coloured bracket with a faint tint (green = ALL/AND,
 * mustard = ANY/OR — see styles.css). Between its children sits a small AND/OR
 * "joiner" on the bracket line. A collapsed group folds to one line: its
 * plain-English summary and how many facets it holds. That whole line is a
 * click target for unfolding it (buttons and the grip inside keep their own jobs).
 *
 * "+ Group" is the group's `data-focus-landing`: when the control that had
 * the keyboard focus is removed (a block's or a sub-group's ✕), focus goes there,
 * in the same group, and not onto a neighbour's ✕ where a second Enter would
 * delete something else (see focusMemory.ts). It is a <button> we draw, so it
 * takes the focus as itself after every repaint. The "+ Facet" picker is not
 * the landing: it is a Fomantic dropdown rebuilt on every paint, the attribute
 * would stay on its hidden <select>, which cannot take the focus, and the
 * typing box that can is made by Fomantic, not by this markup.
 */
export function groupHtml(
  ctx: BlockCtx,
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
        <span class="qb-count">${countLabel(countBlocks(g), "facet")}</span>
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
      ? `<button type="button" class="ui mini basic button" data-action="group-contents" title="Put this group's facets and groups into a new group inside it"><i class="object group outline icon" aria-hidden="true"></i>Group contents</button>`
      : "";
  const blocked = isRoot ? null : ungroupBlocker(ctx.query, g.id);
  const ungroupButton = isRoot
    ? ""
    : `<button type="button" class="ui mini basic button" data-action="ungroup"${blocked ? ` aria-disabled="true" title="${escapeHtml(blocked)}"` : ` title="Put this group's items into the group around it"`}><i class="object ungroup outline icon" aria-hidden="true"></i>Ungroup</button>`;
  // The action buttons share one right-aligned box (`.qb-group-actions`): when
  // the header is too narrow they wrap among themselves, so the ✕ stays last
  // on the right and is never left alone at the start of a new line, where it
  // could be mistaken for the first block's remove button.
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children
    .map((child, i) => nodeHtml(ctx, child, { index: i + 1, count: g.children.length }))
    .join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${isRoot ? "" : nodeGrip(g.id, "group")}
      ${move}
      ${collapseButton(false)}
      <span class="qb-group-label">Match</span>
      <span class="qb-logic" role="group" aria-label="Combine facets with">
        <button type="button" class="qb-logic-btn${g.operator === "AND" ? " is-on" : ""}" data-action="set-and" aria-pressed="${g.operator === "AND"}">ALL</button>
        <button type="button" class="qb-logic-btn${g.operator === "OR" ? " is-on" : ""}" data-action="set-or" aria-pressed="${g.operator === "OR"}">ANY</button>
      </span>
      <span class="qb-group-label">of the following</span>
      <span class="qb-group-actions">
        ${addFacetPicker(ctx.facets)}
        <button type="button" class="ui mini basic button" data-action="add-group" data-focus-landing><i class="plus icon"></i>Group</button>
        ${groupContentsButton}
        ${ungroupButton}
        ${remove}
      </span>
    </div>
    ${issuesHtml(g.id, ctx.issues)}
    <div class="qb-children">${children}</div>
  </div>`;
}

/** A child of a group (never the root, so it always has a position). */
function nodeHtml(ctx: BlockCtx, node: QueryNode, position: Position): string {
  return node.kind === "group"
    ? groupHtml(ctx, node, false, position)
    : blockHtml(ctx, node, position);
}

/** The query card's footer: the whole query in plain English once nothing
 *  needs attention, otherwise how many parts do. `issues` are placed
 *  (placeIssues), so the count matches what is on screen. */
export function footerHtml(query: Group, issues: Issue[], catalog: FieldCatalog): string {
  if (countBlocks(query) === 0) {
    return `<span class="qb-muted">Add a facet to start building the query.</span>`;
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
