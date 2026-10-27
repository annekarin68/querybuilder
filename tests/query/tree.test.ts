import { describe, it, expect } from "vitest";
import {
  addChild,
  countBlocks,
  emptyQuery,
  findNode,
  groupContents,
  groupOf,
  insertNodes,
  moveNode,
  moveSibling,
  newBlock,
  newFieldCondition,
  newGroup,
  positionOf,
  removeCondition,
  removeNode,
  sameSemantics,
  sameTree,
  setFieldCondition,
  setNegated,
  ungroup,
  ungroupBlocker,
  updateNode,
} from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";

/** A root holding two blocks and a sub-group with a third. */
function sample() {
  const a = newBlock("thing");
  const b = newBlock("other");
  const c = newBlock("thing");
  const inner = groupOf([c], "OR");
  const root: Group = { ...emptyQuery(), children: [a, b, inner] };
  return { root, a, b, c, inner };
}

describe("new nodes", () => {
  it("starts with an empty ALL root and makes ids by kind", () => {
    const root = emptyQuery();
    expect(root).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(root.id).toMatch(/^g-/);
    expect(newBlock("thing")).toMatchObject({
      kind: "facet",
      facetId: "thing",
      negated: false,
      operator: "AND",
      conditions: [],
    });
    expect(newBlock("thing").id).toMatch(/^f-/);
    expect(newFieldCondition("size", "gt", 3).id).toMatch(/^c-/);
  });

  it("gives every node its own id", () => {
    expect(newBlock("x").id).not.toBe(newBlock("x").id);
  });

  it("makes an empty group for + Group", () => {
    expect(newGroup()).toMatchObject({ kind: "group", operator: "AND", children: [] });
  });
});

describe("editing", () => {
  it("adds, updates and removes nodes without changing the old tree", () => {
    const { root, a, inner } = sample();
    const block = newBlock("third");
    const added = addChild(root, inner.id, block);
    expect((findNode(added, inner.id) as Group).children).toHaveLength(2);
    expect(inner.children).toHaveLength(1);
    const folded = updateNode(added, a.id, { collapsed: true });
    expect(findNode(folded, a.id)).toMatchObject({ collapsed: true });
    expect(findNode(removeNode(folded, a.id), a.id)).toBeNull();
  });

  it("sets Has / Has no on a block, and only on a block", () => {
    const { root, a, inner } = sample();
    const negated = setNegated(root, a.id, true);
    expect(findNode(negated, a.id)).toMatchObject({ negated: true });
    expect(findNode(setNegated(negated, a.id, false), a.id)).toMatchObject({ negated: false });
    expect(a.negated).toBe(false); // the old tree is unchanged
    // A group has no Has / Has no: asking for it changes nothing.
    expect(findNode(setNegated(root, inner.id, true), inner.id)).not.toHaveProperty("negated");
    expect(setNegated(root, "nope", true)).toEqual(root);
  });

  it("puts a new condition in the facet's field order when given it", () => {
    const { root, a } = sample();
    const order = ["size", "name", "colour"];
    const size = newFieldCondition("size", "gt", 3);
    const colour = newFieldCondition("colour", "eq", "red");
    const name = newFieldCondition("name", "eq", "x");
    let tree = setFieldCondition(root, a.id, size, order);
    tree = setFieldCondition(tree, a.id, colour, order);
    tree = setFieldCondition(tree, a.id, name, order); // between the two, not at the end
    const fieldIds = () => (findNode(tree, a.id) as FacetBlock).conditions.map((c) => c.fieldId);
    expect(fieldIds()).toEqual(["size", "name", "colour"]);
    // Clear-then-set no longer moves a condition to the end.
    tree = removeCondition(tree, a.id, size.id);
    tree = setFieldCondition(tree, a.id, size, order);
    expect(fieldIds()).toEqual(["size", "name", "colour"]);
  });

  it("puts a field the order doesn't know at the end", () => {
    const { root, a } = sample();
    const first = setFieldCondition(root, a.id, newFieldCondition("size", "gt", 3), ["size"]);
    const next = setFieldCondition(first, a.id, newFieldCondition("odd", "eq", 1), ["size"]);
    expect((findNode(next, a.id) as FacetBlock).conditions.map((c) => c.fieldId)).toEqual([
      "size",
      "odd",
    ]);
  });

  it("sets a field condition, replacing the same field's, and removes it", () => {
    const { root, a } = sample();
    const first = newFieldCondition("size", "gt", 3);
    const once = setFieldCondition(root, a.id, first);
    const again = setFieldCondition(once, a.id, { ...first, operatorId: "lt", value: 9 });
    const block = findNode(again, a.id) as FacetBlock;
    expect(block.conditions).toEqual([{ ...first, operatorId: "lt", value: 9 }]);
    const other = setFieldCondition(again, a.id, newFieldCondition("name", "eq", "x"));
    expect((findNode(other, a.id) as FacetBlock).conditions.map((c) => c.fieldId)).toEqual([
      "size",
      "name",
    ]);
    const sizeId = (findNode(other, a.id) as FacetBlock).conditions[0]!.id;
    const cleared = removeCondition(other, a.id, sizeId);
    expect((findNode(cleared, a.id) as FacetBlock).conditions.map((c) => c.fieldId)).toEqual([
      "name",
    ]);
  });

  it("counts blocks at any depth", () => {
    expect(countBlocks(sample().root)).toBe(3);
    expect(countBlocks(emptyQuery())).toBe(0);
  });

  it("tells a fold from a real edit", () => {
    const { root, a } = sample();
    const folded = updateNode(root, a.id, { collapsed: true });
    expect(sameSemantics(root, folded)).toBe(true);
    expect(sameTree(root, folded)).toBe(false);
    expect(sameSemantics(root, setNegated(root, a.id, true))).toBe(false);
  });
});

describe("placing and moving", () => {
  it("inserts at the end of a group, or just before a block", () => {
    const { root, a, b } = sample();
    const n = newBlock("new");
    expect(insertNodes(root, root.id, [n]).children.at(-1)).toBe(n);
    expect(insertNodes(root, b.id, [n]).children.map((c) => c.id)).toEqual([
      a.id,
      n.id,
      b.id,
      root.children[2]!.id,
    ]);
    expect(insertNodes(root, "nope", [n])).toBe(root);
  });

  it("moves a block into a group and refuses impossible moves", () => {
    const { root, a, inner } = sample();
    const moved = moveNode(root, a.id, inner.id)!;
    expect((findNode(moved, inner.id) as Group).children.at(-1)!.id).toBe(a.id);
    expect(moveNode(root, root.id, a.id)).toBeNull();
    expect(moveNode(root, inner.id, inner.children[0]!.id)).toBeNull();
    expect(moveNode(root, "nope", a.id)).toBeNull();
  });

  it("swaps siblings and says where a node stands", () => {
    const { root, a, b } = sample();
    const swapped = moveSibling(root, b.id, "up")!;
    expect(swapped.children.slice(0, 2).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(positionOf(swapped, b.id)).toEqual({ index: 1, count: 3 });
    expect(moveSibling(root, a.id, "up")).toBeNull();
  });

  it("swaps down too, and stops at the end", () => {
    const { root, a, b, inner } = sample();
    const swapped = moveSibling(root, a.id, "down")!;
    expect(swapped.children.map((c) => c.id)).toEqual([b.id, a.id, inner.id]);
    expect(positionOf(swapped, a.id)).toEqual({ index: 2, count: 3 });
    expect(moveSibling(root, inner.id, "down")).toBeNull();
    expect(moveSibling(root, root.id, "down")).toBeNull();
    expect(moveSibling(root, "gone", "up")).toBeNull();
  });
});

describe("grouping", () => {
  it("groups a group's contents and ungroups them again without changing the meaning", () => {
    const { root } = sample();
    const grouped = groupContents(root, root.id);
    expect(grouped.children).toHaveLength(1);
    const innerId = grouped.children[0]!.id;
    expect(ungroupBlocker(grouped, innerId)).toBeNull();
    expect(ungroup(grouped, innerId)!.children.map((c) => c.id)).toEqual(
      root.children.map((c) => c.id),
    );
  });

  it("ungroups a one-item group whatever its ALL/ANY, in its place", () => {
    const { root, a, c, inner } = sample(); // inner: OR of c only, root: AND
    expect(ungroupBlocker(root, inner.id)).toBeNull();
    expect(ungroup(root, inner.id)!.children.map((n) => n.id)).toEqual([
      a.id,
      root.children[1]!.id,
      c.id,
    ]);
  });

  it("refuses to ungroup when the meaning would change", () => {
    const { root, inner } = sample();
    const two = addChild(root, inner.id, newBlock("more")); // inner: OR of two, root: AND
    expect(ungroupBlocker(two, inner.id)).toMatch(/both ALL or both ANY/);
    expect(ungroup(two, inner.id)).toBeNull();
    expect(ungroupBlocker(two, two.id)).toBe("The whole query can't be ungrouped.");
  });

  it("says a block is not a group, and an unknown id is gone", () => {
    const { root, a } = sample();
    expect(ungroupBlocker(root, a.id)).toBe("Only a group can be ungrouped.");
    expect(ungroup(root, a.id)).toBeNull();
    expect(ungroupBlocker(root, "nope")).toBe("That group is no longer in the query.");
  });
});

describe("removeCondition", () => {
  it("removes one condition by its id, even when another has the same field", () => {
    const a = newFieldCondition("size", "gt", 1);
    const b = newFieldCondition("size", "lt", 9);
    const block: FacetBlock = { ...newBlock("thing"), conditions: [a, b] };
    const root: Group = { ...emptyQuery(), children: [block] };
    const next = removeCondition(root, block.id, b.id);
    expect((findNode(next, block.id) as FacetBlock).conditions).toEqual([a]);
  });
});
