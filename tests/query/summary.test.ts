import { describe, it, expect } from "vitest";
import { blockText, queryToText } from "../../src/query/summary";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, name: string, fields: [string, string][]): Facet =>
  ({
    id,
    name,
    tags: [],
    fields: fields.map(([fid, typeName]) => ({ id: fid, name: fid, typeName, values: [] })),
  }) as unknown as Facet;
const catalog = buildFieldCatalog([
  facet("thing", "Thing", [
    ["size", "BIGINT"],
    ["label", "VARCHAR"],
  ]),
  facet("other", "Other", [["when", "TIMESTAMP"]]),
]);
const block = (facetId: string, ...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock(facetId),
  conditions,
});

describe("blockText", () => {
  it("says present / absent when nothing is set", () => {
    expect(blockText(block("thing"), catalog)).toBe("Thing present");
    expect(blockText({ ...block("thing"), negated: true }, catalog)).toBe("Thing absent");
  });

  it("writes one set field without brackets", () => {
    expect(blockText(block("thing", newFieldCondition("size", "gt", 40)), catalog)).toBe(
      "Thing has size > 40",
    );
  });

  it("always brackets what has no applies to, even one field", () => {
    const one = { ...block("thing", newFieldCondition("size", "gt", 40)), negated: true };
    expect(blockText(one, catalog)).toBe("Thing has no (size > 40)");
  });

  it("brackets two or more, joined by the block's ALL / ANY, in the facet's field order", () => {
    const b = block(
      "thing",
      newFieldCondition("label", "in", ["a", "b"]),
      newFieldCondition("size", "between", [20, 80]),
    );
    expect(blockText(b, catalog)).toBe("Thing has (size between (20, 80) AND label in (a, b))");
    expect(blockText({ ...b, operator: "OR", negated: true }, catalog)).toBe(
      "Thing has no (size between (20, 80) OR label in (a, b))",
    );
  });

  it("writes every operator in its short form", () => {
    const one = (operatorId: string, value: unknown, fieldId = "size") =>
      blockText(block("thing", newFieldCondition(fieldId, operatorId, value)), catalog);
    expect(one("eq", 1)).toBe("Thing has size = 1");
    expect(one("neq", 1)).toBe("Thing has size ≠ 1");
    expect(one("gte", 1)).toBe("Thing has size ≥ 1");
    expect(one("lt", 1)).toBe("Thing has size < 1");
    expect(one("lte", 1)).toBe("Thing has size ≤ 1");
    expect(one("contains", "x", "label")).toBe("Thing has label contains x");
    expect(one("not_in", ["a"], "label")).toBe("Thing has label not in (a)");
    expect(one("present", null)).toBe("Thing has size present");
    expect(one("absent", null)).toBe("Thing has size absent");
    expect(blockText(block("other", newFieldCondition("when", "before", "2024")), catalog)).toBe(
      "Other has when before 2024",
    );
  });

  describe("a value not entered yet", () => {
    const text = (operatorId: string, value: unknown, fieldId = "size") =>
      blockText(block("thing", newFieldCondition(fieldId, operatorId, value)), catalog);

    it("shows (value?) for a missing single value, null or empty text", () => {
      expect(text("gte", null)).toBe("Thing has size ≥ (value?)");
      expect(text("gte", "")).toBe("Thing has size ≥ (value?)");
    });

    it("shows (value?) for each missing end of a range", () => {
      expect(text("between", null)).toBe("Thing has size between (value?)");
      expect(text("between", [5, ""])).toBe("Thing has size between (5, (value?))");
      expect(text("between", [null, 9])).toBe("Thing has size between ((value?), 9)");
    });

    it("shows (value?) when no value of a list is chosen", () => {
      expect(text("in", [], "label")).toBe("Thing has label in (value?)");
    });

    it("still prints false and 0: they are values", () => {
      expect(text("eq", false, "label")).toBe("Thing has label = false");
      expect(text("eq", 0)).toBe("Thing has size = 0");
    });
  });

  it("marks what is not filled in yet", () => {
    expect(blockText(block("thing", newFieldCondition("size", "gt", null)), catalog)).toBe(
      "Thing has size > (value?)",
    );
    expect(blockText(block("thing", newFieldCondition("size", null, null)), catalog)).toBe(
      "Thing has size (operator?)",
    );
    expect(blockText(block("nope"), catalog)).toBe("(facet?) present");
  });
});

describe("queryToText", () => {
  it("joins blocks with the group's ALL / ANY and brackets sub-groups", () => {
    const q: Group = {
      ...emptyQuery(),
      children: [
        block("thing", newFieldCondition("size", "gt", 40)),
        groupOf([block("other"), { ...block("thing"), negated: true }], "OR"),
      ],
    };
    expect(queryToText(q, catalog)).toBe("Thing has size > 40 AND (Other present OR Thing absent)");
  });

  it("names an empty query and an empty group", () => {
    expect(queryToText(emptyQuery(), catalog)).toBe("(empty query)");
    expect(queryToText({ ...emptyQuery(), children: [groupOf([])] }, catalog)).toBe("()");
  });
});
