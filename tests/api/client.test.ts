import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiError,
  COMPLIANCE_START_URL,
  getComplianceStatus,
  getDatabases,
  getFacets,
  getMe,
  getStats,
  invalidateCompliance,
  LOGIN_URL,
  logout,
  REQUEST_TIMEOUT_MS,
  runQuery,
  TimeoutError,
} from "../../src/api/client";
import { ContractError } from "../../src/api/contract";
import { toQueryRequest } from "../../src/api/request";
import type { Group } from "../../src/query/types";

const query: Group = {
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
const databaseIds = ["alpha", "beta"];
/** What the client should send for `query` in `databaseIds`. */
const body = toQueryRequest(query, databaseIds);

/** A fetch that answers every call with `body` as JSON (or as-is, if it is a
 *  string) and the given status. */
function mockFetchOnce(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn(async () => new Response(text, { status, statusText: "STATUS" }));
}

function mockStreamFetch(status: number, chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return vi.fn(async () => new Response(body, { status, statusText: "STATUS" }));
}

/** A fetch that never answers on its own — it only settles when its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("api client", () => {
  it("getDatabases GETs /api/databases and returns the databases in the frontend's model", async () => {
    const f = mockFetchOnce(200, [
      {
        label: "alpha",
        name: "ALPHA",
        description: "",
        owner: "",
        totalEntrysets: 1,
        percentageOfTotal: 100,
      },
    ]);
    vi.stubGlobal("fetch", f);
    const out = await getDatabases();
    expect(out).toEqual([
      { id: "alpha", name: "ALPHA", description: "", owner: "", eventCount: 1 },
    ]);
    expect(f).toHaveBeenCalledWith("/api/v1/databases", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("getFacets GETs /api/individuals and returns the facets in the frontend's model", async () => {
    const f = mockFetchOnce(200, [
      {
        label: "engine_rpm",
        group: "engine",
        tags: [],
        idNumber: 1,
        name: "Engine RPM",
        description: "",
        comment: "",
        totalCount: 100,
        fields: [],
      },
    ]);
    vi.stubGlobal("fetch", f);
    const out = await getFacets();
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("engine_rpm");
    expect(f).toHaveBeenCalledWith("/api/v1/individuals", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("getStats POSTs the request body as JSON", async () => {
    const f = mockStreamFetch(200, [""]);
    vi.stubGlobal("fetch", f);
    await getStats(query, databaseIds, () => {});
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("getStats streams NDJSON lines, calling onResult once per line, even split across chunks", async () => {
    const lines = [
      { label: "alpha", success: true, matchCount: 1 },
      { label: "beta", success: false, errorMessages: ["bad query"] },
    ];
    const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const splitAt = ndjson.indexOf("\n") + 3; // cut mid-way into the second line
    const f = mockStreamFetch(200, [ndjson.slice(0, splitAt), ndjson.slice(splitAt)]);
    vi.stubGlobal("fetch", f);
    const received: unknown[] = [];
    await getStats(query, databaseIds, (result) => received.push(result));
    expect(received).toEqual([
      { databaseId: "alpha", status: "ok", matchCount: 1, notes: [] },
      { databaseId: "beta", status: "failed", errors: ["bad query"], notes: [] },
    ]);
  });

  it("getStats throws the server's error message on non-2xx and never calls onResult", async () => {
    const f = mockFetchOnce(400, { error: "bad query tree" });
    vi.stubGlobal("fetch", f);
    const onResult = vi.fn();
    await expect(getStats(query, databaseIds, onResult)).rejects.toThrow("bad query tree");
    expect(onResult).not.toHaveBeenCalled();
  });

  it("runQuery POSTs the request body as JSON", async () => {
    const f = mockFetchOnce(200, { entrysets: [] });
    vi.stubGlobal("fetch", f);
    await runQuery(query, databaseIds);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/query");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("runQuery returns the events in the frontend's model", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { entrysets: [{ id: 4, items: { a: { b: 1 } } }] }));
    expect(await runQuery(query, databaseIds)).toEqual([{ id: 4, values: { a: { b: 1 } } }]);
  });

  it("an unfinished query rejects without sending anything", async () => {
    const f = mockFetchOnce(200, { entrysets: [] });
    vi.stubGlobal("fetch", f);
    const unfinished: Group = {
      ...query,
      children: [
        {
          kind: "condition",
          id: "c1",
          facetId: null,
          fieldId: null,
          operatorId: null,
          value: null,
        },
      ],
    };
    await expect(runQuery(unfinished, databaseIds)).rejects.toThrow("unfinished");
    await expect(getStats(unfinished, databaseIds, () => {})).rejects.toThrow("unfinished");
    expect(f).not.toHaveBeenCalled();
  });

  it("falls back to the request and status line when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getDatabases()).rejects.toThrow("GET /api/v1/databases failed: 500 STATUS");
    vi.stubGlobal("fetch", mockFetchOnce(502, "<html>Bad Gateway</html>"));
    await expect(getDatabases()).rejects.toThrow("GET /api/v1/databases failed: 502 STATUS");
  });

  it("throws an ApiError carrying the response status", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(401, { error: "nope" }));
    await expect(getDatabases()).rejects.toBeInstanceOf(ApiError);
    await expect(getDatabases()).rejects.toMatchObject({ status: 401, message: "nope" });
  });

  it("getMe returns the user when logged in", async () => {
    const f = mockFetchOnce(200, { name: "demo.user" });
    vi.stubGlobal("fetch", f);
    const out = await getMe();
    expect(out).toEqual({ name: "demo.user" });
    expect(f).toHaveBeenCalledWith("/api/v1/auth/me", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("getMe returns null on 401 rather than throwing", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(401, { error: "Not authenticated." }));
    await expect(getMe()).resolves.toBeNull();
  });

  it("getMe still throws on other non-2xx statuses", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(getMe()).rejects.toThrow("boom");
  });

  it("logout POSTs to /api/auth/logout", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await logout();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/logout");
    expect(init.method).toBe("POST");
  });

  it("logout throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(logout()).rejects.toThrow("boom");
  });

  it("getComplianceStatus GETs /api/compliance/status and returns the frontend's model", async () => {
    const f = mockFetchOnce(200, { status: "required" });
    vi.stubGlobal("fetch", f);
    const out = await getComplianceStatus();
    expect(out).toEqual({ status: "required" });
    expect(f).toHaveBeenCalledWith("/api/v1/compliance/status", {
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("invalidateCompliance POSTs to /api/compliance/invalidate", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await invalidateCompliance();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/compliance/invalidate");
    expect(init.method).toBe("POST");
  });

  it("invalidateCompliance throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(invalidateCompliance()).rejects.toThrow("boom");
  });

  it("builds the login / compliance redirect URLs from the same API base as fetches", () => {
    expect(LOGIN_URL).toBe("/api/v1/auth/login");
    expect(COMPLIANCE_START_URL).toBe("/api/v1/compliance/start");
  });

  it("rejects with a TimeoutError when the server stays silent past REQUEST_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const pending = expect(getDatabases()).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await pending;
  });

  it("runQuery rejects with the caller's abort reason when its signal aborts", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const ctrl = new AbortController();
    const pending = runQuery(query, databaseIds, ctrl.signal);
    ctrl.abort(new Error("superseded"));
    await expect(pending).rejects.toThrow("superseded");
  });

  it("getStats passes an abortable signal and rejects when it is aborted", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const ctrl = new AbortController();
    const pending = getStats(query, databaseIds, () => {}, ctrl.signal);
    ctrl.abort(new Error("superseded"));
    await expect(pending).rejects.toThrow("superseded");
  });

  it("getStats throws a readable error when a 2xx response has no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(getStats(query, databaseIds, () => {})).rejects.toThrow(
      "Unexpected response from POST /api/v1/stats: the body is empty.",
    );
  });
});

describe("a response that breaks the API contract", () => {
  it("rejects with a ContractError naming the request and the field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, [{ name: "ALPHA", totalEntrysets: 1 }]));
    const err = await getDatabases().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect((err as Error).message).toBe(
      'Unexpected response from GET /api/v1/databases: "[0].label" should be non-blank text, but it is missing.',
    );
  });

  it("a web page instead of JSON says so, and what to check", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, "<!doctype html><title>Query Builder</title>"));
    await expect(getFacets()).rejects.toThrow(
      /GET \/api\/v1\/individuals: the body should be JSON.*check VITE_API_BASE/,
    );
  });

  it("an events answer without its list", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, []));
    await expect(runQuery(query, databaseIds)).rejects.toThrow(
      "Unexpected response from POST /api/v1/query: the response should be an object, but it is a list.",
    );
  });

  it("a statistics line that isn't JSON names its line, and stops the stream", async () => {
    const ok = JSON.stringify({ label: "alpha", success: true, matchCount: 1 });
    vi.stubGlobal("fetch", mockStreamFetch(200, [`${ok}\nnot json\n${ok}\n`]));
    const onResult = vi.fn();
    await expect(getStats(query, databaseIds, onResult)).rejects.toThrow(
      'Unexpected response from POST /api/v1/stats, line 2: the body should be JSON, but it starts with "not json".',
    );
    expect(onResult).toHaveBeenCalledOnce();
  });

  it("a statistics line without a database names its line and field", async () => {
    vi.stubGlobal("fetch", mockStreamFetch(200, [JSON.stringify({ success: true }) + "\n"]));
    await expect(getStats(query, databaseIds, () => {})).rejects.toThrow(
      'POST /api/v1/stats, line 1: "label" should be non-blank text, but it is missing.',
    );
  });
});
