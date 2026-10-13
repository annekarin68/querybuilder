import { describe, it, expect } from "vitest";
import type { EventRecord, Facet } from "../../src/model";
import {
  cellSets,
  eventTableHtml,
  pagingHtml,
  shortId,
  tableColumns,
} from "../../src/ui/eventTable";
import { pageOf } from "../../src/util/paging";

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

describe("eventTableHtml", () => {
  const columns = tableColumns(events, facets, []);
  const html = eventTableHtml(events, columns, pageOf(events.length, 0), "en-US");

  it("is a real table in a focusable, labelled scroll box with a hidden caption", () => {
    expect(html).toContain(
      '<div class="qb-et-scroll" tabindex="0" role="region" aria-label="Matching events table">',
    );
    expect(html).toContain('<caption class="qb-sr-only">Matching events</caption>');
  });

  it("heads each facet column with its name and how many results hold it", () => {
    expect(html).toContain(
      '<th scope="col"><span class="qb-et-facet">A</span><span class="qb-et-count">in 1 of 2 results</span></th>',
    );
  });

  it("makes each row's id cell its row header, holding the button that opens its JSON", () => {
    expect(html).toContain(
      '<th scope="row" class="qb-et-id"><button type="button" class="qb-et-id-btn" data-action="open-event" data-event-id="e1" aria-label="Show event e1 as JSON" title="Event e1">#e1</button></th>',
    );
  });

  it("draws each occurrence as its own set", () => {
    expect(html).toContain(
      '<ul class="qb-et-sets"><li><dl class="qb-et-set"><dt>pos name</dt><dd>right</dd><dt>val name</dt><dd>2.2</dd></dl></li><li><dl class="qb-et-set"><dt>pos name</dt><dd>left</dd><dt>val name</dt><dd>1.1</dd></dl></li></ul>',
    );
  });

  it("shows — for an occurrence with no values, and nothing for a missing facet", () => {
    const empty = eventTableHtml(
      [event("e", { a: [{}] })],
      tableColumns([event("e", { a: [{}] })], facets, []),
      pageOf(1, 0),
    );
    expect(empty).toContain('<li><span class="qb-et-empty">—</span></li>');
    expect(html).toContain("<td></td>");
  });

  it("escapes every text", () => {
    const bad = [event('"><img>', { a: [{ pos: "<b>" }] })];
    const out = eventTableHtml(bad, tableColumns(bad, facets, []), pageOf(1, 0));
    expect(out).not.toContain("<img>");
    expect(out).not.toContain("<b>");
  });

  it("shows only the rows of the page, and says which page in the caption", () => {
    const many = Array.from({ length: 150 }, (_, i) => event(`e${i}`, { b: [{ x: i }] }));
    const second = eventTableHtml(many, tableColumns(many, facets, []), pageOf(150, 1));
    expect(second).toContain("Matching events, page 2 of 2");
    expect(second).toContain('data-event-id="e100"');
    expect(second).not.toContain('data-event-id="e99"');
  });
});

describe("pagingHtml", () => {
  it("says how many results when they fit on one page, with no buttons", () => {
    expect(pagingHtml(pageOf(42, 0), "en-US")).toBe('<p class="qb-et-paging">42 results</p>');
  });

  it("says which results are shown, with Previous and Next", () => {
    const html = pagingHtml(pageOf(1987, 1), "en-US");
    expect(html).toContain("Results 101–200 of 1,987");
    expect(html).toContain('data-action="previous-event-page" data-page="0">Previous</button>');
    expect(html).toContain('data-action="next-event-page" data-page="2">Next</button>');
  });

  it("disables Previous on the first page and Next on the last", () => {
    expect(pagingHtml(pageOf(150, 0))).toContain('data-page="-1" disabled>Previous');
    expect(pagingHtml(pageOf(150, 1))).toContain('data-page="2" disabled>Next');
  });
});
