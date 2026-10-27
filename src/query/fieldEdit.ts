import {
  fieldsOfFacet,
  findField,
  findOperator,
  type Arity,
  type CatalogField,
  type CatalogOperator,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { newFieldCondition, removeCondition, setFieldCondition } from "./tree";
import type { FacetBlock, FieldCondition, Group } from "./types";

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
 * control still has the right shape and the new operator takes a value: after
 * an operator change that alters the arity ("Greater than" → "Between") the
 * row still shows the old control until the repaint, so the value is reset
 * instead. An operator with no value ("present" → "absent") has no control to
 * read, so its value stays null without asking.
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
  if (sameShape && field && operator && operator.arity !== "none")
    value = readValue(operator.arity, field.valueType) ?? value;
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

/**
 * The query after a field row of `block` was edited, `next` being what
 * `nextFieldCondition` made of it. `rowConditionId` is the condition the row
 * stands for (the row's own id: an unset row has none). A new condition goes
 * in the facet's field order. "Not filtered" (`next` null) removes that
 * condition only, never another one on the same field: a stray duplicate from
 * a tampered saved query has a row of its own and keeps it.
 */
export function queryAfterFieldEdit(
  query: Group,
  block: FacetBlock,
  rowConditionId: string | undefined,
  next: FieldCondition | null,
  catalog: FieldCatalog,
): Group {
  if (next) {
    const fieldOrder = fieldsOfFacet(catalog, block.facetId).map((f) => f.fieldId);
    return setFieldCondition(query, block.id, next, fieldOrder);
  }
  return rowConditionId === undefined ? query : removeCondition(query, block.id, rowConditionId);
}
