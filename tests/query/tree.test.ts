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
  stripCollapsed,
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

  it("newCondition starts with no individual, field, operator, or value", () => {
    const c = newCondition();
    expect(c.individualId).toBeNull();
    expect(c.fieldId).toBeNull();
    expect(c.operatorId).toBeNull();
    expect(c.value).toBeNull();
  });

  it("newGroup starts as an AND group holding one empty condition", () => {
    const g = newGroup();
    expect(g).toMatchObject({ kind: "group", operator: "AND" });
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).toMatchObject({
      kind: "condition",
      individualId: null,
      fieldId: null,
      operatorId: null,
      value: null,
    });
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
    expect(found.children).toHaveLength(2);
    expect(found.children[1]).toBe(c);
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
    // 1 at the root + g's own starter condition + 2 added to g
    expect(countConditions(t)).toBe(4);
  });

  describe("stripCollapsed", () => {
    it("removes collapsed from every group, at any depth", () => {
      const root = emptyQuery();
      const g = newGroup();
      let t = addChild(root, root.id, g);
      t = updateNode(t, root.id, { collapsed: true });
      t = updateNode(t, g.id, { collapsed: false });
      const stripped = stripCollapsed(t) as import("../../src/query/types").Group;
      expect(stripped).not.toHaveProperty("collapsed");
      expect(stripped.children[0]).not.toHaveProperty("collapsed");
    });

    it("leaves everything else (ids, conditions, values) unchanged", () => {
      const root = emptyQuery();
      const c = newCondition();
      let t = addChild(root, root.id, c);
      t = updateNode(t, c.id, { fieldId: "a.b", operatorId: "eq", value: "x" });
      t = updateNode(t, root.id, { collapsed: true });
      const stripped = stripCollapsed(t) as import("../../src/query/types").Group;
      expect(stripped.id).toBe(t.id);
      expect(stripped.children[0]).toMatchObject({ fieldId: "a.b", operatorId: "eq", value: "x" });
    });

    it("two trees differing only in collapsed strip to the same shape", () => {
      const root = emptyQuery();
      const t1 = updateNode(root, root.id, { collapsed: true });
      const t2 = updateNode(root, root.id, { collapsed: false });
      expect(JSON.stringify(stripCollapsed(t1))).toBe(JSON.stringify(stripCollapsed(t2)));
    });
  });
});
