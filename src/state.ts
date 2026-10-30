import type { Group, Issue } from "./query/types";
import { countBlocks, emptyQuery, findNode } from "./query/tree";
import type { FieldRef } from "./query/drop";
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
  /** `name` and `note` are what is being saved, so a reopened dialog shows them. */
  | { status: "saving"; name: string; note: string }
  /** The name belongs to another saved query: ask "Replace it?" */
  | { status: "conflict"; name: string; note: string }
  | { status: "error"; error: string };

/** The logged-in user's saved queries, newest first, as the list dialog
 *  shows them. `unreadable` counts the ones that could not be read (saved by
 *  an older version): the dialog says how many, above the list. */
export type SavedListState =
  | { status: "idle" | "loading" }
  | { status: "ok"; queries: SavedQuery[]; unreadable: number }
  | { status: "error"; error: string };

/** A line above the saved-queries list: a delete that failed ("error",
 *  spoken as an alert) or succeeded ("done", spoken through `announce`). */
export type SavedListNotice = { tone: "error" | "done"; text: string } | null;

/** An action in the list waiting for the user's yes. */
export type SavedConfirm = null | { action: "open" | "delete"; id: string };

/** The panel beside every facet block: "seen" (the facets seen together
 *  with the block's facet) or "about" (the dictionary's words on the facet,
 *  or on the field selected for the panel). */
export type PanelTab = "seen" | "about";

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

  /** The query tree. Its root is always a group. */
  query: Group;
  /** The facet blocks whose folded fields are shown ("+ N more fields"
   *  pressed). Display state: never saved or sent, and not part of `query`,
   *  so opening it is not an edit (spec, section 3). */
  expandedBlockIds: string[];
  /** The one field row drawn open for editing, or null: an unset row whose
   *  slot was pressed, or the row a dropped field or value is about. An open
   *  unset row is drawn with real dropdowns (its operator), so it can be
   *  filled in; a set row looks the same open or not. "Not filtered", Escape
   *  in a block and opening another row close it. (Not what a panel would
   *  call the selected field: focusing a row never changes this, so it never
   *  repaints the rows.) */
  openField: FieldRef | null;
  /** The tab open in the panel beside every block, or null: the panel is
   *  hidden for all blocks at once, and the rows take the whole width.
   *  Pressing the open tab again hides it. Display state, like the two above. */
  panelTab: PanelTab | null;
  /** Whether every co-occurrence row shows its facets' names above the
   *  cells (the legend's toggle). Display state, off at first: the names
   *  make every block taller. */
  coNamesShown: boolean;
  /** The field the About panel describes (a label clicked, or the focus moved
   *  into its row), or null: About describes the block's facet. Only the
   *  About panels repaint when it changes (main.ts, `ABOUT_PANEL_KEYS`), never
   *  the rows: a repaint would close an open dropdown under the user's
   *  cursor. Not `openField`, which says which row is drawn open. */
  selectedField: FieldRef | null;
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
  /** The saved query whose Delete is still waiting for the server, or null:
   *  its buttons are drawn busy meanwhile. */
  deletingSavedId: string | null;
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
  query: emptyQuery(),
  expandedBlockIds: [],
  openField: null,
  // The co-occurrence chart is the panel's news; About is one click away.
  panelTab: "seen",
  coNamesShown: false,
  selectedField: null,
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
  deletingSavedId: null,
  savedListNotice: null,
};

/** Why the current query/scope can't run yet, or null when it can. */
export type RunBlocker = "loading" | "no-database" | "no-facet" | "unfinished" | "rejected";

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
  if (countBlocks(state.query) === 0) return "no-facet";
  if (state.issues.length > 0) return "unfinished";
  // A database found a problem in a part of the query. Only Run is blocked:
  // the statistics that report it stay on screen. A query edit keeps the
  // problems on parts it did not touch, so the next statistics line (sent
  // even in this state) replaces them.
  if (state.serverIssues.length > 0) return "rejected";
  return null;
}

/** The parts of the state that only say how the query is shown and point at
 *  its blocks. (`panelTab` is display state too, but about every block.) */
export type DisplayState = Pick<AppState, "openField" | "expandedBlockIds" | "selectedField">;

/**
 * `display` without what points at a block that is no longer in `query`: a
 * removed block, or a query that was replaced (a saved one opened, Start
 * fresh). Otherwise the ids would stay in the state for ever, and a new block
 * is never given an old id, so they could never be used again. The same
 * object when nothing is stale, so the caller can tell it has nothing to write.
 */
export function displayStateFor(query: Group, display: DisplayState): DisplayState {
  const isBlockInQuery = (id: string) => findNode(query, id)?.kind === "facet";
  const keepIfInQuery = (ref: FieldRef | null) => (ref && isBlockInQuery(ref.blockId) ? ref : null);
  const openField = keepIfInQuery(display.openField);
  const selectedField = keepIfInQuery(display.selectedField);
  const expandedBlockIds = display.expandedBlockIds.filter(isBlockInQuery);
  const unchanged =
    openField === display.openField &&
    selectedField === display.selectedField &&
    expandedBlockIds.length === display.expandedBlockIds.length;
  return unchanged ? display : { openField, expandedBlockIds, selectedField };
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
