import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, previewAnnouncement, STATS_DEBOUNCE_MS, type AppApi } from "../src/app";
import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "../src/api/client";
import type {
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  SavedQuery,
  SavedQueryDraft,
} from "../src/model";
import { buildFieldCatalog } from "../src/query/fieldCatalog";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../src/query/tree";
import type { Group } from "../src/query/types";
import type { OpenSaved } from "../src/query/saved";
import { validateQuery } from "../src/query/validate";
import { createStore, initialState, type AppState } from "../src/state";
import { savePendingQuery, takePendingQuery } from "../src/util/pendingQuery";
import { dbError, failed, ok } from "./statsFixtures";

// ---- fixtures -------------------------------------------------------------

const facets: Facet[] = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    group: "",
    comment: "",
    description: "",
    eventCount: 10,
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", comment: "", description: "", values: [] },
    ],
  },
];

const db = (id: string): Database => ({
  id,
  name: id.toUpperCase(),
  description: "",
  owner: "",
  eventCount: 100,
});
const databases = [db("alpha"), db("beta")];
const catalog = buildFieldCatalog(facets);

/** A query that can run: one finished condition, "Thing: size > n". */
function runnableQuery(n = 3): Group {
  const root = emptyQuery();
  const c = newCondition();
  return updateNode(addChild(root, root.id, c), c.id, {
    facetId: "thing",
    fieldId: "size",
    operatorId: "gt",
    value: n,
  });
}

/** The state after a successful start, with a finished query on screen. */
function ready(query = runnableQuery()): Partial<AppState> {
  return {
    catalog,
    databases,
    facets,
    selectedDatabaseIds: ["alpha", "beta"],
    query,
    issues: validateQuery(query, catalog),
  };
}

const events: EventRecord[] = [{ id: 1, values: {} }];

/** What the server answers for a saved draft. */
function savedFrom(draft: SavedQueryDraft, id: string): SavedQuery {
  return { ...draft, id, updatedAt: "2026-10-08T10:00:00Z" };
}

/** A saved query as the list holds it. */
function savedQuery(id: string, name: string, overrides: Partial<SavedQuery> = {}): SavedQuery {
  return savedFrom(
    { name, note: "", databaseIds: ["alpha"], query: runnableQuery(7), ...overrides },
    id,
  );
}

/** The `openSaved` for a saved query that is on screen unchanged. */
function openFrom(saved: SavedQuery): OpenSaved {
  const { id, name, note, query, databaseIds } = saved;
  return { id, name, note, query, databaseIds };
}

function fakeApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    getDatabases: vi.fn(async () => databases),
    getFacets: vi.fn(async () => facets),
    getMe: vi.fn(async () => ({ name: "pat" })),
    getComplianceStatus: vi.fn(async () => ({
      status: "acknowledged" as const,
      reason: "audit",
      givenAt: "2026-09-23T10:00:00Z",
    })),
    getStats: vi.fn(async () => {}),
    runQuery: vi.fn(async () => events),
    logout: vi.fn(async () => {}),
    invalidateCompliance: vi.fn(async () => {}),
    listSavedQueries: vi.fn(async () => []),
    createSavedQuery: vi.fn(async (draft: SavedQueryDraft) => savedFrom(draft, "new")),
    updateSavedQuery: vi.fn(async (id: string, draft: SavedQueryDraft) => savedFrom(draft, id)),
    deleteSavedQuery: vi.fn(async () => {}),
    ...overrides,
  };
}

function setup(state: Partial<AppState> = {}, api: AppApi = fakeApi()) {
  const store = createStore({ ...initialState, ...state });
  const navigate = vi.fn();
  const announce = vi.fn();
  const app = createApp({ store, api, navigate, announce });
  return { store, api, navigate, announce, app };
}

/** A promise the test settles by hand, to control when a response "arrives". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every pending promise callback run (works with real and fake timers). */
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- Run query ------------------------------------------------------------

describe("runPreview (the Run query button)", () => {
  it("does nothing while the query can't run", () => {
    const { app, api, store } = setup(); // nothing loaded yet
    app.runPreview();
    expect(api.runQuery).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("shows a loader, then the matching events", async () => {
    const { app, api, store } = setup(ready());
    app.runPreview();
    expect(store.getState().preview).toEqual({ status: "loading" });
    expect(api.runQuery).toHaveBeenCalledWith(
      store.getState().query,
      ["alpha", "beta"],
      expect.any(AbortSignal),
    );
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "ok", events });
  });

  it("a 401 saves the query and goes to log in", async () => {
    const api = fakeApi({ runQuery: vi.fn(async () => Promise.reject(new ApiError(401, "no"))) });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(takePendingQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha", "beta"],
    });
  });

  it("a 403 goes to the compliance flow when compliance is what's missing", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "no"))),
      getComplianceStatus: vi.fn(async () => ({ status: "required" as const })),
    });
    const { app, navigate } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(COMPLIANCE_START_URL);
    expect(takePendingQuery()).not.toBeNull();
  });

  it("a 403 for another reason shows its message instead of redirecting", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "Not allowed here."))),
    });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({ status: "error", error: "Not allowed here." });
  });

  it("a 403 whose compliance check fails shows the 403's message", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "Forbidden."))),
      getComplianceStatus: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({ status: "error", error: "Forbidden." });
  });

  it("ignores a 403 if the query changed while compliance was being checked", async () => {
    const compliance = deferred<{ status: "required" }>();
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "no"))),
      getComplianceStatus: vi.fn(() => compliance.promise),
    });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    app.onQueryChange(runnableQuery(4));
    compliance.resolve({ status: "required" });
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("ignores events that arrive after the query changed", async () => {
    const response = deferred<EventRecord[]>();
    const { app, store } = setup(ready(), fakeApi({ runQuery: vi.fn(() => response.promise) }));
    app.runPreview();
    app.onQueryChange(runnableQuery(4));
    response.resolve(events);
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("shows any other error", async () => {
    const api = fakeApi({ runQuery: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const { app, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "error", error: "boom" });
  });

  // The panel repaints out of sight of a screen-reader user, and their focus
  // may be elsewhere: they hear that the run started and how it ended.
  it("tells screen-reader users the run started and what came back", async () => {
    const { app, announce } = setup(ready());
    app.runPreview();
    expect(announce).toHaveBeenLastCalledWith("Fetching events…");
    await flushPromises();
    expect(announce.mock.calls).toEqual([["Fetching events…"], ["Showing 1 matching event."]]);
  });

  it("tells screen-reader users about a failed run", async () => {
    const api = fakeApi({ runQuery: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const { app, announce } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(announce).toHaveBeenLastCalledWith("Could not load events: boom");
  });

  it("says nothing about a run the query has moved on from", async () => {
    const response = deferred<EventRecord[]>();
    const api = fakeApi({ runQuery: vi.fn(() => response.promise) });
    const { app, announce } = setup(ready(), api);
    app.runPreview();
    app.onQueryChange(runnableQuery(4));
    response.resolve(events);
    await flushPromises();
    expect(announce.mock.calls).toEqual([["Fetching events…"]]);
  });
});

describe("previewAnnouncement", () => {
  it("says nothing while no run is shown", () => {
    expect(previewAnnouncement({ status: "idle" })).toBeNull();
  });
  it("counts the events, or says there are none", () => {
    expect(previewAnnouncement({ status: "ok", events: [] })).toBe("No events match this query.");
    expect(previewAnnouncement({ status: "ok", events })).toBe("Showing 1 matching event.");
    expect(previewAnnouncement({ status: "ok", events: [...events, ...events] })).toBe(
      "Showing 2 matching events.",
    );
  });
});

// ---- statistics -----------------------------------------------------------

describe("statistics", () => {
  /** getStats that hands each call's line callback back to the test. */
  function streamingApi() {
    const calls: {
      onLine: (l: DatabaseResult) => void;
      done: ReturnType<typeof deferred<void>>;
      signal?: AbortSignal;
    }[] = [];
    const api = fakeApi({
      getStats: vi.fn(
        (
          _query: Group,
          _databaseIds: string[],
          onLine: (l: DatabaseResult) => void,
          signal?: AbortSignal,
        ) => {
          const done = deferred<void>();
          calls.push({ onLine, done, signal });
          return done.promise;
        },
      ),
    });
    return { api, calls };
  }

  it("fetches after the debounce and streams lines in as they arrive", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { app, store } = setup(ready(), api);
    const next = runnableQuery(5);
    app.onQueryChange(next);
    expect(store.getState().stats).toMatchObject({ status: "idle", results: [] });
    expect(api.getStats).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledWith(
      next,
      ["alpha", "beta"],
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(store.getState().stats).toMatchObject({ status: "loading", results: [] });

    calls[0]!.onLine(ok("alpha", 7));
    expect(store.getState().stats).toMatchObject({
      status: "loading",
      results: [ok("alpha", 7)],
    });

    calls[0]!.onLine(ok("beta", 2));
    calls[0]!.done.resolve();
    await flushPromises();
    expect(store.getState().stats).toMatchObject({
      status: "ok",
      results: [ok("alpha", 7), ok("beta", 2)],
    });
  });

  it("keeps the problems the lines point at, set only when they change", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { app, store } = setup(ready(), api);
    app.onQueryChange(runnableQuery(5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    const setState = vi.spyOn(store, "setState");

    calls[0]!.onLine(failed("alpha", dbError("c1", "Too long.")));
    calls[0]!.onLine(failed("beta", dbError("c1", "Too long.")));
    expect(store.getState().serverIssues).toEqual([
      { nodeId: "c1", message: "Too long.", kind: "invalid" },
    ]);
    // The second line reports the same problem: only `stats` is written, so
    // the query builder doesn't repaint.
    expect(setState.mock.calls.map(([patch]) => Object.keys(patch))).toEqual([
      ["stats", "serverIssues"],
      ["stats"],
    ]);

    app.onQueryChange(runnableQuery(6));
    expect(store.getState().serverIssues).toEqual([]);
  });

  it("drops lines from a request the user has moved on from, and aborts it", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { app, store } = setup(ready(), api);
    app.onQueryChange(runnableQuery(5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);

    app.onQueryChange(runnableQuery(6));
    expect(calls[0]!.signal?.aborted).toBe(true);
    calls[0]!.onLine(ok("alpha", 7));
    calls[0]!.done.resolve();
    await flushPromises();
    expect(store.getState().stats).toMatchObject({ status: "idle", results: [] });

    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledTimes(2);
  });

  it("shows a failed request's error", async () => {
    vi.useFakeTimers();
    const api = fakeApi({ getStats: vi.fn(async () => Promise.reject(new Error("down"))) });
    const { app, store } = setup(ready(), api);
    app.onQueryChange(runnableQuery(5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    await flushPromises();
    expect(store.getState().stats).toMatchObject({ status: "error", error: "down" });
  });

  it("fetches again on retryStats after a failed request", async () => {
    vi.useFakeTimers();
    const getStats = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(async (_q, _ids, onLine: (l: DatabaseResult) => void) => {
        onLine(ok("alpha", 3));
      });
    const { app, store } = setup(ready(), fakeApi({ getStats }));
    app.onQueryChange(runnableQuery(5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    await flushPromises();
    expect(store.getState().stats.status).toBe("error");

    app.retryStats();
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    await flushPromises();
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(store.getState().stats).toMatchObject({ status: "ok", results: [ok("alpha", 3)] });
  });

  it("fetches nothing for an unfinished query", async () => {
    vi.useFakeTimers();
    const { app, api } = setup(ready());
    const root = emptyQuery();
    app.onQueryChange(addChild(root, root.id, newCondition()));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });
});

// ---- query and database changes -------------------------------------------

describe("query and database changes", () => {
  const shown: Partial<AppState> = { preview: { status: "ok", events } };

  it("an edit clears the preview at once and revalidates", () => {
    const { app, store } = setup({ ...ready(), ...shown });
    const root = emptyQuery();
    const unfinished = addChild(root, root.id, newCondition());
    app.onQueryChange(unfinished);
    expect(store.getState().query).toBe(unfinished);
    expect(store.getState().preview).toEqual({ status: "idle" });
    expect(store.getState().issues).toHaveLength(1);
  });

  it("collapsing a group keeps the results and fetches nothing", async () => {
    vi.useFakeTimers();
    const { app, api, store } = setup({ ...ready(), ...shown });
    const query = store.getState().query;
    const folded = updateNode(query, query.id, { collapsed: true });
    app.onQueryChange(folded);
    expect(store.getState().query).toBe(folded);
    expect(store.getState().preview).toEqual(shown.preview);
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });

  it("the same databases in another order are not a change", () => {
    const { app, store } = setup({ ...ready(), ...shown });
    app.onDatabasesChange(["beta", "alpha"]);
    expect(store.getState().preview).toEqual(shown.preview);
    app.onDatabasesChange(["alpha"]);
    expect(store.getState().selectedDatabaseIds).toEqual(["alpha"]);
    expect(store.getState().preview).toEqual({ status: "idle" });
  });
});

// ---- log out / invalidate compliance --------------------------------------

describe("logging out and invalidating compliance", () => {
  const signedIn: Partial<AppState> = {
    ...ready(),
    preview: { status: "ok", events },
    auth: { status: "authenticated", user: { name: "pat" } },
    compliance: { status: "acknowledged", reason: "audit", givenAt: null },
  };

  it("logout clears the preview at once, even if logging out fails", async () => {
    const api = fakeApi({ logout: vi.fn(async () => Promise.reject(new Error("offline"))) });
    const { app, store } = setup(signedIn, api);
    app.onLogout();
    expect(store.getState().preview).toEqual({ status: "idle" });
    await flushPromises();
    expect(store.getState().auth.status).toBe("authenticated");
    expect(console.error).toHaveBeenCalled();
  });

  it("a successful logout signs out and clears compliance", async () => {
    const { app, store } = setup(signedIn);
    app.onLogout();
    await flushPromises();
    expect(store.getState().auth.status).toBe("anonymous");
    expect(store.getState().compliance.status).toBe("required");
  });

  it("invalidating compliance clears the preview and asks for a reason again", async () => {
    const { app, api, store } = setup(signedIn);
    app.onInvalidateCompliance();
    expect(store.getState().preview).toEqual({ status: "idle" });
    await flushPromises();
    expect(api.invalidateCompliance).toHaveBeenCalled();
    expect(store.getState().compliance.status).toBe("required");
    expect(store.getState().auth.status).toBe("authenticated");
  });
});

// ---- startup --------------------------------------------------------------

describe("start", () => {
  it("loads everything, selects every database and seeds one empty condition", async () => {
    const { app, store } = setup();
    await app.start(false);
    const s = store.getState();
    expect(s.catalog).toEqual(catalog);
    expect(s.databases).toBe(databases);
    expect(s.facets).toBe(facets);
    expect(s.selectedDatabaseIds).toEqual(["alpha", "beta"]);
    expect(s.query.children).toHaveLength(1);
    expect(s.issues).toEqual([expect.objectContaining({ kind: "incomplete" })]);
    expect(s.auth).toMatchObject({ status: "authenticated", user: { name: "pat" } });
    expect(s.compliance).toMatchObject({ status: "acknowledged", reason: "audit" });
  });

  it("logs login and compliance failures and carries on", async () => {
    const api = fakeApi({
      getMe: vi.fn(async () => Promise.reject(new Error("idp down"))),
      getComplianceStatus: vi.fn(async () => Promise.reject(new Error("audit down"))),
    });
    const { app, store } = setup({}, api);
    await app.start(false);
    expect(store.getState().auth.status).toBe("anonymous");
    expect(store.getState().compliance.status).toBe("required");
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("rejects when databases or facets can't be loaded", async () => {
    const api = fakeApi({ getFacets: vi.fn(async () => Promise.reject(new Error("down"))) });
    const { app } = setup({}, api);
    await expect(app.start(false)).rejects.toThrow("down");
  });

  it("after a login/compliance redirect, restores the saved query and fetches its statistics", async () => {
    vi.useFakeTimers();
    const saved = runnableQuery(9);
    savePendingQuery(saved, ["beta", "no-longer-exists"]);
    const { app, api, store } = setup();
    await app.start(true);
    expect(store.getState().query).toEqual(saved);
    expect(store.getState().selectedDatabaseIds).toEqual(["beta"]);
    expect(store.getState().issues).toEqual([]);
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it("a normal load ignores a leftover saved query, and clears it", async () => {
    savePendingQuery(runnableQuery(9), ["beta"]);
    const { app, store } = setup();
    await app.start(false);
    expect(store.getState().selectedDatabaseIds).toEqual(["alpha", "beta"]);
    expect(store.getState().issues).toHaveLength(1); // the seeded empty condition
    expect(takePendingQuery()).toBeNull();
  });
});

describe("saveQueryBeforeRedirect (login / compliance links)", () => {
  it("saves a query that has conditions", () => {
    const { app, store } = setup(ready());
    app.saveQueryBeforeRedirect();
    expect(takePendingQuery()?.query).toEqual(store.getState().query);
  });

  it("saves nothing for an empty query", () => {
    const { app } = setup({ ...ready(), query: emptyQuery() });
    app.saveQueryBeforeRedirect();
    expect(takePendingQuery()).toBeNull();
  });
});

describe("dropping docs items", () => {
  it("a facet drop adds a facet-level 'present' condition and validates it", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    const q = store.getState().query;
    expect(q.children).toHaveLength(1);
    expect(q.children[0]).toMatchObject({ facetId: "thing", fieldId: null, operatorId: "present" });
    expect(store.getState().issues).toEqual([]);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("announces what was added, for screen readers", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Added 1 condition to the query.");
  });

  it("announces a move", () => {
    const root = emptyQuery();
    const c = newCondition();
    const g = newGroup();
    const { app, announce } = setup({ ...ready(addChild(addChild(root, root.id, c), root.id, g)) });
    app.onDropItem({ type: "node", nodeId: c.id }, g.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Moved the condition.");
  });

  it("announces no 'Added' or 'Moved' when nothing was added or moved", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "ghost" }, store.getState().query.id);
    app.onDropItem({ type: "node", nodeId: "gone" }, store.getState().query.id);
    app.onDropItem(null, store.getState().query.id);
    // Only the three warnings are spoken, in order (see the next test).
    expect(announce.mock.calls).toEqual([
      [expect.stringMatching(/^Couldn't add “ghost”: /)],
      ["That item is no longer in the query."],
      ["That item can't be added to a query."],
    ]);
  });

  it("speaks a refused drop's warning, since its box appears with its text already in it", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()) });
    app.onDropItem(null, store.getState().query.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("That item can't be added to a query.");
    // The same refusal again is a new action: it is spoken again.
    app.onDropItem(null, store.getState().query.id);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it("showNotice shows a message as the warning and speaks it", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()) });
    app.showNotice("Not allowed.");
    expect(store.getState().dropNotice).toBe("Not allowed.");
    expect(announce).toHaveBeenCalledExactlyOnceWith("Not allowed.");
  });

  it("a drop that fully succeeds speaks no warning", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()), dropNotice: "old" });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Added 1 condition to the query.");
  });

  it("moving a node onto the spot it already holds changes and announces nothing", () => {
    // The last child dropped on its own parent goes "to the end of the group":
    // where it already is.
    // (Finished conditions: a lone blank row would be replaced by the moved one.)
    const done = { facetId: "thing", fieldId: "size", operatorId: "gt", value: 1 };
    const root = emptyQuery();
    const first = newCondition();
    const last = newCondition();
    const q = updateNode(
      updateNode(addChild(addChild(root, root.id, first), root.id, last), first.id, done),
      last.id,
      done,
    );
    const { store, app, announce } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: last.id }, root.id);
    expect(announce).not.toHaveBeenCalled();
    expect(store.getState().query).toBe(q);
  });

  it("an unknown facet adds nothing and says why", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "ghost" }, store.getState().query.id);
    expect(store.getState().query.children).toHaveLength(0);
    expect(store.getState().dropNotice).toMatch(/ghost/);
  });

  it("unreadable drag data adds nothing and says so", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem(null, store.getState().query.id);
    expect(store.getState().query.children).toHaveLength(0);
    expect(store.getState().dropNotice).toBe("That item can't be added to a query.");
  });

  it("a successful drop clears an earlier warning", () => {
    const { store, app } = setup({ ...ready(emptyQuery()), dropNotice: "old" });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("a warning from showNotice is cleared again by dismissDropNotice (what a successful Group contents or Ungroup calls)", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.showNotice("Not allowed.");
    app.dismissDropNotice();
    expect(store.getState().dropNotice).toBeNull();
  });

  it("dismissDropNotice clears the warning", () => {
    const { store, app } = setup({ dropNotice: "x" });
    app.dismissDropNotice();
    expect(store.getState().dropNotice).toBeNull();
  });

  it("moving a group into itself is refused with a warning", () => {
    // A group dropped on a group nested inside it (dropping it on itself is a
    // quiet no-op, see the next test).
    const root = emptyQuery();
    const inner = newGroup();
    const outer = newGroup();
    const g = addChild(outer, outer.id, inner);
    const { store, app } = setup({ ...ready(addChild(root, root.id, g)) });
    const before = store.getState().query;
    app.onDropItem({ type: "node", nodeId: g.id }, inner.id);
    expect(store.getState().dropNotice).toBe("A group can't be moved into itself.");
    expect(store.getState().query).toBe(before);
  });

  it("a node that is no longer in the query is refused with its own warning", () => {
    const q = runnableQuery();
    const { store, app } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: "gone" }, q.id);
    expect(store.getState().dropNotice).toBe("That item is no longer in the query.");
    expect(store.getState().query).toBe(q);
  });

  it("the root can't be moved", () => {
    const q = runnableQuery();
    const g = newGroup();
    const query = addChild(q, q.id, g);
    const { store, app } = setup({ ...ready(query) });
    app.onDropItem({ type: "node", nodeId: query.id }, g.id);
    expect(store.getState().dropNotice).toBe("That item is no longer in the query.");
    expect(store.getState().query).toBe(query);
  });

  it("dropping a node on itself does nothing quietly", () => {
    const q = runnableQuery();
    const c = q.children[0]!;
    const { store, app } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: c.id }, c.id);
    expect(store.getState().query).toBe(q);
    expect(store.getState().dropNotice).toBeNull();
  });

  describe("a collapsed target group", () => {
    /** A root holding a collapsed, empty group; returns the group's id too. */
    function withCollapsedGroup() {
      const root = emptyQuery();
      const g = newGroup();
      const query = updateNode(addChild(root, root.id, g), g.id, { collapsed: true });
      return { query, groupId: g.id };
    }
    const groupOf = (q: Group, id: string) => q.children.find((n) => n.id === id);

    it("opens to show a facet dropped into it", () => {
      const { query, groupId } = withCollapsedGroup();
      const { store, app } = setup({ ...ready(query) });
      app.onDropItem({ type: "facet", facetId: "thing" }, groupId);
      const g = groupOf(store.getState().query, groupId);
      expect(g).toMatchObject({ collapsed: false });
      // (A new group starts with one blank condition; the drop replaces it.)
      expect(g?.kind === "group" && g.children).toHaveLength(1);
      expect(g?.kind === "group" && g.children[0]).toMatchObject({ facetId: "thing" });
    });

    it("stays collapsed when the drop fails", () => {
      const { query, groupId } = withCollapsedGroup();
      const { store, app } = setup({ ...ready(query) });
      app.onDropItem({ type: "facet", facetId: "ghost" }, groupId);
      expect(groupOf(store.getState().query, groupId)).toMatchObject({ collapsed: true });
    });

    it("opens to show a node moved into it", () => {
      const { query, groupId } = withCollapsedGroup();
      const c = newCondition();
      const withCond = addChild(query, query.id, c);
      const { store, app } = setup({ ...ready(withCond) });
      app.onDropItem({ type: "node", nodeId: c.id }, groupId);
      const g = groupOf(store.getState().query, groupId);
      expect(g).toMatchObject({ collapsed: false });
      expect(g?.kind === "group" && g.children.at(-1)?.id).toBe(c.id);
    });

    it("stays collapsed when a move is refused", () => {
      const { query, groupId } = withCollapsedGroup();
      const { store, app } = setup({ ...ready(query) });
      app.onDropItem({ type: "node", nodeId: "no-such-node" }, groupId);
      expect(groupOf(store.getState().query, groupId)).toMatchObject({ collapsed: true });
    });
  });

  describe("a lone blank condition (the starting query)", () => {
    const blank = newCondition();
    function startingQuery(): Group {
      const root = emptyQuery();
      return addChild(root, root.id, blank);
    }

    it("is replaced by a dropped facet", () => {
      const { store, app } = setup({ ...ready(startingQuery()) });
      app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
      const q = store.getState().query;
      expect(q.children).toHaveLength(1);
      expect(q.children[0]).toMatchObject({ facetId: "thing", operatorId: "present" });
      expect(store.getState().issues).toEqual([]);
    });

    it("is replaced when the drop lands on the blank row itself", () => {
      const { store, app } = setup({ ...ready(startingQuery()) });
      app.onDropItem({ type: "facet", facetId: "thing" }, blank.id);
      const q = store.getState().query;
      expect(q.children).toHaveLength(1);
      expect(q.children[0]).toMatchObject({ facetId: "thing" });
    });

    it("is replaced by the + button too", () => {
      const { store, app } = setup({ ...ready(startingQuery()) });
      app.onAddItem({ type: "field", facetId: "thing", fieldId: "size" });
      const q = store.getState().query;
      expect(q.children).toHaveLength(1);
      expect(q.children[0]).toMatchObject({ facetId: "thing", fieldId: "size" });
    });

    it("is replaced even after the user switched the root to ANY, which stays", () => {
      const anyRoot = { ...startingQuery(), operator: "OR" as const };
      const { store, app } = setup({ ...ready(anyRoot) });
      app.onAddItem({ type: "facet", facetId: "thing" });
      expect(store.getState().query).toMatchObject({ operator: "OR" });
      expect(store.getState().query.children).toHaveLength(1);
    });

    describe("in a group added with + Group", () => {
      // The root holds two children, so only the new group's row is lone and blank.
      function withNewGroup() {
        const root = emptyQuery();
        const g = newGroup();
        const query = addChild(addChild(root, root.id, newCondition()), root.id, g);
        return { query, groupId: g.id, blankId: g.children[0]?.id ?? "" };
      }
      function expectReplaced(q: Group, groupId: string) {
        const g = q.children.find((n) => n.id === groupId);
        expect(q.children).toHaveLength(2);
        expect(g?.kind === "group" && g.children).toHaveLength(1);
        expect(g?.kind === "group" && g.children[0]).toMatchObject({ facetId: "thing" });
      }

      it("is replaced by a drop on the group", () => {
        const { query, groupId } = withNewGroup();
        const { store, app } = setup({ ...ready(query) });
        app.onDropItem({ type: "facet", facetId: "thing" }, groupId);
        expectReplaced(store.getState().query, groupId);
      });

      it("is replaced by a drop on its blank row", () => {
        const { query, groupId, blankId } = withNewGroup();
        const { store, app } = setup({ ...ready(query) });
        app.onDropItem({ type: "facet", facetId: "thing" }, blankId);
        expectReplaced(store.getState().query, groupId);
      });
    });

    it("is replaced by an existing node moved into a group, which then holds only that node", () => {
      const root = emptyQuery();
      const g = newGroup();
      const c = { ...newCondition(), facetId: "thing", operatorId: "present" };
      const { store, app } = setup({ ...ready(addChild(addChild(root, root.id, c), root.id, g)) });
      app.onDropItem({ type: "node", nodeId: c.id }, g.id);
      const q = store.getState().query;
      expect(q.children.map((n) => n.id)).toEqual([g.id]);
      const inner = q.children[0];
      expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([c.id]);
    });

    it("stays when the drop fails", () => {
      const { store, app } = setup({ ...ready(startingQuery()) });
      app.onAddItem({ type: "facet", facetId: "ghost" });
      expect(store.getState().query.children).toHaveLength(1);
      expect(store.getState().query.children[0]).toMatchObject({ facetId: null });
      expect(store.getState().dropNotice).toMatch(/ghost/);
    });

    it("stays when the user has already chosen something in it", () => {
      const edited = updateNode(startingQuery(), blank.id, { facetId: "thing" });
      const { store, app } = setup({ ...ready(edited) });
      app.onAddItem({ type: "facet", facetId: "thing" });
      expect(store.getState().query.children).toHaveLength(2);
    });
  });

  it("onAddItem puts the item in the root group", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onAddItem({ type: "field", facetId: "thing", fieldId: "size" });
    expect(store.getState().query.children[0]).toMatchObject({ facetId: "thing", fieldId: "size" });
  });

  it("with no docs loaded yet, says so instead of ignoring the drop", () => {
    const { store, app } = setup({});
    app.onAddItem({ type: "facet", facetId: "thing" });
    expect(store.getState().dropNotice).toBe(
      "The data dictionary is still loading; try again in a moment.",
    );
  });
});

// ---- saved queries --------------------------------------------------------

describe("saved queries: opening the dialogs", () => {
  it("sends an anonymous visitor to log in, keeping the query (even a blank one)", () => {
    const { app, navigate, store } = setup({
      ...ready(emptyQuery()),
      auth: { status: "anonymous" },
    });
    app.openSaveDialog();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(takePendingQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha", "beta"],
    });
    expect(store.getState().savedDialog).toBeNull();
  });

  it("does the same for the list", () => {
    const { app, navigate, api } = setup({ ...ready(), auth: { status: "anonymous" } });
    app.openSavedList();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(api.listSavedQueries).not.toHaveBeenCalled();
  });

  it("opens the save dialog for a logged-in user, with a fresh save state", () => {
    const { app, store } = setup({
      ...ready(),
      auth: { status: "authenticated", user: { name: "pat" } },
      save: { status: "error", error: "old" },
    });
    app.openSaveDialog();
    expect(store.getState().savedDialog).toBe("save");
    expect(store.getState().save).toEqual({ status: "idle" });
  });

  it("treats a login that is still loading as logged in", () => {
    const { app, store, navigate } = setup(ready()); // auth: loading
    app.openSaveDialog();
    expect(store.getState().savedDialog).toBe("save");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("loads the list when the list dialog opens", async () => {
    const queries = [savedQuery("a", "Weekly")];
    const { app, store } = setup(
      ready(),
      fakeApi({ listSavedQueries: vi.fn(async () => queries) }),
    );
    app.openSavedList();
    expect(store.getState().savedDialog).toBe("list");
    expect(store.getState().savedList).toEqual({ status: "loading" });
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries });
  });

  it("shows a failed list load and loads again on retry", async () => {
    const list = vi
      .fn<AppApi["listSavedQueries"]>()
      .mockRejectedValueOnce(new ApiError(500, "down"))
      .mockResolvedValueOnce([]);
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: list }));
    app.openSavedList();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "error", error: "down" });
    app.retrySavedList();
    expect(store.getState().savedList).toEqual({ status: "loading" });
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [] });
  });

  it("a 401 on the list redirects to log in", async () => {
    const api = fakeApi({
      listSavedQueries: vi.fn(async () => Promise.reject(new ApiError(401, "no"))),
    });
    const { app, navigate } = setup(ready(), api);
    app.openSavedList();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(takePendingQuery()).not.toBeNull();
  });

  it("ignores a slow list answer once a newer load started", async () => {
    const slow = deferred<SavedQuery[]>();
    const list = vi
      .fn<AppApi["listSavedQueries"]>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([savedQuery("b", "Newer")]);
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: list }));
    app.openSavedList();
    app.retrySavedList();
    await flushPromises();
    slow.resolve([savedQuery("a", "Older")]);
    await flushPromises();
    expect(store.getState().savedList).toMatchObject({ status: "ok", queries: [{ id: "b" }] });
  });

  it("closing the dialog resets it and drops a pending load", async () => {
    const slow = deferred<SavedQuery[]>();
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: vi.fn(() => slow.promise) }));
    app.openSavedList();
    app.closeSavedDialog();
    slow.resolve([savedQuery("a", "Weekly")]);
    await flushPromises();
    expect(store.getState()).toMatchObject({
      savedDialog: null,
      savedConfirm: null,
      save: { status: "idle" },
      savedList: { status: "idle" },
    });
  });
});

describe("saved queries: saving", () => {
  const loggedIn = { auth: { status: "authenticated", user: { name: "pat" } } } as const;

  it("creates a new saved query from the query and selection on screen", async () => {
    const { app, api, store, announce } = setup({ ...ready(), ...loggedIn, savedDialog: "save" });
    app.saveQuery("  Weekly ", " note ");
    expect(store.getState().save).toEqual({ status: "saving" });
    await flushPromises();
    const { query } = store.getState();
    expect(api.createSavedQuery).toHaveBeenCalledWith({
      name: "Weekly",
      note: "note",
      databaseIds: ["alpha", "beta"],
      query,
    });
    expect(store.getState()).toMatchObject({
      savedDialog: null,
      save: { status: "idle" },
      openSaved: { id: "new", name: "Weekly", note: "note", query, databaseIds: ["alpha", "beta"] },
    });
    expect(announce).toHaveBeenCalledWith("Saved “Weekly”.");
  });

  it("updates the open query when the name is its own", async () => {
    const open = savedQuery("s1", "Weekly", { databaseIds: ["alpha", "beta"] });
    const { app, api, store } = setup({
      ...ready(),
      ...loggedIn,
      savedDialog: "save",
      openSaved: openFrom(open),
    });
    app.saveQuery("weekly", "");
    await flushPromises();
    expect(api.updateSavedQuery).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ name: "weekly" }),
    );
    expect(api.createSavedQuery).not.toHaveBeenCalled();
    expect(store.getState().openSaved).toMatchObject({ id: "s1" });
  });

  it("creates a copy when saved under another name", async () => {
    const open = savedQuery("s1", "Weekly");
    const { app, api } = setup({ ...ready(), ...loggedIn, openSaved: openFrom(open) });
    app.saveQuery("Monthly", "");
    await flushPromises();
    expect(api.createSavedQuery).toHaveBeenCalled();
    expect(api.updateSavedQuery).not.toHaveBeenCalled();
  });

  it("refuses an empty name without asking the backend", () => {
    const { app, api, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" });
    app.saveQuery("   ", "");
    expect(api.createSavedQuery).not.toHaveBeenCalled();
    expect(store.getState().save).toEqual({ status: "error", error: "Give the query a name." });
  });

  it("keeps the dialog open and asks to replace when the name clashes", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(409, "exists"))),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "note");
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "conflict", name: "Weekly", note: "note" });
    expect(store.getState().savedDialog).toBe("save");
  });

  it("replaces the query that has the clashing name", async () => {
    const clash = savedQuery("other", "weekly ");
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(409, "exists"))),
      listSavedQueries: vi.fn(async () => [savedQuery("x", "Monthly"), clash]),
    });
    const { app, store, announce } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "note");
    await flushPromises();
    app.confirmReplace();
    expect(store.getState().save).toEqual({ status: "saving" });
    await flushPromises();
    expect(api.updateSavedQuery).toHaveBeenCalledWith(
      "other",
      expect.objectContaining({ name: "Weekly", note: "note" }),
    );
    expect(store.getState()).toMatchObject({
      savedDialog: null,
      save: { status: "idle" },
      openSaved: { id: "other" },
    });
    expect(announce).toHaveBeenCalledWith("Saved “Weekly”.");
  });

  it("creates after all when the clashing query is gone by the time of the replace", async () => {
    const api = fakeApi({
      createSavedQuery: vi
        .fn<AppApi["createSavedQuery"]>()
        .mockRejectedValueOnce(new ApiError(409, "exists"))
        .mockImplementation(async (draft) => savedFrom(draft, "fresh")),
      listSavedQueries: vi.fn(async () => []),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    app.confirmReplace();
    await flushPromises();
    expect(store.getState().openSaved).toMatchObject({ id: "fresh" });
  });

  it("cancelling the replace goes back to the form", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(409, "exists"))),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    app.cancelReplace();
    expect(store.getState().save).toEqual({ status: "idle" });
    expect(store.getState().savedDialog).toBe("save");
  });

  it("confirmReplace does nothing when there is no clash to replace", () => {
    const { app, api } = setup({ ...ready(), ...loggedIn, savedDialog: "save" });
    app.confirmReplace();
    expect(api.listSavedQueries).not.toHaveBeenCalled();
  });

  it("a 401 saves the query and goes to log in", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(401, "no"))),
    });
    const { app, navigate } = setup({ ...ready(), savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(takePendingQuery()).not.toBeNull();
  });

  it("shows any other error in the dialog", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(500, "disk full"))),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "error", error: "disk full" });
    expect(store.getState().savedDialog).toBe("save");
  });

  it("ignores a failure that arrives after the dialog was closed", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.closeSavedDialog();
    slow.reject(new ApiError(500, "late"));
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "idle" });
  });

  it("does not start a second save while one is running", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.saveQuery("Weekly", ""); // Enter pressed twice
    expect(api.createSavedQuery).toHaveBeenCalledTimes(1);
    slow.resolve(savedQuery("new", "Weekly"));
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "idle" });
    expect(store.getState().openSaved).toMatchObject({ id: "new" });
  });

  it("does not let a late save replace a query opened since", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const other = savedQuery("b", "Other");
    const { app, store } = setup({ ...ready(emptyQuery()), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.closeSavedDialog();
    store.setState({ savedList: { status: "ok", queries: [other] } });
    app.askOpenSaved("b");
    slow.resolve(savedQuery("a", "Weekly"));
    await flushPromises();
    expect(store.getState().openSaved).toMatchObject({ id: "b" });
  });

  it("remembers a save that finished after the dialog was closed", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.closeSavedDialog();
    slow.resolve(savedQuery("late", "Weekly"));
    await flushPromises();
    expect(store.getState().openSaved).toMatchObject({ id: "late" });
  });
});

describe("saved queries: opening one from the list", () => {
  const loggedIn = { auth: { status: "authenticated", user: { name: "pat" } } } as const;
  const target = savedQuery("t", "Weekly", { databaseIds: ["alpha", "gone"] });
  const inList: Partial<AppState> = {
    savedDialog: "list",
    savedList: { status: "ok", queries: [target] },
  };

  it("opens at once when nothing would be lost, dropping databases that no longer exist", async () => {
    vi.useFakeTimers();
    const { app, api, store, announce } = setup({ ...loggedIn, ...inList, ...ready(emptyQuery()) });
    app.askOpenSaved("t");
    const state = store.getState();
    expect(state.query).toBe(target.query);
    expect(state.selectedDatabaseIds).toEqual(["alpha"]);
    expect(state.issues).toEqual(validateQuery(target.query, catalog));
    expect(state.savedDialog).toBeNull();
    expect(state.savedConfirm).toBeNull();
    expect(state.openSaved).toEqual({ ...openFrom(target), databaseIds: ["alpha"] });
    expect(state.dropNotice).toBe("1 saved database no longer exists and was left out.");
    expect(announce).toHaveBeenCalledWith("Opened “Weekly”.");
    // Like any edit: statistics are fetched for the opened query.
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledWith(
      target.query,
      ["alpha"],
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("resets the statistics and preview of the query it replaces", () => {
    const { app, store } = setup({
      ...loggedIn,
      ...inList,
      ...ready(emptyQuery()),
      stats: { status: "ok", results: [] },
      preview: { status: "ok", events },
    });
    app.askOpenSaved("t");
    expect(store.getState().stats).toEqual({ status: "idle", results: [] });
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("says how many databases were left out", () => {
    const many = savedQuery("t", "Weekly", { databaseIds: ["alpha", "x", "y"] });
    const { app, store } = setup({
      ...loggedIn,
      ...ready(emptyQuery()),
      savedDialog: "list",
      savedList: { status: "ok", queries: [many] },
    });
    app.askOpenSaved("t");
    expect(store.getState().dropNotice).toBe(
      "2 saved databases no longer exist and were left out.",
    );
  });

  it("clears an old warning when nothing was left out", () => {
    const whole = savedQuery("t", "Weekly", { databaseIds: ["alpha"] });
    const { app, store } = setup({
      ...loggedIn,
      ...ready(emptyQuery()),
      dropNotice: "old",
      savedDialog: "list",
      savedList: { status: "ok", queries: [whole] },
    });
    app.askOpenSaved("t");
    expect(store.getState().dropNotice).toBeNull();
  });

  it("asks first when the query on screen has unsaved work", () => {
    const { app, store } = setup({ ...loggedIn, ...inList, ...ready() });
    app.askOpenSaved("t");
    expect(store.getState().savedConfirm).toEqual({ action: "open", id: "t" });
    expect(store.getState().query).not.toBe(target.query);
  });

  it("opens after the user confirms", () => {
    const { app, store } = setup({ ...loggedIn, ...inList, ...ready() });
    app.askOpenSaved("t");
    app.confirmSavedAction();
    expect(store.getState().query).toBe(target.query);
    expect(store.getState().savedConfirm).toBeNull();
    expect(store.getState().savedDialog).toBeNull();
  });

  it("keeps the query when the user cancels", () => {
    const query = runnableQuery();
    const { app, store } = setup({ ...loggedIn, ...inList, ...ready(query) });
    app.askOpenSaved("t");
    app.cancelSavedAction();
    expect(store.getState().savedConfirm).toBeNull();
    expect(store.getState().query).toBe(query);
    expect(store.getState().savedDialog).toBe("list");
  });

  it("opens at once when the query on screen is the saved one, unedited", () => {
    const current = savedQuery("c", "Current", { databaseIds: ["alpha", "beta"] });
    const { app, store } = setup({
      ...loggedIn,
      ...inList,
      ...ready(current.query),
      openSaved: openFrom(current),
    });
    app.askOpenSaved("t");
    expect(store.getState().openSaved).toMatchObject({ id: "t" });
  });

  it("ignores a query that is no longer in the list", () => {
    const { app, store } = setup({ ...loggedIn, ...inList, ...ready(emptyQuery()) });
    app.askOpenSaved("nope");
    expect(store.getState().savedDialog).toBe("list");
    expect(store.getState().openSaved).toBeNull();
  });
});

describe("saved queries: deleting", () => {
  const loggedIn = { auth: { status: "authenticated", user: { name: "pat" } } } as const;
  const a = savedQuery("a", "Weekly");
  const b = savedQuery("b", "Monthly");

  it("asks first, then deletes and reloads the list", async () => {
    const list = vi.fn<AppApi["listSavedQueries"]>().mockResolvedValue([b]);
    const { app, api, store, announce } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a, b] },
      },
      fakeApi({ listSavedQueries: list }),
    );
    app.askDeleteSaved("a");
    expect(store.getState().savedConfirm).toEqual({ action: "delete", id: "a" });
    expect(api.deleteSavedQuery).not.toHaveBeenCalled();
    app.confirmSavedAction();
    expect(store.getState().savedConfirm).toBeNull();
    await flushPromises();
    expect(api.deleteSavedQuery).toHaveBeenCalledWith("a");
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [b] });
    expect(announce).toHaveBeenCalledWith("Deleted “Weekly”.");
  });

  it("forgets the open query when it is the one deleted", async () => {
    const { app, store } = setup({
      ...loggedIn,
      ...ready(a.query),
      openSaved: openFrom(a),
      savedDialog: "list",
      savedList: { status: "ok", queries: [a] },
    });
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().openSaved).toBeNull();
  });

  it("keeps the open query when another one is deleted", async () => {
    const { app, store } = setup({
      ...loggedIn,
      ...ready(a.query),
      openSaved: openFrom(a),
      savedDialog: "list",
      savedList: { status: "ok", queries: [a, b] },
    });
    app.askDeleteSaved("b");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().openSaved).toMatchObject({ id: "a" });
  });

  it("shows a failed delete in the list", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(404, "gone"))),
    });
    const { app, store } = setup(
      { ...loggedIn, ...ready(), savedDialog: "list", savedList: { status: "ok", queries: [a] } },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "error", error: "gone" });
  });

  it("a 401 on delete redirects to log in", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(401, "no"))),
    });
    const { app, navigate } = setup(
      { ...loggedIn, ...ready(), savedDialog: "list", savedList: { status: "ok", queries: [a] } },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
  });

  it("confirmSavedAction does nothing without a pending action", () => {
    const { app, api } = setup(ready());
    app.confirmSavedAction();
    expect(api.deleteSavedQuery).not.toHaveBeenCalled();
  });
});
