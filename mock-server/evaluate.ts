import { FIELDS } from "./catalog";
import type { StatBlock } from "../src/api/types";

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

/**
 * Restrict rows to the selected databases. Each plant species is its own
 * "database" (see catalog DATABASES), so a database id is matched against
 * `row.species`.
 */
export function filterByDatabases(rows: Row[], databaseIds: string[]): Row[] {
  const ids = new Set(databaseIds);
  return rows.filter((r) => ids.has(String(r.species)));
}

/**
 * Per-database match / total counts, in the given id order. Counts only — a real
 * backend does this as `COUNT(*) ... GROUP BY database`, cheap at any scale.
 */
export function perDatabaseCounts(
  query: JsonNode,
  rows: Row[],
  databaseIds: string[],
): { id: string; matchCount: number; totalCount: number }[] {
  return databaseIds.map((id) => {
    const inDb = rows.filter((r) => String(r.species) === id);
    return {
      id,
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

function referencedFieldIds(node: JsonNode, acc = new Set<string>()): Set<string> {
  if (node.kind === "condition") {
    if (node.fieldId) acc.add(node.fieldId);
  } else {
    for (const c of node.children) referencedFieldIds(c, acc);
  }
  return acc;
}

/** part / whole, scaled to `target`, rounded. Zero whole → zero. */
export function scaleCount(part: number, whole: number, target: number): number {
  return whole ? Math.round((part / whole) * target) : 0;
}

/**
 * `scale` lets the mock report counts at real database scale while still
 * evaluating the 200-row sample: `total` multiplies row-population counts
 * (nullCount), `match` multiplies match-population counts (distribution buckets).
 * min/max/avg are field *values*, never scaled. Both default to 1 (no scaling).
 */
export function computeBlocks(
  query: JsonNode,
  rows: Row[],
  scale: { total?: number; match?: number } = {},
): StatBlock[] {
  const totalScale = scale.total ?? 1;
  const matchScale = scale.match ?? 1;
  const matching = rows.filter((r) => matches(query, r));
  const blocks: StatBlock[] = [];

  for (const fieldId of referencedFieldIds(query)) {
    const field = FIELDS.find((f) => f.id === fieldId);
    if (!field) continue;
    const matchingValues = matching.map((r) => r[fieldId]);
    const present = matchingValues.filter((v) => v !== null && v !== undefined && v !== "");

    // nullCount is computed across ALL rows in the (scoped) dataset — Ruling 9.
    const allValues = rows.map((r) => r[fieldId]);
    const allPresent = allValues.filter((v) => v !== null && v !== undefined && v !== "");
    const nullCount = Math.round((allValues.length - allPresent.length) * totalScale);

    if (field.valueType === "number") {
      const nums = present.map(Number);
      blocks.push({
        kind: "number-summary",
        fieldLabel: field.label,
        min: nums.length ? Math.min(...nums) : 0,
        max: nums.length ? Math.max(...nums) : 0,
        avg: nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : 0,
        nullCount,
      });
    } else if (field.valueType === "date") {
      const dates = present.map(String).sort();
      blocks.push({
        kind: "date-range",
        fieldLabel: field.label,
        earliest: dates[0] ?? "",
        latest: dates[dates.length - 1] ?? "",
        nullCount,
      });
    } else {
      const counts = new Map<string, number>();
      for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      let buckets = [...counts.entries()]
        .map(([label, count]) => ({ label, count: Math.round(count * matchScale) }))
        .sort((a, b) => b.count - a.count);
      if (field.valueType === "string") buckets = buckets.slice(0, 10);
      blocks.push({ kind: "distribution", fieldLabel: field.label, buckets, nullCount });
    }
  }
  return blocks;
}
