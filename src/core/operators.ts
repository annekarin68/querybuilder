import type { OperatorDefinition, ValueType } from "./types.js";

/**
 * The full catalog of operators the builder knows about. A given field only
 * offers the subset whose `applicableTypes` includes the field's valueType
 * (further narrowed by `FieldDefinition.allowedOperatorIds`, if set).
 *
 * Adding a new operator is a one-line addition here plus a case in
 * `serializer.ts`'s value formatter if it needs special formatting.
 */
export const OPERATOR_DEFINITIONS: readonly OperatorDefinition[] = [
  { id: "eq", label: "Equals", arity: "single", applicableTypes: ["string", "number", "boolean", "date", "enum"] },
  { id: "neq", label: "Not equals", arity: "single", applicableTypes: ["string", "number", "boolean", "date", "enum"] },
  { id: "gt", label: "Greater than", arity: "single", applicableTypes: ["number", "date"] },
  { id: "gte", label: "Greater than or equal", arity: "single", applicableTypes: ["number", "date"] },
  { id: "lt", label: "Less than", arity: "single", applicableTypes: ["number", "date"] },
  { id: "lte", label: "Less than or equal", arity: "single", applicableTypes: ["number", "date"] },
  { id: "before", label: "Before", arity: "single", applicableTypes: ["date"] },
  { id: "after", label: "After", arity: "single", applicableTypes: ["date"] },
  { id: "contains", label: "Contains", arity: "single", applicableTypes: ["string"] },
  { id: "range", label: "Between", arity: "range", applicableTypes: ["number", "date", "enum"] },
  { id: "in", label: "Is any of", arity: "multi", applicableTypes: ["enum", "string", "number"] },
  { id: "isEmpty", label: "Is empty", arity: "none", applicableTypes: ["string", "number", "date", "enum"] },
  { id: "isNotEmpty", label: "Is not empty", arity: "none", applicableTypes: ["string", "number", "date", "enum"] },
] as const;

const OPERATORS_BY_ID: ReadonlyMap<string, OperatorDefinition> = new Map(
  OPERATOR_DEFINITIONS.map((operator) => [operator.id, operator]),
);

export function getOperatorById(operatorId: string | null | undefined): OperatorDefinition | undefined {
  if (!operatorId) return undefined;
  return OPERATORS_BY_ID.get(operatorId);
}

/**
 * Returns the operators applicable to a given value type, optionally
 * narrowed to an explicit allow-list of operator ids (order follows the
 * allow-list when one is given, otherwise catalog order).
 */
export function getOperatorsForType(
  valueType: ValueType,
  allowedOperatorIds?: readonly string[],
): OperatorDefinition[] {
  const applicable = OPERATOR_DEFINITIONS.filter((operator) => operator.applicableTypes.includes(valueType));
  if (!allowedOperatorIds || allowedOperatorIds.length === 0) {
    return applicable;
  }
  const allowed = new Set(allowedOperatorIds);
  const applicableById = new Map(applicable.map((operator) => [operator.id, operator]));
  return allowedOperatorIds
    .map((id) => applicableById.get(id))
    .filter((operator): operator is OperatorDefinition => operator !== undefined);
}
