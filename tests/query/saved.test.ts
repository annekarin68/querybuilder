import { describe, it, expect } from "vitest";
import {
  hasUnsavedWork,
  isEdited,
  sameName,
  saveTarget,
  type OpenSaved,
} from "../../src/query/saved";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";
import type { Group } from "../../src/query/types";

/** A query with one chosen condition. */
function chosenQuery(value: number | null = 3): Group {
  const root = emptyQuery();
  const c = newCondition();
  return updateNode(addChild(root, root.id, c), c.id, {
    facetId: "thing",
    fieldId: "size",
    operatorId: "gt",
    value,
  });
}

function savedFrom(query: Group, databaseIds = ["alpha", "beta"]): OpenSaved {
  return { id: "s1", name: "Weekly", note: "", query, databaseIds };
}

describe("sameName", () => {
  it("ignores case and surrounding spaces", () => {
    expect(sameName(" Weekly ", "weekly")).toBe(true);
  });
  it("tells different names apart", () => {
    expect(sameName("Weekly", "Weekly 2")).toBe(false);
  });
});

describe("isEdited", () => {
  const query = chosenQuery();

  it("is false for the same query and selection", () => {
    expect(isEdited(savedFrom(query), query, ["alpha", "beta"])).toBe(false);
  });

  it("does not count folding a group as an edit", () => {
    const group = newGroup();
    const withGroup = addChild(query, query.id, group);
    const folded = updateNode(withGroup, group.id, { collapsed: true });
    expect(isEdited(savedFrom(withGroup), folded, ["alpha", "beta"])).toBe(false);
  });

  it("is true after a value change", () => {
    expect(isEdited(savedFrom(query), chosenQuery(4), ["alpha", "beta"])).toBe(true);
  });

  it("is true when the selection holds other databases", () => {
    expect(isEdited(savedFrom(query), query, ["alpha"])).toBe(true);
    expect(isEdited(savedFrom(query), query, ["alpha", "gamma"])).toBe(true);
  });

  it("ignores the order of the selection", () => {
    expect(isEdited(savedFrom(query), query, ["beta", "alpha"])).toBe(false);
  });
});

describe("hasUnsavedWork", () => {
  const ids = ["alpha"];

  it("is false for the starting query's blank row, or no row at all", () => {
    const root = emptyQuery();
    const seed = addChild(root, root.id, newCondition());
    expect(hasUnsavedWork(null, seed, ids)).toBe(false);
    expect(hasUnsavedWork(null, root, ids)).toBe(false);
  });

  it("is true for a never-saved query with something chosen", () => {
    expect(hasUnsavedWork(null, chosenQuery(), ids)).toBe(true);
  });

  it("finds a chosen condition inside a nested group", () => {
    const root = emptyQuery();
    const inner = newGroup();
    const condition = newCondition();
    const nested = addChild(addChild(root, root.id, inner), inner.id, condition);
    const filled = updateNode(nested, condition.id, { facetId: "thing" });
    expect(hasUnsavedWork(null, nested, ids)).toBe(false);
    expect(hasUnsavedWork(null, filled, ids)).toBe(true);
  });

  it("is false for a query left as it was opened", () => {
    const query = chosenQuery();
    expect(hasUnsavedWork(savedFrom(query, ids), query, ids)).toBe(false);
  });

  it("is true once the opened query was edited", () => {
    expect(hasUnsavedWork(savedFrom(chosenQuery(), ids), chosenQuery(4), ids)).toBe(true);
  });
});

describe("saveTarget", () => {
  const open = savedFrom(chosenQuery());

  it("updates the open query when the name is its own", () => {
    expect(saveTarget("weekly", open)).toEqual({ kind: "update", id: "s1" });
  });
  it("creates when the name is another", () => {
    expect(saveTarget("Monthly", open)).toEqual({ kind: "create" });
  });
  it("creates when nothing is open", () => {
    expect(saveTarget("Weekly", null)).toEqual({ kind: "create" });
  });
});
