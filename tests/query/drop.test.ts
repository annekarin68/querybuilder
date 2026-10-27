import { describe, it, expect } from "vitest";
import {
  addedNodesMessage,
  dropItem,
  movedMessage,
  parseDragItem,
  reorderedMessage,
} from "../../src/query/drop";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, findNode, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: ["t"],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: ["3", "4"] },
      { id: "label", name: "label", typeName: "VARCHAR", values: ["a"] },
    ],
  },
  { id: "other", name: "Other", tags: ["t"], fields: [] },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const withBlock = () => {
  const block = newBlock("thing");
  const query: Group = { ...emptyQuery(), children: [block] };
  return { query, block };
};

describe("parseDragItem", () => {
  it("reads our own payloads and nothing else", () => {
    expect(parseDragItem('{"type":"facet","facetId":"thing"}')).toEqual({
      type: "facet",
      facetId: "thing",
    });
    expect(parseDragItem('{"type":"facet"}')).toBeNull();
    expect(parseDragItem("not json")).toBeNull();
  });
});

describe("dropItem", () => {
  it("adds a facet as a new block at the end of the group", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "thing" }, q.id, facets, catalog);
    expect(out.problems).toEqual([]);
    expect(out.query.children).toHaveLength(1);
    expect(out.query.children[0]).toMatchObject({ kind: "facet", facetId: "thing" });
    expect(out.added).toEqual(out.query.children);
    expect(out.select).toBeNull();
  });

  it("puts a drop on a block just before it", () => {
    const { query, block } = withBlock();
    const out = dropItem(query, { type: "facet", facetId: "other" }, block.id, facets, catalog);
    expect(out.query.children.map((c) => (c as FacetBlock).facetId)).toEqual(["other", "thing"]);
  });

  it("focuses the row when a field is dropped on a block of its facet", () => {
    const { query, block } = withBlock();
    const out = dropItem(
      query,
      { type: "field", facetId: "thing", fieldId: "size" },
      block.id,
      facets,
      catalog,
    );
    expect(out.query).toBe(query);
    expect(out.added).toEqual([]);
    expect(out.select).toEqual({ blockId: block.id, fieldId: "size" });
  });

  it("adds a new block for a field dropped anywhere else, and focuses its row", () => {
    const q = emptyQuery();
    const out = dropItem(
      q,
      { type: "field", facetId: "thing", fieldId: "size" },
      q.id,
      facets,
      catalog,
    );
    const added = out.query.children[0] as FacetBlock;
    expect(added.conditions).toEqual([]);
    expect(out.select).toEqual({ blockId: added.id, fieldId: "size" });
  });

  it("fills an unset row with equals value (a number field gets a number)", () => {
    const { query, block } = withBlock();
    const out = dropItem(
      query,
      { type: "value", facetId: "thing", fieldId: "size", value: "3" },
      block.id,
      facets,
      catalog,
    );
    const filled = findNode(out.query, block.id) as FacetBlock;
    expect(filled.conditions).toMatchObject([{ fieldId: "size", operatorId: "eq", value: 3 }]);
    expect(out.added).toEqual([]);
    expect(out.select).toEqual({ blockId: block.id, fieldId: "size" });
  });

  it("never overwrites a set row: a value for it becomes a new block", () => {
    const block: FacetBlock = {
      ...newBlock("thing"),
      conditions: [newFieldCondition("size", "gt", 1)],
    };
    const query: Group = { ...emptyQuery(), children: [block] };
    const out = dropItem(
      query,
      { type: "value", facetId: "thing", fieldId: "size", value: "4" },
      block.id,
      facets,
      catalog,
    );
    expect((findNode(out.query, block.id) as FacetBlock).conditions[0]!.value).toBe(1);
    expect(out.query.children).toHaveLength(2);
    expect(out.query.children[0]).toMatchObject({
      conditions: [{ fieldId: "size", operatorId: "eq", value: 4 }],
    });
  });

  it("adds a tag's facets as one ALL group of blocks", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "tag", tag: "t" }, q.id, facets, catalog);
    expect(out.query.children).toHaveLength(1);
    expect(out.query.children[0]).toMatchObject({ kind: "group", operator: "AND" });
    expect(addedNodesMessage(out.added)).toBe("Added a group of 2 facets to the query.");
  });

  it("explains what it can't add, and changes nothing", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "nope" }, q.id, facets, catalog);
    expect(out.query).toBe(q);
    expect(out.problems[0]).toMatch(/Couldn't add “nope”/);
    const value = dropItem(
      q,
      { type: "value", facetId: "thing", fieldId: "size", value: "9" },
      q.id,
      facets,
      catalog,
    );
    expect(value.problems).toEqual(["Couldn't add “9”: it is not one of size's known values."]);
  });

  it("adds at the root when the target is gone (a stale drop)", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "thing" }, "gone", facets, catalog);
    expect(out.query.children).toHaveLength(1);
  });
});

describe("messages", () => {
  it("counts facets and names what moved", () => {
    expect(addedNodesMessage([newBlock("thing")])).toBe("Added 1 facet to the query.");
    expect(movedMessage("facet")).toBe("Moved the facet.");
    expect(reorderedMessage("facet", "up", { index: 1, count: 3 })).toBe(
      "Moved the facet up, to position 1 of 3.",
    );
  });
});
