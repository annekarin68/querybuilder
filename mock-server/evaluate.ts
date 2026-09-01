type Row = Record<string, string | number | boolean | null>;

export interface JsonCondition {
  kind: "condition";
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}
export interface JsonGroup {
  kind: "group";
  operator: "AND" | "OR";
  children: JsonNode[];
}
export type JsonNode = JsonCondition | JsonGroup;

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function conditionMatches(c: JsonCondition, row: Row): boolean {
  if (!c.fieldId || !c.operatorId) return false;
  const v = row[c.fieldId];
  switch (c.operatorId) {
    case "eq":
      return v === c.value;
    case "neq":
      return v !== c.value;
    case "gt":
      return v != null && cmp(v, c.value) > 0;
    case "gte":
      return v != null && cmp(v, c.value) >= 0;
    case "lt":
      return v != null && cmp(v, c.value) < 0;
    case "lte":
      return v != null && cmp(v, c.value) <= 0;
    case "before":
      return v != null && String(v) < String(c.value);
    case "after":
      return v != null && String(v) > String(c.value);
    case "contains":
      return v != null && String(v).includes(String(c.value));
    case "between": {
      if (!Array.isArray(c.value) || c.value.length !== 2 || v == null) return false;
      return cmp(v, c.value[0]!) >= 0 && cmp(v, c.value[1]!) <= 0;
    }
    case "in":
      return Array.isArray(c.value) && c.value.includes(v as never);
    case "isEmpty":
      return v === null || v === undefined || v === "";
    case "isNotEmpty":
      return !(v === null || v === undefined || v === "");
    default:
      return false;
  }
}

export function matches(node: JsonNode, row: Row): boolean {
  if (node.kind === "condition") return conditionMatches(node, row);
  if (node.children.length === 0) return true;
  return node.operator === "AND"
    ? node.children.every((c) => matches(c, row))
    : node.children.some((c) => matches(c, row));
}
