import { createConditionNode, createGroupNode, insertChild, removeNode, updateNode } from "./ast.js";
import type { ConditionNode, GroupNode, LogicalOperator } from "./types.js";

/**
 * The full vocabulary of edits the UI can make to an expression tree.
 * Living in `core` (rather than alongside the components that dispatch
 * them) keeps this vocabulary — and the reducer below — independent of
 * any particular UI toolkit, and lets it be unit-tested with no DOM at all.
 */
export type TreeCommand =
  | { type: "update-condition"; nodeId: string; patch: Partial<Pick<ConditionNode, "fieldId" | "operatorId" | "value">> }
  | { type: "set-group-operator"; nodeId: string; operator: LogicalOperator }
  | { type: "add-condition"; parentId: string }
  | { type: "add-group"; parentId: string }
  | { type: "remove-node"; nodeId: string };

/** Applies one command to a tree, returning a new tree (the input is left untouched). */
export function applyCommand(tree: GroupNode, command: TreeCommand): GroupNode {
  switch (command.type) {
    case "update-condition":
      return updateNode(tree, command.nodeId, (node) =>
        node.kind === "condition" ? { ...node, ...command.patch } : node,
      );
    case "set-group-operator":
      return updateNode(tree, command.nodeId, (node) =>
        node.kind === "group" ? { ...node, operator: command.operator } : node,
      );
    case "add-condition":
      return insertChild(tree, command.parentId, createConditionNode());
    case "add-group":
      return insertChild(tree, command.parentId, createGroupNode("AND", [createConditionNode()]));
    case "remove-node":
      return removeNode(tree, command.nodeId);
    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
