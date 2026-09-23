import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { savePendingQuery, takePendingQuery } from "../../src/util/pendingQuery";
import { emptyQuery } from "../../src/query/tree";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe("pendingQuery", () => {
  it("round-trips a saved query", () => {
    const query = emptyQuery();
    savePendingQuery(query, ["alpha", "beta"]);
    expect(takePendingQuery()).toEqual({ query, selectedDatabaseIds: ["alpha", "beta"] });
  });

  it("returns null when nothing was saved", () => {
    expect(takePendingQuery()).toBeNull();
  });

  it("clears the entry after taking it — a second take returns null", () => {
    savePendingQuery(emptyQuery(), ["alpha"]);
    takePendingQuery();
    expect(takePendingQuery()).toBeNull();
  });

  it("returns null for corrupted JSON instead of throwing", () => {
    sessionStorage.setItem("qb:pending-query", "{not valid json");
    expect(takePendingQuery()).toBeNull();
  });

  it("returns null when sessionStorage itself is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => savePendingQuery(emptyQuery(), ["alpha"])).not.toThrow();
    expect(takePendingQuery()).toBeNull();
  });
});
