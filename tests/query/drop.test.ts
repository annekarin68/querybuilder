import { describe, it, expect } from "vitest";
import {
  addedMessage,
  dropNotice,
  movedMessage,
  nodesForItem,
  parseDragItem,
} from "../../src/query/drop";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import type { Condition } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, tags: string[], fields: Facet["fields"] = []): Facet => ({
  id,
  name: id.toUpperCase(),
  tags,
  group: "",
  comment: "",
  description: "",
  eventCount: 1,
  fields,
});
const fld = (id: string, typeName: string, values: string[] = []) => ({
  id,
  name: id,
  typeName,
  comment: "",
  description: "",
  values,
});
const facets = [
  facet(
    "a",
    ["t1"],
    [
      fld("size", "BIGINT", ["3.0", "7"]),
      fld("color", "VARCHAR(9)", ["red"]),
      fld("on", "BOOLEAN"),
    ],
  ),
  facet("b", ["t1", "t2"]),
  facet("c", []),
];
const catalog = buildFieldCatalog(facets);
const conds = (r: { nodes: unknown[] }) => r.nodes as Condition[];

describe("parseDragItem", () => {
  it("reads each kind", () => {
    expect(parseDragItem('{"type":"facet","facetId":"a"}')).toEqual({
      type: "facet",
      facetId: "a",
    });
    expect(parseDragItem('{"type":"field","facetId":"a","fieldId":"size"}')).toEqual({
      type: "field",
      facetId: "a",
      fieldId: "size",
    });
    expect(parseDragItem('{"type":"value","facetId":"a","fieldId":"size","value":"7"}')).toEqual({
      type: "value",
      facetId: "a",
      fieldId: "size",
      value: "7",
    });
    expect(parseDragItem('{"type":"tag","tag":"t1"}')).toEqual({ type: "tag", tag: "t1" });
    expect(parseDragItem('{"type":"node","nodeId":"c-1"}')).toEqual({
      type: "node",
      nodeId: "c-1",
    });
  });
  it("rejects anything else", () => {
    for (const bad of [
      "",
      "nope",
      "[]",
      "null",
      '{"type":"facet"}',
      '{"type":"zzz"}',
      '{"type":"field","facetId":"a"}',
      '{"type":"value","facetId":"a","fieldId":"b","value":3}',
    ]) {
      expect(parseDragItem(bad)).toBeNull();
    }
  });
});

describe("nodesForItem", () => {
  it("a facet becomes a facet-level 'present' condition", () => {
    const r = nodesForItem({ type: "facet", facetId: "a" }, facets, catalog);
    expect(r.problems).toEqual([]);
    expect(conds(r)).toHaveLength(1);
    expect(conds(r)[0]).toMatchObject({
      kind: "condition",
      facetId: "a",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });
  it("a field becomes a condition with no operator yet", () => {
    const r = nodesForItem({ type: "field", facetId: "a", fieldId: "size" }, facets, catalog);
    expect(conds(r)[0]).toMatchObject({
      facetId: "a",
      fieldId: "size",
      operatorId: null,
      value: null,
    });
  });
  it("a string value becomes 'eq'", () => {
    const r = nodesForItem(
      { type: "value", facetId: "a", fieldId: "color", value: "red" },
      facets,
      catalog,
    );
    expect(conds(r)[0]).toMatchObject({ fieldId: "color", operatorId: "eq", value: "red" });
  });
  it("a number field's value is sent as a number, matching the pick-list", () => {
    const r = nodesForItem(
      { type: "value", facetId: "a", fieldId: "size", value: "3" },
      facets,
      catalog,
    );
    expect(conds(r)[0]).toMatchObject({ operatorId: "eq", value: 3 });
  });
  it("a tag becomes one 'present' per facet carrying it", () => {
    const r = nodesForItem({ type: "tag", tag: "t1" }, facets, catalog);
    expect(conds(r).map((c) => c.facetId)).toEqual(["a", "b"]);
    expect(r.problems).toEqual([]);
  });
  it("every created condition has its own id", () => {
    const ids = conds(nodesForItem({ type: "tag", tag: "t1" }, facets, catalog)).map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });
  it("reports an unknown facet", () => {
    const r = nodesForItem({ type: "facet", facetId: "zzz" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems[0]).toMatch(/“zzz”.*not in the loaded data dictionary/);
    expect(r.problems[0]).toMatch(/dictionary may be out of date/);
  });
  it("reports an unknown field", () => {
    const r = nodesForItem({ type: "field", facetId: "a", fieldId: "nope" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems).toHaveLength(1);
  });
  it("reports a value that is not in the field's list, and a field with no list", () => {
    expect(
      nodesForItem(
        { type: "value", facetId: "a", fieldId: "color", value: "green" },
        facets,
        catalog,
      ).problems,
    ).toHaveLength(1);
    expect(
      nodesForItem({ type: "value", facetId: "a", fieldId: "on", value: "true" }, facets, catalog)
        .problems,
    ).toHaveLength(1);
  });
  it("reports a tag nobody carries", () => {
    const r = nodesForItem({ type: "tag", tag: "ghost" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems).toEqual(["The tag “ghost” has no facets."]);
  });
});

describe("dropNotice", () => {
  it("is null without problems", () => expect(dropNotice([])).toBeNull());
  it("joins problems", () => expect(dropNotice(["One.", "Two."])).toBe("One. Two."));
});

describe("addedMessage / movedMessage (read out to screen readers)", () => {
  it("says how many conditions were added", () => {
    expect(addedMessage(1)).toBe("Added 1 condition to the query.");
    expect(addedMessage(3)).toBe("Added 3 conditions to the query.");
  });
  it("says what was moved", () => {
    expect(movedMessage("condition")).toBe("Moved the condition.");
    expect(movedMessage("group")).toBe("Moved the group.");
  });
});
