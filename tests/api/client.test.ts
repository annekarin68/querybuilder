import { describe, it, expect, vi, afterEach } from "vitest";
import { getDatabases, getSchema, getStats, runQuery } from "../../src/api/client";
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
  it("getSchema GETs /api/schema and returns the parsed body", async () => {
    const f = mockFetchOnce(200, { fields: [], operators: [] });
    vi.stubGlobal("fetch", f);
    const out = await getSchema();
    expect(out).toEqual({ fields: [], operators: [] });
    expect(f).toHaveBeenCalledWith("/api/schema", undefined);
  });

  it("getDatabases GETs /api/databases and returns the parsed body", async () => {
    const f = mockFetchOnce(200, { databases: [{ id: "fern", label: "Fern" }] });
    vi.stubGlobal("fetch", f);
    const out = await getDatabases();
    expect(out).toEqual({ databases: [{ id: "fern", label: "Fern" }] });
    expect(f).toHaveBeenCalledWith("/api/databases", undefined);
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
      { label: "alpha", success: true, matchCount: 1, totalCount: 2, infoMessages: [] },
      { label: "beta", success: false, validationErrors: ["bad query"], infoMessages: [] },
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
    const f = mockFetchOnce(200, { columns: [], rows: [], page: 2, pageSize: 25, totalRows: 0 });
    vi.stubGlobal("fetch", f);
    await runQuery(emptyQuery(), ["rose"], 2, 25);
    const [, init] = f.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ databases: ["rose"], page: 2, pageSize: 25 });
  });

  it("falls back to status text when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getSchema()).rejects.toThrow("500 STATUS");
  });
});
