import type { RequestCondition, RequestNode } from "../src/api/legacy/types";
import type {
  RequestFacet,
  RequestGroup,
  StatsErrorMessage,
  StatsResponse,
} from "../src/api/types";
import type { MockEvent } from "./rows";
import type { Occurrence } from "./vehicleData";

export type Row = Record<string, string | number | boolean | null>;

// The query arrives as a QueryRequest (src/api/types.ts). server.ts checks its
// shape (requestBody.ts) before anything here reads it.

/** The key a facet's field value is stored under in a Row (mock-server/rows.ts).
 *  A dotted key is fine here: it never leaves the mock, and the fictional data
 *  has no dots in its labels. */
export function rowKey(facetId: string, fieldId: string): string {
  return `${facetId}.${fieldId}`;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * The parts of a full or partial ISO UTC timestamp, each one optional here:
 *
 *     2024  -11  -06  T14  :32  :05  .123  Z
 *     year  mon  day  hour min  sec  frac
 *
 * `timestampParts` then checks what a regex can't say readably: a part only
 * appears after the one before it ("2024T14" has no month and day), and `Z`
 * only after a time. A copy of the pattern in src/query/dates.ts (the mock
 * shares no runtime code with src/); tests/dateCases.ts makes both accept the
 * same values.
 */
const PARTS =
  /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?(?:T(\d{2}))?(?::(\d{2}))?(?::(\d{2}))?(?:\.(\d{1,3}))?(Z)?$/;

/** year, month, day, hour, minute, second, fraction — `undefined` from the first part left out. */
type Parts = [string, ...(string | undefined)[]];

/** The value's parts, or null if it isn't a (partial) ISO UTC timestamp. */
function timestampParts(v: string): Parts | null {
  const m = PARTS.exec(v);
  if (!m) return null;
  const parts = m.slice(1, 8) as Parts;
  const firstMissing = parts.indexOf(undefined);
  if (firstMissing !== -1 && parts.slice(firstMissing).some((p) => p !== undefined)) return null;
  const hasTime = parts[3] !== undefined;
  if (m[8] && !hasTime) return null;
  return parts;
}

/**
 * The span of time a full or partial ISO UTC timestamp covers, as
 * [start, end) in epoch ms: "2024-11" is all of November 2024,
 * "2024-11-06T14" the hour from 14:00 UTC. How the frontend sends dates —
 * docs/ARCHITECTURE.md, "Dates". Null if `v` isn't one.
 */
export function utcSpan(v: unknown): [number, number] | null {
  if (typeof v !== "string") return null;
  const found = timestampParts(v);
  if (!found) return null;
  const [year, month, day, hour, minute, second, fraction] = found;
  const parts = [
    Number(year),
    month ? Number(month) - 1 : 0,
    day ? Number(day) : 1,
    hour ? Number(hour) : 0,
    minute ? Number(minute) : 0,
    second ? Number(second) : 0,
    fraction ? Number(fraction.padEnd(3, "0")) : 0,
  ] as const;
  // The last part the value spells out is the one its span is one unit of.
  const last = [year, month, day, hour, minute, second, fraction].filter(Boolean).length - 1;
  const end: number[] = [...parts];
  end[last]! += last === 6 ? 10 ** (3 - fraction!.length) : 1;
  const utc = (p: readonly number[]) => Date.UTC(p[0]!, p[1]!, p[2], p[3], p[4], p[5], p[6]);
  return [utc(parts), utc(end)];
}

/**
 * A date condition against a stored timestamp (or "YYYY-MM-DD", read as
 * midnight UTC): the backend's interpretation of the user's operator at the
 * precision they typed. Undefined when this isn't one — the generic
 * comparison applies instead.
 */
function dateMatches(
  operatorId: string,
  value: unknown,
  v: Row[string] | undefined,
): boolean | undefined {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) return undefined;
  if (operatorId === "between") {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const from = utcSpan(value[0]);
    const to = utcSpan(value[1]);
    return from && to ? t >= from[0] && t < to[1] : undefined;
  }
  const span = utcSpan(value);
  if (!span) return undefined;
  const [start, end] = span;
  switch (operatorId) {
    case "eq":
      return t >= start && t < end;
    case "neq":
      return t < start || t >= end;
    case "before":
      return t < start;
    case "after":
      return t >= end;
    default:
      return undefined;
  }
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Whether the event holds any value at all for the facet (see `rowKey`). A
 *  key whose value is null holds nothing, so it does not count. */
function rowHasFacet(row: Row, facetId: string): boolean {
  const prefix = `${facetId}.`;
  return Object.keys(row).some((k) => k.startsWith(prefix) && row[k] !== null);
}

/** Whether a stored value `v` matches `operatorId` with the condition's
 *  `value`: the mock's reading of every field-level operator. */
function fieldMatches(operatorId: string, value: unknown, v: Row[string] | undefined): boolean {
  const asDate = dateMatches(operatorId, value, v);
  if (asDate !== undefined) return asDate;
  switch (operatorId) {
    case "eq":
      return v === value;
    case "neq":
      return v !== value;
    case "gt":
      return v != null && cmp(v, value) > 0;
    case "gte":
      return v != null && cmp(v, value) >= 0;
    case "lt":
      return v != null && cmp(v, value) < 0;
    case "lte":
      return v != null && cmp(v, value) <= 0;
    case "before":
      return v != null && String(v) < String(value);
    case "after":
      return v != null && String(v) > String(value);
    case "contains":
      return v != null && String(v).includes(String(value));
    case "between": {
      if (!Array.isArray(value) || value.length !== 2 || v == null) return false;
      return cmp(v, value[0]!) >= 0 && cmp(v, value[1]!) <= 0;
    }
    case "in":
      return Array.isArray(value) && value.includes(v as never);
    case "not_in":
      return Array.isArray(value) && !value.includes(v as never);
    case "absent":
      return isBlank(v);
    case "present":
      return !isBlank(v);
    default:
      return false;
  }
}

function conditionMatches(c: RequestCondition, row: Row): boolean {
  if (c.field_id === null) {
    // A condition about the facet itself: only presence makes sense.
    if (c.operator_id === "present") return rowHasFacet(row, c.facet_id);
    if (c.operator_id === "absent") return !rowHasFacet(row, c.facet_id);
    return false;
  }
  return fieldMatches(c.operator_id, c.value, row[rowKey(c.facet_id, c.field_id)]);
}

/**
 * Restrict events to the selected databases. An event's `db` comes purely from
 * the entryset's numeric id (see mock-server/databases.ts and `toMockEvent` in
 * mock-server/rows.ts), never from anything inside the entryset's own fields.
 */
export function filterByDatabases(events: MockEvent[], databaseIds: string[]): MockEvent[] {
  const ids = new Set(databaseIds);
  return events.filter((e) => ids.has(e.db));
}

/**
 * Per-database match / total counts, in the given id order. Counts only — a real
 * backend does this as `COUNT(*) ... GROUP BY database`, cheap at any scale.
 */
export function perDatabaseCounts(
  query: MockNode,
  events: MockEvent[],
  databaseIds: string[],
): { label: string; matchCount: number; totalCount: number }[] {
  return databaseIds.map((label) => {
    const inDb = events.filter((e) => e.db === label);
    return {
      label,
      totalCount: inDb.length,
      matchCount: inDb.filter((e) => eventMatches(query, e)).length,
    };
  });
}

/** A query tree as the mock accepts it while the app moves to facet blocks:
 *  groups may hold facet blocks and, until plan A2, the old condition nodes. */
export interface MockGroup {
  kind: "group";
  id: string;
  operator: RequestGroup["operator"];
  children: MockNode[];
}
export type MockNode = MockGroup | RequestFacet | RequestCondition;

/** Whether one occurrence matches the block's set fields; no set fields: yes. */
function occurrenceMatches(f: RequestFacet, occ: Occurrence): boolean {
  if (f.conditions.length === 0) return true;
  const test = (c: RequestFacet["conditions"][number]) =>
    fieldMatches(c.operator_id, c.value, occ[c.field_id]);
  return f.operator === "AND" ? f.conditions.every(test) : f.conditions.some(test);
}

/** The event has (or, negated, has no) occurrence of the facet in which the
 *  block's fields match: "ALL" means all within ONE occurrence. This is the
 *  mock's reading; the real backend owns the rule. */
export function facetMatches(f: RequestFacet, event: MockEvent): boolean {
  const has = (event.occurrences[f.facet_id] ?? []).some((occ) => occurrenceMatches(f, occ));
  return f.negated ? !has : has;
}

export function eventMatches(node: MockNode, event: MockEvent): boolean {
  if (node.kind === "facet") return facetMatches(node, event);
  if (node.kind === "condition") return conditionMatches(node, event.row);
  if (node.children.length === 0) return true;
  return node.operator === "AND"
    ? node.children.every((c) => eventMatches(c, event))
    : node.children.some((c) => eventMatches(c, event));
}

/** The old condition-node matcher, on a flattened row (mock-server/rows.ts). */
export function matches(node: RequestNode, row: Row): boolean {
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

/** The longest text value the mock's databases accept. */
export const MAX_TEXT_LENGTH = 100;

/**
 * The problems the mock's databases find in a query, each pointed at by the
 * `id` of its node — the way a real backend reports what only it can check:
 *
 * - a condition with a text value (or a text item in a list) longer than
 *   MAX_TEXT_LENGTH (`invalid`);
 * - a group whose every child has an error of its own (a condition's, or a
 *   child group's own "no valid conditions"): "Group contains no valid
 *   conditions." This mirrors the real backend. It is `incomplete`, not
 *   `invalid`: the frontend shows it as a warning, while the condition
 *   errors that cause it stay red. An empty group gets none; the frontend's
 *   own validation reports that.
 *
 * Empty when there are none.
 */
export function queryErrors(node: MockNode): StatsErrorMessage[] {
  if (node.kind === "facet") {
    const errors = node.conditions.flatMap(textTooLong);
    // Mirrors the group rule below: a block whose every set field failed.
    if (node.conditions.length > 0 && errors.length === node.conditions.length) {
      errors.push({
        node_id: node.id,
        kind: "incomplete",
        message: "Facet contains no valid conditions.",
      });
    }
    return errors;
  }
  if (node.kind === "group") {
    const perChild = node.children.map(queryErrors);
    const errors = perChild.flat();
    const everyChildFailed =
      node.children.length > 0 &&
      node.children.every((child, i) => perChild[i]!.some((e) => e.node_id === child.id));
    if (everyChildFailed) {
      errors.push({
        node_id: node.id,
        kind: "incomplete",
        message: "Group contains no valid conditions.",
      });
    }
    return errors;
  }
  return textTooLong(node);
}

/** The "text is too long" error of one condition, if it has one. */
function textTooLong(c: { id: string; value: unknown }): StatsErrorMessage[] {
  const values = Array.isArray(c.value) ? c.value : [c.value];
  const tooLong = values.some((v) => typeof v === "string" && v.length > MAX_TEXT_LENGTH);
  if (!tooLong) return [];
  return [
    {
      node_id: c.id,
      kind: "invalid",
      message: `Text is too long (at most ${MAX_TEXT_LENGTH} characters).`,
    },
  ];
}

/** What the mock worked out for one database; `buildStatsLine` puts it on the
 *  wire. camelCase because it is the mock's own, not the contract's. */
export interface DatabaseOutcome {
  label: string;
  /** Present only on success. */
  matchCount?: number;
  /** When set, this database's line reports failure instead of a count. */
  fail?: { errorMessages: StatsErrorMessage[]; infoMessages: string[] };
}

/** Turns one database's raw outcome into the StatsResponse line /api/filter/validate streams for it. */
export function buildStatsLine(outcome: DatabaseOutcome): StatsResponse {
  if (outcome.fail) {
    const line: StatsResponse = {
      label: outcome.label,
      success: false,
      error_messages: outcome.fail.errorMessages,
      info_messages: outcome.fail.infoMessages,
    };
    return line;
  }
  return { label: outcome.label, success: true, match_count: outcome.matchCount };
}
