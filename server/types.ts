/**
 * Minimal, standalone mirror of the client's expression-tree JSON shape.
 * Kept separate from `src/core` on purpose: this mock server is a stand-in
 * for "some backend, written in whatever language", not a consumer of the
 * TypeScript library — a real backend wouldn't share source with the
 * frontend either.
 */
export type JsonConditionValue = string | number | boolean | (string | number)[] | null;

export interface JsonCondition {
  fieldId: string | null;
  operatorId: string | null;
  value: JsonConditionValue;
}

export interface JsonGroup {
  operator: "AND" | "OR";
  children: (JsonCondition | JsonGroup)[];
}

export type JsonExpression = JsonCondition | JsonGroup;

export function isGroup(node: JsonExpression): node is JsonGroup {
  return (node as JsonGroup).children !== undefined;
}

export type FieldValueType = "string" | "number" | "boolean" | "date" | "enum";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  id: string;
  label: string;
  valueType: FieldValueType;
  options?: FieldOption[];
  allowedOperatorIds?: string[];
}

export type Record_ = Record<string, string | number | boolean | null>;
