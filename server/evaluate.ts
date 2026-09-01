import type { FieldDefinition, JsonExpression, Record_ } from "./types.js";
import { isGroup } from "./types.js";

/**
 * A small, generic tree-walking evaluator: given the same JSON expression
 * shape the client's `JsonSerializer` produces, decide whether one record
 * matches it. This is what a real backend's query layer would do (likely
 * by translating the tree into a SQL WHERE clause instead) — it's included
 * here so the demo's "Run query" button does something real rather than
 * returning canned data.
 */
export function evaluate(node: JsonExpression, record: Record_, fields: readonly FieldDefinition[]): boolean {
  if (isGroup(node)) {
    return node.operator === "AND"
      ? node.children.every((child) => evaluate(child, record, fields))
      : node.children.some((child) => evaluate(child, record, fields));
  }

  const { fieldId, operatorId, value } = node;
  if (!fieldId || !operatorId) return true; // an incomplete condition matches everything (validation should prevent this reaching here)

  const field = fields.find((candidate) => candidate.id === fieldId);
  const actual = record[fieldId];
  if (!field || actual === undefined) return false;

  const rank = (raw: string | number | boolean | null): number | string => {
    if (field.valueType === "enum" && field.options) {
      const index = field.options.findIndex((option) => option.value === raw);
      return index === -1 ? String(raw) : index;
    }
    if (field.valueType === "date") return new Date(String(raw)).getTime();
    return raw as number | string;
  };

  switch (operatorId) {
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "gt":
      return rank(actual) > rank(value as string | number);
    case "gte":
      return rank(actual) >= rank(value as string | number);
    case "lt":
      return rank(actual) < rank(value as string | number);
    case "lte":
      return rank(actual) <= rank(value as string | number);
    case "before":
      return rank(actual) < rank(value as string | number);
    case "after":
      return rank(actual) > rank(value as string | number);
    case "contains":
      return String(actual).toLowerCase().includes(String(value).toLowerCase());
    case "range": {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [start, end] = value;
      if (start === undefined || end === undefined) return false;
      const actualRank = rank(actual);
      return actualRank >= rank(start) && actualRank <= rank(end);
    }
    case "in":
      return Array.isArray(value) && value.some((candidate) => candidate === actual);
    case "isEmpty":
      return actual === null || actual === "" || actual === undefined;
    case "isNotEmpty":
      return !(actual === null || actual === "" || actual === undefined);
    default:
      return false;
  }
}
