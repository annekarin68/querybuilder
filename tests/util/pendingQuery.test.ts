import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { savePendingQuery, takePendingQuery } from "../../src/util/pendingQuery";
import { addChild, emptyQuery, newCondition, newGroup } from "../../src/query/tree";

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

  it("round-trips a nested tree with conditions", () => {
    const root = emptyQuery();
    const inner = newGroup();
    const nested = addChild(root, root.id, addChild(inner, inner.id, newCondition()));
    const withCond = addChild(nested, nested.id, newCondition());
    savePendingQuery(withCond, ["alpha"]);
    expect(takePendingQuery()).toEqual({ query: withCond, selectedDatabaseIds: ["alpha"] });
  });

  it.each([
    ["a non-object", 42],
    ["a missing query", { selectedDatabaseIds: [] }],
    ["a condition as root", { query: newCondition(), selectedDatabaseIds: [] }],
    [
      "a group with a malformed child",
      { query: { ...emptyQuery(), children: [{ kind: "condition" }] }, selectedDatabaseIds: [] },
    ],
    [
      "a bad logical operator",
      { query: { ...emptyQuery(), operator: "XOR" }, selectedDatabaseIds: [] },
    ],
    ["non-string database ids", { query: emptyQuery(), selectedDatabaseIds: [1, 2] }],
  ])("returns null for %s", (_label, entry) => {
    sessionStorage.setItem("qb:pending-query", JSON.stringify(entry));
    expect(takePendingQuery()).toBeNull();
  });
});
