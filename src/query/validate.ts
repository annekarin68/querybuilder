import type { Condition, Issue, QueryNode } from "./types";

export interface ValidationSchema {
  fields: { id: string; valueType: string }[];
  operators: { id: string; arity: "none" | "one" | "two" | "many" }[];
}

export function hasBlockingErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

function isEmptyScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function checkCondition(c: Condition, schema: ValidationSchema, out: Issue[]): void {
  if (!c.fieldId) {
    out.push({ nodeId: c.id, message: "Choose a field.", severity: "error" });
    return;
  }
  if (!c.operatorId) {
    out.push({ nodeId: c.id, message: "Choose an operator.", severity: "error" });
    return;
  }
  const op = schema.operators.find((o) => o.id === c.operatorId);
  if (!op) {
    out.push({ nodeId: c.id, message: "Unknown operator.", severity: "error" });
    return;
  }
  if (op.arity === "one" && isEmptyScalar(c.value)) {
    out.push({ nodeId: c.id, message: "Enter a value.", severity: "error" });
  }
  if (op.arity === "two") {
    const v = c.value;
    if (!Array.isArray(v) || v.length !== 2 || v.some(isEmptyScalar)) {
      out.push({ nodeId: c.id, message: "Enter both values.", severity: "error" });
    }
  }
  if (op.arity === "many") {
    const v = c.value;
    if (!Array.isArray(v) || v.length === 0) {
      out.push({ nodeId: c.id, message: "Choose at least one value.", severity: "error" });
    }
  }
}

function walk(node: QueryNode, isRoot: boolean, schema: ValidationSchema, out: Issue[]): void {
  if (node.kind === "condition") {
    checkCondition(node, schema, out);
    return;
  }
  if (!isRoot && node.children.length === 0) {
    out.push({ nodeId: node.id, message: "Add a condition to this group.", severity: "error" });
  }
  for (const child of node.children) walk(child, false, schema, out);
}

export function validateQuery(tree: QueryNode, schema: ValidationSchema): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, schema, out);
  return out;
}
