import { getOperatorsForType, getOperatorById } from "./operators.js";
import type { ExpressionNode, FieldDefinition, GroupNode, ValidationIssue } from "./types.js";

/**
 * Walks the tree and reports everything that would stop it from being
 * safely serialized and sent to the backend: missing selections, values
 * that don't match the operator's arity, and empty groups.
 *
 * Returns an empty array when the tree is valid. The root group is exempt
 * from the "empty group" check so a brand-new, untouched builder doesn't
 * immediately show an error.
 */
export function validateExpression(root: GroupNode, fields: readonly FieldDefinition[]): ValidationIssue[] {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const issues: ValidationIssue[] = [];
  walk(root, true);
  return issues;

  function walk(node: ExpressionNode, isRoot: boolean): void {
    if (node.kind === "group") {
      if (!isRoot && node.children.length === 0) {
        issues.push({ nodeId: node.id, message: "Empty group: add a condition or remove it.", severity: "error" });
      }
      for (const child of node.children) walk(child, false);
      return;
    }

    // Condition node.
    if (!node.fieldId) {
      issues.push({ nodeId: node.id, message: "Choose a field.", severity: "error" });
      return;
    }
    const field = fieldsById.get(node.fieldId);
    if (!field) {
      issues.push({ nodeId: node.id, message: `Unknown field "${node.fieldId}".`, severity: "error" });
      return;
    }
    if (!node.operatorId) {
      issues.push({ nodeId: node.id, message: "Choose an operator.", severity: "error" });
      return;
    }
    const operator = getOperatorById(node.operatorId);
    const allowed = getOperatorsForType(field.valueType, field.allowedOperatorIds);
    if (!operator || !allowed.some((candidate) => candidate.id === operator.id)) {
      issues.push({
        nodeId: node.id,
        message: `Operator "${node.operatorId}" is not valid for field "${field.label}".`,
        severity: "error",
      });
      return;
    }

    if (operator.arity === "none") return; // no value expected

    if (node.value === null || node.value === undefined) {
      issues.push({ nodeId: node.id, message: "Enter a value.", severity: "error" });
      return;
    }

    if (operator.arity === "range") {
      const isPair = Array.isArray(node.value) && node.value.length === 2 && node.value.every((part) => part !== "" && part !== null && part !== undefined);
      if (!isPair) {
        issues.push({ nodeId: node.id, message: "Enter both ends of the range.", severity: "error" });
      }
    } else if (operator.arity === "multi") {
      if (!Array.isArray(node.value) || node.value.length === 0) {
        issues.push({ nodeId: node.id, message: "Select at least one value.", severity: "error" });
      }
    } else if (typeof node.value === "string" && node.value.trim() === "") {
      issues.push({ nodeId: node.id, message: "Enter a value.", severity: "error" });
    }
  }
}

export function isValidExpression(root: GroupNode, fields: readonly FieldDefinition[]): boolean {
  return validateExpression(root, fields).every((issue) => issue.severity !== "error");
}
