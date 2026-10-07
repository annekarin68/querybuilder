import {
  findField,
  findOperator,
  isFacetLevel,
  type Arity,
  type CatalogField,
  type CatalogOperator,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import type { Condition } from "./types";

/** What a condition row's Facet / Field / Operator dropdowns currently show. */
export interface RowPicks {
  facetId: string | null;
  fieldId: string | null;
  operatorId: string | null;
  /** true when the Field dropdown shows the no-field choice */
  facetOnly: boolean;
}

/**
 * The value a condition should hold when it has no meaningful selection yet — not
 * every control can represent "unset" on screen (a boolean toggle is always either
 * true or false), so this is where a field/operator's real default lives.
 */
export function defaultValueFor(
  field: CatalogField | undefined,
  operator: CatalogOperator | undefined,
): unknown {
  if (field?.valueType === "boolean" && operator?.arity === "one") return false;
  return null;
}

/**
 * The condition after the user changed something in its row. The dropdowns
 * cascade: a new Facet clears Field, Operator and value; a new Field clears
 * Operator and value. Choosing "no field" (a facet-level condition) sets the
 * operator to "present".
 *
 * `readValue` reads the row's on-screen value control. It is only called when
 * that control still has the right shape — if the operator's arity changed
 * (say "Greater than" → "Between"), the row still shows the OLD control until
 * the next repaint, so the value is reset instead of read.
 */
export function nextCondition(
  cond: Condition,
  picks: RowPicks,
  catalog: FieldCatalog,
  readValue: (arity: Arity, valueType: ValueType) => unknown,
): Pick<Condition, "facetId" | "fieldId" | "operatorId" | "value"> {
  const facetId = picks.facetId;
  const facetChanged = facetId !== cond.facetId;
  // A new facet starts over: neither a field nor "no field" carries across.
  const facetOnly = !facetChanged && picks.facetOnly;
  const fieldId = facetChanged || facetOnly ? null : picks.fieldId;
  const wasFacetOnly = isFacetLevel(cond);
  const fieldChanged = facetChanged || fieldId !== cond.fieldId || facetOnly !== wasFacetOnly;
  // Choosing "no field" picks "present" straight away, so the condition is
  // already complete and can be told apart from "nothing chosen yet".
  const operatorId = fieldChanged ? (facetOnly ? "present" : null) : picks.operatorId;

  const field = findField(catalog, facetId, fieldId);
  const operator = findOperator(operatorId);
  const sameShape = findOperator(cond.operatorId)?.arity === operator?.arity;

  let value = defaultValueFor(field, operator);
  if (!fieldChanged && sameShape && field && operator) {
    value = readValue(operator.arity, field.valueType) ?? value;
  }
  return { facetId, fieldId, operatorId, value };
}
