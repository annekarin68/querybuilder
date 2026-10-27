import { describe, it, expect } from "vitest";
import { blockHtml, footerHtml, groupHtml, type BlockCtx } from "../../src/ui/blockHtml";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: [] },
      { id: "label", name: "label", typeName: "VARCHAR", values: [] },
    ],
  },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const ctxFor = (query: Group): BlockCtx => ({
  catalog,
  facets,
  issues: [],
  query,
  expandedBlockIds: [],
  selectedField: null,
});
const pos = { index: 1, count: 1 };

describe("blockHtml", () => {
  it("draws a block: name, Has on, no ALL/ANY while fewer than two fields are set", () => {
    const b = newBlock("thing");
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain(`class="qb-block" data-node-id="${b.id}"`);
    expect(html).toContain('<span class="qb-block-name">Thing</span>');
    expect(html).toContain('data-action="set-has" aria-pressed="true"');
    expect(html).toContain('data-action="set-has-no" aria-pressed="false"');
    expect(html).not.toContain("set-and");
    expect(html).not.toContain("an occurrence where");
    expect(html).toContain('aria-label="Remove facet"');
  });

  it("offers ALL / ANY once two fields are set", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      negated: true,
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 1), newFieldCondition("label", "eq", "x")],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain('data-action="set-has-no" aria-pressed="true"');
    expect(html).toContain("an occurrence where");
    expect(html).toContain('data-action="set-or" aria-pressed="true"');
    expect(html).toContain("of the set fields match");
  });

  it("folds to its head and the summary line", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      collapsed: true,
      conditions: [newFieldCondition("size", "gt", 40)],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain("is-collapsed");
    expect(html).toContain("Thing has size &gt; 40");
    expect(html).not.toContain("qb-field-row");
  });
});

describe("groupHtml", () => {
  it("offers + Facet as a picker of every facet, and + Group as the focus landing", () => {
    const q = emptyQuery();
    const html = groupHtml(ctxFor(q), q, true);
    expect(html).toContain(
      'data-part="add-facet" aria-label="Add a facet to this group"><option value="">+ Facet</option><option value="thing">Thing</option>',
    );
    expect(html).toMatch(/data-action="add-group" data-focus-landing/);
    expect(html).not.toContain("add-condition");
  });

  it("counts facets in a folded group", () => {
    const g = { ...groupOf([newBlock("thing"), newBlock("thing")]), collapsed: true };
    const q: Group = { ...emptyQuery(), children: [g] };
    expect(groupHtml(ctxFor(q), g, false, pos)).toContain("2 facets");
  });
});

describe("footerHtml", () => {
  it("asks for a facet in an empty query, and shows the summary otherwise", () => {
    expect(footerHtml(emptyQuery(), [], catalog)).toContain(
      "Add a facet to start building the query.",
    );
    const q: Group = { ...emptyQuery(), children: [newBlock("thing")] };
    expect(footerHtml(q, [], catalog)).toContain("Thing present");
  });
});
