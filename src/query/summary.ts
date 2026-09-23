import type { Condition, QueryNode } from "./types";
import { findField, findOperator, type FieldCatalog } from "./fieldCatalog";

function formatValue(c: Condition, arity: string): string {
  if (arity === "none") return "";
  if (arity === "two" && Array.isArray(c.value)) {
    return `${String(c.value[0])} to ${String(c.value[1])}`;
  }
  if (arity === "many" && Array.isArray(c.value)) return c.value.map(String).join(", ");
  return String(c.value);
}

function conditionText(catalog: FieldCatalog, c: Condition): string {
  const field = findField(catalog, c.fieldId);
  const op = findOperator(c.operatorId);
  const parts = [field?.name ?? "(field?)", op?.name ?? "(operator?)"];
  const val = op ? formatValue(c, op.arity) : "";
  if (val) parts.push(val);
  return parts.join(" ");
}

function nodeText(catalog: FieldCatalog, node: QueryNode, isRoot: boolean): string {
  if (node.kind === "condition") return conditionText(catalog, node);
  if (node.children.length === 0) return isRoot ? "(empty query)" : "()";
  const inner = node.children.map((c) => nodeText(catalog, c, false)).join(` ${node.operator} `);
  return isRoot ? inner : `(${inner})`;
}

/** The query in plain English, e.g. "Engine: rpm Greater than 3000 AND (…)". Display only. */
export function queryToText(tree: QueryNode, catalog: FieldCatalog): string {
  return nodeText(catalog, tree, true);
}
