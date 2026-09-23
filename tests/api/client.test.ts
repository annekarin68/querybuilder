import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ApiError,
  getComplianceStatus,
  getDatabases,
  getMe,
  getSchema,
  getStats,
  invalidateCompliance,
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
    const f = mockFetchOnce(200, { matchCount: 1, totalCount: 2, blocks: [] });
    vi.stubGlobal("fetch", f);
    const q = emptyQuery();
    await getStats(q, ["fern", "oak"]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      query: JSON.parse(JSON.stringify(q)),
      databases: ["fern", "oak"],
    });
  });

  it("runQuery POSTs query + databases + paging", async () => {
    const f = mockFetchOnce(200, { columns: [], rows: [], page: 2, pageSize: 25, totalRows: 0 });
    vi.stubGlobal("fetch", f);
    await runQuery(emptyQuery(), ["rose"], 2, 25);
    const [, init] = f.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ databases: ["rose"], page: 2, pageSize: 25 });
  });

  it("throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(400, { error: "bad query tree" }));
    await expect(getStats(emptyQuery(), ["fern"])).rejects.toThrow("bad query tree");
  });

  it("falls back to status text when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getSchema()).rejects.toThrow("500 STATUS");
  });

  it("throws an ApiError carrying the response status", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(401, { error: "nope" }));
    await expect(getSchema()).rejects.toBeInstanceOf(ApiError);
    await expect(getSchema()).rejects.toMatchObject({ status: 401, message: "nope" });
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

  it("getComplianceStatus GETs /api/compliance/status and returns the parsed body", async () => {
    const f = mockFetchOnce(200, { status: "required" });
    vi.stubGlobal("fetch", f);
    const out = await getComplianceStatus();
    expect(out).toEqual({ status: "required" });
    expect(f).toHaveBeenCalledWith("/api/compliance/status", undefined);
  });

  it("invalidateCompliance POSTs to /api/compliance/invalidate", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await invalidateCompliance();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/compliance/invalidate");
    expect(init.method).toBe("POST");
  });

  it("invalidateCompliance throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(invalidateCompliance()).rejects.toThrow("boom");
  });
});
