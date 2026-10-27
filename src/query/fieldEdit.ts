import {
  findField,
  findOperator,
  type Arity,
  type CatalogField,
  type CatalogOperator,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { newFieldCondition } from "./tree";
import type { FieldCondition } from "./types";

/**
 * The value a condition holds before the user enters one. Not every control
 * can show "unset" (a boolean toggle is always true or false), so this is
 * where a field's real default lives.
 */
export function defaultValueFor(
  field: CatalogField | undefined,
  operator: CatalogOperator | undefined,
): unknown {
  if (field?.valueType === "boolean" && operator?.arity === "one") return false;
  return null;
}

/**
 * A field row after the user picked an operator or typed a value. Null means
 * "not filtered": the blank choice at the top of the operator dropdown was
 * picked, and the block no longer holds a condition for this field.
 *
 * `readValue` reads the row's value control. It is only called while that
 * control still has the right shape: after an operator change that alters the
 * arity ("Greater than" → "Between") the row still shows the old control until
 * the repaint, so the value is reset instead.
 */
export function nextFieldCondition(
  existing: FieldCondition | undefined,
  facetId: string,
  fieldId: string,
  operatorId: string | null,
  catalog: FieldCatalog,
  readValue: (arity: Arity, valueType: ValueType) => unknown,
): FieldCondition | null {
  if (!operatorId) return null;
  const field = findField(catalog, facetId, fieldId);
  const operator = findOperator(operatorId);
  let value = defaultValueFor(field, operator);
  const sameShape =
    existing !== undefined && findOperator(existing.operatorId)?.arity === operator?.arity;
  if (sameShape && field && operator) value = readValue(operator.arity, field.valueType) ?? value;
  return existing
    ? { ...existing, operatorId, value }
    : newFieldCondition(fieldId, operatorId, value);
}

/** Where the cursor goes after an operator was picked: to its value, unless
 *  the operator takes none ("present"). */
export function cursorAfterOperator(operatorId: string | null): "value" | null {
  const op = findOperator(operatorId);
  return op && op.arity !== "none" ? "value" : null;
}
