import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  forgetKeptQuery,
  isWorthRestoring,
  keepQuery,
  readKeptQuery,
} from "../../src/util/keptQuery";
import {
  addChild,
  emptyQuery,
  groupOf,
  newBlock,
  newFieldCondition,
  newGroup,
} from "../../src/query/tree";
import type { FacetBlock } from "../../src/query/types";

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

  it("round-trips a nested tree with facet blocks and their set fields", () => {
    const root = emptyQuery();
    const block: FacetBlock = {
      ...newBlock("thing"),
      negated: true,
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 3), newFieldCondition("label", null, null)],
    };
    const nested = addChild(root, root.id, groupOf([block]));
    const withBlock = addChild(nested, nested.id, newBlock("other"));
    keepQuery(withBlock, ["alpha"]);
    expect(readKeptQuery()).toEqual({ query: withBlock, selectedDatabaseIds: ["alpha"] });
  });

  const block = newBlock("thing");
  const inGroup = (child: unknown) => ({
    query: { ...emptyQuery(), children: [child] },
    selectedDatabaseIds: [],
  });

  it.each([
    ["a non-object", 42],
    ["a missing query", { selectedDatabaseIds: [] }],
    ["a block as root", { query: block, selectedDatabaseIds: [] }],
    ["a group with a malformed child", inGroup({ kind: "facet" })],
    [
      "a bad logical operator",
      { query: { ...emptyQuery(), operator: "XOR" }, selectedDatabaseIds: [] },
    ],
    ["non-string database ids", { query: emptyQuery(), selectedDatabaseIds: [1, 2] }],
    // A query kept by the build before facet blocks: dropped once, not
    // migrated (spec, decision 9).
    [
      "the old shape, a condition in a group",
      inGroup({
        kind: "condition",
        id: "c1",
        facetId: "thing",
        fieldId: null,
        operatorId: "present",
        value: null,
      }),
    ],
    ["a block without a facet", inGroup({ ...block, facetId: null })],
    ["a block whose negated is not true or false", inGroup({ ...block, negated: "no" })],
    ["a block with a bad ALL/ANY", inGroup({ ...block, operator: "all" })],
    ["a block without conditions", inGroup({ ...block, conditions: undefined })],
    [
      "a field condition without a field",
      inGroup({ ...block, conditions: [{ ...newFieldCondition("size", "gt", 3), fieldId: null }] }),
    ],
    [
      "a field condition with a numeric operator",
      inGroup({ ...block, conditions: [{ ...newFieldCondition("size", "gt", 3), operatorId: 7 }] }),
    ],
    ["a field condition without an id", inGroup({ ...block, conditions: [{ fieldId: "size" }] })],
  ])("returns null for %s", (_label, entry) => {
    sessionStorage.setItem("qb:kept-query", JSON.stringify(entry));
    expect(readKeptQuery()).toBeNull();
  });
});

describe("isWorthRestoring", () => {
  const root = emptyQuery();

  // The starting query is an empty group: bringing that back would only show
  // a "Restored" notice for nothing.
  it("is false while no facet has been added: empty groups, or only ALL/ANY", () => {
    expect(isWorthRestoring(root)).toBe(false);
    const nestedEmpty = addChild(root, root.id, newGroup());
    expect(isWorthRestoring({ ...nestedEmpty, operator: "OR" })).toBe(false);
  });

  it("is true once a facet block is in the query, at any depth, even with nothing set", () => {
    expect(isWorthRestoring(addChild(root, root.id, newBlock("thing")))).toBe(true);
    const deep = addChild(root, root.id, groupOf([groupOf([newBlock("x")])]));
    expect(isWorthRestoring(deep)).toBe(true);
  });
});
