import type { Issue, QueryNode } from "./query/types";
import { countConditions, emptyQuery } from "./query/tree";
import { hasBlockingErrors } from "./query/validate";
import type {
  AuthUser,
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./api/types";

export type ActiveView = "filter" | "review" | "approval" | "done";
export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export interface AppState {
  schema: SchemaResponse | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: DatabasesResponse["databases"] | null;
  /** The vehicle telemetry data model backing the docs sidebar (loaded once). */
  individuals: IndividualsResponse | null;
  /** Who's logged in, if anyone — populated once at startup via GET /api/auth/me. */
  auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
  /** Compliance acknowledgment for this session, if any — populated once at
   *  startup via GET /api/compliance/status. Display-only, same as `auth`:
   *  it drives the top-menu widget and an advisory hint, never gating logic. */
  compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null };
  /** Which databases the query currently runs against. Empty = nothing runs. */
  selectedDatabaseIds: string[];
  activeView: ActiveView;

  query: QueryNode;
  issues: Issue[];

  stats: { status: AsyncStatus; data: StatsResponse | null; error: string | null };
  preview: { status: AsyncStatus; data: EntrysetsResponse | null; error: string | null };

  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  schema: null,
  databases: null,
  individuals: null,
  auth: { status: "loading", user: null },
  compliance: { status: "loading", reason: null, ackedAt: null },
  selectedDatabaseIds: [],
  activeView: "filter",
  query: emptyQuery(),
  issues: [],
  stats: { status: "idle", data: null, error: null },
  preview: { status: "idle", data: null, error: null },
  sidebarCollapsed: false,
};

/**
 * Whether the current query/scope is complete and valid enough to run or
 * refresh (§6): a schema is loaded, there are no blocking validation issues,
 * at least one condition exists, and at least one database is selected. The
 * single source of truth for this check — main.ts's runPreview, refreshStats,
 * and syncRunButton all read it instead of repeating the four clauses.
 */
export function canRunQuery(
  state: Pick<AppState, "schema" | "issues" | "query" | "selectedDatabaseIds">,
): boolean {
  return (
    !!state.schema &&
    !hasBlockingErrors(state.issues) &&
    countConditions(state.query) > 0 &&
    state.selectedDatabaseIds.length > 0
  );
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

export const store = createStore(initialState);
