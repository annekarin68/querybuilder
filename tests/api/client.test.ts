import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiError,
  getDatabases,
  getIndividuals,
  getMe,
  getStats,
  logout,
  runQuery,
} from "../../src/api/client";
import { emptyQuery } from "../../src/query/tree";

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

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("getDatabases GETs /api/databases and returns the parsed bare array", async () => {
    const f = mockFetchOnce(200, [
      {
        label: "fern",
        name: "Fern",
        description: "",
        owner: "",
        totalEntrysets: 1,
        percentageOfTotal: 100,
      },
    ]);
    vi.stubGlobal("fetch", f);
    const out = await getDatabases();
    expect(out).toEqual([
      {
        label: "fern",
        name: "Fern",
        description: "",
        owner: "",
        totalEntrysets: 1,
        percentageOfTotal: 100,
      },
    ]);
    expect(f).toHaveBeenCalledWith("/api/databases", undefined);
  });

  it("getIndividuals GETs /api/individuals and returns the parsed bare array", async () => {
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
    const out = await getIndividuals();
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("engine_rpm");
    expect(f).toHaveBeenCalledWith("/api/individuals", undefined);
  });

  it("getStats POSTs the query tree + selected databases as JSON", async () => {
    const f = mockStreamFetch(200, [""]);
    vi.stubGlobal("fetch", f);
    const q = emptyQuery();
    await getStats(q, ["fern", "oak"], () => {});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      query: JSON.parse(JSON.stringify(q)),
      databases: ["fern", "oak"],
    });
  });

  it("getStats streams NDJSON lines, calling onLine once per line, even split across chunks", async () => {
    const lines = [
      { label: "alpha", success: true, matchCount: 1 },
      { label: "beta", success: false, errorMessages: ["bad query"] },
    ];
    const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const splitAt = ndjson.indexOf("\n") + 3; // cut mid-way into the second line
    const f = mockStreamFetch(200, [ndjson.slice(0, splitAt), ndjson.slice(splitAt)]);
    vi.stubGlobal("fetch", f);
    const received: unknown[] = [];
    await getStats(emptyQuery(), ["alpha", "beta"], (line) => received.push(line));
    expect(received).toEqual(lines);
  });

  it("getStats throws the server's error message on non-2xx and never calls onLine", async () => {
    const f = mockFetchOnce(400, { error: "bad query tree" });
    vi.stubGlobal("fetch", f);
    const onLine = vi.fn();
    await expect(getStats(emptyQuery(), ["fern"], onLine)).rejects.toThrow("bad query tree");
    expect(onLine).not.toHaveBeenCalled();
  });

  it("runQuery POSTs query + databases + paging", async () => {
    const f = mockFetchOnce(200, { entrysets: [] });
    vi.stubGlobal("fetch", f);
    await runQuery(emptyQuery(), ["rose"], 2, 25);
    const [, init] = f.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ databases: ["rose"], page: 2, pageSize: 25 });
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
    // getMe() calls fetch(url) with no second argument (unlike request<T>,
    // which always passes init explicitly) — so check just the URL, not the
    // full args array, which would otherwise differ in length from ["/api/auth/me", undefined].
    expect(f.mock.calls[0]![0]).toBe("/api/auth/me");
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
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
  });

  it("logout throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(logout()).rejects.toThrow("boom");
  });
});
