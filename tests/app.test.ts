import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp, STATS_DEBOUNCE_MS, type AppApi } from "../src/app";
import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "../src/api/client";
import type {
  DatabasesResponse,
  EventsResponse,
  Facet,
  QueryRequest,
  StatsResponse,
} from "../src/api/types";
import { buildFieldCatalog } from "../src/query/fieldCatalog";
import { toQueryRequest } from "../src/query/request";
import { addChild, emptyQuery, newCondition, updateNode } from "../src/query/tree";
import type { Group } from "../src/query/types";
import { validateQuery } from "../src/query/validate";
import { createStore, initialState, type AppState } from "../src/state";
import { savePendingQuery, takePendingQuery } from "../src/util/pendingQuery";

// ---- fixtures -------------------------------------------------------------

const facets: Facet[] = [
  {
    label: "thing",
    name: "Thing",
    group: "",
    tags: [],
    idNumber: 1,
    description: "",
    comment: "",
    totalCount: 10,
    fields: [
      {
        label: "size",
        type: "BIGINT",
        format: "",
        description: "",
        comment: "",
        cardinality: 0,
        values: [],
      },
    ],
  },
];

const db = (label: string): DatabasesResponse => ({
  label,
  name: label.toUpperCase(),
  description: "",
  owner: "",
  totalEntrysets: 100,
  percentageOfTotal: 50,
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

const events: EventsResponse = { entrysets: [{ id: 1, items: {} }] };
const line = (label: string, matchCount: number): StatsResponse => ({
  label,
  success: true,
  matchCount,
});

function fakeApi(overrides: Partial<AppApi> = {}): AppApi {
  return {
    getDatabases: vi.fn(async () => databases),
    getFacets: vi.fn(async () => facets),
    getMe: vi.fn(async () => ({ name: "pat" })),
    getComplianceStatus: vi.fn(async () => ({
      status: "acknowledged" as const,
      reason: "audit",
      ackedAt: "2026-09-23T10:00:00Z",
    })),
    getStats: vi.fn(async () => {}),
    runQuery: vi.fn(async () => events),
    logout: vi.fn(async () => {}),
    invalidateCompliance: vi.fn(async () => {}),
    ...overrides,
  };
}

function setup(state: Partial<AppState> = {}, api: AppApi = fakeApi()) {
  const store = createStore({ ...initialState, ...state });
  const navigate = vi.fn();
  const app = createApp({ store, api, navigate });
  return { store, api, navigate, app };
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
      toQueryRequest(store.getState().query, ["alpha", "beta"]),
      expect.any(AbortSignal),
    );
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "ok", data: events });
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
    const response = deferred<EventsResponse>();
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
});

// ---- statistics -----------------------------------------------------------

describe("statistics", () => {
  /** getStats that hands each call's line callback back to the test. */
  function streamingApi() {
    const calls: {
      onLine: (l: StatsResponse) => void;
      done: ReturnType<typeof deferred<void>>;
      signal?: AbortSignal;
    }[] = [];
    const api = fakeApi({
      getStats: vi.fn(
        (_body: QueryRequest, onLine: (l: StatsResponse) => void, signal?: AbortSignal) => {
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
    expect(store.getState().stats).toMatchObject({ status: "idle", lines: [] });
    expect(api.getStats).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);
    expect(api.getStats).toHaveBeenCalledWith(
      toQueryRequest(next, ["alpha", "beta"]),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(store.getState().stats).toMatchObject({ status: "loading", lines: [] });

    calls[0]!.onLine(line("alpha", 7));
    expect(store.getState().stats).toMatchObject({ status: "loading", lines: [line("alpha", 7)] });

    calls[0]!.onLine(line("beta", 2));
    calls[0]!.done.resolve();
    await flushPromises();
    expect(store.getState().stats).toMatchObject({
      status: "ok",
      lines: [line("alpha", 7), line("beta", 2)],
    });
  });

  it("drops lines from a request the user has moved on from, and aborts it", async () => {
    vi.useFakeTimers();
    const { api, calls } = streamingApi();
    const { app, store } = setup(ready(), api);
    app.onQueryChange(runnableQuery(5));
    await vi.advanceTimersByTimeAsync(STATS_DEBOUNCE_MS);

    app.onQueryChange(runnableQuery(6));
    expect(calls[0]!.signal?.aborted).toBe(true);
    calls[0]!.onLine(line("alpha", 7));
    calls[0]!.done.resolve();
    await flushPromises();
    expect(store.getState().stats).toMatchObject({ status: "idle", lines: [] });

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
  const shown: Partial<AppState> = { preview: { status: "ok", data: events } };

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
    preview: { status: "ok", data: events },
    auth: { status: "authenticated", user: { name: "pat" } },
    compliance: { status: "acknowledged", reason: "audit", ackedAt: null },
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
