import {
  findFacet,
  findField,
  findOperator,
  type Arity,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { isUtcTimestamp } from "./dates";
import type { FacetBlock, FieldCondition, Group, Issue, QueryNode } from "./types";

/** Whether a single value is still unset: nothing chosen or typed yet. */
export function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function incomplete(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "incomplete" };
}

function invalid(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "invalid" };
}

/** What the user still has to fill in for the operator's arity, or null. */
function shapeProblem(arity: Arity, v: unknown): string | null {
  switch (arity) {
    case "none": // checked before this, in checkCondition
      return null;
    case "one":
      return isBlankValue(v) ? "Enter a value." : null;
    case "two":
      return Array.isArray(v) && v.length === 2 && !v.some(isBlankValue)
        ? null
        : "Enter both values.";
    case "many":
      // An empty list is the normal "nothing chosen yet"; a blank item inside
      // a list only comes from a tampered saved query.
      if (!Array.isArray(v) || v.length === 0) return "Choose at least one value.";
      return v.some(isBlankValue) ? "Remove the empty value." : null;
  }
}

/** Why a single value isn't of the field's type, or null. Values off a
 *  field's pick-list are fine: the list can be out of date. */
function typeProblem(valueType: ValueType, v: unknown): string | null {
  switch (valueType) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "Enter a number.";
    case "boolean":
      return typeof v === "boolean" ? null : "Choose true or false.";
    case "string":
      return typeof v === "string" ? null : "Enter text.";
    case "date":
      return isUtcTimestamp(v)
        ? null
        : "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z.";
  }
}

/** Issues about a condition sit on its row (`c.id`), except two: the builder
 *  draws one row per field the data dictionary knows, so a condition for an
 *  unknown field, or a second one for the same field, has no row on screen.
 *  Those issues sit on the block, where they are always visible, and name the
 *  field instead. */
function checkCondition(
  block: FacetBlock,
  c: FieldCondition,
  catalog: FieldCatalog,
  out: Issue[],
): void {
  const fieldDef = findField(catalog, block.facetId, c.fieldId);
  if (!fieldDef) {
    out.push(
      invalid(
        block.id,
        `Unknown field “${c.fieldId}”. The data dictionary may have changed; remove this facet and add it again.`,
      ),
    );
    return;
  }
  if (!c.operatorId) {
    out.push(incomplete(c.id, "Choose an operator."));
    return;
  }
  const op = findOperator(c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!fieldDef.operatorIds.includes(c.operatorId)) {
    out.push(invalid(c.id, "That operator isn't available for this field."));
    return;
  }
  // A no-value operator's value goes out as `null` (docs/ARCHITECTURE.md,
  // "Wire format of the query"); anything else came from a tampered saved query.
  if (op.arity === "none") {
    if (c.value !== null) out.push(invalid(c.id, "This operator takes no value."));
    return;
  }
  const shape = shapeProblem(op.arity, c.value);
  if (shape) {
    out.push(incomplete(c.id, shape));
    return;
  }
  // Each single value: the value itself, each end of a range, each list item.
  const values = op.arity === "one" ? [c.value] : (c.value as unknown[]);
  const wrongType = values.map((v) => typeProblem(fieldDef.valueType, v)).find(Boolean);
  if (wrongType) {
    out.push(invalid(c.id, wrongType));
    return;
  }
  // A backwards number range matches nothing. A date range's order is the
  // backend's call: with partial timestamps, "in order" is its interpretation.
  if (op.arity === "two" && fieldDef.valueType === "number") {
    const [from, to] = c.value as [number, number];
    if (from > to) out.push(invalid(c.id, "From must not be greater than To."));
  }
}

/** A block with nothing set is fine: it asks whether the facet is present
 *  (or absent). Unset fields are simply not in `conditions`. */
function checkBlock(block: FacetBlock, catalog: FieldCatalog, out: Issue[]): void {
  if (!findFacet(catalog, block.facetId)) {
    out.push(invalid(block.id, "Unknown facet."));
    return;
  }
  const seen = new Set<string>();
  for (const c of block.conditions) {
    // The builder keeps one condition per field; two only come from a
    // tampered saved query, and the row could show only one of them. The
    // issue sits on the block (see checkCondition).
    if (seen.has(c.fieldId)) {
      out.push(invalid(block.id, `The field “${c.fieldId}” is set twice in this facet.`));
      continue;
    }
    seen.add(c.fieldId);
    checkCondition(block, c, catalog, out);
  }
}

function walk(node: QueryNode, isRoot: boolean, catalog: FieldCatalog, out: Issue[]): void {
  if (node.kind === "facet") {
    checkBlock(node, catalog, out);
    return;
  }
  // An empty root is the starting query: "not finished" without a message
  // (runBlocker in state.ts keeps Run off; the footer says what to do).
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a facet to this group."));
  }
  for (const child of node.children) walk(child, false, catalog, out);
}

export function validateQuery(tree: Group, catalog: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, catalog, out);
  return out;
}
