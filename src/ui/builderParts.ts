import type { Issue } from "../query/types";
import type { Direction } from "../query/tree";
import { escapeHtml } from "./panel";

// HTML pieces shared by the query builder's rows, groups and facet blocks.
// They live here, not in queryBuilder.ts, so the new facet-block builder can
// use them without importing the old one.

/**
 * The issues under a row or group. The user's own unfinished parts are quiet
 * grey hints: they simply aren't done yet. Anything the databases found is
 * highlighted with an icon in the warning colour even when it is only
 * "incomplete" (such as "Group contains no valid conditions."): nothing else
 * on screen says it, and users missed it in grey (2026-10-13). Invalid is red.
 * Every kind blocks running (validate.ts). Issues come from validate.ts and
 * from the backend (src/query/issues.ts).
 */
export function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const text = (pick: (i: Issue) => boolean) =>
    mine
      .filter(pick)
      .map((i) => escapeHtml(i.message))
      .join(" ");
  const hint = text((i) => i.kind === "incomplete" && !i.fromServer);
  const warning = text((i) => i.kind === "incomplete" && i.fromServer === true);
  const invalid = text((i) => i.kind === "invalid");
  return (
    (hint ? `<div class="qb-hint">${hint}</div>` : "") +
    (warning
      ? `<div class="qb-server-warning"><i class="exclamation triangle icon" aria-hidden="true"></i>${warning}</div>`
      : "") +
    (invalid
      ? `<div class="qb-invalid"><i class="exclamation circle icon" aria-hidden="true"></i>${invalid}</div>`
      : "")
  );
}

/** A node's drag handle: carries `{type: "node", nodeId}`. The id is kept in
 *  `data-node-item` and the drag payload is built from it in the dragstart
 *  handler, so no JSON lives in the DOM. A group's grip looks different from a
 *  condition's (`qb-grip-group`, drawn in the group's colour; a facet block's
 *  is `qb-grip-facet`) and its tooltip says what it moves: the two sit at
 *  the same left edge, so otherwise a user cannot tell which one carries the
 *  whole group. */
export function nodeGrip(nodeId: string, kind: "group" | "condition" | "facet"): string {
  const cls = kind === "condition" ? "qb-grip" : `qb-grip qb-grip-${kind}`;
  return `<span class="${cls}" draggable="true" data-node-item="${escapeHtml(nodeId)}" aria-hidden="true" title="Drag to move this ${kind}"><i class="grip vertical icon"></i></span>`;
}

export function iconButton(action: string, label: string, icon: string): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"><i class="${icon} icon"></i></button>`;
}

/** Where a node stands among its siblings: `index` counts from 1. */
export interface Position {
  index: number;
  count: number;
}

/**
 * The Move up / Move down pair: the keyboard's way to reorder a node (dragging
 * needs a mouse). Two small buttons side by side next to the grip. The first
 * node's Up and the last node's Down are `aria-disabled` rather than `disabled`
 * or hidden: the pair keeps its shape, a screen reader says why nothing
 * happens, and, above all, the button keeps keyboard focus. A `disabled`
 * button loses focus, so pressing Enter repeatedly would move the focus to the
 * other button and then move the node back the way it came. The click handler
 * ignores clicks on such a button. `kind` ("condition", "group" or "facet")
 * names what moves, because a page has many pairs and "Move up" alone would
 * not say which node it is for.
 */
export function moveButtons(kind: "condition" | "group" | "facet", position: Position): string {
  const button = (direction: Direction, unavailable: boolean) => {
    const label = `Move ${kind} ${direction}`;
    const title = `Move ${direction}`;
    return `<button type="button" class="qb-icon-btn" data-action="move-${direction}" aria-label="${label}" title="${title}"${unavailable ? ' aria-disabled="true"' : ""}><i class="angle ${direction} icon"></i></button>`;
  };
  return `<span class="qb-move" role="group" aria-label="Move this ${kind}">${button("up", position.index <= 1)}${button("down", position.index >= position.count)}</span>`;
}

/**
 * The group's (or facet block's) fold/unfold button: a bordered chevron (down while open, right
 * while folded — the same arrows the data dictionary uses), so it reads as
 * something to click.
 */
export function collapseButton(collapsed: boolean, what: "group" | "facet" = "group"): string {
  const label = `${collapsed ? "Expand" : "Collapse"} ${what}`;
  const icon = collapsed ? "angle right" : "angle down";
  return `<button type="button" class="qb-icon-btn qb-collapse-btn" data-action="toggle-collapse" aria-label="${label}" title="${label}" aria-expanded="${!collapsed}"><i class="${icon} icon"></i></button>`;
}
