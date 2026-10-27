import type { FacetBlock, FieldCondition, Group, LogicalOperator, QueryNode } from "./types";

// Pure, immutable edits of the query (docs/ARCHITECTURE.md, "The query model"):
// every edit reads `state.query`, calls one function here and writes the new
// tree back. Only new nodes get fresh ids. Field conditions live inside facet
// blocks and are never moved on their own (spec, decision 8).

export type NodePatch = Partial<Pick<Group, "operator" | "collapsed">> &
  Partial<Pick<FacetBlock, "negated">>;

let counter = 0;
/** A fresh id: "g-…" for a group, "f-…" for a facet block, "c-…" for a field condition. */
function id(prefix: "g" | "f" | "c"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** The starting query: an empty ALL group, the root. It is "not finished",
 *  not invalid (validate.ts): the builder offers "+ Facet" in it. */
export function emptyQuery(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** What "+ Group" adds: an empty ALL group with its own "+ Facet". */
export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** A new, open group holding `children`: how a tag's facets arrive ("Add
 *  all"), so a misplaced "Add all" is moved or removed in one go, and how a
 *  saved group is read back (with a fresh id). */
export function groupOf(children: QueryNode[], operator: LogicalOperator = "AND"): Group {
  return { kind: "group", id: id("g"), operator, children };
}

/** A new block for a facet: "Has", ALL, nothing set yet. */
export function newBlock(facetId: string): FacetBlock {
  return { kind: "facet", id: id("f"), facetId, negated: false, operator: "AND", conditions: [] };
}

export function newFieldCondition(
  fieldId: string,
  operatorId: string | null,
  value: unknown,
): FieldCondition {
  return { kind: "condition", id: id("c"), fieldId, operatorId, value };
}

/** A copy of `node` with `fn` applied to every group and block (post-order).
 *  Blocks are leaves here: their conditions are edited through the block. */
function mapTree(node: QueryNode, fn: (n: QueryNode) => QueryNode): QueryNode {
  if (node.kind === "group") {
    return fn({ ...node, children: node.children.map((c) => mapTree(c, fn)) });
  }
  return fn({ ...node });
}

export function addChild(tree: Group, parentId: string, node: QueryNode): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === parentId ? { ...n, children: [...n.children, node] } : n,
  ) as Group;
}

export function updateNode(tree: Group, nodeId: string, patch: NodePatch): Group {
  return mapTree(tree, (n) => (n.id === nodeId ? ({ ...n, ...patch } as QueryNode) : n)) as Group;
}

export function removeNode(tree: Group, nodeId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" ? { ...n, children: n.children.filter((c) => c.id !== nodeId) } : n,
  ) as Group;
}

/** The group or block with this id, or null. (Field conditions are found
 *  through their block: `block.conditions`.) */
export function findNode(tree: QueryNode, nodeId: string): QueryNode | null {
  if (tree.id === nodeId) return tree;
  if (tree.kind === "group") {
    for (const child of tree.children) {
      const hit = findNode(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

/** Block `blockId` with `condition` for its field: replacing the condition
 *  the field had (a block holds at most one per field), or added at the end. */
export function setFieldCondition(tree: Group, blockId: string, condition: FieldCondition): Group {
  return mapTree(tree, (n) => {
    if (n.kind !== "facet" || n.id !== blockId) return n;
    const at = n.conditions.findIndex((c) => c.fieldId === condition.fieldId);
    const conditions = [...n.conditions];
    if (at === -1) conditions.push(condition);
    else conditions[at] = condition;
    return { ...n, conditions };
  }) as Group;
}

/** Block `blockId` without a condition on `fieldId`: the row is "not filtered" again. */
export function clearFieldCondition(tree: Group, blockId: string, fieldId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "facet" && n.id === blockId
      ? { ...n, conditions: n.conditions.filter((c) => c.fieldId !== fieldId) }
      : n,
  ) as Group;
}

/** Block `blockId` without the condition `conditionId`: how a stray row (an
 *  unknown field, or a field set twice in a saved query) is removed. Unlike
 *  `clearFieldCondition` it leaves another condition on the same field. */
export function removeCondition(tree: Group, blockId: string, conditionId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "facet" && n.id === blockId
      ? { ...n, conditions: n.conditions.filter((c) => c.id !== conditionId) }
      : n,
  ) as Group;
}

export function countBlocks(tree: QueryNode): number {
  if (tree.kind === "facet") return 1;
  return tree.children.reduce((sum, c) => sum + countBlocks(c), 0);
}

/**
 * Whether two trees filter the same way, i.e. differ at most in `collapsed`:
 * a display-only flag, not part of what the query means. Compares the two as
 * JSON with every `collapsed` left out.
 */
export function sameSemantics(a: QueryNode, b: QueryNode): boolean {
  const withoutCollapsed = (key: string, value: unknown) =>
    key === "collapsed" ? undefined : value;
  return JSON.stringify(a, withoutCollapsed) === JSON.stringify(b, withoutCollapsed);
}

/** Whether two trees are identical, `collapsed` included: nothing on screen
 *  would change. Tells a move that did something from one that didn't. */
export function sameTree(a: QueryNode, b: QueryNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Put `nodes` where a drop on `targetId` lands: at the end of the target if it
 * is a group, otherwise just before the target block in its parent. An
 * unknown target changes nothing.
 */
export function insertNodes(tree: Group, targetId: string, nodes: QueryNode[]): Group {
  const target = findNode(tree, targetId);
  if (!target) return tree;
  if (target.kind === "group") {
    return mapTree(tree, (n) =>
      n.kind === "group" && n.id === targetId ? { ...n, children: [...n.children, ...nodes] } : n,
    ) as Group;
  }
  return mapTree(tree, (n) => {
    if (n.kind !== "group") return n;
    const at = n.children.findIndex((c) => c.id === targetId);
    if (at === -1) return n;
    const children = [...n.children];
    children.splice(at, 0, ...nodes);
    return { ...n, children };
  }) as Group;
}

/**
 * Move `nodeId` to where a drop on `targetId` lands (see `insertNodes`).
 * Returns null when the move is impossible: an unknown id, the root, or a
 * group moved into itself or something inside it.
 */
export function moveNode(tree: Group, nodeId: string, targetId: string): Group | null {
  const node = findNode(tree, nodeId);
  if (!node || nodeId === tree.id || !findNode(tree, targetId)) return null;
  if (findNode(node, targetId)) return null; // the target is the node itself or inside it
  return insertNodes(removeNode(tree, nodeId), targetId, [node]);
}

/**
 * "Group contents": the group's children move into one new group, with the
 * same ALL/ANY, which becomes the group's only child. The query means the same
 * afterwards. An unknown id (or a block's) changes nothing.
 */
export function groupContents(tree: Group, groupId: string): Group {
  const target = findNode(tree, groupId);
  if (!target || target.kind !== "group") return tree;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === groupId
      ? { ...n, children: [groupOf(n.children, n.operator)] }
      : n,
  ) as Group;
}

export const UNGROUP_BLOCKED_MESSAGE =
  "Ungroup works only when this group and the one around it are both ALL or both ANY, or when it holds one item.";

export type Direction = "up" | "down";

/** The group that holds `nodeId` directly, or null (the root, or unknown). */
function parentOf(tree: Group, nodeId: string): Group | null {
  for (const child of tree.children) {
    if (child.id === nodeId) return tree;
    if (child.kind === "group") {
      const hit = parentOf(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

/** Where `nodeId` stands among its siblings (`index` counts from 1), or null
 *  for the root and unknown ids. */
export function positionOf(tree: Group, nodeId: string): { index: number; count: number } | null {
  const parent = parentOf(tree, nodeId);
  if (!parent) return null;
  return {
    index: parent.children.findIndex((c) => c.id === nodeId) + 1,
    count: parent.children.length,
  };
}

/**
 * Swap `nodeId` with its previous ("up") or next ("down") sibling: the Move
 * up / Move down buttons. Never changes which group a node is in. Null when
 * there is nothing to swap with, for the root and for unknown ids.
 */
export function moveSibling(tree: Group, nodeId: string, direction: Direction): Group | null {
  const parent = parentOf(tree, nodeId);
  if (!parent) return null;
  const from = parent.children.findIndex((c) => c.id === nodeId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= parent.children.length) return null;
  return mapTree(tree, (n) => {
    if (n.kind !== "group" || n.id !== parent.id) return n;
    const children = [...n.children];
    [children[from], children[to]] = [children[to]!, children[from]!];
    return { ...n, children };
  }) as Group;
}

/**
 * Why `groupId` can't be ungrouped, or null if it can. Ungrouping must never
 * change what the query means: that holds when the group combines its items
 * the same way as its parent, or when it holds only one item.
 */
export function ungroupBlocker(tree: Group, groupId: string): string | null {
  if (groupId === tree.id) return "The whole query can't be ungrouped.";
  const node = findNode(tree, groupId);
  const parent = parentOf(tree, groupId);
  if (!node || node.kind !== "group" || !parent) return "That group is no longer in the query.";
  if (node.operator === parent.operator || node.children.length === 1) return null;
  return UNGROUP_BLOCKED_MESSAGE;
}

/** Put `groupId`'s children in its place in its parent; null when `ungroupBlocker` says no. */
export function ungroup(tree: Group, groupId: string): Group | null {
  if (ungroupBlocker(tree, groupId) !== null) return null;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.children.some((c) => c.id === groupId)
      ? {
          ...n,
          children: n.children.flatMap((c) =>
            c.id === groupId && c.kind === "group" ? c.children : [c],
          ),
        }
      : n,
  ) as Group;
}
