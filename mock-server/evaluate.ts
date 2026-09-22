import type { StatsResponse } from "../src/api/types";

export type Row = Record<string, string | number | boolean | null>;

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

/**
 * Restrict rows to the selected databases. Rows are flattened entrysets
 * (see mock-server/rows.ts), each carrying a synthetic `__db` key assigned
 * purely from the entryset's numeric id (see mock-server/databases.ts) —
 * never from anything inside the entryset's own fields.
 */
export function filterByDatabases(rows: Row[], databaseIds: string[]): Row[] {
  const ids = new Set(databaseIds);
  return rows.filter((r) => ids.has(String(r.__db)));
}

/**
 * Per-database match / total counts, in the given id order. Counts only — a real
 * backend does this as `COUNT(*) ... GROUP BY database`, cheap at any scale.
 */
export function perDatabaseCounts(
  query: JsonNode,
  rows: Row[],
  databaseIds: string[],
): { label: string; matchCount: number; totalCount: number }[] {
  return databaseIds.map((label) => {
    const inDb = rows.filter((r) => String(r.__db) === label);
    return {
      label,
      totalCount: inDb.length,
      matchCount: inDb.filter((r) => matches(query, r)).length,
    };
  });
}

export function matches(node: JsonNode, row: Row): boolean {
  if (node.kind === "condition") return conditionMatches(node, row);
  if (node.children.length === 0) return true;
  return node.operator === "AND"
    ? node.children.every((c) => matches(c, row))
    : node.children.some((c) => matches(c, row));
}

/** part / whole, scaled to `target`, rounded. Zero whole → zero. */
export function scaleCount(part: number, whole: number, target: number): number {
  return whole ? Math.round((part / whole) * target) : 0;
}

export interface DatabaseOutcome {
  label: string;
  /** Present only on success. */
  matchCount?: number;
  infoMessages?: string[];
  /** When set, this database's line reports failure instead of a count. */
  fail?: { errorMessages: string[]; infoMessages: string[] };
}

/** Turns one database's raw outcome into the StatsResponse line /api/stats streams for it. */
export function buildStatsLine(outcome: DatabaseOutcome): StatsResponse {
  if (outcome.fail) {
    const line: StatsResponse = {
      label: outcome.label,
      success: false,
      errorMessages: outcome.fail.errorMessages,
      infoMessages: outcome.fail.infoMessages,
    };
    return line;
  }
  const line: StatsResponse = { label: outcome.label, success: true, matchCount: outcome.matchCount };
  if (outcome.infoMessages) line.infoMessages = outcome.infoMessages;
  return line;
}
