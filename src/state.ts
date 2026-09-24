import type { Group, Issue } from "./query/types";
import { countConditions, emptyQuery } from "./query/tree";
import type { Compliance, Database, DatabaseResult, EventRecord, Facet, User } from "./model";
import type { FieldCatalog } from "./query/fieldCatalog";

export type ActiveView = "filter" | "review" | "approval" | "done";

// Each async part of the state is a union on `status`: a field exists only in
// the states where it means something, so TypeScript rejects impossible
// combinations like "authenticated, but no user".

/** Who's logged in. */
export type AuthState =
  { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; user: User };

/** The session's compliance acknowledgment. */
export type ComplianceState = { status: "loading" } | Compliance;

/** The live statistics. `results` fills in as each database answers. */
export type StatsState =
  | { status: "idle" | "loading" | "ok"; results: DatabaseResult[] }
  | { status: "error"; error: string };

/** The Matching events request. Only "ok" carries events, only "error" a message. */
export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; events: EventRecord[] }
  | { status: "error"; error: string };

export interface AppState {
  /** The queryable fields, derived from `facets` at startup (there is
   *  no schema endpoint — see src/query/fieldCatalog.ts). */
  catalog: FieldCatalog | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: Database[] | null;
  /** The data model backing the docs sidebar (loaded once). */
  facets: Facet[] | null;
  /** Who's logged in, if anyone — loaded once at startup via GET /api/auth/me. */
  auth: AuthState;
  /** Compliance acknowledgment for this session — loaded once at startup via
   *  GET /api/compliance/status. Display-only, same as `auth`: it drives the
   *  account menu and an advisory hint, never gating logic. */
  compliance: ComplianceState;
  /** The `Database.id`s of the databases the query runs against. Empty =
   *  nothing runs. */
  selectedDatabaseIds: string[];
  activeView: ActiveView;

  /** The query tree. Its root is always a group. */
  query: Group;
  issues: Issue[];

  stats: StatsState;
  preview: PreviewState;

  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  catalog: null,
  databases: null,
  facets: null,
  auth: { status: "loading" },
  compliance: { status: "loading" },
  selectedDatabaseIds: [],
  activeView: "filter",
  query: emptyQuery(),
  issues: [],
  stats: { status: "idle", results: [] },
  preview: { status: "idle" },
  // The docs start folded into their rail so the query builder gets the width.
  sidebarCollapsed: true,
};

/** Why the current query/scope can't run yet, or null when it can. */
export type RunBlocker = "loading" | "no-database" | "no-condition" | "unfinished";

type RunInputs = Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds">;

/**
 * The single source of truth for "can this query run?" (docs/ARCHITECTURE.md,
 * "Correctness invariant"). src/app.ts uses it to
 * decide whether to fetch; the statistics and Matching events panels use the
 * reason to explain why they are empty. Checked in the order the panels explain
 * them.
 */
export function runBlocker(state: RunInputs): RunBlocker | null {
  if (!state.catalog) return "loading";
  if (state.selectedDatabaseIds.length === 0) return "no-database";
  if (countConditions(state.query) === 0) return "no-condition";
  if (state.issues.length > 0) return "unfinished";
  return null;
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: (): AppState => state,
    setState(patch: Partial<AppState>): void {
      const changed = new Set(Object.keys(patch) as (keyof AppState)[]);
      state = { ...state, ...patch };
      for (const l of listeners) l(state, changed);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export const store = createStore(initialState);
