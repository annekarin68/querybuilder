import { describe, it, expect } from "vitest";
import { validateQuery } from "../../src/query/validate";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, fields: [string, string][]): Facet =>
  ({
    id,
    name: id,
    tags: [],
    fields: fields.map(([fid, typeName]) => ({ id: fid, name: fid, typeName, values: [] })),
  }) as unknown as Facet;
const catalog = buildFieldCatalog([
  facet("thing", [
    ["size", "BIGINT"],
    ["label", "VARCHAR"],
  ]),
]);

const block = (...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock("thing"),
  conditions,
});
const query = (...children: Group["children"]): Group => ({ ...emptyQuery(), children });
const issues = (q: Group) => validateQuery(q, catalog).map((i) => [i.kind, i.message]);

describe("validateQuery with facet blocks", () => {
  it("accepts an empty root: not finished, but nothing to fix", () => {
    expect(issues(emptyQuery())).toEqual([]);
  });

  it("asks for a facet in an empty group below the root", () => {
    expect(issues(query(groupOf([])))).toEqual([["incomplete", "Add a facet to this group."]]);
  });

  it("accepts a block with nothing set (the facet is present / absent)", () => {
    expect(issues(query(block()))).toEqual([]);
  });

  it("rejects a block for an unknown facet", () => {
    expect(issues(query({ ...newBlock("nope") }))).toEqual([["invalid", "Unknown facet."]]);
  });

  it("checks every set field", () => {
    expect(issues(query(block(newFieldCondition("size", "gt", 3))))).toEqual([]);
    expect(issues(query(block(newFieldCondition("size", "gt", null))))).toEqual([
      ["incomplete", "Enter a value."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "gt", "big"))))).toEqual([
      ["invalid", "Enter a number."],
    ]);
    expect(issues(query(block(newFieldCondition("nope", "eq", 1))))).toEqual([
      [
        "invalid",
        "Unknown field “nope”. The data dictionary may have changed; remove this condition.",
      ],
    ]);
    expect(issues(query(block(newFieldCondition("size", null, null))))).toEqual([
      ["incomplete", "Choose an operator."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "contains", "x"))))).toEqual([
      ["invalid", "That operator isn't available for this field."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "between", [9, 2]))))).toEqual([
      ["invalid", "From must not be greater than To."],
    ]);
  });

  it("checks not_in like in", () => {
    expect(issues(query(block(newFieldCondition("label", "not_in", ["a", "b"]))))).toEqual([]);
    expect(issues(query(block(newFieldCondition("label", "not_in", []))))).toEqual([
      ["incomplete", "Choose at least one value."],
    ]);
  });

  it("rejects a field set twice in one block (only a tampered saved query can do that)", () => {
    const twice = block(newFieldCondition("size", "gt", 1), newFieldCondition("size", "lt", 9));
    expect(issues(query(twice))).toEqual([
      ["invalid", "The field “size” is set twice in this facet."],
    ]);
  });

  it("points each issue at the condition, the block or the group", () => {
    const c = newFieldCondition("size", "gt", null);
    const b = block(c);
    const unknown = newBlock("nope");
    const g = groupOf([]);
    const ids = validateQuery(query(b, unknown, g), catalog).map((i) => i.nodeId);
    expect(ids).toEqual([c.id, unknown.id, g.id]);
  });

  it("puts the issues of a stray condition on that condition, which gets a removable row", () => {
    // An unknown field and a second condition for one field have no ordinary
    // row; the builder draws each as a row of its own, so the issue sits there.
    const gone = newFieldCondition("nope", "eq", 1);
    const first = newFieldCondition("size", "gt", 1);
    const second = newFieldCondition("size", "lt", 9);
    const ids = validateQuery(query(block(gone), block(first, second)), catalog).map(
      (i) => i.nodeId,
    );
    expect(ids).toEqual([gone.id, second.id]);
  });
});
