import type { Group, Issue } from "./query/types";
import { countConditions, emptyQuery } from "./query/tree";
import type {
  Compliance,
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  SavedQuery,
  User,
} from "./model";
import type { FieldCatalog } from "./query/fieldCatalog";
import type { OpenSaved } from "./query/saved";

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

/** The Matching events request. Only "ok" carries events (and which page of
 *  them is on screen, 0-based: src/util/paging.ts), only "error" a message. */
export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; events: EventRecord[]; page: number }
  | { status: "error"; error: string };

/** Which saved-queries dialog is open: "save" (name and note), "list", or, for
 *  a logged-out user, the question whether to log in first ("login-to-save" /
 *  "login-to-list" say which button asked, so the focus can go back to it). */
export type SavedDialog = null | "save" | "list" | "login-to-save" | "login-to-list";

/** Saving the query on screen, as the save dialog shows it. */
export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  /** The name belongs to another saved query: ask "Replace it?" */
  | { status: "conflict"; name: string; note: string }
  | { status: "error"; error: string };

/** The logged-in user's saved queries, newest first, as the list dialog shows them. */
export type SavedListState =
  | { status: "idle" | "loading" }
  | { status: "ok"; queries: SavedQuery[] }
  | { status: "error"; error: string };

/** A line above the saved-queries list: a delete that failed ("error",
 *  spoken as an alert) or succeeded ("done", spoken through `announce`). */
export type SavedListNotice = { tone: "error" | "done"; text: string } | null;

/** An action in the list waiting for the user's yes. */
export type SavedConfirm = null | { action: "open" | "delete"; id: string };

export interface AppState {
  /** The queryable fields, derived from `facets` at startup (there is
   *  no schema endpoint — see src/query/fieldCatalog.ts). */
  catalog: FieldCatalog | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: Database[] | null;
  /** The data model backing the docs sidebar (loaded once). */
  facets: Facet[] | null;
  /** Who's logged in, if anyone — loaded once at startup via GET /api/users/me. */
  auth: AuthState;
  /** The session's compliance log — loaded once at startup via
   *  GET /api/log/status (a 403 there means "required"). Display-only, same as
   *  `auth`: it drives the account menu and an advisory hint, never gating
   *  logic. */
  compliance: ComplianceState;
  /** The `Database.id`s of the databases the query runs against. Empty =
   *  nothing runs. */
  selectedDatabaseIds: string[];
  activeView: ActiveView;

  /** The query tree. Its root is always a group. */
  query: Group;
  issues: Issue[];
  /** The problems the backend found in the query on screen: the errors in
   *  `stats` that point at a node (src/query/issues.ts, serverIssues). Set by
   *  app.ts together with `stats`, but only when they change, so the panels
   *  that show them don't repaint for every streamed stats line. */
  serverIssues: Issue[];

  stats: StatsState;
  preview: PreviewState;
  /** The event whose JSON dialog is open (an `EventRecord.id` of the results
   *  on screen), or null. Closed with the results whenever they reset. */
  openEventId: string | null;

  sidebarCollapsed: boolean;
  /** A warning about the last change to the query, shown dismissible above it;
   *  null when there is nothing to say. Named for its first use, a drop (or
   *  "Add to query") that couldn't be done in full; it also carries a refused
   *  Ungroup and "N saved databases no longer exist…" after opening a saved
   *  query. */
  dropNotice: string | null;
  /** The query on screen was brought back by this page load (a reload, a Back
   *  from the login page): the notice above it says so and offers Start fresh.
   *  Hidden by its ✕, by Start fresh and by the first edit (`changeScope`). */
  restoredNotice: boolean;
  /** Whether the hidden easter-egg mascot set is showing. Display only: five
   *  clicks on the logo toggle it. It is not stored, so a reload brings back
   *  the normal pickle (decided by the maintainers, 2026-10-08). */
  easterEgg: boolean;

  /** The saved query on screen, as it was when last opened or saved; null for a
   *  query that was never saved. Whether the user changed it since is worked
   *  out (`isEdited`), never stored. */
  openSaved: OpenSaved | null;
  savedDialog: SavedDialog;
  save: SaveState;
  savedList: SavedListState;
  savedConfirm: SavedConfirm;
  /** How the last delete in the Saved queries dialog went, shown above the
   *  list; null when there is nothing to say. It lives in the state, not in the
   *  toast, because the toast is drawn under the open dialog's backdrop. Cleared
   *  by the next action in the dialog and when it closes. */
  savedListNotice: SavedListNotice;
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
  serverIssues: [],
  stats: { status: "idle", results: [] },
  preview: { status: "idle" },
  openEventId: null,
  // The docs are the main way to build a query, so they start open.
  sidebarCollapsed: false,
  dropNotice: null,
  restoredNotice: false,
  easterEgg: false,
  openSaved: null,
  savedDialog: null,
  save: { status: "idle" },
  savedList: { status: "idle" },
  savedConfirm: null,
  savedListNotice: null,
};

/** Why the current query/scope can't run yet, or null when it can. */
export type RunBlocker = "loading" | "no-database" | "no-condition" | "unfinished" | "rejected";

export type RunInputs = Pick<
  AppState,
  "catalog" | "issues" | "serverIssues" | "query" | "selectedDatabaseIds"
>;

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
  // A database found a problem in a part of the query. Only Run is blocked:
  // the statistics that report it stay on screen, and a query or database
  // change resets both before the next fetch.
  if (state.serverIssues.length > 0) return "rejected";
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
