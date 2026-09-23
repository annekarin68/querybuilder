import { findField, type FieldCatalog } from "./fieldCatalog";
import type { Condition, Group, QueryNode } from "./types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Start of the UTC day `days` after `day` ("2024-11-06" → "2024-11-06T00:00:00.000Z"). */
function dayStart(day: string, days = 0): string {
  const t = new Date(`${day}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

function bound(c: Condition, id: string, operatorId: "gte" | "lt", value: string): Condition {
  return { ...c, id, operatorId, value };
}

/** `from <= instant < to`, or (for `neq`) the instant is outside that range. */
function range(c: Condition, from: string, to: string, outside = false): Group {
  return {
    kind: "group",
    id: c.id,
    operator: outside ? "OR" : "AND",
    children: outside
      ? [bound(c, `${c.id}.from`, "lt", from), bound(c, `${c.id}.to`, "gte", to)]
      : [bound(c, `${c.id}.from`, "gte", from), bound(c, `${c.id}.to`, "lt", to)],
  };
}

/**
 * A date condition holds calendar days ("YYYY-MM-DD", from the date picker),
 * but the backend compares full UTC timestamps (docs/ARCHITECTURE.md §7,
 * "Dates"). Rewrite it into `gte` / `lt` comparisons against UTC day starts.
 * Anything else — including a value that isn't a calendar day — is sent as is.
 */
function dateToWire(c: Condition): QueryNode {
  const v = c.value;
  const isDay = (x: unknown): x is string => typeof x === "string" && DAY.test(x);
  switch (c.operatorId) {
    case "eq":
      return isDay(v) ? range(c, dayStart(v), dayStart(v, 1)) : c;
    case "neq":
      return isDay(v) ? range(c, dayStart(v), dayStart(v, 1), true) : c;
    case "before":
      return isDay(v) ? { ...c, operatorId: "lt", value: dayStart(v) } : c;
    case "after":
      return isDay(v) ? { ...c, operatorId: "gte", value: dayStart(v, 1) } : c;
    case "between": {
      if (!Array.isArray(v) || v.length !== 2 || !isDay(v[0]) || !isDay(v[1])) return c;
      return range(c, dayStart(v[0]), dayStart(v[1], 1));
    }
    default:
      return c;
  }
}

/** The query as sent to `/api/stats` and `/api/query`: the on-screen tree with
 *  date conditions rewritten to UTC timestamps. Never modifies `query`. */
export function toWireQuery(query: Group, catalog: FieldCatalog): Group {
  const walk = (node: QueryNode): QueryNode => {
    if (node.kind === "group") return { ...node, children: node.children.map(walk) };
    return findField(catalog, node.fieldId)?.valueType === "date" ? dateToWire(node) : node;
  };
  return walk(query) as Group;
}
