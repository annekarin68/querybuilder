import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  forgetKeptQuery,
  isWorthRestoring,
  keepQuery,
  readKeptQuery,
} from "../../src/util/keptQuery";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";

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

describe("keptQuery", () => {
  it("round-trips a saved query", () => {
    const query = emptyQuery();
    keepQuery(query, ["alpha", "beta"]);
    expect(readKeptQuery()).toEqual({ query, selectedDatabaseIds: ["alpha", "beta"] });
  });

  it("returns null when nothing was saved", () => {
    expect(readKeptQuery()).toBeNull();
  });

  // The copy is kept for the next page load, whatever it is: reading it must
  // not lose it (a reload straight after a reload still finds it).
  it("leaves the copy in place after reading it", () => {
    keepQuery(emptyQuery(), ["alpha"]);
    readKeptQuery();
    expect(readKeptQuery()).not.toBeNull();
  });

  it("forgetKeptQuery removes the copy", () => {
    keepQuery(emptyQuery(), ["alpha"]);
    forgetKeptQuery();
    expect(readKeptQuery()).toBeNull();
  });

  // A tab open across the deploy that left for the login page under the old
  // build wrote the old key: its return hop must still find the query.
  it("reads a copy the previous build wrote under its old key", () => {
    const query = emptyQuery();
    sessionStorage.setItem(
      "qb:pending-query",
      JSON.stringify({ query, selectedDatabaseIds: ["a"] }),
    );
    expect(readKeptQuery()).toEqual({ query, selectedDatabaseIds: ["a"] });
  });

  it("prefers the current key, and forgetting removes the old one too", () => {
    keepQuery(emptyQuery(), ["new"]);
    sessionStorage.setItem(
      "qb:pending-query",
      JSON.stringify({ query: emptyQuery(), selectedDatabaseIds: ["old"] }),
    );
    expect(readKeptQuery()?.selectedDatabaseIds).toEqual(["new"]);
    forgetKeptQuery();
    expect(readKeptQuery()).toBeNull();
  });

  it("a newer copy replaces the older one", () => {
    keepQuery(emptyQuery(), ["alpha"]);
    keepQuery(emptyQuery(), ["beta"]);
    expect(readKeptQuery()?.selectedDatabaseIds).toEqual(["beta"]);
  });

  it("returns null for corrupted JSON instead of throwing", () => {
    sessionStorage.setItem("qb:kept-query", "{not valid json");
    expect(readKeptQuery()).toBeNull();
  });

  it("returns null when sessionStorage itself is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => keepQuery(emptyQuery(), ["alpha"])).not.toThrow();
    expect(readKeptQuery()).toBeNull();
  });

  it("round-trips a nested tree with conditions", () => {
    const root = emptyQuery();
    const inner = newGroup();
    const nested = addChild(root, root.id, addChild(inner, inner.id, newCondition()));
    const withCond = addChild(nested, nested.id, newCondition());
    keepQuery(withCond, ["alpha"]);
    expect(readKeptQuery()).toEqual({ query: withCond, selectedDatabaseIds: ["alpha"] });
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
    sessionStorage.setItem("qb:kept-query", JSON.stringify(entry));
    expect(readKeptQuery()).toBeNull();
  });
});

describe("isWorthRestoring", () => {
  const root = emptyQuery();
  const blank = newCondition();

  // The starting query is one blank row: bringing that back would only show a
  // "Restored" notice for nothing.
  it("is false while nothing has been chosen: no rows, blank rows, or only ALL/ANY", () => {
    expect(isWorthRestoring(root)).toBe(false);
    expect(isWorthRestoring(addChild(root, root.id, blank))).toBe(false);
    const nestedBlank = addChild(root, root.id, newGroup()); // a group holding one blank row
    expect(isWorthRestoring({ ...nestedBlank, operator: "OR" })).toBe(false);
  });

  it("is true once any row has a facet, at any depth", () => {
    const chosen = updateNode(addChild(root, root.id, blank), blank.id, { facetId: "thing" });
    expect(isWorthRestoring(chosen)).toBe(true);
    const inner = newGroup();
    const deep = addChild(root, root.id, { ...inner, children: [{ ...blank, facetId: "x" }] });
    expect(isWorthRestoring(deep)).toBe(true);
  });
});
