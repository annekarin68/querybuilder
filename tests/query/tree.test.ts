import { describe, it, expect } from "vitest";
import {
  addChild,
  clearFieldCondition,
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
  removeNode,
  sameSemantics,
  sameTree,
  setFieldCondition,
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
    const negated = updateNode(added, a.id, { negated: true });
    expect(findNode(negated, a.id)).toMatchObject({ negated: true });
    expect(findNode(removeNode(negated, a.id), a.id)).toBeNull();
  });

  it("sets a field condition, replacing the same field's, and clears it", () => {
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
    const cleared = clearFieldCondition(other, a.id, "size");
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
    expect(sameSemantics(root, updateNode(root, a.id, { negated: true }))).toBe(false);
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

  it("refuses to ungroup when the meaning would change", () => {
    const { root, inner } = sample();
    const two = addChild(root, inner.id, newBlock("more")); // inner: OR of two, root: AND
    expect(ungroupBlocker(two, inner.id)).toMatch(/both ALL or both ANY/);
    expect(ungroup(two, inner.id)).toBeNull();
    expect(ungroupBlocker(two, two.id)).toBe("The whole query can't be ungrouped.");
  });
});
