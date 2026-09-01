import { describe, it, expect } from "vitest";
import {
  emptyQuery,
  newCondition,
  newGroup,
  addChild,
  updateNode,
  removeNode,
  findNode,
  countConditions,
} from "../../src/query/tree";

describe("tree", () => {
  it("emptyQuery is an AND group with no children", () => {
    const q = emptyQuery();
    expect(q).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(typeof q.id).toBe("string");
  });

  it("new nodes get unique ids", () => {
    expect(newCondition().id).not.toBe(newCondition().id);
    expect(newGroup().id).not.toBe(newGroup().id);
  });

  it("addChild returns a new tree with the node appended, original unchanged", () => {
    const root = emptyQuery();
    const c = newCondition();
    const next = addChild(root, root.id, c);
    expect(root.children).toHaveLength(0); // original untouched
    expect(next.children).toHaveLength(1);
    expect(next.children[0]).toBe(c);
  });

  it("addChild can target a nested group", () => {
    const root = emptyQuery();
    const g = newGroup();
    const withGroup = addChild(root, root.id, g);
    const c = newCondition();
    const next = addChild(withGroup, g.id, c);
    const found = findNode(next, g.id) as import("../../src/query/types").Group;
    expect(found.children[0]).toBe(c);
  });

  it("updateNode shallow-merges a patch into one node only", () => {
    const root = emptyQuery();
    const c = newCondition();
    const t1 = addChild(root, root.id, c);
    const t2 = updateNode(t1, c.id, { fieldId: "species", operatorId: "eq", value: "oak" });
    const updated = findNode(t2, c.id) as import("../../src/query/types").Condition;
    expect(updated).toMatchObject({ fieldId: "species", operatorId: "eq", value: "oak" });
    // original still null
    expect((findNode(t1, c.id) as import("../../src/query/types").Condition).fieldId).toBeNull();
  });

  it("removeNode deletes the node wherever it is", () => {
    const root = emptyQuery();
    const c = newCondition();
    const t1 = addChild(root, root.id, c);
    const t2 = removeNode(t1, c.id);
    expect(t2.children).toHaveLength(0);
    expect(findNode(t2, c.id)).toBeNull();
  });

  it("countConditions counts leaves at any depth", () => {
    const root = emptyQuery();
    const g = newGroup();
    let t = addChild(root, root.id, newCondition());
    t = addChild(t, root.id, g);
    t = addChild(t, g.id, newCondition());
    t = addChild(t, g.id, newCondition());
    expect(countConditions(t)).toBe(3);
  });
});
