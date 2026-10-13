import type { Group, QueryNode } from "../query/types";

/**
 * The **kept query** (docs/ARCHITECTURE.md, "Saved query across the
 * login/compliance redirect"): a copy of the query on screen and its database
 * selection, written on every change, so that the next page load in this tab
 * can put it back. That covers a reload, the trip to the login or compliance
 * page and back, a Back from those pages, and a reopened tab. Not to be
 * confused with a *saved* query, which the user names and the server stores.
 *
 * sessionStorage only: this tab's own, gone when the tab is closed for good,
 * so a query is never left behind on a shared machine; and never sent to the
 * backend or put in a redirect URL.
 */
const KEY = "qb:kept-query";

export interface KeptQuery {
  query: Group;
  selectedDatabaseIds: string[];
}

/** Write the copy, replacing the one before. */
export function keepQuery(query: Group, selectedDatabaseIds: string[]): void {
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
 * written by an older build of the app (a deploy can land between two page
 * loads), so it is untrusted input — a malformed tree must be
 * dropped here rather than crash rendering or validation later.
 */
function isQueryNode(v: unknown): v is QueryNode {
  if (!isObject(v) || typeof v.id !== "string") return false;
  if (v.kind === "condition") {
    // A condition's `value` is not checked here on purpose: `validateQuery`
    // flags a bad one, and Run stays blocked, so it never reaches the request.
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
 * Read the copy, if any, and leave it in place (the app writes a new one as
 * soon as its first state is set). A missing key, a storage error, corrupted
 * JSON, and a structurally invalid entry are all treated the same: nothing to
 * restore. The root must be a group — the query builder's root is always one.
 */
export function readKeptQuery(): KeptQuery | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
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

/**
 * Whether `query` holds anything the user chose: at least one row with a
 * facet, at any depth. The starting query (one blank row), blank rows and an
 * ALL/ANY switch alone are not worth bringing back with a "Restored" notice.
 */
export function isWorthRestoring(query: Group): boolean {
  return query.children.some((node) =>
    node.kind === "group" ? isWorthRestoring(node) : node.facetId !== null,
  );
}
