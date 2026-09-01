import type { ConditionNode, ExpressionNode, GroupNode, LogicalOperator } from "./types.js";

function createId(): string {
  // crypto.randomUUID is available in every modern browser and in Node 19+.
  return crypto.randomUUID();
}

export function createConditionNode(partial: Partial<Omit<ConditionNode, "kind" | "id">> = {}): ConditionNode {
  return {
    kind: "condition",
    id: createId(),
    fieldId: partial.fieldId ?? null,
    operatorId: partial.operatorId ?? null,
    value: partial.value ?? null,
  };
}

export function createGroupNode(
  operator: LogicalOperator = "AND",
  children: readonly ExpressionNode[] = [],
): GroupNode {
  return {
    kind: "group",
    id: createId(),
    operator,
    children,
  };
}

/** Depth-first search for a node by id. Returns undefined if not found. */
export function findNode(root: ExpressionNode, nodeId: string): ExpressionNode | undefined {
  if (root.id === nodeId) return root;
  if (root.kind !== "group") return undefined;
  for (const child of root.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Returns a new tree with `nodeId` replaced by the result of `updater`.
 * The original tree is left untouched (structural sharing everywhere else).
 */
export function updateNode(
  root: GroupNode,
  nodeId: string,
  updater: (node: ExpressionNode) => ExpressionNode,
): GroupNode {
  if (root.id === nodeId) {
    const updated = updater(root);
    if (updated.kind !== "group") {
      throw new Error("Cannot replace the root group with a non-group node.");
    }
    return updated;
  }
  return {
    ...root,
    children: root.children.map((child) => {
      if (child.id === nodeId) return updater(child);
      if (child.kind === "group") return updateNode(child, nodeId, updater);
      return child;
    }),
  };
}

/** Returns a new tree with `child` appended to the group identified by `parentId`. */
export function insertChild(root: GroupNode, parentId: string, child: ExpressionNode): GroupNode {
  if (root.id === parentId) {
    return { ...root, children: [...root.children, child] };
  }
  return {
    ...root,
    children: root.children.map((existing) =>
      existing.kind === "group" ? insertChild(existing, parentId, child) : existing,
    ),
  };
}

/** Returns a new tree with the node identified by `nodeId` removed. Removing the root is a no-op. */
export function removeNode(root: GroupNode, nodeId: string): GroupNode {
  if (root.id === nodeId) return root;
  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== nodeId)
      .map((child) => (child.kind === "group" ? removeNode(child, nodeId) : child)),
  };
}

/** Returns a fresh, empty query tree: a single root AND-group with no children. */
export function createEmptyExpression(): GroupNode {
  return createGroupNode("AND", []);
}
