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
  sameTree,
  insertNodes,
  replaceLoneBlankCondition,
  moveNode,
  placeNodes,
} from "../../src/query/tree";
import type { Condition, Group } from "../../src/query/types";

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
    const found = findNode(next, g.id) as Group;
    expect(found.children).toHaveLength(2);
    expect(found.children[1]).toBe(c);
  });

  it("updateNode shallow-merges a patch into one node only", () => {
    const root = emptyQuery();
    const c = newCondition();
    const t1 = addChild(root, root.id, c);
    const t2 = updateNode(t1, c.id, { fieldId: "color", operatorId: "eq", value: "red" });
    const updated = findNode(t2, c.id) as Condition;
    expect(updated).toMatchObject({ fieldId: "color", operatorId: "eq", value: "red" });
    // original still null
    expect((findNode(t1, c.id) as Condition).fieldId).toBeNull();
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

describe("sameTree", () => {
  it("is true for equal trees that are different objects", () => {
    const root = emptyQuery();
    const tree = addChild(root, root.id, newCondition());
    expect(sameTree(tree, structuredClone(tree))).toBe(true);
  });

  it("counts a collapse toggle as a difference, unlike sameSemantics", () => {
    // The user sees a group fold, so something visible changed.
    const root = emptyQuery();
    const g = newGroup();
    const tree = addChild(root, root.id, g);
    expect(sameTree(tree, updateNode(tree, g.id, { collapsed: true }))).toBe(false);
  });

  it("notices a reorder and an edit", () => {
    const root = emptyQuery();
    const a = newCondition();
    const b = newCondition();
    const ab = addChild(addChild(root, root.id, a), root.id, b);
    const ba = addChild(addChild(root, root.id, b), root.id, a);
    expect(sameTree(ab, ba)).toBe(false);
    expect(sameTree(ab, updateNode(ab, a.id, { value: "x" }))).toBe(false);
  });
});

describe("insertNodes", () => {
  it("appends to a group", () => {
    const root = emptyQuery();
    const a = newCondition();
    const b = newCondition();
    const t = insertNodes(addChild(root, root.id, a), root.id, [b]);
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual([a.id, b.id]);
  });
  it("inserts before a condition", () => {
    const root = emptyQuery();
    const a = newCondition();
    const b = newCondition();
    const c = newCondition();
    const t = insertNodes(addChild(addChild(root, root.id, a), root.id, b), b.id, [c]);
    expect(t.children.map((n) => n.id)).toEqual([a.id, c.id, b.id]);
  });
  it("does nothing for an unknown target", () => {
    const root = emptyQuery();
    expect(insertNodes(root, "nope", [newCondition()])).toEqual(root);
  });
});

describe("replaceLoneBlankCondition", () => {
  it("swaps a group's only, blank condition for the new nodes (drop on the group)", () => {
    const root = emptyQuery();
    const blank = newCondition();
    const a = newCondition();
    const b = newCondition();
    const t = replaceLoneBlankCondition(addChild(root, root.id, blank), root.id, [a, b]);
    expect(t?.id).toBe(root.id);
    expect(t?.children.map((n) => n.id)).toEqual([a.id, b.id]);
  });
  it("does the same for a drop on the blank row itself", () => {
    const root = emptyQuery();
    const blank = newCondition();
    const a = newCondition();
    const t = replaceLoneBlankCondition(addChild(root, root.id, blank), blank.id, [a]);
    expect(t?.children.map((n) => n.id)).toEqual([a.id]);
  });
  it("works in a nested group (what + Group adds) and leaves the rest alone", () => {
    const root = emptyQuery();
    const sibling = newCondition();
    const group = newGroup();
    const a = newCondition();
    const q = addChild(addChild(root, root.id, sibling), root.id, group);
    const t = replaceLoneBlankCondition(q, group.id, [a]);
    expect(t?.children.map((n) => n.id)).toEqual([sibling.id, group.id]);
    const inner = t?.children[1];
    expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([a.id]);
  });
  it("keeps the group's ALL/ANY choice and fold state", () => {
    const root = emptyQuery();
    const q = updateNode(addChild(root, root.id, newCondition()), root.id, {
      operator: "OR",
      collapsed: true,
    });
    expect(replaceLoneBlankCondition(q, root.id, [newCondition()])).toMatchObject({
      operator: "OR",
      collapsed: true,
    });
  });
  it("is null when the group has no children", () => {
    const root = emptyQuery();
    expect(replaceLoneBlankCondition(root, root.id, [newCondition()])).toBeNull();
  });
  it("is null when the only condition has anything chosen", () => {
    const root = emptyQuery();
    const c = newCondition();
    const q = updateNode(addChild(root, root.id, c), c.id, { facetId: "x" });
    expect(replaceLoneBlankCondition(q, root.id, [newCondition()])).toBeNull();
  });
  it("is null when the group has more than one child", () => {
    const root = emptyQuery();
    const blank = newCondition();
    const q = addChild(addChild(root, root.id, blank), root.id, newCondition());
    expect(replaceLoneBlankCondition(q, root.id, [newCondition()])).toBeNull();
    expect(replaceLoneBlankCondition(q, blank.id, [newCondition()])).toBeNull();
  });
  it("is null when the only child is a group", () => {
    const root = emptyQuery();
    const q = addChild(root, root.id, newGroup());
    expect(replaceLoneBlankCondition(q, root.id, [newCondition()])).toBeNull();
  });
  it("is null for an unknown target or nothing to put in", () => {
    const root = emptyQuery();
    const q = addChild(root, root.id, newCondition());
    expect(replaceLoneBlankCondition(q, "nope", [newCondition()])).toBeNull();
    expect(replaceLoneBlankCondition(q, root.id, [])).toBeNull();
  });
});

describe("placeNodes", () => {
  it("replaces a lone blank row", () => {
    const root = emptyQuery();
    const a = newCondition();
    const t = placeNodes(addChild(root, root.id, newCondition()), root.id, [a]);
    expect(t.children.map((n) => n.id)).toEqual([a.id]);
  });
  it("otherwise inserts, like insertNodes", () => {
    const root = emptyQuery();
    const first = { ...newCondition(), facetId: "x" };
    const a = newCondition();
    const t = placeNodes(addChild(root, root.id, first), root.id, [a]);
    expect(t.children.map((n) => n.id)).toEqual([first.id, a.id]);
  });
});

describe("moveNode", () => {
  it("moves a condition into another group", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = addChild(t, root.id, g);
    const moved = moveNode(t, c.id, g.id)!;
    expect(moved.children.map((n) => n.id)).toEqual([g.id]);
    const inner = findNode(moved, g.id);
    expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([c.id]);
  });
  it("replaces the blank row of a group it is moved into", () => {
    const root = emptyQuery();
    const g = newGroup(); // one blank condition
    const c = { ...newCondition(), facetId: "x" };
    const t = addChild(addChild(root, root.id, c), root.id, g);
    const moved = moveNode(t, c.id, g.id)!;
    const inner = findNode(moved, g.id);
    expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([c.id]);
    expect(moved.children.map((n) => n.id)).toEqual([g.id]);
  });
  it("replaces a blank row it is dropped on, once it is the group's only child", () => {
    const root = emptyQuery();
    const blank = newCondition();
    const c = { ...newCondition(), facetId: "x" };
    const t = addChild(addChild(root, root.id, blank), root.id, c);
    // Taking `c` out leaves just the blank row, which `c` then replaces.
    expect(moveNode(t, c.id, blank.id)?.children.map((n) => n.id)).toEqual([c.id]);
  });
  it("reorders before a sibling and keeps the node's data", () => {
    const root = emptyQuery();
    const a = { ...newCondition(), facetId: "x" };
    const b = newCondition();
    const t = addChild(addChild(root, root.id, a), root.id, b);
    const moved = moveNode(t, b.id, a.id)!;
    expect(moved.children.map((n) => n.id)).toEqual([b.id, a.id]);
    expect(findNode(moved, a.id)).toMatchObject({ facetId: "x" });
  });
  it("refuses to move a group into itself or a descendant", () => {
    const root = emptyQuery();
    const outer = { ...newGroup(), children: [] };
    const inner = { ...newGroup(), children: [] };
    let t = addChild(root, root.id, outer);
    t = addChild(t, outer.id, inner);
    expect(moveNode(t, outer.id, outer.id)).toBeNull();
    expect(moveNode(t, outer.id, inner.id)).toBeNull();
  });
  it("refuses to move the root", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    expect(moveNode(addChild(root, root.id, g), root.id, g.id)).toBeNull();
  });
  it("returns null for unknown ids", () => {
    const root = emptyQuery();
    expect(moveNode(root, "a", "b")).toBeNull();
  });
  it("returns null for an unknown target, even when the node exists", () => {
    const root = emptyQuery();
    const c = newCondition();
    expect(moveNode(addChild(root, root.id, c), c.id, "nowhere")).toBeNull();
  });
  it("appends at the end of a group that already has children", () => {
    const root = emptyQuery();
    const moving = { ...newCondition(), facetId: "x" };
    const first = { ...newCondition(), facetId: "y" };
    const second = { ...newCondition(), facetId: "z" };
    const g = { ...newGroup(), children: [first, second] };
    const t = addChild(addChild(root, root.id, moving), root.id, g);
    const inner = findNode(moveNode(t, moving.id, g.id)!, g.id);
    expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([
      first.id,
      second.id,
      moving.id,
    ]);
  });
  it("leaves the input tree unchanged", () => {
    const root = emptyQuery();
    const c = { ...newCondition(), facetId: "x" };
    const g = { ...newGroup(), children: [] };
    const t = addChild(addChild(root, root.id, c), root.id, g);
    const before = structuredClone(t);
    moveNode(t, c.id, g.id);
    expect(t).toEqual(before);
  });
  it("refuses to move a group onto a condition inside it", () => {
    const root = emptyQuery();
    const c = newCondition();
    const g = { ...newGroup(), children: [c] };
    expect(moveNode(addChild(root, root.id, g), g.id, c.id)).toBeNull();
  });
});
