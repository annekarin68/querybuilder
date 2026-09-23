import type { Condition, QueryNode } from "./types";
import { findField, findOperator, type Arity, type FieldCatalog } from "./fieldCatalog";

/** Stands in for a value the user hasn't entered yet, like "(field?)" below. */
const MISSING = "(value?)";

function valueText(v: unknown): string {
  return v === null || v === undefined || v === "" ? MISSING : String(v);
}

function formatValue(c: Condition, arity: Arity): string {
  if (arity === "none") return "";
  if (arity === "two") {
    const [from, to]: unknown[] = Array.isArray(c.value) ? c.value : [];
    return `${valueText(from)} to ${valueText(to)}`;
  }
  if (arity === "many") {
    return Array.isArray(c.value) && c.value.length > 0 ? c.value.map(String).join(", ") : MISSING;
  }
  return valueText(c.value);
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

/** The query in plain English, e.g. "Thing: size Greater than 3000 AND (…)". Display only. */
export function queryToText(tree: QueryNode, catalog: FieldCatalog): string {
  return nodeText(catalog, tree, true);
}
