import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, previewAnnouncement, STATS_DEBOUNCE_MS, type AppApi } from "../src/app";
import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "../src/api/client";
import type {
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  SavedQuery,
  SavedQueryList,
  SavedQueryDraft,
} from "../src/model";
import { buildFieldCatalog } from "../src/query/fieldCatalog";
import {
  addChild,
  emptyQuery,
  newBlock,
  newFieldCondition,
  newGroup,
  removeNode,
  setFieldCondition,
  setNegated,
  updateNode,
} from "../src/query/tree";
import type { FacetBlock, Group } from "../src/query/types";
import { isEdited, type OpenSaved } from "../src/query/saved";
import { validateQuery } from "../src/query/validate";
import { createStore, initialState, type AppState } from "../src/state";
import {
  keepQuery,
  readKeptQuery,
  RESTORED_MESSAGE,
  STARTED_FRESH_MESSAGE,
} from "../src/util/keptQuery";
import { dbError, failed, ok } from "./statsFixtures";

// ---- fixtures -------------------------------------------------------------

const facets: Facet[] = [
  {
    id: "thing",
    name: "Thing",
    number: 1,
    tags: [],
    group: "",
    comment: "",
    description: "",
    eventCount: 10,
    coOccurrence: new Map(),
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

/** A block of the facet "thing" with `conditions` set. */
function thingBlock(...conditions: FacetBlock["conditions"]): FacetBlock {
  return { ...newBlock("thing"), conditions };
}

/** A query that can run: one block with one finished field, "Thing has size > n". */
function runnableQuery(n = 3): Group {
  const root = emptyQuery();
  return addChild(root, root.id, thingBlock(newFieldCondition("size", "gt", n)));
}

/** A query that cannot run yet: its one set field has no value ("Enter a value."). */
function unfinishedQuery(): Group {
  const root = emptyQuery();
  return addChild(root, root.id, thingBlock(newFieldCondition("size", "gt", null)));
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

const events: EventRecord[] = [{ id: "e-1", values: {} }];

/** What the server answers for a saved draft. */
function savedFrom(draft: SavedQueryDraft, id: string): SavedQuery {
  return { ...draft, id, updatedAt: "2026-10-08T10:00:00Z" };
}

/** A saved query as the list holds it. */
/** A saved-queries list in which every entry could be read. */
function listOf(...queries: SavedQuery[]): SavedQueryList {
  return { queries, unreadable: [] };
}

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
      log: '{\n  "reason": "audit"\n}',
    })),
    getStats: vi.fn(async () => {}),
    runQuery: vi.fn(async () => events),
    logout: vi.fn(async () => {}),
    invalidateCompliance: vi.fn(async () => {}),
    listSavedQueries: vi.fn(async () => listOf()),
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
  const showError = vi.fn();
  const app = createApp({ store, api, navigate, announce, showError });
  return { store, api, navigate, announce, showError, app };
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
    expect(store.getState().preview).toEqual({ status: "ok", events, page: 0 });
  });

  it("a 401 saves the query and goes to log in", async () => {
    const api = fakeApi({ runQuery: vi.fn(async () => Promise.reject(new ApiError(401, "no"))) });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(readKeptQuery()).toEqual({
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
    expect(readKeptQuery()).not.toBeNull();
  });

  it("a 403 for another reason shows a plain message instead of redirecting", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "Not allowed here."))),
    });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({
      status: "error",
      error: "You don't have permission to do this. If you think you should, contact support.",
    });
  });

  it("a 403 whose compliance check fails shows the 403's plain message", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(403, "Forbidden."))),
      getComplianceStatus: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    const { app, navigate, store } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().preview).toEqual({
      status: "error",
      error: "You don't have permission to do this. If you think you should, contact support.",
    });
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
    expect(store.getState().preview).toEqual({
      status: "error",
      error: "Something went wrong. Try again; if it keeps happening, reload the page.",
    });
  });

  // The panel repaints out of sight of a screen-reader user, and their focus
  // may be elsewhere: they hear that the run started and how it ended.
  it("tells screen-reader users the run started and what came back", async () => {
    const { app, announce } = setup(ready());
    app.runPreview();
    expect(announce).toHaveBeenLastCalledWith("Fetching events…");
    await flushPromises();
    expect(announce.mock.calls).toEqual([["Fetching events…"], ["Showing 1 result."]]);
  });

  it("tells screen-reader users about a failed run", async () => {
    const api = fakeApi({ runQuery: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const { app, announce } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(announce).toHaveBeenLastCalledWith(
      "Couldn't load events: Something went wrong. Try again; if it keeps happening, reload the page.",
    );
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
    expect(previewAnnouncement({ status: "ok", events: [], page: 0 })).toBe(
      "No events match this query.",
    );
    expect(previewAnnouncement({ status: "ok", events, page: 0 })).toBe("Showing 1 result.");
    expect(previewAnnouncement({ status: "ok", events: [...events, ...events], page: 0 })).toBe(
      "Showing 2 results.",
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
      { nodeId: "c1", message: "Too long.", kind: "invalid", fromServer: true },
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

  /** Two blocks, each with one finished field: the server's problem goes on
   *  the first block's condition, the edits on the second block. */
  function twoBlockQuery() {
    const first = thingBlock(newFieldCondition("size", "gt", 1));
    const second = thingBlock(newFieldCondition("size", "gt", 2));
    const root = emptyQuery();
    const query = addChild(addChild(root, root.id, first), root.id, second);
    const problemId = first.conditions[0]!.id;
    const editSecond = (q: Group, n: number) =>
      setFieldCondition(q, second.id, newFieldCondition("size", "gt", n));
    return { query, problemId, editSecond, first };
  }

  it("keeps a problem on a node an edit did not touch, so the builder doesn't repaint (#76)", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { query, problemId, editSecond } = twoBlockQuery();
    const { app, store } = setup(ready(query), api);
    app.onQueryChange(editSecond(query, 5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    calls[0]!.onLine(failed("alpha", dbError(problemId, "Too long.")));
    expect(store.getState().serverIssues).toHaveLength(1);

    app.onQueryChange(editSecond(store.getState().query, 6));
    expect(store.getState().serverIssues).toHaveLength(1);
    // Run stays blocked by the problem, but the statistics still go out.
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    const setState = vi.spyOn(store, "setState");
    calls[1]!.onLine(failed("alpha", dbError(problemId, "Too long.")));
    expect(setState.mock.calls.map(([patch]) => Object.keys(patch))).toEqual([["stats"]]);
  });

  it("drops a carried problem once the new statistics finish without it", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { query, problemId, editSecond } = twoBlockQuery();
    const { app, store } = setup(ready(query), api);
    app.onQueryChange(editSecond(query, 5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    calls[0]!.onLine(failed("alpha", dbError(problemId, "Too long.")));

    app.onQueryChange(editSecond(store.getState().query, 6));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    calls[1]!.onLine(ok("alpha", 3));
    expect(store.getState().serverIssues).toHaveLength(1); // still streaming
    calls[1]!.done.resolve();
    await flushPromises();
    expect(store.getState().serverIssues).toEqual([]);
  });

  it("drops a problem at once when its own node is edited, or the databases change", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { query, problemId, editSecond, first } = twoBlockQuery();
    const { app, store } = setup(ready(query), api);
    app.onQueryChange(editSecond(query, 5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    calls[0]!.onLine(failed("alpha", dbError(problemId, "Too long.")));

    const edited = setFieldCondition(store.getState().query, first.id, {
      ...first.conditions[0]!,
      value: 9,
    });
    app.onQueryChange(edited);
    expect(store.getState().serverIssues).toEqual([]);

    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    calls[1]!.onLine(failed("alpha", dbError(problemId, "Too long.")));
    app.onDatabasesChange(["alpha"]);
    expect(store.getState().serverIssues).toEqual([]);
  });

  it("abandons a running Run query when a database then finds a problem (#81)", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const run = deferred<EventRecord[]>();
    let runSignal: AbortSignal | undefined;
    api.runQuery = vi.fn((_q: Group, _ids: string[], signal?: AbortSignal) => {
      runSignal = signal;
      return run.promise;
    });
    const { query, problemId, editSecond } = twoBlockQuery();
    const { app, store, announce } = setup(ready(query), api);
    app.onQueryChange(editSecond(query, 5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    app.runPreview();
    expect(store.getState().preview.status).toBe("loading");

    calls[0]!.onLine(failed("alpha", dbError(problemId, "Too long.")));
    expect(store.getState().preview).toEqual({ status: "idle" });
    expect(runSignal?.aborted).toBe(true);
    run.resolve(events);
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "idle" });
    expect(announce.mock.calls).toEqual([["Fetching events…"]]);
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
    expect(store.getState().stats).toMatchObject({
      status: "error",
      error: "Something went wrong. Try again; if it keeps happening, reload the page.",
    });
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
    app.onQueryChange(unfinishedQuery());
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });
});

describe("Matching events pages and the event dialog", () => {
  const many: EventRecord[] = Array.from({ length: 250 }, (_, i) => ({ id: `e-${i}`, values: {} }));
  const shownMany = (): Partial<AppState> => ({
    ...ready(),
    preview: { status: "ok", events: many, page: 0 },
  });

  it("a run starts at the first page", async () => {
    const { app, store } = setup(ready(), fakeApi({ runQuery: vi.fn(async () => many) }));
    app.runPreview();
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "ok", events: many, page: 0 });
  });

  it("shows another page and says which results are shown", () => {
    const { app, store, announce } = setup(shownMany());
    app.showEventPage(2);
    expect(store.getState().preview).toMatchObject({ page: 2 });
    expect(announce).toHaveBeenCalledWith("Showing results 201 to 250 of 250.");
  });

  // Numbers follow the viewer's language ("1,987" or "1.987"), like the paging line.
  it("writes the numbers of the announcement with the app's digit grouping", () => {
    const thousands: EventRecord[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `t-${i}`,
      values: {},
    }));
    const { app, announce } = setup({
      ...ready(),
      preview: { status: "ok", events: thousands, page: 0 },
    });
    app.showEventPage(1);
    expect(announce).toHaveBeenCalledWith("Showing results 101 to 200 of 2\u00a0500.");
    expect(previewAnnouncement({ status: "ok", events: thousands, page: 0 })).toBe(
      "Showing 2\u00a0500 results.",
    );
  });

  it("starting a run closes the open event with the results it showed", async () => {
    const response = deferred<EventRecord[]>();
    const { app, store } = setup(
      { ...shownMany(), openEventId: "e-3" },
      fakeApi({ runQuery: vi.fn(() => response.promise) }),
    );
    app.runPreview();
    expect(store.getState()).toMatchObject({ preview: { status: "loading" }, openEventId: null });
  });

  it("clamps a page that does not exist, and does nothing for the page on screen", () => {
    const { app, store, announce } = setup(shownMany());
    app.showEventPage(9);
    expect(store.getState().preview).toMatchObject({ page: 2 });
    announce.mockClear();
    app.showEventPage(2);
    expect(announce).not.toHaveBeenCalled();
  });

  it("a query edit resets the page and closes the dialog with the results", () => {
    const { app, store } = setup({ ...shownMany(), openEventId: "e-3" });
    app.onQueryChange(runnableQuery(9));
    expect(store.getState().preview).toEqual({ status: "idle" });
    expect(store.getState().openEventId).toBeNull();
  });

  it("opens the dialog for a shown event only, and closes it", () => {
    const { app, store } = setup(shownMany());
    app.openEvent("ghost");
    expect(store.getState().openEventId).toBeNull();
    app.openEvent("e-3");
    expect(store.getState().openEventId).toBe("e-3");
    app.closeEvent();
    expect(store.getState().openEventId).toBeNull();
  });
});

// ---- query and database changes -------------------------------------------

describe("query and database changes", () => {
  const shown: Partial<AppState> = { preview: { status: "ok", events, page: 0 } };

  it("an edit clears the preview at once and revalidates", () => {
    const { app, store } = setup({ ...ready(), ...shown });
    const unfinished = unfinishedQuery();
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

// ---- log out / withdraw compliance --------------------------------------

describe("logging out and invalidating compliance", () => {
  const signedIn: Partial<AppState> = {
    ...ready(),
    preview: { status: "ok", events, page: 0 },
    auth: { status: "authenticated", user: { name: "pat" } },
    compliance: { status: "acknowledged", log: "{}" },
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

  it("says so when logging out fails", async () => {
    const api = fakeApi({ logout: vi.fn(async () => Promise.reject(new ApiError(500, "x"))) });
    const { app, store, showError } = setup(signedIn, api);
    app.onLogout();
    await flushPromises();
    expect(store.getState().auth.status).toBe("authenticated");
    expect(showError).toHaveBeenCalledWith("Couldn't log out. Try again.");
  });

  it("says so when invalidating the compliance reason fails", async () => {
    const api = fakeApi({
      invalidateCompliance: vi.fn(async () => Promise.reject(new ApiError(500, "x"))),
    });
    const { app, showError } = setup(signedIn, api);
    app.onWithdrawCompliance();
    await flushPromises();
    expect(showError).toHaveBeenCalledWith("Couldn't withdraw the compliance reason. Try again.");
  });

  // A browser that restores its last session brings sessionStorage back, so
  // the copy would outlive the user on a shared machine (maintainers,
  // 2026-10-13). The query stays on screen: building on anonymously is fine.
  it("a successful logout forgets the kept query but leaves the query on screen", async () => {
    const { app, store } = setup(signedIn);
    keepQuery(store.getState().query, ["alpha"]);
    const onScreen = store.getState().query;
    app.onLogout();
    await flushPromises();
    expect(readKeptQuery()).toBeNull();
    expect(store.getState().query).toBe(onScreen);
  });

  it("a failed logout keeps the kept query", async () => {
    const api = fakeApi({ logout: vi.fn(async () => Promise.reject(new ApiError(500, "x"))) });
    const { app, store } = setup(signedIn, api);
    keepQuery(store.getState().query, ["alpha"]);
    app.onLogout();
    await flushPromises();
    expect(readKeptQuery()).not.toBeNull();
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
    app.onWithdrawCompliance();
    expect(store.getState().preview).toEqual({ status: "idle" });
    await flushPromises();
    expect(api.invalidateCompliance).toHaveBeenCalled();
    expect(store.getState().compliance.status).toBe("required");
    expect(store.getState().auth.status).toBe("authenticated");
  });
});

// ---- startup --------------------------------------------------------------

describe("start", () => {
  it("loads everything, selects every database and starts with an empty query", async () => {
    const { app, store } = setup();
    await app.start(false);
    const s = store.getState();
    expect(s.catalog).toEqual(catalog);
    expect(s.databases).toBe(databases);
    expect(s.facets).toBe(facets);
    expect(s.selectedDatabaseIds).toEqual(["alpha", "beta"]);
    // No seed row any more: the footer says "Add a facet to start…", and the
    // empty query is "not finished", not invalid (no issue, a normal mascot).
    expect(s.query).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(s.issues).toEqual([]);
    expect(s.auth).toMatchObject({ status: "authenticated", user: { name: "pat" } });
    expect(s.compliance).toMatchObject({
      status: "acknowledged",
      log: expect.stringContaining("audit"),
    });
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

  it("after a login/compliance redirect, restores the kept query, without a notice", async () => {
    vi.useFakeTimers();
    const kept = runnableQuery(9);
    keepQuery(kept, ["beta", "no-longer-exists"]);
    const { app, api, store, announce } = setup();
    await app.start(true);
    expect(store.getState().query).toEqual(kept);
    expect(store.getState().selectedDatabaseIds).toEqual(["beta"]);
    expect(store.getState().issues).toEqual([]);
    // The user expects their query back after logging in: no Restored notice.
    // (The database that no longer exists is still said: that is news.)
    expect(store.getState().restoredNotice).toBe(false);
    expect(announce).not.toHaveBeenCalledWith(RESTORED_MESSAGE);
    expect(store.getState().dropNotice).toBe(
      "1 selected database no longer exists and was left out.",
    );
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it("a normal load (a reload, a Back) restores the kept query and says so", async () => {
    vi.useFakeTimers();
    const kept = runnableQuery(9);
    keepQuery(kept, ["beta", "no-longer-exists"]);
    const { app, api, store, announce } = setup();
    await app.start(false);
    expect(store.getState().query).toEqual(kept);
    expect(store.getState().selectedDatabaseIds).toEqual(["beta"]);
    expect(store.getState().restoredNotice).toBe(true);
    expect(announce).toHaveBeenCalledWith(RESTORED_MESSAGE);
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it("a normal load does not bring back a query in which nothing was chosen", async () => {
    // Only an ALL/ANY switch and an empty group: no facet.
    const blank: Group = { ...emptyQuery(), operator: "OR", children: [newGroup()] };
    keepQuery(blank, ["beta"]);
    const { app, store, announce } = setup();
    await app.start(false);
    expect(store.getState().selectedDatabaseIds).toEqual(["alpha", "beta"]);
    expect(store.getState().query).not.toEqual(blank); // a fresh start
    expect(store.getState().restoredNotice).toBe(false);
    expect(announce).not.toHaveBeenCalled();
  });

  it("on the return hop, restores even a copy in which nothing was chosen", async () => {
    const blank: Group = { ...emptyQuery(), operator: "OR", children: [newGroup()] };
    keepQuery(blank, ["beta"]);
    const { app, store } = setup();
    await app.start(true);
    expect(store.getState().query).toEqual(blank);
    expect(store.getState().selectedDatabaseIds).toEqual(["beta"]);
  });

  // Old queries are not migrated (spec, decision 9): a copy kept by the build
  // before facet blocks fails the structural check, and the app starts fresh.
  it("drops a kept query in the shape before facet blocks, without a word", async () => {
    const oldShape = {
      kind: "group",
      id: "g1",
      operator: "AND",
      children: [
        {
          kind: "condition",
          id: "c1",
          facetId: "thing",
          fieldId: "size",
          operatorId: "gt",
          value: 3,
        },
      ],
    };
    sessionStorage.setItem(
      "qb:kept-query",
      JSON.stringify({ query: oldShape, selectedDatabaseIds: ["beta"] }),
    );
    const { app, store, announce } = setup();
    await app.start(true);
    expect(store.getState().query.children).toEqual([]);
    expect(store.getState().selectedDatabaseIds).toEqual(["alpha", "beta"]);
    expect(store.getState().restoredNotice).toBe(false);
    expect(announce).not.toHaveBeenCalled();
    // The first state replaces the old copy, so it is dropped only once.
    expect(readKeptQuery()?.query).toEqual(store.getState().query);
  });

  it("says which databases from before no longer exist", async () => {
    keepQuery(runnableQuery(9), ["beta", "gone-1", "gone-2"]);
    const { app, store } = setup();
    await app.start(false);
    expect(store.getState().selectedDatabaseIds).toEqual(["beta"]);
    expect(store.getState().dropNotice).toBe(
      "2 selected databases no longer exist and were left out.",
    );
  });

  it("restores a query whose databases are all gone, with none selected, and says so", async () => {
    keepQuery(runnableQuery(9), ["gone"]);
    const { app, store } = setup();
    await app.start(false);
    expect(store.getState().selectedDatabaseIds).toEqual([]);
    expect(store.getState().dropNotice).toBe(
      "1 selected database no longer exists and was left out.",
    );
  });

  it("a load that fails leaves the kept query for the next try", async () => {
    const kept = runnableQuery(9);
    keepQuery(kept, ["beta"]);
    const api = fakeApi({ getFacets: vi.fn(async () => Promise.reject(new Error("down"))) });
    const { app } = setup({}, api);
    await expect(app.start(false)).rejects.toThrow("down");
    expect(readKeptQuery()).toEqual({ query: kept, selectedDatabaseIds: ["beta"] });
  });

  it("keeps the first state at once, so a reload straight away finds it", async () => {
    const { app, store } = setup();
    await app.start(false);
    expect(readKeptQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha", "beta"],
    });
  });
});

describe("the kept query", () => {
  it("is rewritten on every change to the query or the databases", () => {
    const { app, store } = setup(ready());
    const next = runnableQuery(3);
    app.onQueryChange(next);
    expect(readKeptQuery()?.query).toEqual(next);
    app.onDatabasesChange(["alpha"]);
    expect(readKeptQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha"],
    });
  });
});

describe("the Restored notice", () => {
  const restored = () => setup({ ...ready(), restoredNotice: true });

  it("Start fresh puts back the empty starting query with every database", () => {
    const { app, store } = restored();
    app.onDatabasesChange(["alpha"]); // something to undo besides the query
    store.setState({ restoredNotice: true });
    app.startFresh();
    const s = store.getState();
    expect(s.restoredNotice).toBe(false);
    expect(s.selectedDatabaseIds).toEqual(["alpha", "beta"]);
    expect(s.query).toMatchObject({ kind: "group", children: [] });
    expect(s.issues).toEqual([]);
    expect(s.stats).toEqual({ status: "idle", results: [] });
    // What is kept now is the blank start, which a reload won't bring back.
    expect(readKeptQuery()?.query).toEqual(s.query);
  });

  // A save while the notice is up sets `openSaved` without an edit, so the
  // notice is still there: a fresh start must not stay tied to that saved query.
  it("Start fresh forgets which saved query was open, and says what happened", () => {
    const { app, store, announce } = setup({
      ...ready(),
      restoredNotice: true,
      openSaved: openFrom(savedQuery("sq-1", "Weekly")),
    });
    app.startFresh();
    expect(store.getState().openSaved).toBeNull();
    expect(announce).toHaveBeenCalledWith(STARTED_FRESH_MESSAGE);
  });

  it("the ✕ only hides it; the query stays", () => {
    const { app, store } = restored();
    const before = store.getState().query;
    app.dismissRestoredNotice();
    expect(store.getState().restoredNotice).toBe(false);
    expect(store.getState().query).toBe(before);
  });

  // Editing means carrying on with the restored query: the offer is settled.
  it("goes away with the first change to the query or the databases", () => {
    const edited = restored();
    edited.app.onQueryChange(runnableQuery(4));
    expect(edited.store.getState().restoredNotice).toBe(false);
    const scoped = restored();
    scoped.app.onDatabasesChange(["alpha"]);
    expect(scoped.store.getState().restoredNotice).toBe(false);
  });
});

describe("dropping docs items", () => {
  it("a facet drop adds a block with nothing set ('Thing present') and validates it", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    const q = store.getState().query;
    expect(q.children).toHaveLength(1);
    expect(q.children[0]).toMatchObject({
      kind: "facet",
      facetId: "thing",
      negated: false,
      conditions: [],
    });
    expect(store.getState().issues).toEqual([]);
    expect(store.getState().dropNotice).toBeNull();
    expect(store.getState().openField).toBeNull();
  });

  it("announces what was added, for screen readers", () => {
    const { store, app, announce } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Added 1 facet to the query.");
  });

  it("announces a move", () => {
    const root = emptyQuery();
    const block = newBlock("thing");
    const g = newGroup();
    const { app, announce } = setup({
      ...ready(addChild(addChild(root, root.id, block), root.id, g)),
    });
    app.onDropItem({ type: "node", nodeId: block.id }, g.id);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Moved the facet.");
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
    expect(announce).toHaveBeenCalledExactlyOnceWith("Added 1 facet to the query.");
  });

  it("moving a node onto the spot it already holds changes and announces nothing", () => {
    // The last child dropped on its own parent goes "to the end of the group":
    // where it already is.
    const root = emptyQuery();
    const last = newBlock("thing");
    const q = addChild(addChild(root, root.id, newBlock("thing")), root.id, last);
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
    const block = q.children[0]!;
    const { store, app } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: block.id }, block.id);
    expect(store.getState().query).toBe(q);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("a block dropped on another block lands just before it", () => {
    const root = emptyQuery();
    const [first, second] = [newBlock("thing"), newBlock("thing")];
    const q = addChild(addChild(root, root.id, first), root.id, second);
    const { store, app } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: second.id }, first.id);
    expect(store.getState().query.children.map((n) => n.id)).toEqual([second.id, first.id]);
  });

  describe("a field or a value, which is about one row of a block", () => {
    // "size" with known values, so a value can be dragged from the dictionary.
    const valued: Facet[] = [
      {
        ...facets[0]!,
        fields: [{ ...facets[0]!.fields[0]!, values: ["3", "4"] }],
      },
    ];
    const withBlock = (block: FacetBlock) => {
      const root = emptyQuery();
      return setup({
        ...ready(addChild(root, root.id, block)),
        facets: valued,
        catalog: buildFieldCatalog(valued),
      });
    };

    it("a field dropped on a block of its facet opens its row and adds nothing", () => {
      const block = newBlock("thing");
      const { store, app, announce } = withBlock(block);
      const before = store.getState().query;
      app.onDropItem({ type: "field", facetId: "thing", fieldId: "size" }, block.id);
      expect(store.getState().query).toBe(before);
      expect(store.getState().openField).toEqual({ blockId: block.id, fieldId: "size" });
      expect(announce).toHaveBeenCalledExactlyOnceWith("Showing size in Thing.");
    });

    // The builder moves the keyboard focus into that row after a mouse drop,
    // so onDropItem says which row it opened.
    it("onDropItem returns the row it opened, and null when it opened none", () => {
      const block = newBlock("thing");
      const { app } = withBlock(block);
      const field = { type: "field", facetId: "thing", fieldId: "size" } as const;
      expect(app.onDropItem(field, block.id)).toEqual({ blockId: block.id, fieldId: "size" });
      expect(app.onDropItem({ type: "facet", facetId: "thing" }, block.id)).toBeNull();
      expect(app.onDropItem(null, block.id)).toBeNull();
    });

    it("unfolds a folded block to show the row a field drop opened", () => {
      const block = { ...newBlock("thing"), collapsed: true };
      const { store, app } = withBlock(block);
      app.onDropItem({ type: "field", facetId: "thing", fieldId: "size" }, block.id);
      expect(store.getState().query.children[0]).toMatchObject({ collapsed: false });
    });

    it("a field dropped anywhere else adds a block and opens its row", () => {
      const { store, app, announce } = setup({ ...ready(emptyQuery()) });
      app.onDropItem(
        { type: "field", facetId: "thing", fieldId: "size" },
        store.getState().query.id,
      );
      const added = store.getState().query.children[0] as FacetBlock;
      expect(added).toMatchObject({ kind: "facet", facetId: "thing", conditions: [] });
      expect(store.getState().openField).toEqual({ blockId: added.id, fieldId: "size" });
      expect(announce).toHaveBeenCalledExactlyOnceWith("Added 1 facet to the query.");
    });

    it("a value dropped on an unset row fills it, and says so", () => {
      const block = newBlock("thing");
      const { store, app, announce } = withBlock(block);
      app.onDropItem({ type: "value", facetId: "thing", fieldId: "size", value: "3" }, block.id);
      expect(store.getState().query.children[0]).toMatchObject({
        id: block.id,
        conditions: [{ fieldId: "size", operatorId: "eq", value: 3 }],
      });
      expect(store.getState().issues).toEqual([]);
      expect(store.getState().openField).toEqual({ blockId: block.id, fieldId: "size" });
      expect(announce).toHaveBeenCalledExactlyOnceWith("Set size to 3.");
    });

    it("a value dropped on a set row becomes a block of its own, beside it, and says why", () => {
      const block = thingBlock(newFieldCondition("size", "gt", 1));
      const { store, app, announce } = withBlock(block);
      app.onDropItem({ type: "value", facetId: "thing", fieldId: "size", value: "4" }, block.id);
      const [added, kept] = store.getState().query.children as FacetBlock[];
      expect(kept).toEqual(block); // nothing the user chose is overwritten
      expect(added).toMatchObject({ conditions: [{ fieldId: "size", value: 4 }] });
      expect(store.getState().openField).toEqual({ blockId: added!.id, fieldId: "size" });
      expect(announce).toHaveBeenCalledExactlyOnceWith(
        "Added 1 facet to the query, beside the one that already sets size.",
      );
    });
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
      const block = newBlock("thing");
      const withBlock = addChild(query, query.id, block);
      const { store, app } = setup({ ...ready(withBlock) });
      app.onDropItem({ type: "node", nodeId: block.id }, groupId);
      const g = groupOf(store.getState().query, groupId);
      expect(g).toMatchObject({ collapsed: false });
      expect(g?.kind === "group" && g.children.at(-1)?.id).toBe(block.id);
    });

    it("stays collapsed when a move is refused", () => {
      const { query, groupId } = withCollapsedGroup();
      const { store, app } = setup({ ...ready(query) });
      app.onDropItem({ type: "node", nodeId: "no-such-node" }, groupId);
      expect(groupOf(store.getState().query, groupId)).toMatchObject({ collapsed: true });
    });
  });

  it("onAddItem puts the item at the end of the root group, which keeps its ALL/ANY", () => {
    const anyRoot: Group = { ...runnableQuery(), operator: "OR" };
    const { store, app } = setup({ ...ready(anyRoot) });
    app.onAddItem({ type: "field", facetId: "thing", fieldId: "size" });
    const q = store.getState().query;
    expect(q.operator).toBe("OR");
    expect(q.children).toHaveLength(2);
    expect(q.children[1]).toMatchObject({ kind: "facet", facetId: "thing" });
  });

  it("Add all on a tag puts one ALL group of blocks at the end of the root and says so", () => {
    const tagged: Facet[] = [
      { ...facets[0]!, id: "one", name: "One", tags: ["t"] },
      { ...facets[0]!, id: "two", name: "Two", tags: ["t"] },
    ];
    const { app, store, announce } = setup({
      ...ready(),
      facets: tagged,
      catalog: buildFieldCatalog(tagged),
    });
    const before = store.getState().query.children.length;
    app.onAddItem({ type: "tag", tag: "t" });
    const { children } = store.getState().query;
    expect(children).toHaveLength(before + 1);
    const group = children.at(-1);
    expect(group).toMatchObject({ kind: "group", operator: "AND" });
    expect(group?.kind === "group" && group.children).toEqual([
      expect.objectContaining({ kind: "facet", facetId: "one", conditions: [] }),
      expect.objectContaining({ kind: "facet", facetId: "two", conditions: [] }),
    ]);
    expect(announce).toHaveBeenCalledWith("Added a group of 2 facets to the query.");
  });

  it("with no docs loaded yet, says so instead of ignoring the drop", () => {
    const { store, app } = setup({});
    app.onAddItem({ type: "facet", facetId: "thing" });
    expect(store.getState().dropNotice).toBe(
      "The data dictionary is still loading; try again in a moment.",
    );
  });
});

describe("the field row being worked on, and folded field lists", () => {
  // Neither is a query edit: the statistics, the results and the Restored
  // notice stay, and nothing is fetched again.
  const shown: Partial<AppState> = {
    ...ready(),
    preview: { status: "ok", events, page: 0 },
    restoredNotice: true,
  };

  it("openFieldRow opens a row, and null closes it", async () => {
    vi.useFakeTimers();
    const { app, api, store } = setup(shown);
    const ref = { blockId: "f-1", fieldId: "size" };
    app.openFieldRow(ref);
    expect(store.getState().openField).toEqual(ref);
    app.openFieldRow(null);
    expect(store.getState().openField).toBeNull();
    expect(store.getState()).toMatchObject({ preview: shown.preview, restoredNotice: true });
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });

  it("opening the row that is already open repaints nothing", () => {
    const { app, store } = setup(shown);
    app.openFieldRow({ blockId: "f-1", fieldId: "size" });
    const seen = vi.fn();
    store.subscribe(seen);
    app.openFieldRow({ blockId: "f-1", fieldId: "size" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("toggleFields opens a block's folded fields, and closes them again", async () => {
    vi.useFakeTimers();
    const { app, api, store } = setup({ ...shown, expandedBlockIds: ["other"] });
    app.toggleFields("f-1");
    expect(store.getState().expandedBlockIds).toEqual(["other", "f-1"]);
    app.toggleFields("f-1");
    expect(store.getState().expandedBlockIds).toEqual(["other"]);
    expect(store.getState()).toMatchObject({ preview: shown.preview, restoredNotice: true });
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });
});

describe("the panel beside each block", () => {
  // Display state: switching tabs or selecting a field is no query edit, so
  // the statistics and results stay and nothing is fetched again.
  const shown: Partial<AppState> = {
    ...ready(),
    preview: { status: "ok", events, page: 0 },
    restoredNotice: true,
  };

  it("setPanelTab switches the tab, and pressing the open one hides the panel", async () => {
    vi.useFakeTimers();
    const { app, api, store } = setup(shown);
    app.setPanelTab("about", false);
    expect(store.getState().panelTab).toBe("about");
    app.setPanelTab("about", true);
    expect(store.getState().panelTab).toBeNull();
    app.setPanelTab("seen", false);
    expect(store.getState().panelTab).toBe("seen");
    app.toggleCoNames();
    expect(store.getState().coNamesShown).toBe(true);
    expect(store.getState()).toMatchObject({ preview: shown.preview, restoredNotice: true });
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).not.toHaveBeenCalled();
  });

  // A cell or box of the co-occurrence row opens the dictionary at its facet
  // (main.ts then opens and focuses the facet's card).
  it("showFacetInDictionary unfolds a folded dictionary for a facet it knows", () => {
    const { app, store } = setup({ ...shown, sidebarCollapsed: true });
    expect(app.showFacetInDictionary("thing")).toBe(true);
    expect(store.getState().sidebarCollapsed).toBe(false);
    expect(store.getState()).toMatchObject({ preview: shown.preview, restoredNotice: true });
  });

  it("showFacetInDictionary leaves the dictionary alone for a facet it does not know", () => {
    const { app, store } = setup({ ...shown, sidebarCollapsed: true });
    expect(app.showFacetInDictionary("gone")).toBe(false);
    expect(store.getState().sidebarCollapsed).toBe(true);
  });

  it("selectFieldForPanel selects a field for About, and null goes back to the facet", () => {
    const { app, store } = setup(shown);
    const ref = { blockId: "f-1", fieldId: "size" };
    app.selectFieldForPanel(ref);
    expect(store.getState().selectedField).toEqual(ref);
    expect(store.getState().openField).toBeNull();
    app.selectFieldForPanel(null);
    expect(store.getState().selectedField).toBeNull();
  });

  // Every focus move inside a row asks again: only a change may repaint.
  it("selecting the field that is already selected changes nothing", () => {
    const { app, store } = setup(shown);
    app.selectFieldForPanel({ blockId: "f-1", fieldId: "size" });
    const seen = vi.fn();
    store.subscribe(seen);
    app.selectFieldForPanel({ blockId: "f-1", fieldId: "size" });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("display state follows the query", () => {
  // `openField` and `expandedBlockIds` point at blocks of the query; they
  // must not outlive the block or the query they were made for.
  const block = thingBlock(newFieldCondition("size", "gt", 3));
  const kept = addChild(emptyQuery(), emptyQuery().id, block);
  const query = { ...emptyQuery(), children: [block] };
  const shownBlock: Partial<AppState> = {
    ...ready(query),
    openField: { blockId: block.id, fieldId: "size" },
    expandedBlockIds: [block.id],
    selectedField: { blockId: block.id, fieldId: "label" },
  };

  it("removing the block drops its open row, its open fields and its selected field", () => {
    const { app, store } = setup(shownBlock);
    app.onQueryChange(removeNode(store.getState().query, block.id));
    expect(store.getState().openField).toBeNull();
    expect(store.getState().expandedBlockIds).toEqual([]);
    expect(store.getState().selectedField).toBeNull();
  });

  it("an edit that keeps the block keeps them", () => {
    const { app, store } = setup(shownBlock);
    app.onQueryChange(setNegated(store.getState().query, block.id, true));
    expect(store.getState().openField).toEqual({ blockId: block.id, fieldId: "size" });
    expect(store.getState().expandedBlockIds).toEqual([block.id]);
  });

  it("Start fresh drops them with the old query", () => {
    const { app, store } = setup({ ...shownBlock, restoredNotice: true });
    app.startFresh();
    expect(store.getState().openField).toBeNull();
    expect(store.getState().expandedBlockIds).toEqual([]);
    expect(store.getState().selectedField).toBeNull();
  });

  it("opening a saved query drops them with the old query", () => {
    const target = savedQuery("t", "Weekly");
    const { app, store } = setup({
      ...shownBlock,
      auth: { status: "authenticated", user: { name: "pat" } },
      savedDialog: "list",
      savedList: { status: "ok", queries: [target], unreadable: [] },
    });
    app.askOpenSaved("t");
    // The query on screen is unsaved work: the app asks first.
    app.confirmSavedAction();
    expect(store.getState().query).toBe(target.query);
    expect(store.getState().openField).toBeNull();
    expect(store.getState().expandedBlockIds).toEqual([]);
    expect(store.getState().selectedField).toBeNull();
  });

  it("a restored query starts with none", async () => {
    keepQuery(kept, ["beta"]);
    const { app, store } = setup({
      openField: { blockId: block.id, fieldId: "size" },
      expandedBlockIds: [block.id],
    });
    await app.start(true);
    expect(store.getState().openField).toBeNull();
    expect(store.getState().expandedBlockIds).toEqual([]);
  });
});

// ---- saved queries --------------------------------------------------------

describe("saved queries: opening the dialogs", () => {
  it("asks an anonymous visitor to log in first instead of leaving at once", () => {
    const { app, navigate, store } = setup({
      ...ready(emptyQuery()),
      auth: { status: "anonymous" },
    });
    app.openSaveDialog();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().savedDialog).toBe("login-to-save");
  });

  it("does the same for the list, without asking the server", () => {
    const { app, navigate, api, store } = setup({ ...ready(), auth: { status: "anonymous" } });
    app.openSavedList();
    expect(navigate).not.toHaveBeenCalled();
    expect(api.listSavedQueries).not.toHaveBeenCalled();
    expect(store.getState().savedDialog).toBe("login-to-list");
  });

  it("Log in in that dialog goes to log in, keeping the query (even a blank one)", () => {
    const { app, navigate, store } = setup({
      ...ready(emptyQuery()),
      auth: { status: "anonymous" },
      savedDialog: "login-to-save",
    });
    app.logInToSave();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(readKeptQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha", "beta"],
    });
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
      fakeApi({ listSavedQueries: vi.fn(async () => listOf(...queries)) }),
    );
    app.openSavedList();
    expect(store.getState().savedDialog).toBe("list");
    expect(store.getState().savedList).toEqual({ status: "loading" });
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries, unreadable: [] });
  });

  it("keeps the saved queries that could not be read, for the dialog to list", async () => {
    const queries = [savedQuery("a", "Weekly")];
    const old = { id: "sq-old", name: "Old" };
    const { app, store } = setup(
      ready(),
      fakeApi({ listSavedQueries: vi.fn(async () => ({ queries, unreadable: [old, old] })) }),
    );
    app.openSavedList();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries, unreadable: [old, old] });
  });

  it("shows a failed list load and loads again on retry", async () => {
    const list = vi
      .fn<AppApi["listSavedQueries"]>()
      .mockRejectedValueOnce(new ApiError(500, "down"))
      .mockResolvedValueOnce(listOf());
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: list }));
    app.openSavedList();
    await flushPromises();
    expect(store.getState().savedList).toEqual({
      status: "error",
      error:
        "The server ran into a problem. Try again in a moment; if it keeps happening, contact support.",
    });
    app.retrySavedList();
    expect(store.getState().savedList).toEqual({ status: "loading" });
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [], unreadable: [] });
  });

  it("a 401 on the list redirects to log in", async () => {
    const api = fakeApi({
      listSavedQueries: vi.fn(async () => Promise.reject(new ApiError(401, "no"))),
    });
    const { app, navigate } = setup(ready(), api);
    app.openSavedList();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(readKeptQuery()).not.toBeNull();
  });

  it("ignores a slow list answer once a newer load started", async () => {
    const slow = deferred<SavedQueryList>();
    const list = vi
      .fn<AppApi["listSavedQueries"]>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(listOf(savedQuery("b", "Newer")));
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: list }));
    app.openSavedList();
    app.retrySavedList();
    await flushPromises();
    slow.resolve(listOf(savedQuery("a", "Older")));
    await flushPromises();
    expect(store.getState().savedList).toMatchObject({ status: "ok", queries: [{ id: "b" }] });
  });

  it("closing the dialog resets it and drops a pending load", async () => {
    const slow = deferred<SavedQueryList>();
    const { app, store } = setup(ready(), fakeApi({ listSavedQueries: vi.fn(() => slow.promise) }));
    app.openSavedList();
    app.closeSavedDialog();
    slow.resolve(listOf(savedQuery("a", "Weekly")));
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

  it("shows the query just saved as not edited, though the answer's nodes have other ids", async () => {
    // A saved query is read back with fresh node ids ("Saved queries"), so the
    // open query must remember the tree that was sent, not the one answered.
    const api = fakeApi({
      createSavedQuery: vi.fn(async (draft: SavedQueryDraft) => ({
        ...savedFrom(draft, "new"),
        query: { ...draft.query, id: "g-read-back" },
      })),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    const { openSaved, query, selectedDatabaseIds } = store.getState();
    expect(openSaved).toMatchObject({ id: "new", name: "Weekly" });
    expect(isEdited(openSaved!, query, selectedDatabaseIds)).toBe(false);
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

  it("creates it again when the open query was deleted elsewhere (the update answers 404)", async () => {
    const open = savedQuery("gone", "Weekly", { databaseIds: ["alpha", "beta"] });
    const api = fakeApi({
      updateSavedQuery: vi.fn(async () =>
        Promise.reject(new ApiError(404, "No saved query with that id.")),
      ),
      createSavedQuery: vi.fn(async (draft: SavedQueryDraft) => savedFrom(draft, "fresh")),
    });
    const { app, store, announce } = setup(
      { ...ready(), ...loggedIn, savedDialog: "save", openSaved: openFrom(open) },
      api,
    );
    app.saveQuery("Weekly", "");
    await flushPromises();
    expect(api.updateSavedQuery).toHaveBeenCalledWith("gone", expect.anything());
    expect(api.createSavedQuery).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly" }));
    expect(store.getState()).toMatchObject({
      savedDialog: null,
      save: { status: "idle" },
      openSaved: { id: "fresh", name: "Weekly" },
    });
    expect(announce).toHaveBeenCalledWith("Saved “Weekly”.");
  });

  it("still shows another failed update in the dialog", async () => {
    const open = savedQuery("s1", "Weekly");
    const api = fakeApi({
      updateSavedQuery: vi.fn(async () => Promise.reject(new ApiError(500, "Broken"))),
    });
    const { app, store } = setup(
      { ...ready(), ...loggedIn, savedDialog: "save", openSaved: openFrom(open) },
      api,
    );
    app.saveQuery("Weekly", "");
    await flushPromises();
    expect(api.createSavedQuery).not.toHaveBeenCalled();
    expect(store.getState().save).toMatchObject({ status: "error" });
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
      listSavedQueries: vi.fn(async () => listOf(savedQuery("x", "Monthly"), clash)),
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
      listSavedQueries: vi.fn(async () => listOf()),
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
    expect(readKeptQuery()).not.toBeNull();
  });

  it("shows any other error in the dialog", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(500, "disk full"))),
    });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    expect(store.getState().save).toEqual({
      status: "error",
      error:
        "The server ran into a problem. Try again in a moment; if it keeps happening, contact support.",
    });
    expect(store.getState().savedDialog).toBe("save");
  });

  it("reports a failure that arrives after the dialog was closed as a toast (#84)", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store, showError } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.closeSavedDialog();
    expect(store.getState().save).toEqual({ status: "saving" });
    slow.reject(new ApiError(500, "late"));
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "idle" });
    expect(showError).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Couldn't save “Weekly”\. /),
    );
  });

  it("a 409 after the dialog was closed is a toast, not a question nobody sees", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store, showError } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    app.closeSavedDialog();
    slow.reject(new ApiError(409, "taken"));
    await flushPromises();
    expect(store.getState().save).toEqual({ status: "idle" });
    // No name box is on screen any more, so the toast says which name.
    expect(showError).toHaveBeenCalledExactlyOnceWith(
      "Not saved: another saved query already has this name (“Weekly”). Save again to replace it.",
    );
  });

  it("reopening during a save shows that save, and Save can't start a second one (#84)", async () => {
    const slow = deferred<SavedQuery>();
    const api = fakeApi({ createSavedQuery: vi.fn(() => slow.promise) });
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("A", "");
    app.closeSavedDialog();
    app.openSaveDialog();
    expect(store.getState().save).toEqual({ status: "saving" });
    app.saveQuery("B", "");
    expect(api.createSavedQuery).toHaveBeenCalledOnce();
    slow.resolve(savedQuery("a", "A"));
    await flushPromises();
    // The reopened form shows this save, so it closes with it.
    expect(store.getState().savedDialog).toBeNull();
    expect(store.getState().openSaved).toMatchObject({ id: "a" });
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
    store.setState({ savedList: { status: "ok", queries: [other], unreadable: [] } });
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
    savedList: { status: "ok", queries: [target], unreadable: [] },
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

  it("shows the opened query as not edited: the tree on screen is the one it remembers", () => {
    // Node ids are made fresh on every read of a saved query, so the
    // comparison must be with this very tree, never with another read of it.
    const { app, store } = setup({ ...loggedIn, ...inList, ...ready(emptyQuery()) });
    app.askOpenSaved("t");
    const { openSaved, query, selectedDatabaseIds } = store.getState();
    expect(isEdited(openSaved!, query, selectedDatabaseIds)).toBe(false);
  });

  it("resets the statistics and preview of the query it replaces", () => {
    const { app, store } = setup({
      ...loggedIn,
      ...inList,
      ...ready(emptyQuery()),
      stats: { status: "ok", results: [] },
      preview: { status: "ok", events, page: 0 },
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
      savedList: { status: "ok", queries: [many], unreadable: [] },
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
      savedList: { status: "ok", queries: [whole], unreadable: [] },
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
    const list = vi.fn<AppApi["listSavedQueries"]>().mockResolvedValue(listOf(b));
    const { app, api, store, announce } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a, b], unreadable: [] },
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
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [b], unreadable: [] });
    expect(announce).toHaveBeenCalledWith("Deleted “Weekly”.");
  });

  // Sighted users otherwise only see the item vanish. The reload after the
  // delete must not clear it.
  it("shows the delete inside the dialog too, after the list reloads", async () => {
    const list = vi.fn<AppApi["listSavedQueries"]>().mockResolvedValue(listOf(b));
    const { app, store } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a, b], unreadable: [] },
      },
      fakeApi({ listSavedQueries: list }),
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [b], unreadable: [] });
    expect(store.getState().savedListNotice).toEqual({ tone: "done", text: "Deleted “Weekly”." });
  });

  it("deletes an unreadable saved query, naming it (#80)", async () => {
    const { app, store, api, announce } = setup({
      ...loggedIn,
      ...ready(),
      savedDialog: "list",
      savedList: { status: "ok", queries: [], unreadable: [{ id: "sq-old", name: "" }] },
    });
    app.askDeleteSaved("sq-old");
    app.confirmSavedAction();
    await flushPromises();
    expect(api.deleteSavedQuery).toHaveBeenCalledWith("sq-old");
    expect(announce).toHaveBeenCalledWith("Deleted “Unnamed saved query”.");
    expect(store.getState().deletingSavedId).toBeNull();
  });

  it("draws a running delete as busy and ignores its buttons meanwhile (#84)", async () => {
    const answer = deferred<void>();
    const api = fakeApi({ deleteSavedQuery: vi.fn(() => answer.promise) });
    const { app, store } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    const before = store.getState().query;
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    expect(store.getState().deletingSavedId).toBe("a");
    app.askDeleteSaved("a");
    app.askOpenSaved("a");
    expect(store.getState().savedConfirm).toBeNull();
    expect(store.getState().query).toBe(before);
    answer.resolve();
    await flushPromises();
    expect(store.getState().deletingSavedId).toBeNull();
  });

  it("a failed delete is no longer busy", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(500, "x"))),
    });
    const { app, store } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().deletingSavedId).toBeNull();
  });

  it("a delete that finishes after the dialog was closed leaves no notice behind", async () => {
    const answer = deferred<void>();
    const api = fakeApi({ deleteSavedQuery: vi.fn(() => answer.promise) });
    const { app, store } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    app.closeSavedDialog();
    answer.resolve();
    await flushPromises();
    expect(store.getState().savedListNotice).toBeNull();
  });

  it("forgets the open query when it is the one deleted", async () => {
    const { app, store } = setup({
      ...loggedIn,
      ...ready(a.query),
      openSaved: openFrom(a),
      savedDialog: "list",
      savedList: { status: "ok", queries: [a], unreadable: [] },
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
      savedList: { status: "ok", queries: [a, b], unreadable: [] },
    });
    app.askDeleteSaved("b");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().openSaved).toMatchObject({ id: "a" });
  });

  it("a delete whose query is already gone counts as deleted", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(404, "gone"))),
      listSavedQueries: vi.fn(async () => listOf()),
    });
    const { app, store, showError } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(showError).not.toHaveBeenCalled();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [], unreadable: [] });
  });

  // The toast is drawn under the modal dialog's backdrop and the page's live
  // region is inert while the dialog is open, so the notice lives in the dialog.
  it("a failed delete keeps the list and says so inside the dialog", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(503, "down"))),
    });
    const { app, store, showError } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [a], unreadable: [] });
    expect(store.getState().savedListNotice).toEqual({
      tone: "error",
      text: `Couldn't delete “${a.name}”. The server is busy or unavailable right now. Try again in a moment.`,
    });
    expect(showError).not.toHaveBeenCalled();
  });

  it("the delete notice goes away when the list reloads, another question is asked or the dialog closes", async () => {
    const failing = () =>
      fakeApi({
        deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(503, "down"))),
        listSavedQueries: vi.fn(async () => listOf(a)),
      });
    const failedDelete = async () => {
      const made = setup(
        {
          ...loggedIn,
          ...ready(),
          savedDialog: "list",
          savedList: { status: "ok", queries: [a], unreadable: [] },
        },
        failing(),
      );
      made.app.askDeleteSaved("a");
      made.app.confirmSavedAction();
      await flushPromises();
      expect(made.store.getState().savedListNotice).not.toBeNull();
      return made;
    };

    const reload = await failedDelete();
    reload.app.retrySavedList();
    expect(reload.store.getState().savedListNotice).toBeNull();

    const asking = await failedDelete();
    asking.app.askDeleteSaved("a");
    expect(asking.store.getState().savedListNotice).toBeNull();

    const closing = await failedDelete();
    closing.app.closeSavedDialog();
    expect(closing.store.getState().savedListNotice).toBeNull();

    const reopening = await failedDelete();
    reopening.app.openSavedList();
    expect(reopening.store.getState().savedListNotice).toBeNull();
  });

  it("a delete that fails after the dialog was closed leaves no notice behind", async () => {
    const answer = deferred<void>();
    const api = fakeApi({ deleteSavedQuery: vi.fn(() => answer.promise) });
    const { app, store } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    app.closeSavedDialog();
    answer.reject(new ApiError(503, "down"));
    await flushPromises();
    expect(store.getState().savedListNotice).toBeNull();
  });

  it("a 401 on delete redirects to log in", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(401, "no"))),
    });
    const { app, navigate } = setup(
      {
        ...loggedIn,
        ...ready(),
        savedDialog: "list",
        savedList: { status: "ok", queries: [a], unreadable: [] },
      },
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

describe("moving a node up or down", () => {
  /** A root with blocks of the facets a, b, c in that order. */
  function threeRows() {
    const [a, b, c] = ["a", "b", "c"].map((facetId) => newBlock(facetId));
    const root = [a!, b!, c!].reduce((t, n) => addChild(t, t.id, n), emptyQuery());
    return { root, a: a!, b: b!, c: c! };
  }
  const order = (store: ReturnType<typeof setup>["store"]) =>
    store.getState().query.children.map((n) => n.id);

  it("swaps the node with its neighbour and says where it ended up", () => {
    const { root, a, b, c } = threeRows();
    const { store, app, announce } = setup({ ...ready(root) });
    app.onMoveNode(c.id, "up");
    expect(order(store)).toEqual([a.id, c.id, b.id]);
    expect(announce).toHaveBeenCalledExactlyOnceWith("Moved the facet up, to position 2 of 3.");
  });

  it("is an edit like any other: the statistics and the preview are reset", () => {
    const { root, a } = threeRows();
    const { store, app } = setup({ ...ready(root), stats: { status: "ok", results: [] } });
    app.onMoveNode(a.id, "down");
    expect(store.getState().stats).toEqual({ status: "idle", results: [] });
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("does nothing, and announces nothing, at the end of the list", () => {
    const { root, a, c } = threeRows();
    const { store, app, announce } = setup({ ...ready(root) });
    app.onMoveNode(a.id, "up");
    app.onMoveNode(c.id, "down");
    app.onMoveNode("gone", "up");
    expect(store.getState().query).toBe(root);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("onPageRestored: Back from the login page shows the cached page (#77)", () => {
  it("resets Matching events that was left on Fetching events…", async () => {
    const api = fakeApi({
      runQuery: vi.fn(async () => Promise.reject(new ApiError(401, "login"))),
    });
    const { app, store, navigate } = setup(ready(), api);
    app.runPreview();
    await flushPromises();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(store.getState().preview.status).toBe("loading");
    app.onPageRestored();
    expect(store.getState().preview).toEqual({ status: "idle" });
  });

  it("resets a save left on Saving…, and keeps the dialog open", async () => {
    const api = fakeApi({
      createSavedQuery: vi.fn(async () => Promise.reject(new ApiError(401, "login"))),
    });
    const loggedIn = { auth: { status: "authenticated", user: { name: "pat" } } } as const;
    const { app, store } = setup({ ...ready(), ...loggedIn, savedDialog: "save" }, api);
    app.saveQuery("Weekly", "");
    await flushPromises();
    app.onPageRestored();
    expect(store.getState().save).toEqual({ status: "idle" });
    expect(store.getState().savedDialog).toBe("save");
  });

  it("asks again for statistics that were still loading", async () => {
    vi.useFakeTimers();
    const { app, api, store } = setup({ ...ready(), stats: { status: "loading", results: [] } });
    app.onPageRestored();
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledOnce();
    expect(store.getState().stats.status).toBe("ok");
  });
});
