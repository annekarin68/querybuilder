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

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "STATUS",
    json: async () => body,
  } as Response);
}

function mockStreamFetch(status: number, chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "STATUS",
    body,
    json: async () => ({}),
  } as unknown as Response);
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
    expect(f).toHaveBeenCalledWith("/api/v1/databases", { signal: expect.any(AbortSignal) });
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
    expect(f).toHaveBeenCalledWith("/api/v1/individuals", { signal: expect.any(AbortSignal) });
  });

  it("getStats POSTs the request body as JSON", async () => {
    const f = mockStreamFetch(200, [""]);
    vi.stubGlobal("fetch", f);
    await getStats(query, databaseIds, () => {});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
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
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/query");
    expect(JSON.parse(init.body)).toEqual(body);
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

  it("falls back to status text when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getDatabases()).rejects.toThrow("500 STATUS");
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
    expect(f).toHaveBeenCalledWith("/api/v1/auth/me", { signal: expect.any(AbortSignal) });
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
    const [url, init] = f.mock.calls[0]!;
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
      signal: expect.any(AbortSignal),
    });
  });

  it("invalidateCompliance POSTs to /api/compliance/invalidate", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await invalidateCompliance();
    const [url, init] = f.mock.calls[0]!;
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
      vi.fn().mockResolvedValue({ ok: true, status: 204, statusText: "", body: null }),
    );
    await expect(getStats(query, databaseIds, () => {})).rejects.toThrow(
      "empty statistics response",
    );
  });
});
