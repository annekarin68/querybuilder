import type { Condition, Issue, QueryNode } from "./types";
import { findField, findOperator, type FieldCatalog } from "./fieldCatalog";
import { isUtcTimestamp } from "./dates";

function isEmptyScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function incomplete(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "incomplete" };
}

function invalid(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "invalid" };
}

function checkCondition(c: Condition, catalog: FieldCatalog, out: Issue[]): void {
  if (!c.facetId || !c.fieldId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  const fieldDef = findField(catalog, c.facetId, c.fieldId);
  if (!fieldDef) {
    out.push(invalid(c.id, "Unknown field."));
    return;
  }
  if (!c.operatorId) {
    out.push(incomplete(c.id, "Choose an operator."));
    return;
  }
  const op = findOperator(c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!fieldDef.operatorIds.includes(c.operatorId)) {
    out.push(invalid(c.id, "That operator isn't available for this field."));
    return;
  }
  if (op.arity === "one" && isEmptyScalar(c.value)) {
    out.push(incomplete(c.id, "Enter a value."));
  }
  if (op.arity === "two") {
    const v = c.value;
    if (!Array.isArray(v) || v.length !== 2 || v.some(isEmptyScalar)) {
      out.push(incomplete(c.id, "Enter both values."));
    }
  }
  if (fieldDef.valueType === "date" && (op.arity === "one" || op.arity === "two")) {
    const values = Array.isArray(c.value) ? c.value : [c.value];
    if (values.some((v) => !isEmptyScalar(v) && !isUtcTimestamp(v))) {
      out.push(invalid(c.id, "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z."));
    }
  }
  if (op.arity === "many") {
    const v = c.value;
    if (!Array.isArray(v) || v.length === 0) {
      out.push(incomplete(c.id, "Choose at least one value."));
    }
  }
}

function walk(node: QueryNode, isRoot: boolean, catalog: FieldCatalog, out: Issue[]): void {
  if (node.kind === "condition") {
    checkCondition(node, catalog, out);
    return;
  }
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a condition to this group."));
  }
  for (const child of node.children) walk(child, false, catalog, out);
}

export function validateQuery(tree: QueryNode, catalog: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, catalog, out);
  return out;
}
