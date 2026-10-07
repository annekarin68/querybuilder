import type { Condition, Group, QueryNode } from "./types";

export type NodePatch = Partial<Pick<Condition, "facetId" | "fieldId" | "operatorId" | "value">> &
  Partial<Pick<Group, "operator" | "collapsed">>;

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function emptyQuery(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

export function newCondition(): Condition {
  return {
    kind: "condition",
    id: id("c"),
    facetId: null,
    fieldId: null,
    operatorId: null,
    value: null,
  };
}

/** A new AND group, pre-populated with one empty condition so it is usable
 *  straight away (the "+ Group" button). A group can still become empty when
 *  its last condition is removed — validate.ts reports that case. */
export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [newCondition()] };
}

/** Return a copy of `node` with `fn` applied to every node in the tree (post-order). */
function mapTree(node: QueryNode, fn: (n: QueryNode) => QueryNode): QueryNode {
  if (node.kind === "group") {
    const mapped: Group = {
      ...node,
      children: node.children.map((c) => mapTree(c, fn)),
    };
    return fn(mapped);
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

export function countConditions(tree: QueryNode): number {
  if (tree.kind === "condition") return 1;
  return tree.children.reduce((sum, c) => sum + countConditions(c), 0);
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

/**
 * Whether two trees are identical, `collapsed` included: nothing on screen
 * would change. Unlike `sameSemantics`, folding a group counts as a change,
 * because the user sees it. Used to tell a move that did something from one
 * that put a node back where it was.
 */
export function sameTree(a: QueryNode, b: QueryNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Put `nodes` where a drop on `targetId` lands: at the end of the target if it
 * is a group, otherwise just before the target in its parent. An unknown
 * target changes nothing.
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

/** A condition nobody has touched: nothing chosen yet (what "+ Condition" adds). */
function isBlankCondition(node: QueryNode): boolean {
  return (
    node.kind === "condition" &&
    node.facetId === null &&
    node.fieldId === null &&
    node.operatorId === null &&
    node.value === null
  );
}

/**
 * A group that holds just one blank condition (the starting query, or what
 * "+ Group" adds) is waiting to be filled in: nobody wants to keep that blank
 * row once something is added. If the drop on `targetId` lands in such a group
 * (on the group, or on its blank row), return `tree` with `nodes` in that row's
 * place; otherwise null, so the caller inserts as usual. The group keeps its
 * ALL/ANY choice and fold state: only a blank row is replaced, never something
 * the user chose.
 */
export function replaceLoneBlankCondition(
  tree: Group,
  targetId: string,
  nodes: QueryNode[],
): Group | null {
  if (nodes.length === 0) return null;
  let replaced = false;
  const next = mapTree(tree, (n) => {
    if (n.kind !== "group") return n;
    const [only] = n.children;
    // `insertNodes` reads a group target as "at the end" and a condition target
    // as "just before it". Here both mean "replace the blank row", so a drop on
    // the group or on its blank row finds this same group.
    const targetsThisGroup = n.id === targetId || only?.id === targetId;
    // (`!only` is implied by the length check; it is here so TypeScript knows.)
    if (!targetsThisGroup || n.children.length !== 1 || !only || !isBlankCondition(only)) return n;
    replaced = true;
    return { ...n, children: [...nodes] };
  }) as Group;
  return replaced ? next : null;
}

/**
 * Where `nodes` land when dropped on `targetId`: in place of a lone blank row
 * (`replaceLoneBlankCondition`), otherwise as `insertNodes` puts them. Every
 * drop goes through here, so new items and moved nodes behave the same.
 */
export function placeNodes(tree: Group, targetId: string, nodes: QueryNode[]): Group {
  return replaceLoneBlankCondition(tree, targetId, nodes) ?? insertNodes(tree, targetId, nodes);
}

/**
 * Move `nodeId` to where a drop on `targetId` lands (see `placeNodes`).
 * Returns null when the move is impossible: an unknown id, the root, or a
 * group moved into itself or something inside it.
 */
export function moveNode(tree: Group, nodeId: string, targetId: string): Group | null {
  const node = findNode(tree, nodeId);
  if (!node || nodeId === tree.id || !findNode(tree, targetId)) return null;
  if (findNode(node, targetId)) return null; // target is the node itself or inside it
  // Judge the target after the node is out: taking it out can leave a lone blank row.
  return placeNodes(removeNode(tree, nodeId), targetId, [node]);
}
