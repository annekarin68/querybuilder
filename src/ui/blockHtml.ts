import type { Facet } from "../model";
import { findFacet, type FieldCatalog } from "../query/fieldCatalog";
import type { FieldRef } from "../query/drop";
import { blockText, queryToText } from "../query/summary";
import { countBlocks, ungroupBlocker } from "../query/tree";
import type { FacetBlock, Group, Issue, QueryNode } from "../query/types";
import {
  collapseButton,
  iconButton,
  issuesHtml,
  moveButtons,
  nodeGrip,
  type Position,
} from "./builderParts";
import { fieldRowsHtml } from "./fieldRows";
import { countLabel } from "./format";
import { escapeHtml } from "./panel";

// The HTML of the facet-block builder's tree: groups, facet blocks and the
// footer line. Pure strings, so the Node-only tests can reach them. Not wired
// in until Task 3 of plan A2 (docs/superpowers/plans/2026-10-27-facet-blocks-a2-builder.md).

/** What every part of the tree's HTML needs, passed down the recursion. */
export interface BlockCtx {
  catalog: FieldCatalog;
  /** The facets the "+ Facet" picker offers; null while they are loading. */
  facets: Facet[] | null;
  issues: Issue[];
  /** The whole query: a group's Ungroup button needs its parent's ALL/ANY. */
  query: Group;
  /** Blocks whose folded field list is open ("+ N more fields"). */
  expandedBlockIds: readonly string[];
  /** The field row the user is editing; its unset row is drawn open. */
  selectedField: FieldRef | null;
}

/** A facet block (spec, section 5): its head, its issues and its field rows.
 *  The facet is fixed: to filter on another facet the user adds a block. */
export function blockHtml(ctx: BlockCtx, block: FacetBlock, position: Position): string {
  const name = findFacet(ctx.catalog, block.facetId)?.name ?? block.facetId;
  const head = (inner: string) =>
    `<div class="qb-block-head">${nodeGrip(block.id, "facet")}${moveButtons("facet", position)}${collapseButton(Boolean(block.collapsed), "facet")}<span class="qb-block-name">${escapeHtml(name)}</span>${inner}<span class="qb-spacer"></span>${iconButton("remove-node", "Remove facet", "times")}</div>`;
  if (block.collapsed) {
    const text = blockText(block, ctx.catalog);
    return `<div class="qb-block is-collapsed" data-node-id="${escapeHtml(block.id)}">${head(
      `<span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`,
    )}${issuesHtml(block.id, ctx.issues)}</div>`;
  }
  const pair = (on: boolean, action: string, label: string) =>
    `<button type="button" class="qb-logic-btn${on ? " is-on" : ""}" data-action="${action}" aria-pressed="${on}">${label}</button>`;
  const has = `<span class="qb-logic" role="group" aria-label="Has or has no">${pair(!block.negated, "set-has", "Has")}${pair(block.negated, "set-has-no", "Has no")}</span>`;
  const setCount = block.conditions.length;
  // ALL / ANY only matter once two fields are set; before that they change nothing.
  const where = setCount >= 1 ? `<span class="qb-group-label">an occurrence where</span>` : "";
  const match =
    setCount >= 2
      ? `<span class="qb-logic" role="group" aria-label="Combine the set fields with">${pair(block.operator === "AND", "set-and", "ALL")}${pair(block.operator === "OR", "set-or", "ANY")}</span><span class="qb-group-label">of the set fields match</span>`
      : "";
  const expanded = ctx.expandedBlockIds.includes(block.id);
  const selected = ctx.selectedField?.blockId === block.id ? ctx.selectedField.fieldId : null;
  const rows = fieldRowsHtml(
    { catalog: ctx.catalog, issues: ctx.issues },
    block,
    expanded,
    selected,
  );
  return `<div class="qb-block" data-node-id="${escapeHtml(block.id)}">${head(has + where + match)}${issuesHtml(block.id, ctx.issues)}<div class="qb-field-rows">${rows}</div></div>`;
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
 * delete something else (see focusMemory.ts). The "+ Facet" picker is not the
 * landing: focusing a dropdown opens its menu.
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
