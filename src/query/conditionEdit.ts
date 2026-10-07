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
import { queryToText } from "./summary";
import type { Condition } from "./types";

/** What a condition row's Facet / Field / Operator dropdowns currently show. */
export interface RowPicks {
  facetId: string | null;
  fieldId: string | null;
  /** The Operator dropdown. A whole-facet condition has none: see `facetOperatorId`. */
  operatorId: string | null;
  /** "present" or "absent" when the Field dropdown shows a whole-facet test.
   *  That choice is the operator, so the row draws no Operator dropdown. */
  facetOperatorId: string | null;
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
 * Operator and value. Choosing a whole-facet test ("Is present" / "Is absent")
 * in the Field dropdown clears the field and sets that operator.
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
  // A new facet starts over: neither a field nor a whole-facet test carries
  // across (the Field dropdown still shows the old facet's choice until the
  // repaint, so its value must be ignored here).
  const facetOperatorId = facetChanged ? null : picks.facetOperatorId;
  const fieldId = facetChanged || facetOperatorId ? null : picks.fieldId;
  const fieldChanged = facetChanged || fieldId !== cond.fieldId || isFacetLevel(cond);
  // The whole-facet test is the operator itself, chosen in the Field dropdown,
  // so the condition is complete at once and can be told apart from "nothing
  // chosen yet". A field starts over without an operator.
  const operatorId = facetOperatorId ?? (fieldChanged ? null : picks.operatorId);

  const field = findField(catalog, facetId, fieldId);
  const operator = findOperator(operatorId);
  const sameShape = findOperator(cond.operatorId)?.arity === operator?.arity;

  let value = defaultValueFor(field, operator);
  if (!fieldChanged && sameShape && field && operator) {
    value = readValue(operator.arity, field.valueType) ?? value;
  }
  return { facetId, fieldId, operatorId, value };
}

/** Where the cursor goes after a choice in a condition row's dropdown, so a
 *  whole condition can be built from the keyboard. */
const NEXT_PART: Record<string, "field" | "operator" | "value"> = {
  facet: "field",
  field: "operator",
  operator: "value",
};

/** "field-closed" = the Field dropdown without opening its menu. */
export type CursorTarget = "field" | "field-closed" | "operator" | "value";

/**
 * Where the cursor goes after the row was changed. Decided on the condition
 * that was just committed (what `nextCondition` returned), never on the row's
 * raw dropdown values: after a new Facet the Field dropdown still shows the old
 * facet's choice until the repaint, and that stale choice must not count.
 *
 * `changedPart` is the dropdown just used ("facet", "field", …), if any;
 * `hasChoice` is whether it now shows a choice (a cleared dropdown moves
 * nowhere). A whole-facet test finishes the row (no Operator or Value follows),
 * so the cursor stays on the Field dropdown, closed, where the user can still
 * change their mind.
 */
export function cursorAfterChange(
  changedPart: string | undefined,
  hasChoice: boolean,
  committed: Pick<Condition, "facetId" | "fieldId" | "operatorId" | "value">,
): CursorTarget | null {
  if (!changedPart || !hasChoice) return null;
  if (changedPart === "field" && isFacetLevel(committed)) return "field-closed";
  return NEXT_PART[changedPart] ?? null;
}

/**
 * What to say to screen-reader users after the row was changed, or null.
 * A whole-facet test removes the Operator and Value slots from the row, which a
 * screen reader user cannot see happen, so they are told the row is complete,
 * in the words of the query's plain-English summary ("Thing is present").
 * Same arguments as `cursorAfterChange`.
 */
export function announcementAfterChange(
  changedPart: string | undefined,
  hasChoice: boolean,
  committed: Condition,
  catalog: FieldCatalog,
): string | null {
  if (changedPart !== "field" || !hasChoice || !isFacetLevel(committed)) return null;
  return `${queryToText(committed, catalog)}. Condition complete.`;
}
