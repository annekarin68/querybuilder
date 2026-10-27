import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "./api/client";
import type * as client from "./api/client";
import { userMessage } from "./api/errorText";
import type { Compliance, DatabaseResult, SavedQuery, SavedQueryDraft } from "./model";
import { buildFieldCatalog } from "./query/fieldCatalog";
import { serverIssues } from "./query/issues";
import {
  dropItem,
  dropMessage,
  dropNotice,
  movedMessage,
  reorderedMessage,
  type DragItem,
  type FieldRef,
} from "./query/drop";
import {
  emptyQuery,
  findNode,
  moveNode,
  moveSibling,
  positionOf,
  sameSemantics,
  sameTree,
  updateNode,
  type Direction,
} from "./query/tree";
import { hasUnsavedWork, sameName, saveTarget, type OpenSaved } from "./query/saved";
import type { Group } from "./query/types";
import { validateQuery } from "./query/validate";
import {
  displayStateFor,
  runBlocker,
  type AppState,
  type PreviewState,
  type SavedListNotice,
  type StatsState,
  type Store,
} from "./state";
import { debounce } from "./util/debounce";
import { pageOf } from "./util/paging";
import {
  forgetKeptQuery,
  isWorthRestoring,
  keepQuery,
  readKeptQuery,
  RESTORED_MESSAGE,
  STARTED_FRESH_MESSAGE,
} from "./util/keptQuery";
import { requestSlot } from "./util/requestSlot";

/**
 * What the app does in response to the user and the server: loading at
 * startup, live statistics, Run query, the 401/403 redirects into login and
 * compliance, and logging out. It changes state only through `store` and
 * touches no DOM, so tests drive it with a fake `api` (tests/app.test.ts).
 * main.ts wires it to the page.
 */

/** The API functions the app calls: src/api/client.ts in the browser, a fake
 *  in tests. They take and return the frontend's own model (src/model.ts),
 *  never the backend's types. */
export type AppApi = Pick<
  typeof client,
  | "getDatabases"
  | "getFacets"
  | "getMe"
  | "getComplianceStatus"
  | "getStats"
  | "runQuery"
  | "logout"
  | "invalidateCompliance"
  | "listSavedQueries"
  | "createSavedQuery"
  | "updateSavedQuery"
  | "deleteSavedQuery"
>;

export interface AppDeps {
  store: Store;
  api: AppApi;
  /** A full-page navigation (into the login or compliance flow). */
  navigate(url: string): void;
  /** Say something to screen-reader users without moving focus (a polite live
   *  region). Used when an edit changes the query without any visible focus
   *  change, such as the "+" button adding a row. */
  announce(message: string): void;
  /** Tell the user that something they asked for failed, when no panel has a
   *  place for it (logging out, a delete): a short toast, also spoken. */
  showError(message: string): void;
}

/** How long the query must stay unchanged before statistics are fetched. */
export const STATS_DEBOUNCE_MS = 400;

/** The query a first visit starts with, and Start fresh puts back: an empty
 *  group. It is "not finished", not invalid: the footer says "Add a facet to
 *  start…" and "+ Facet" is right there (spec, section 3). */
function startingQuery(): Group {
  return emptyQuery();
}

/** The warning for databases a saved or kept selection named that no longer
 *  exist (they were left out): none, or one sentence. */
function goneDatabasesMessage(count: number, which: "saved" | "selected"): string[] {
  if (count === 0) return [];
  return [
    count === 1
      ? `1 ${which} database no longer exists and was left out.`
      : `${count} ${which} databases no longer exist and were left out.`,
  ];
}

/**
 * What a screen reader hears when Run query's panel changes: it repaints out of
 * sight of a user who isn't looking at it, and their focus may be elsewhere
 * (paint() never moves focus into a panel it wasn't in). Null: say nothing.
 */
export function previewAnnouncement(preview: PreviewState): string | null {
  switch (preview.status) {
    case "idle":
      return null;
    case "loading":
      return "Fetching events…";
    case "error":
      return `Could not load events: ${preview.error}`;
    case "ok": {
      const n = preview.events.length;
      if (n === 0) return "No events match this query.";
      return n === 1 ? "Showing 1 result." : `Showing ${n.toLocaleString()} results.`;
    }
  }
}

export function createApp({ store, api, navigate, announce, showError }: AppDeps) {
  // One slot per request kind. Every query/scope edit cancels both
  // (docs/ARCHITECTURE.md, "Correctness invariant").
  const statsSlot = requestSlot();
  const previewSlot = requestSlot();
  // Saved-queries requests have their own slots: a query edit does not make
  // them stale (they do not depend on the query on screen), closing the dialog
  // or asking again does.
  const savedListSlot = requestSlot();
  const saveSlot = requestSlot();

  /**
   * A 403 from /api/filter/execute means "authenticated, but some requirement is unmet" —
   * compliance is one such requirement, but not necessarily the only one (e.g. a
   * user not permitted to query a database). Redirecting into the compliance flow
   * on every 403 would send such a user round in circles with no error ever shown,
   * so ask the backend whether compliance is actually what's missing first:
   * GET /api/log/status answers 403 when the session has no compliance log
   * (getComplianceStatus turns that into "required").
   */
  async function complianceIsRequired(): Promise<boolean> {
    try {
      return (await api.getComplianceStatus()).status === "required";
    } catch {
      return false;
    }
  }

  // The kept query (src/util/keptQuery.ts): every change to the query or the
  // database selection is copied at once, so the next page load in this tab
  // finds what was on screen.
  store.subscribe((state, changed) => {
    if (changed.has("query") || changed.has("selectedDatabaseIds")) {
      keepQuery(state.query, state.selectedDatabaseIds);
    }
  });

  /** Leave for `url`; the next page load restores the kept query. The copy
   *  is already current (see the `store.subscribe` above); it is written once
   *  more here so that leaving never depends on that. */
  function redirectInto(url: string): void {
    const s = store.getState();
    keepQuery(s.query, s.selectedDatabaseIds);
    navigate(url);
  }

  /**
   * Run query. It always attempts the request and reacts to what comes back: a
   * 401 (not logged in) or 403 (logged in, some requirement unmet — e.g.
   * compliance) keeps the query and navigates into the matching flow.
   *
   * Only ever do this from a call triggered by an explicit user gesture (a Run
   * click). Never wrap it around an automatically-fired request such as
   * refreshStats — that would redirect the browser without a click and break
   * the "never redirects itself" loop-safety property this feature depends on.
   */
  function runPreview(): void {
    const state = store.getState();
    if (runBlocker(state)) return;
    const req = previewSlot.start();
    const show = (preview: PreviewState, extra: Partial<AppState> = {}) => {
      store.setState({ preview, ...extra });
      const spoken = previewAnnouncement(preview);
      if (spoken) announce(spoken);
    };
    const showRunError = (err: unknown) => {
      console.error("Run query failed:", err);
      show({ status: "error", error: userMessage(err) });
    };
    // A new run replaces the results, so a dialog open on one of them closes
    // in the same setState (docs/ARCHITECTURE.md, "State and the render loop").
    show({ status: "loading" }, { openEventId: null });
    api
      .runQuery(state.query, state.selectedDatabaseIds, req.signal)
      .then((events) => {
        if (!req.isStale()) show({ status: "ok", events, page: 0 });
      })
      .catch(async (err) => {
        if (req.isStale()) return;
        if (err instanceof ApiError && err.status === 401) return redirectInto(LOGIN_URL);
        if (err instanceof ApiError && err.status === 403) {
          const required = await complianceIsRequired();
          if (req.isStale()) return; // query, scope or session changed meanwhile
          return required ? redirectInto(COMPLIANCE_START_URL) : showRunError(err);
        }
        showRunError(err);
      });
  }

  /**
   * Write `stats`, and the problems its lines point at (`serverIssues`) — but
   * those only when they changed. Stats lines stream in one by one; the query
   * builder repaints whenever `serverIssues` is set, and a repaint closes an
   * open dropdown and drops a value the user is typing.
   */
  function setStats(stats: StatsState): void {
    const issues = serverIssues(stats);
    const same = JSON.stringify(issues) === JSON.stringify(store.getState().serverIssues);
    store.setState(same ? { stats } : { stats, serverIssues: issues });
  }

  /** Statistics, streamed one line per database and refetched live (debounced). */
  const refreshStats = debounce(() => {
    const state = store.getState();
    if (runBlocker(state)) return;
    const req = statsSlot.start();
    const results: DatabaseResult[] = [];
    setStats({ status: "loading", results: [] });
    api
      .getStats(
        state.query,
        state.selectedDatabaseIds,
        (result) => {
          if (req.isStale()) return;
          results.push(result);
          setStats({ status: "loading", results: [...results] });
        },
        req.signal,
      )
      .then(() => {
        if (!req.isStale()) setStats({ status: "ok", results });
      })
      .catch((err) => {
        if (req.isStale()) return;
        console.error("Statistics failed:", err);
        setStats({ status: "error", error: userMessage(err) });
      });
  }, STATS_DEBOUNCE_MS);

  /** The "Try again" button of a failed statistics request: asks again for the
   *  current query and scope. `refreshStats` itself checks `runBlocker`. */
  function retryStats(): void {
    refreshStats();
  }

  /**
   * Logging out or invalidating compliance only affects Run (/api/filter/validate is
   * anonymous), so only the preview is cancelled — and it is reset in the same
   * step, because whoever aborts a request must also reset its panel: the
   * aborted request's own handlers are stale and will never touch the state.
   */
  function resetPreview(): void {
    previewSlot.cancel();
    // The dialog shows one of the results being reset.
    store.setState({ preview: { status: "idle" }, openEventId: null });
  }

  function onLogout(): void {
    resetPreview();
    api
      .logout()
      .then(() => {
        // Compliance is piggybacked on the session server-side, so it's gone too
        // once the session ends — reset the local display state to match.
        store.setState({ auth: { status: "anonymous" }, compliance: { status: "required" } });
        // A browser that restores its last session would bring the kept query
        // back for whoever opens it next: logging out hands the browser over.
        // The query stays on screen (building on anonymously is fine); a later
        // edit is kept again, as new work.
        forgetKeptQuery();
      })
      .catch((err) => {
        console.error("Logout failed:", err);
        // The menu still shows the user: say why nothing happened.
        showError("Couldn't log out. Try again.");
      });
  }

  function onInvalidateCompliance(): void {
    resetPreview();
    api
      .invalidateCompliance()
      .then(() => {
        store.setState({ compliance: { status: "required" } });
      })
      .catch((err) => {
        console.error("Invalidate compliance failed:", err);
        showError("Couldn't invalidate the compliance reason. Try again.");
      });
  }

  /**
   * A query edit or a database-scope change: clear stats (with their
   * serverIssues) & preview in the SAME setState and abandon every request
   * still in flight, then schedule fresh statistics.
   */
  function changeScope(patch: Partial<AppState>): void {
    statsSlot.cancel();
    previewSlot.cancel();
    store.setState({
      // An edit means the user carries on with the restored query (or a fresh
      // one): the Restored notice has nothing left to offer.
      restoredNotice: false,
      ...patch,
      stats: { status: "idle", results: [] },
      serverIssues: [],
      preview: { status: "idle" },
      openEventId: null, // the dialog shows one of the results being reset
    });
    refreshStats();
  }

  function onQueryChange(nextQuery: Group): void {
    const { query, catalog } = store.getState();
    if (nextQuery === query) return;
    // Expanding/collapsing a group is display-only: no reset, no refetch.
    if (sameSemantics(nextQuery, query)) {
      store.setState({ query: nextQuery });
      return;
    }
    const issues = catalog ? validateQuery(nextQuery, catalog) : [];
    // A removed block takes its display state with it (see displayStateFor).
    const { openField, expandedBlockIds } = store.getState();
    changeScope({
      query: nextQuery,
      issues,
      ...displayStateFor(nextQuery, { openField, expandedBlockIds }),
    });
  }

  /** Show a drop's problems, or clear an old warning when there are none. */
  function setNotice(problems: string[]): void {
    const notice = dropNotice(problems);
    if (notice !== store.getState().dropNotice) store.setState({ dropNotice: notice });
    // The warning's box is painted together with its text, and a screen reader
    // only speaks text that CHANGES inside a region it already knows, so the
    // box itself is never spoken: say it through the page's region.
    // Also when the text is the same as before: it is a new refused drop.
    if (notice) announce(notice);
  }

  /** Show one message as the warning (and speak it): for a refusal that does
   *  not come from a drop, such as an Ungroup that would change the query. */
  function showNotice(message: string): void {
    setNotice([message]);
  }

  /** `tree` with `nodeId` unfolded, if it is a folded group or block. */
  function unfold(tree: Group, nodeId: string): Group {
    return findNode(tree, nodeId)?.collapsed
      ? updateNode(tree, nodeId, { collapsed: false })
      : tree;
  }

  /** `tree` with the group `nodeId` unfolded, if it is a folded group: so the
   *  user sees what was just dropped into it. (A drop on a block lands before
   *  it, so the block itself stays as it is.) */
  function openGroup(tree: Group, nodeId: string): Group {
    return findNode(tree, nodeId)?.kind === "group" ? unfold(tree, nodeId) : tree;
  }

  /**
   * A docs item or a query node was dropped on `targetNodeId` (a group: it goes
   * at the end; a facet block: just before it, or into it — see `dropItem`).
   * Nothing is dropped silently: what can't be done is explained in
   * `dropNotice`. Returns the field row the drop opened, or null: after a
   * mouse drop the builder moves the keyboard focus into that row.
   */
  function onDropItem(item: DragItem | null, targetNodeId: string): FieldRef | null {
    const { query, facets, catalog } = store.getState();
    if (!item) {
      setNotice(["That item can't be added to a query."]);
      return null;
    }
    if (item.type === "node") {
      if (item.nodeId === targetNodeId) return null;
      // A node that is gone (a stale drag) or the root can't be moved.
      const node = findNode(query, item.nodeId);
      if (item.nodeId === query.id || !node) {
        setNotice(["That item is no longer in the query."]);
        return null;
      }
      const moved = moveNode(query, item.nodeId, targetNodeId);
      if (!moved) {
        // The node exists, so the only refusal left is a group dropped on
        // something inside itself (or a target that is gone).
        setNotice(["A group can't be moved into itself."]);
        return null;
      }
      setNotice([]);
      const next = openGroup(moved, targetNodeId);
      // Dropped where it already was (say, the last block onto its own group):
      // nothing changed, so there is nothing to announce either.
      if (sameTree(next, query)) return null;
      onQueryChange(next);
      announce(movedMessage(node.kind));
      return null;
    }
    if (!facets || !catalog) {
      setNotice(["The data dictionary is still loading; try again in a moment."]);
      return null;
    }
    const outcome = dropItem(query, item, targetNodeId, facets, catalog);
    setNotice(outcome.problems);
    // Refused: the query stays exactly as it was, folds included.
    if (outcome.query === query && !outcome.select) return null;
    let next = openGroup(outcome.query, targetNodeId);
    // The row the drop is about must be on screen: its block is unfolded, and
    // the row is opened, which draws it with its dropdowns so the user can go
    // on with it. (The open row is drawn even in a folded field list:
    // see visibleFieldIds in ui/fieldRows.ts, so the list needs no unfolding.)
    if (outcome.select) next = unfold(next, outcome.select.blockId);
    if (next !== query) onQueryChange(next);
    if (outcome.select) openFieldRow(outcome.select);
    const spoken = dropMessage(query, item, targetNodeId, outcome, catalog);
    if (spoken) announce(spoken);
    return outcome.select;
  }

  /**
   * Open field row `ref` for editing (`AppState.openField`), or close the
   * open one (null). Not a query edit: the statistics stay, nothing is
   * refetched.
   */
  function openFieldRow(ref: FieldRef | null): void {
    const current = store.getState().openField;
    const same =
      current === ref ||
      (current !== null &&
        ref !== null &&
        current.blockId === ref.blockId &&
        current.fieldId === ref.fieldId);
    if (!same) store.setState({ openField: ref });
  }

  /** "+ N more fields" / "Show fewer fields" on block `blockId`. Display
   *  state, like folding: not a query edit, never saved or sent. */
  function toggleFields(blockId: string): void {
    const { expandedBlockIds } = store.getState();
    store.setState({
      expandedBlockIds: expandedBlockIds.includes(blockId)
        ? expandedBlockIds.filter((id) => id !== blockId)
        : [...expandedBlockIds, blockId],
    });
  }

  /** The keyboard path: "Add to query" puts the item at the end of the root
   *  group; a tag's facets arrive as one group. The focus stays on the
   *  dictionary's button, so the user can add several in a row; the
   *  announcement says what happened. */
  function onAddItem(item: DragItem): void {
    onDropItem(item, store.getState().query.id);
  }

  /**
   * The Move up / Move down buttons: the keyboard's way to reorder. Swaps the
   * node with a sibling, never changes its group (dragging does that). Nothing
   * to swap with (an end of the list) does nothing, and says nothing.
   */
  function onMoveNode(nodeId: string, direction: Direction): void {
    const { query } = store.getState();
    const moved = moveSibling(query, nodeId, direction);
    const node = findNode(query, nodeId);
    const position = positionOf(moved ?? query, nodeId);
    if (!moved || !node || !position) return;
    onQueryChange(moved);
    announce(reorderedMessage(node.kind, direction, position));
  }

  function dismissDropNotice(): void {
    store.setState({ dropNotice: null });
  }

  function onDatabasesChange(nextIds: string[]): void {
    const cur = store.getState().selectedDatabaseIds;
    if (nextIds.length === cur.length && nextIds.every((id) => cur.includes(id))) return;
    changeScope({ selectedDatabaseIds: nextIds });
  }

  /** The Restored notice's **Start fresh**: the starting query with every
   *  database, as on a first visit. It goes through `changeScope` like any
   *  edit, which also hides the notice. Not tied to a saved query either: a
   *  save while the notice was up set `openSaved` without hiding it. */
  function startFresh(): void {
    const { databases, catalog } = store.getState();
    const query = startingQuery();
    changeScope({
      query,
      selectedDatabaseIds: (databases ?? []).map((d) => d.id),
      issues: catalog ? validateQuery(query, catalog) : [],
      openSaved: null,
      dropNotice: null,
      // The blocks they pointed at are gone with the old query.
      openField: null,
      expandedBlockIds: [],
    });
    announce(STARTED_FRESH_MESSAGE);
  }

  /** The Restored notice's ✕: hide it and keep the restored query. */
  function dismissRestoredNotice(): void {
    store.setState({ restoredNotice: false });
  }

  /**
   * Load everything the app needs and set the first real state, restoring the
   * kept query (src/util/keptQuery.ts) if there is one worth restoring.
   * `resumed` is true on the return hop from the login or compliance flow.
   * Rejects if databases or facets can't be loaded — without them there is
   * nothing to show (and the kept query stays for the next try).
   */
  async function start(resumed: boolean): Promise<void> {
    const kept = readKeptQuery();
    // After logging in the user expects their query back, so it is restored
    // whatever it holds, without a word. On any other load (a reload, a Back
    // from the login page, a reopened tab) it is restored only if something
    // was chosen in it, and the Restored notice offers Start fresh.
    const pending = kept && (resumed || isWorthRestoring(kept.query)) ? kept : null;
    const showRestored = pending !== null && !resumed;

    const [databases, facets, user, compliance] = await Promise.all([
      api.getDatabases(),
      api.getFacets(),
      // Login and compliance state are display-only and most of the app works
      // anonymously, so an outage of either must not take the whole app down:
      // show "Log in" / "Compliance needed", and let a Run press surface the
      // real problem.
      api.getMe().catch((err) => {
        console.error("Could not determine login state:", err);
        return null;
      }),
      api.getComplianceStatus().catch((err): Compliance => {
        console.error("Could not determine compliance status:", err);
        return { status: "required" };
      }),
    ]);

    const catalog = buildFieldCatalog(facets);
    // A restored query replaces the starting one (an empty group).
    const query = pending ? pending.query : startingQuery();
    // A restored selection may name databases that no longer exist (it can
    // outlive a backend change): keep only the ones this load knows, and say
    // which went. Otherwise every database is selected by default.
    const selectedDatabaseIds = pending
      ? pending.selectedDatabaseIds.filter((id) => databases.some((d) => d.id === id))
      : databases.map((d) => d.id);
    const gone = pending ? pending.selectedDatabaseIds.length - selectedDatabaseIds.length : 0;
    store.setState({
      catalog,
      databases,
      facets,
      selectedDatabaseIds,
      query,
      openField: null,
      expandedBlockIds: [],
      // The first query bypasses onQueryChange, so validate here: a restored
      // query may be unfinished, and Run must stay blocked then.
      issues: validateQuery(query, catalog),
      auth: user ? { status: "authenticated", user } : { status: "anonymous" },
      compliance,
      restoredNotice: showRestored,
    });
    if (showRestored) announce(RESTORED_MESSAGE);
    setNotice(goneDatabasesMessage(gone, "selected"));
    // Fetch a restored query's statistics now, as any in-app edit would (an
    // unfinished one fetches nothing). The empty start has nothing to run yet.
    if (pending) refreshStats();
  }

  // ---- saved queries ------------------------------------------------------
  // The dialogs only show `savedDialog`, `save`, `savedList`, `savedConfirm` and
  // `savedListNotice`; everything they do happens here.

  /** A saved-query request failed. A 401 means there is no session: redirect
   *  like Run does (the query is kept first). Anything else is shown by `show`. */
  function savedCallFailed(err: unknown, show: (error: string) => void): void {
    if (err instanceof ApiError && err.status === 401) return redirectInto(LOGIN_URL);
    console.error("Saved queries request failed:", err);
    show(userMessage(err));
  }

  /** Whether the dialogs may open. A logged-out visitor is asked to log in
   *  first instead (`kind`: which button they pressed). A redirect without a
   *  word surprised users (2026-10-08), and a note always on screen read as
   *  if the whole builder needed a login (maintainers' decision, 2026-10-13).
   *  While the login state is still loading the visitor counts as logged in: a
   *  401 from the API redirects. */
  function mayUseSavedQueries(kind: "save" | "list"): boolean {
    if (store.getState().auth.status !== "anonymous") return true;
    store.setState({ savedDialog: kind === "save" ? "login-to-save" : "login-to-list" });
    return false;
  }

  /** "Log in" in either login dialog (the save one and the list one; the name
   *  is from the first): keep the query, even a blank one (they asked to save
   *  it), and leave for the login flow. */
  function logInToSave(): void {
    redirectInto(LOGIN_URL);
  }

  function openSaveDialog(): void {
    if (!mayUseSavedQueries("save")) return;
    store.setState({ savedDialog: "save", save: { status: "idle" } });
  }

  /** (Re)load the list. `notice` is what to show above it meanwhile: a reload
   *  is an action in the dialog, which clears the last one, unless it is the
   *  reload after a delete, which keeps "Deleted “X”." on screen. */
  function loadSavedList(notice: SavedListNotice = null): void {
    const req = savedListSlot.start();
    store.setState({ savedList: { status: "loading" }, savedListNotice: notice });
    api
      .listSavedQueries()
      .then(({ queries, unreadable }) => {
        if (!req.isStale()) store.setState({ savedList: { status: "ok", queries, unreadable } });
      })
      .catch((err) => {
        if (req.isStale()) return;
        savedCallFailed(err, (error) => store.setState({ savedList: { status: "error", error } }));
      });
  }

  function openSavedList(): void {
    if (!mayUseSavedQueries("list")) return;
    store.setState({ savedDialog: "list", savedConfirm: null });
    loadSavedList();
  }

  function closeSavedDialog(): void {
    // A late answer must not repaint a closed dialog, so abandon what is in
    // flight and reset what the dialogs show.
    savedListSlot.cancel();
    saveSlot.cancel();
    store.setState({
      savedDialog: null,
      savedConfirm: null,
      save: { status: "idle" },
      savedList: { status: "idle" },
      savedListNotice: null,
    });
  }

  /** Send `draft` and show how it went. A save that succeeds is remembered
   *  even if the dialog was closed meanwhile: it did happen on the server. */
  function sendSave(draft: SavedQueryDraft, send: () => Promise<SavedQuery>): void {
    const { name, note } = draft;
    const openWhenStarted = store.getState().openSaved;
    const req = saveSlot.start();
    store.setState({ save: { status: "saving" } });
    send()
      .then((saved) => {
        // The open query remembers the tree that was sent, which is the tree
        // on screen: the answer's tree has fresh node ids ("Saved queries"),
        // so comparing with it would show the query as edited at once.
        const openNow: OpenSaved = {
          id: saved.id,
          name: saved.name,
          note: saved.note,
          query: draft.query,
          databaseIds: draft.databaseIds,
        };
        // The saved query becomes the open one only if nothing else was opened
        // since the save started (a slow answer after the user opened another
        // query would otherwise make the next Save overwrite this one with
        // that other query).
        const patch: Partial<AppState> =
          store.getState().openSaved === openWhenStarted ? { openSaved: openNow } : {};
        // Leave the dialog alone when it was closed, or closed and reopened.
        store.setState(
          req.isStale() ? patch : { ...patch, savedDialog: null, save: { status: "idle" } },
        );
        announce(`Saved “${saved.name}”.`);
      })
      .catch((err) => {
        if (req.isStale()) return;
        // 409: the name belongs to another saved query. Not an error: the
        // dialog asks whether to replace it.
        if (err instanceof ApiError && err.status === 409) {
          store.setState({ save: { status: "conflict", name, note } });
          return;
        }
        savedCallFailed(err, (error) => store.setState({ save: { status: "error", error } }));
      });
  }

  /** What is saved: the query and databases on screen, under this name and note. */
  function draftOf(name: string, note: string): SavedQueryDraft {
    const { query, selectedDatabaseIds } = store.getState();
    return { name: name.trim(), note: note.trim(), databaseIds: [...selectedDatabaseIds], query };
  }

  /** Overwrite the saved query `id` with `draft`. If it is gone (deleted in
   *  another tab, `404`), create it instead: the user asked to save, and an
   *  update that can never succeed would leave the dialog stuck on "No saved
   *  query with that id.". */
  async function updateOrCreate(id: string, draft: SavedQueryDraft): Promise<SavedQuery> {
    try {
      return await api.updateSavedQuery(id, draft);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return api.createSavedQuery(draft);
      throw err;
    }
  }

  function saveQuery(name: string, note: string): void {
    // One save at a time: Enter in the form submits even when the button is
    // disabled, and a second create would get a 409 against the first, asking
    // "Replace it?" about the user's own save. (confirmReplace needs the
    // "conflict" state, which a running save has already left.)
    if (store.getState().save.status === "saving") return;
    const draft = draftOf(name, note);
    if (draft.name === "") {
      store.setState({ save: { status: "error", error: "Give the query a name." } });
      return;
    }
    const target = saveTarget(draft.name, store.getState().openSaved);
    sendSave(draft, () =>
      target.kind === "update" ? updateOrCreate(target.id, draft) : api.createSavedQuery(draft),
    );
  }

  /** "Replace it": overwrite the saved query that has the clashing name. The
   *  list is read again to find it, because a create's 409 does not say which
   *  one it is. */
  function confirmReplace(): void {
    const { save } = store.getState();
    if (save.status !== "conflict") return;
    const draft = draftOf(save.name, save.note);
    sendSave(draft, async () => {
      const { queries } = await api.listSavedQueries();
      const clash = queries.find((q) => sameName(q.name, draft.name));
      // Deleted in the meantime (another tab): there is nothing left to replace.
      return clash ? updateOrCreate(clash.id, draft) : api.createSavedQuery(draft);
    });
  }

  function cancelReplace(): void {
    if (store.getState().save.status === "conflict") store.setState({ save: { status: "idle" } });
  }

  /** The saved query `id` from the list on screen, if it is still there. */
  function listedQuery(id: string): SavedQuery | undefined {
    const { savedList } = store.getState();
    return savedList.status === "ok" ? savedList.queries.find((q) => q.id === id) : undefined;
  }

  /**
   * Put a saved query on screen. It goes through `changeScope` and
   * `validateQuery` like any edit, so the "Correctness invariant" holds: the
   * statistics and preview of the old query are gone, and Run stays blocked
   * while the opened query is unfinished.
   */
  function openSavedQuery(saved: SavedQuery): void {
    const { databases, catalog } = store.getState();
    // Databases can disappear after a save: keep only the ones that exist now.
    const known = databases
      ? saved.databaseIds.filter((id) => databases.some((d) => d.id === id))
      : saved.databaseIds;
    const left = saved.databaseIds.length - known.length;
    changeScope({
      query: saved.query,
      selectedDatabaseIds: known,
      issues: catalog ? validateQuery(saved.query, catalog) : [],
      // The blocks they pointed at are gone with the old query.
      openField: null,
      expandedBlockIds: [],
      // The selection kept, not the saved one: the user did not edit the
      // dropped ids away, so opening must not count as an edit.
      openSaved: {
        id: saved.id,
        name: saved.name,
        note: saved.note,
        query: saved.query,
        databaseIds: known,
      },
      savedDialog: null,
      savedConfirm: null,
      savedListNotice: null,
    });
    announce(`Opened “${saved.name}”.`);
    setNotice(goneDatabasesMessage(left, "saved"));
  }

  function askOpenSaved(id: string): void {
    const saved = listedQuery(id);
    if (!saved) return; // the list changed under the click
    const { openSaved, query, selectedDatabaseIds } = store.getState();
    if (hasUnsavedWork(openSaved, query, selectedDatabaseIds)) {
      store.setState({ savedConfirm: { action: "open", id }, savedListNotice: null });
    } else {
      openSavedQuery(saved);
    }
  }

  function askDeleteSaved(id: string): void {
    store.setState({ savedConfirm: { action: "delete", id }, savedListNotice: null });
  }

  function deleteSaved(id: string): void {
    const name = listedQuery(id)?.name;
    const deleted = () => {
      const { openSaved, savedDialog } = store.getState();
      // The query on screen stays; it just no longer belongs to a saved one.
      if (openSaved?.id === id) store.setState({ openSaved: null });
      const done = name === undefined ? null : `Deleted “${name}”.`;
      if (done) announce(done);
      if (savedDialog === "list") loadSavedList(done ? { tone: "done", text: done } : null);
    };
    // `.then(ok, failed)`, not `.then(ok).catch(failed)`: a bug inside
    // `deleted()` must not be reported to the user as a failed delete.
    api.deleteSavedQuery(id).then(deleted, (err) => {
      // Already gone (deleted in another tab): that is what the user wanted.
      if (err instanceof ApiError && err.status === 404) return deleted();
      // Keep the list on screen: replacing it with an error would hide every
      // other saved query because one delete failed. The notice is shown inside
      // the dialog: a toast would be drawn under its backdrop (Delete is only
      // reachable in the modal dialog).
      savedCallFailed(err, (error) => {
        // The dialog may have been closed while the request ran.
        if (store.getState().savedDialog !== "list") return;
        store.setState({
          savedListNotice: {
            tone: "error",
            text: `Couldn't delete “${name ?? "the saved query"}”. ${error}`,
          },
        });
      });
    });
  }

  function confirmSavedAction(): void {
    const { savedConfirm } = store.getState();
    if (!savedConfirm) return;
    store.setState({ savedConfirm: null });
    if (savedConfirm.action === "delete") return deleteSaved(savedConfirm.id);
    const saved = listedQuery(savedConfirm.id);
    if (saved) openSavedQuery(saved);
  }

  function cancelSavedAction(): void {
    store.setState({ savedConfirm: null });
  }

  /** Show page `page` of the results (clamped to the pages that exist) and
   *  say which results are on screen: the table repaints out of sight of a
   *  screen-reader user. */
  function showEventPage(page: number): void {
    const { preview } = store.getState();
    if (preview.status !== "ok") return;
    const shown = pageOf(preview.events.length, page);
    if (shown.page === preview.page) return;
    store.setState({ preview: { ...preview, page: shown.page } });
    // The viewer's number format, like the paging line on screen.
    announce(
      `Showing results ${shown.from.toLocaleString()} to ${shown.to.toLocaleString()} of ${shown.total.toLocaleString()}.`,
    );
  }

  /** Open the JSON dialog of a result on screen (an id from an older run,
   *  clicked on a stale screen, opens nothing). */
  function openEvent(id: string): void {
    const { preview } = store.getState();
    if (preview.status === "ok" && preview.events.some((e) => e.id === id)) {
      store.setState({ openEventId: id });
    }
  }

  function closeEvent(): void {
    if (store.getState().openEventId !== null) store.setState({ openEventId: null });
  }

  return {
    start,
    runPreview,
    showEventPage,
    openEvent,
    closeEvent,
    onQueryChange,
    onDropItem,
    onAddItem,
    openFieldRow,
    toggleFields,
    onMoveNode,
    dismissDropNotice,
    showNotice,
    onDatabasesChange,
    onLogout,
    onInvalidateCompliance,
    startFresh,
    dismissRestoredNotice,
    retryStats,
    openSaveDialog,
    openSavedList,
    logInToSave,
    closeSavedDialog,
    saveQuery,
    confirmReplace,
    cancelReplace,
    retrySavedList: () => loadSavedList(),
    askOpenSaved,
    askDeleteSaved,
    confirmSavedAction,
    cancelSavedAction,
  };
}
