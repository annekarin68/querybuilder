import type { Condition, Issue, QueryNode } from "./types";
import {
  findField,
  findOperator,
  type Arity,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { isUtcTimestamp } from "./dates";

function isEmptyScalar(v: unknown): boolean {
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
      return isEmptyScalar(v) ? "Enter a value." : null;
    case "two":
      return Array.isArray(v) && v.length === 2 && !v.some(isEmptyScalar)
        ? null
        : "Enter both values.";
    case "many":
      return Array.isArray(v) && v.length > 0 ? null : "Choose at least one value.";
  }
}

/**
 * Why a single value isn't of the field's type, or null. Values off a field's
 * pick-list are fine: the list can be out of date.
 */
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

function checkCondition(c: Condition, catalog: FieldCatalog, out: Issue[]): void {
  if (!c.facetId || !c.fieldId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  const fieldDef = findField(catalog, c.facetId, c.fieldId);
  if (!fieldDef) {
    out.push(invalid(c.id, "Unknown field."));
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
  // A no-value operator's value goes out as `null`, see
  // docs/ARCHITECTURE.md, "Wire format of the query". The UI always sets
  // that; anything else came from a tampered saved query and can't be sent.
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

function walk(node: QueryNode, isRoot: boolean, catalog: FieldCatalog, out: Issue[]): void {
  if (node.kind === "condition") {
    checkCondition(node, catalog, out);
    return;
  }
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a condition to this group."));
  }
  for (const child of node.children) walk(child, false, catalog, out);
}

export function validateQuery(tree: QueryNode, catalog: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, catalog, out);
  return out;
}
