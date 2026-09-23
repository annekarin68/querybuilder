import type { QueryNode } from "../query/types";

const KEY = "qb:pending-query";

interface PendingQuery {
  query: QueryNode;
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

/**
 * Reads and clears the saved query, if any. A missing key, a storage error,
 * and corrupted JSON are all treated the same: nothing to restore.
 */
export function takePendingQuery(): PendingQuery | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as PendingQuery;
  } catch {
    return null;
  }
}
