import type { Condition, Group, QueryNode } from "./types";

export type NodePatch = Partial<Pick<Condition, "fieldId" | "operatorId" | "value">> &
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
  return { kind: "condition", id: id("c"), fieldId: null, operatorId: null, value: null };
}

export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** Return a copy of `node` with `fn` applied to every node in the tree (post-order). */
function mapTree(node: QueryNode, fn: (n: QueryNode) => QueryNode): QueryNode {
  if (node.kind === "group") {
    const mapped: Group = {
      ...node,
      children: node.children.map((c) => mapTree(c, fn) as Group | Condition),
    };
    return fn(mapped);
  }
  return fn({ ...node });
}

export function addChild(tree: Group, parentId: string, node: QueryNode): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === parentId
      ? { ...n, children: [...n.children, node as Group | Condition] }
      : n,
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
