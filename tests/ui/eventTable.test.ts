import { describe, it, expect } from "vitest";
import type { EventRecord, Facet } from "../../src/model";
import { cellSets, shortId, tableColumns } from "../../src/ui/eventTable";

const facet = (id: string, number: number, fields: string[] = []): Facet => ({
  id,
  name: id.toUpperCase(),
  number,
  tags: [],
  group: "",
  comment: "",
  description: "",
  eventCount: 0,
  fields: fields.map((f) => ({
    id: f,
    name: `${f} name`,
    typeName: "VARCHAR",
    comment: "",
    description: "",
    values: [],
  })),
});

const facets = [facet("b", 2, ["x"]), facet("a", 1, ["pos", "val"]), facet("c", 3)];

const event = (id: string, values: EventRecord["values"]): EventRecord => ({ id, values });

const events = [
  event("e1", {
    b: [{ x: 1 }],
    a: [
      { val: 2.2, pos: "right" },
      { pos: "left", val: 1.1 },
    ],
  }),
  event("e2", { b: [{ x: 2 }], zz: [{ k: "v" }] }),
];

describe("tableColumns", () => {
  it("has a column for each facet some result holds, by facet number", () => {
    expect(tableColumns(events, facets, []).map((c) => c.facetId)).toEqual(["a", "b", "zz"]);
  });

  it("puts the FIRST_COLUMNS facets first, in their order", () => {
    expect(tableColumns(events, facets, ["b"]).map((c) => c.facetId)).toEqual(["b", "a", "zz"]);
  });

  it("keeps several FIRST_COLUMNS facets in their listed order, even against facet number", () => {
    expect(tableColumns(events, facets, ["b", "a"]).map((c) => c.facetId)).toEqual([
      "b",
      "a",
      "zz",
    ]);
  });

  it("orders known facets with the same number by id, whatever the event order", () => {
    const tied = [facet("y", 5), facet("x", 5)];
    const inEventOrder = [event("e", { y: [{ k: 1 }], x: [{ k: 1 }] })];
    expect(tableColumns(inEventOrder, tied, []).map((c) => c.facetId)).toEqual(["x", "y"]);
  });

  it("gives no column to a FIRST_COLUMNS facet that no result holds", () => {
    expect(tableColumns(events, facets, ["c", "b"]).map((c) => c.facetId)).toEqual([
      "b",
      "a",
      "zz",
    ]);
  });

  it("counts results over the whole sample and names the column", () => {
    const [a, b, zz] = tableColumns(events, facets, []);
    expect(a).toMatchObject({ name: "A", resultCount: 1 });
    expect(b).toMatchObject({ name: "B", resultCount: 2 });
    expect(zz).toMatchObject({ name: "zz", resultCount: 1, fields: [] });
  });

  it("puts facets the dictionary does not know last, by id", () => {
    const more = [...events, event("e3", { aa: [{ k: 1 }] })];
    expect(tableColumns(more, facets, []).map((c) => c.facetId)).toEqual(["a", "b", "aa", "zz"]);
  });

  it("ignores a facet listed with no occurrences", () => {
    expect(tableColumns([event("e", { a: [] })], facets, [])).toEqual([]);
  });
});

describe("cellSets", () => {
  const [a, , zz] = tableColumns(events, facets, []);

  it("keeps each occurrence as its own set, fields in dictionary order", () => {
    expect(cellSets(events[0]!, a!)).toEqual([
      [
        { name: "pos name", value: "right" },
        { name: "val name", value: "2.2" },
      ],
      [
        { name: "pos name", value: "left" },
        { name: "val name", value: "1.1" },
      ],
    ]);
  });

  it("is empty for a result without the facet", () => {
    expect(cellSets(events[1]!, a!)).toEqual([]);
  });

  it("names unknown fields by their key, after the known ones, sorted", () => {
    const col = tableColumns([event("e", { a: [{ z: 1, pos: "p", b: true }] })], facets, [])[0]!;
    expect(cellSets(event("e", { a: [{ z: 1, pos: "p", b: true }] }), col)).toEqual([
      [
        { name: "pos name", value: "p" },
        { name: "b", value: "true" },
        { name: "z", value: "1" },
      ],
    ]);
    expect(cellSets(events[1]!, zz!)).toEqual([[{ name: "k", value: "v" }]]);
  });

  it("keeps an occurrence with no values as an empty set", () => {
    expect(cellSets(event("e", { a: [{}] }), a!)).toEqual([[]]);
  });

  it("is empty, not an error, for a facet named like a built-in property that the result lacks", () => {
    const col = tableColumns([event("e1", { constructor: [{ k: 1 }] })], facets, [])[0]!;
    expect(cellSets(event("e2", { a: [{ pos: "p" }] }), col)).toEqual([]);
  });

  it("treats a field named like a built-in object property as missing when absent", () => {
    const withBuiltin = [facet("a", 1, ["constructor", "pos"])];
    const col = tableColumns([event("e", { a: [{ pos: "p" }] })], withBuiltin, [])[0]!;
    expect(cellSets(event("e", { a: [{ pos: "p" }] }), col)).toEqual([
      [{ name: "pos name", value: "p" }],
    ]);
  });
});

describe("shortId", () => {
  it("cuts a GUID to its first 8 characters", () => {
    expect(shortId("6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10")).toBe("6f1c2a9e…");
  });
  it("keeps a short id as it is", () => {
    expect(shortId("e-12")).toBe("e-12");
  });
});
