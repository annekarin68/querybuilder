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
  sameSemantics,
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

  it("newCondition starts with no facet, field, operator, or value", () => {
    const c = newCondition();
    expect(c.facetId).toBeNull();
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
      facetId: null,
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
});

describe("sameSemantics", () => {
  it("ignores a collapse toggle but not a real edit", () => {
    const root = emptyQuery();
    const g = newGroup();
    const tree = addChild(root, root.id, g);
    const collapsed = updateNode(tree, g.id, { collapsed: true });
    expect(sameSemantics(tree, collapsed)).toBe(true);
    expect(sameSemantics(tree, updateNode(tree, g.id, { operator: "OR" }))).toBe(false);
  });

  it("ignores collapsed at any depth, set either way", () => {
    const root = emptyQuery();
    const g = newGroup();
    const tree = addChild(root, root.id, g);
    const folded = updateNode(updateNode(tree, root.id, { collapsed: true }), g.id, {
      collapsed: false,
    });
    expect(sameSemantics(tree, folded)).toBe(true);
  });

  it("notices a changed value even when collapsed also changed", () => {
    const root = emptyQuery();
    const c = newCondition();
    const tree = updateNode(addChild(root, root.id, c), c.id, { fieldId: "a.b", value: "x" });
    const edited = updateNode(updateNode(tree, root.id, { collapsed: true }), c.id, { value: "y" });
    expect(sameSemantics(tree, edited)).toBe(false);
  });

  it("does not modify the trees it compares", () => {
    const root = emptyQuery();
    const folded = { ...root, collapsed: true };
    sameSemantics(root, folded);
    expect(folded.collapsed).toBe(true);
  });
});
