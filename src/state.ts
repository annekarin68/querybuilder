import type { Issue, QueryNode } from "./query/types";
import { countConditions, emptyQuery } from "./query/tree";
import { hasBlockingErrors } from "./query/validate";
import type {
  AuthUser,
  DatabasesResponse,
  EventsResponse,
  Facet,
  StatsResponse,
} from "./api/types";
import { buildFieldCatalog } from "./query/fieldCatalog";

export type ActiveView = "filter" | "review" | "approval" | "done";
export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export interface AppState {
  schema: ReturnType<typeof buildFieldCatalog> | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: DatabasesResponse[] | null;
  /** The data model backing the docs sidebar (loaded once). */
  facets: Facet[] | null;
  /** Who's logged in, if anyone — populated once at startup via GET /api/auth/me. */
  auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
  /** Compliance acknowledgment for this session, if any — populated once at
   *  startup via GET /api/compliance/status. Display-only, same as `auth`:
   *  it drives the account menu and an advisory hint, never gating logic. */
  compliance: {
    status: "loading" | "required" | "acknowledged";
    reason: string | null;
    ackedAt: string | null;
  };
  /** Which databases the query currently runs against. Empty = nothing runs. */
  selectedDatabaseIds: string[];
  activeView: ActiveView;

  query: QueryNode;
  issues: Issue[];

  stats: { status: AsyncStatus; lines: StatsResponse[]; error: string | null };
  preview: { status: AsyncStatus; data: EventsResponse | null; error: string | null };

  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  schema: null,
  databases: null,
  facets: null,
  auth: { status: "loading", user: null },
  compliance: { status: "loading", reason: null, ackedAt: null },
  selectedDatabaseIds: [],
  activeView: "filter",
  query: emptyQuery(),
  issues: [],
  stats: { status: "idle", lines: [], error: null },
  preview: { status: "idle", data: null, error: null },
  // The docs start folded into their rail so the query builder gets the width.
  sidebarCollapsed: true,
};

/**
 * Whether the current query/scope is complete and valid enough to run or
 * refresh (§6): a schema is loaded, there are no blocking validation issues,
 * at least one condition exists, and at least one database is selected. The
 * single source of truth for this check — main.ts's runPreview and
 * refreshStats read it instead of repeating the four clauses (the preview
 * panel mirrors the same checks to decide whether Run is enabled).
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
