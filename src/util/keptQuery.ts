import { countBlocks } from "../query/tree";
import type { FieldCondition, Group, QueryNode } from "../query/types";

/**
 * The **kept query** (docs/ARCHITECTURE.md, "Saved query across the
 * login/compliance redirect"): a copy of the query on screen and its database
 * selection, written on every change, so that the next page load in this tab
 * can put it back. That covers a reload, the trip to the login or compliance
 * page and back, a Back from those pages, and a reopened tab. Not to be
 * confused with a *saved* query, which the user names and the server stores.
 *
 * sessionStorage only: this tab's own, and never sent to the backend or put
 * in a redirect URL. It is gone when the tab is closed for good, except that a
 * browser restoring its last session ("Continue where you left off") brings it
 * back with the tabs. So Log out forgets it (`forgetKeptQuery`): on a shared
 * machine, logging out is what hands the browser over.
 */
const KEY = "qb:kept-query";

/** Where the build before the rename (2026-10-13) kept it. A tab open across
 *  that deploy, out on the login page, comes back with its query only here,
 *  so it is still read. Remove once no such tab can be left. */
const OLD_KEY = "qb:pending-query";

/** The Restored notice above the query, and what a screen reader hears when a
 *  page load brings the query back (`app.start`). */
export const RESTORED_MESSAGE = "Restored the query you were building.";

/** What a screen reader hears after the notice's Start fresh: the notice and
 *  the query it was about are gone, and nothing else on screen says so. */
export const STARTED_FRESH_MESSAGE = "Started a fresh query.";

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

/** Remove the copy (and one an older build kept), so no page load brings it back. */
export function forgetKeptQuery(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(OLD_KEY);
  } catch {
    // Storage unavailable: then nothing was kept either.
  }
}

/**
 * Structural check on a tree read back from storage. The entry may have been
 * written by an older build of the app (a deploy can land between two page
 * loads), so it is untrusted input — a malformed tree must be
 * dropped here rather than crash rendering or validation later. A query in
 * the shape before facet blocks (a condition directly in a group) fails here
 * and is dropped once: old queries are not migrated (spec, decision 9).
 */
function isQueryNode(v: unknown): v is QueryNode {
  if (!isObject(v) || typeof v.id !== "string") return false;
  if (v.kind === "facet") {
    return (
      typeof v.facetId === "string" &&
      typeof v.negated === "boolean" &&
      (v.operator === "AND" || v.operator === "OR") &&
      Array.isArray(v.conditions) &&
      v.conditions.every(isFieldCondition)
    );
  }
  return (
    v.kind === "group" &&
    (v.operator === "AND" || v.operator === "OR") &&
    Array.isArray(v.children) &&
    v.children.every(isQueryNode)
  );
}

/** A set field of a block. Its `value` is not checked here on purpose:
 *  `validateQuery` flags a bad one, and Run stays blocked, so it never
 *  reaches the request. */
function isFieldCondition(v: unknown): v is FieldCondition {
  return (
    isObject(v) &&
    v.kind === "condition" &&
    typeof v.id === "string" &&
    typeof v.fieldId === "string" &&
    (v.operatorId === null || typeof v.operatorId === "string")
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
    const raw = sessionStorage.getItem(KEY) ?? sessionStorage.getItem(OLD_KEY);
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
 * Whether `query` holds anything the user chose: at least one facet block, at
 * any depth. The starting query (an empty group), empty groups and an
 * ALL/ANY switch alone are not worth bringing back with a "Restored" notice.
 */
export function isWorthRestoring(query: Group): boolean {
  return countBlocks(query) > 0;
}
