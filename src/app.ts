import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "./api/client";
import type * as client from "./api/client";
import type { Compliance, DatabaseResult, SavedQuery, SavedQueryDraft } from "./model";
import { buildFieldCatalog } from "./query/fieldCatalog";
import { serverIssues } from "./query/issues";
import { addedMessage, dropNotice, movedMessage, nodesForItem, type DragItem } from "./query/drop";
import {
  addChild,
  countConditions,
  findNode,
  moveNode,
  newCondition,
  placeNodes,
  sameSemantics,
  sameTree,
  updateNode,
} from "./query/tree";
import { hasUnsavedWork, sameName, saveTarget } from "./query/saved";
import type { Group } from "./query/types";
import { validateQuery } from "./query/validate";
import { runBlocker, type AppState, type PreviewState, type StatsState, type Store } from "./state";
import { debounce } from "./util/debounce";
import { savePendingQuery, takePendingQuery } from "./util/pendingQuery";
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
}

/** How long the query must stay unchanged before statistics are fetched. */
export const STATS_DEBOUNCE_MS = 400;

/** The text a panel shows for a failed request. The error itself (with its
 *  stack) goes to the console, for whoever is debugging. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
      return `Showing ${n} matching ${n === 1 ? "event" : "events"}.`;
    }
  }
}

export function createApp({ store, api, navigate, announce }: AppDeps) {
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
   * A 403 from /api/query means "authenticated, but some requirement is unmet" —
   * compliance is one such requirement, but not necessarily the only one (e.g. a
   * user not permitted to query a database). Redirecting into the compliance flow
   * on every 403 would send such a user round in circles with no error ever shown,
   * so ask the backend whether compliance is actually what's missing first.
   */
  async function complianceIsRequired(): Promise<boolean> {
    try {
      return (await api.getComplianceStatus()).status === "required";
    } catch {
      return false;
    }
  }

  /** Save the query (it survives the page load) and leave for `url`. */
  function redirectInto(url: string): void {
    const s = store.getState();
    savePendingQuery(s.query, s.selectedDatabaseIds);
    navigate(url);
  }

  /**
   * Run query. It always attempts the request and reacts to what comes back: a
   * 401 (not logged in) or 403 (logged in, some requirement unmet — e.g.
   * compliance) saves the query and navigates into the matching flow.
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
    const show = (preview: PreviewState) => {
      store.setState({ preview });
      const spoken = previewAnnouncement(preview);
      if (spoken) announce(spoken);
    };
    const showError = (err: unknown) => {
      console.error("Run query failed:", err);
      show({ status: "error", error: errorMessage(err) });
    };
    show({ status: "loading" });
    api
      .runQuery(state.query, state.selectedDatabaseIds, req.signal)
      .then((events) => {
        if (!req.isStale()) show({ status: "ok", events });
      })
      .catch(async (err) => {
        if (req.isStale()) return;
        if (err instanceof ApiError && err.status === 401) return redirectInto(LOGIN_URL);
        if (err instanceof ApiError && err.status === 403) {
          const required = await complianceIsRequired();
          if (req.isStale()) return; // query, scope or session changed meanwhile
          return required ? redirectInto(COMPLIANCE_START_URL) : showError(err);
        }
        showError(err);
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
        setStats({ status: "error", error: errorMessage(err) });
      });
  }, STATS_DEBOUNCE_MS);

  /** The "Try again" button of a failed statistics request: asks again for the
   *  current query and scope. `refreshStats` itself checks `runBlocker`. */
  function retryStats(): void {
    refreshStats();
  }

  /**
   * Logging out or invalidating compliance only affects Run (/api/stats is
   * anonymous), so only the preview is cancelled — and it is reset in the same
   * step, because whoever aborts a request must also reset its panel: the
   * aborted request's own handlers are stale and will never touch the state.
   */
  function resetPreview(): void {
    previewSlot.cancel();
    store.setState({ preview: { status: "idle" } });
  }

  function onLogout(): void {
    resetPreview();
    api
      .logout()
      .then(() => {
        // Compliance is piggybacked on the session server-side, so it's gone too
        // once the session ends — reset the local display state to match.
        store.setState({ auth: { status: "anonymous" }, compliance: { status: "required" } });
      })
      .catch((err) => {
        // Best-effort: the button is still there for the user to try again.
        console.error("Logout failed:", errorMessage(err));
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
        console.error("Invalidate compliance failed:", errorMessage(err));
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
      ...patch,
      stats: { status: "idle", results: [] },
      serverIssues: [],
      preview: { status: "idle" },
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
    changeScope({ query: nextQuery, issues });
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

  /** `tree` with the group `nodeId` expanded, if it is a collapsed group: so
   *  the user sees what was just dropped into it. */
  function openGroup(tree: Group, nodeId: string): Group {
    const node = findNode(tree, nodeId);
    return node?.kind === "group" && node.collapsed
      ? updateNode(tree, nodeId, { collapsed: false })
      : tree;
  }

  /**
   * A docs item or a query node was dropped on `targetNodeId` (a group: it goes
   * at the end; a condition: just before it). Nothing is dropped silently: what
   * can't be done is explained in `dropNotice`.
   */
  function onDropItem(item: DragItem | null, targetNodeId: string): void {
    const { query, facets, catalog } = store.getState();
    if (!item) {
      setNotice(["That item can't be added to a query."]);
      return;
    }
    if (item.type === "node") {
      if (item.nodeId === targetNodeId) return;
      // A node that is gone (a stale drag) or the root can't be moved.
      const node = findNode(query, item.nodeId);
      if (item.nodeId === query.id || !node) {
        setNotice(["That item is no longer in the query."]);
        return;
      }
      const moved = moveNode(query, item.nodeId, targetNodeId);
      if (!moved) {
        // The node exists, so the only refusal left is a group dropped on
        // something inside itself (or a target that is gone).
        setNotice(["A group can't be moved into itself."]);
        return;
      }
      setNotice([]);
      const next = openGroup(moved, targetNodeId);
      // Dropped where it already was (say, the last row onto its own group):
      // nothing changed, so there is nothing to announce either.
      if (sameTree(next, query)) return;
      onQueryChange(next);
      announce(movedMessage(node.kind));
      return;
    }
    if (!facets || !catalog) {
      setNotice(["The data dictionary is still loading; try again in a moment."]);
      return;
    }
    const { nodes, problems } = nodesForItem(item, facets, catalog);
    setNotice(problems);
    if (nodes.length === 0) return;
    // `placeNodes` puts the new nodes in place of a lone blank row (the starting
    // query, or a new "+ Group"), else at the target like any drop.
    onQueryChange(openGroup(placeNodes(query, targetNodeId, nodes), targetNodeId));
    announce(addedMessage(nodes.length));
  }

  /** The keyboard path: "Add to query" puts the item in the root group (or, if
   *  that holds just a blank row, in its place). */
  function onAddItem(item: DragItem): void {
    onDropItem(item, store.getState().query.id);
  }

  function dismissDropNotice(): void {
    store.setState({ dropNotice: null });
  }

  function onDatabasesChange(nextIds: string[]): void {
    const cur = store.getState().selectedDatabaseIds;
    if (nextIds.length === cur.length && nextIds.every((id) => cur.includes(id))) return;
    changeScope({ selectedDatabaseIds: nextIds });
  }

  /**
   * Any link that navigates straight into the login or compliance flow (the
   * account menu, the Matching events card's notes) must save the in-progress
   * query first, not just Run's own redirect — otherwise a user who follows
   * the on-screen guidance loses their query.
   */
  function saveQueryBeforeRedirect(): void {
    const s = store.getState();
    if (countConditions(s.query) > 0) savePendingQuery(s.query, s.selectedDatabaseIds);
  }

  /**
   * Load everything the app needs and set the first real state. `resumed` is
   * true on the return hop from the login or compliance flow: only then is the
   * pending query (src/util/pendingQuery.ts) restored. Rejects if databases or
   * facets can't be loaded — without them there is nothing to show.
   */
  async function start(resumed: boolean): Promise<void> {
    // Always take (and so clear) a pending entry, even on a normal load: a stale
    // one from an abandoned attempt must not resurface on some later, unrelated
    // return hop. Only a return hop actually uses it.
    const taken = takePendingQuery();
    const pending = resumed ? taken : null;

    const [databases, facets, user, compliance] = await Promise.all([
      api.getDatabases(),
      api.getFacets(),
      // Login and compliance state are display-only and most of the app works
      // anonymously, so an outage of either must not take the whole app down:
      // show "Log in" / "Compliance needed", and let a Run press surface the
      // real problem.
      api.getMe().catch((err) => {
        console.error("Could not determine login state:", errorMessage(err));
        return null;
      }),
      api.getComplianceStatus().catch((err): Compliance => {
        console.error("Could not determine compliance status:", errorMessage(err));
        return { status: "required" };
      }),
    ]);

    const catalog = buildFieldCatalog(facets);
    // A restored query replaces the normal seed (one empty condition).
    const initial = store.getState().query;
    const query = pending ? pending.query : addChild(initial, initial.id, newCondition());
    store.setState({
      catalog,
      databases,
      facets,
      // A restored selection may name databases that no longer exist (it can
      // outlive a backend change) — keep only ones this load actually knows.
      // Otherwise every database is selected by default.
      selectedDatabaseIds: pending
        ? pending.selectedDatabaseIds.filter((id) => databases.some((d) => d.id === id))
        : databases.map((d) => d.id),
      query,
      // The seed bypasses onQueryChange, so validate here — otherwise Run
      // would be enabled on the empty seeded condition.
      issues: validateQuery(query, catalog),
      auth: user ? { status: "authenticated", user } : { status: "anonymous" },
      compliance,
    });
    // A restored query is already complete, so fetch its statistics now, as
    // any in-app edit would. The empty seed has nothing runnable yet.
    if (pending) refreshStats();
  }

  // ---- saved queries ------------------------------------------------------
  // The dialogs only show `savedDialog`, `save`, `savedList` and `savedConfirm`;
  // everything they do happens here.

  /** A saved-query request failed. A 401 means there is no session: redirect
   *  like Run does (the query is saved first). Anything else is shown by `show`. */
  function savedCallFailed(err: unknown, show: (error: string) => void): void {
    if (err instanceof ApiError && err.status === 401) return redirectInto(LOGIN_URL);
    console.error("Saved queries request failed:", err);
    show(errorMessage(err));
  }

  /** Whether the dialogs may open: an anonymous visitor goes to log in instead,
   *  with the query saved even when it is blank (they asked to save). While the
   *  login state is still loading the visitor counts as logged in: a 401 from
   *  the API redirects. */
  function mayUseSavedQueries(): boolean {
    if (store.getState().auth.status !== "anonymous") return true;
    redirectInto(LOGIN_URL);
    return false;
  }

  function openSaveDialog(): void {
    if (!mayUseSavedQueries()) return;
    store.setState({ savedDialog: "save", save: { status: "idle" } });
  }

  function loadSavedList(): void {
    const req = savedListSlot.start();
    store.setState({ savedList: { status: "loading" } });
    api
      .listSavedQueries()
      .then((queries) => {
        if (!req.isStale()) store.setState({ savedList: { status: "ok", queries } });
      })
      .catch((err) => {
        if (req.isStale()) return;
        savedCallFailed(err, (error) => store.setState({ savedList: { status: "error", error } }));
      });
  }

  function openSavedList(): void {
    if (!mayUseSavedQueries()) return;
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
    });
  }

  /** Send one save and show how it went. A save that succeeds is remembered
   *  even if the dialog was closed meanwhile: it did happen on the server. */
  function sendSave(name: string, note: string, send: () => Promise<SavedQuery>): void {
    const openWhenStarted = store.getState().openSaved;
    const req = saveSlot.start();
    store.setState({ save: { status: "saving" } });
    send()
      .then((saved) => {
        const { id, query, databaseIds } = saved;
        // The saved query becomes the open one only if nothing else was opened
        // since the save started (a slow answer after the user opened another
        // query would otherwise make the next Save overwrite this one with
        // that other query).
        const patch: Partial<AppState> =
          store.getState().openSaved === openWhenStarted
            ? { openSaved: { id, name: saved.name, note: saved.note, query, databaseIds } }
            : {};
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
    sendSave(draft.name, draft.note, () =>
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
    sendSave(draft.name, draft.note, async () => {
      const clash = (await api.listSavedQueries()).find((q) => sameName(q.name, draft.name));
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
    });
    announce(`Opened “${saved.name}”.`);
    setNotice(
      left === 0
        ? []
        : [
            left === 1
              ? "1 saved database no longer exists and was left out."
              : `${left} saved databases no longer exist and were left out.`,
          ],
    );
  }

  function askOpenSaved(id: string): void {
    const saved = listedQuery(id);
    if (!saved) return; // the list changed under the click
    const { openSaved, query, selectedDatabaseIds } = store.getState();
    if (hasUnsavedWork(openSaved, query, selectedDatabaseIds)) {
      store.setState({ savedConfirm: { action: "open", id } });
    } else {
      openSavedQuery(saved);
    }
  }

  function askDeleteSaved(id: string): void {
    store.setState({ savedConfirm: { action: "delete", id } });
  }

  function deleteSaved(id: string): void {
    const name = listedQuery(id)?.name;
    api
      .deleteSavedQuery(id)
      .then(() => {
        const { openSaved, savedDialog } = store.getState();
        // The query on screen stays; it just no longer belongs to a saved one.
        if (openSaved?.id === id) store.setState({ openSaved: null });
        if (name !== undefined) announce(`Deleted “${name}”.`);
        if (savedDialog === "list") loadSavedList();
      })
      .catch((err) => {
        savedCallFailed(err, (error) => store.setState({ savedList: { status: "error", error } }));
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

  return {
    start,
    runPreview,
    onQueryChange,
    onDropItem,
    onAddItem,
    dismissDropNotice,
    showNotice,
    onDatabasesChange,
    onLogout,
    onInvalidateCompliance,
    saveQueryBeforeRedirect,
    retryStats,
    openSaveDialog,
    openSavedList,
    closeSavedDialog,
    saveQuery,
    confirmReplace,
    cancelReplace,
    retrySavedList: loadSavedList,
    askOpenSaved,
    askDeleteSaved,
    confirmSavedAction,
    cancelSavedAction,
  };
}
