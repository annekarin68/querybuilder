import type { Group, QueryNode } from "../query/types";

const KEY = "qb:pending-query";

interface PendingQuery {
  query: Group;
  selectedDatabaseIds: string[];
}

/**
 * Preserves the in-progress query across the full-page redirect into the
 * login or compliance flow — a lost query tree would otherwise force the
 * user to rebuild it from scratch after logging in or writing a compliance
 * reason. sessionStorage only: never sent through the backend or any
 * redirect URL.
 */
export function savePendingQuery(query: QueryNode, selectedDatabaseIds: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ query, selectedDatabaseIds }));
  } catch {
    // Storage unavailable (private browsing, disabled site data) — nothing to
    // preserve, not fatal; the user just rebuilds the query if this happens.
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural check on a tree read back from storage. The entry may have been
 * written by an older build of the app (a deploy can land between the redirect
 * out and the return hop), so it is untrusted input — a malformed tree must be
 * dropped here rather than crash rendering or validation later.
 */
function isQueryNode(v: unknown): v is QueryNode {
  if (!isObject(v) || typeof v.id !== "string") return false;
  if (v.kind === "condition") {
    const nullableString = (x: unknown) => x === null || typeof x === "string";
    return nullableString(v.facetId) && nullableString(v.fieldId) && nullableString(v.operatorId);
  }
  return (
    v.kind === "group" &&
    (v.operator === "AND" || v.operator === "OR") &&
    Array.isArray(v.children) &&
    v.children.every(isQueryNode)
  );
}

/**
 * Reads and clears the saved query, if any. A missing key, a storage error,
 * corrupted JSON, and a structurally invalid entry are all treated the same:
 * nothing to restore. The root must be a group — the query builder's root is
 * always one.
 */
export function takePendingQuery(): PendingQuery | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed: unknown = JSON.parse(raw);
    if (
      !isObject(parsed) ||
      !isQueryNode(parsed.query) ||
      parsed.query.kind !== "group" ||
      !Array.isArray(parsed.selectedDatabaseIds) ||
      !parsed.selectedDatabaseIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return { query: parsed.query, selectedDatabaseIds: parsed.selectedDatabaseIds as string[] };
  } catch {
    return null;
  }
}
