import type { Condition, Group, QueryNode } from "./types";

export interface SummarySchema {
  fields: { id: string; label: string; options?: { value: string; label: string }[] }[];
  operators: { id: string; label: string; arity: "none" | "one" | "two" | "many" }[];
}

function optionLabel(schema: SummarySchema, fieldId: string | null, raw: unknown): string {
  const field = schema.fields.find((f) => f.id === fieldId);
  const opt = field?.options?.find((o) => o.value === raw);
  if (opt) return opt.label;
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

function formatValue(schema: SummarySchema, c: Condition, arity: string): string {
  if (arity === "none") return "";
  if (arity === "two" && Array.isArray(c.value)) {
    return `${optionLabel(schema, c.fieldId, c.value[0])} to ${optionLabel(schema, c.fieldId, c.value[1])}`;
  }
  if (arity === "many" && Array.isArray(c.value)) {
    return c.value.map((v) => optionLabel(schema, c.fieldId, v)).join(", ");
  }
  return optionLabel(schema, c.fieldId, c.value);
}

function conditionText(schema: SummarySchema, c: Condition): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const op = schema.operators.find((o) => o.id === c.operatorId);
  const parts = [field?.label ?? "(field?)", op?.label ?? "(operator?)"];
  const val = op ? formatValue(schema, c, op.arity) : "";
  if (val) parts.push(val);
  return parts.join(" ");
}

function nodeText(schema: SummarySchema, node: QueryNode, isRoot: boolean): string {
  if (node.kind === "condition") return conditionText(schema, node);
  const group = node as Group;
  if (group.children.length === 0) return isRoot ? "(empty query)" : "()";
  const inner = group.children.map((c) => nodeText(schema, c, false)).join(` ${group.operator} `);
  return isRoot ? inner : `(${inner})`;
}

export function queryToText(tree: QueryNode, schema: SummarySchema): string {
  return nodeText(schema, tree, true);
}
