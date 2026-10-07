import { describe, it, expect } from "vitest";
import { DOCS_HINT, dragData, facetHtml, groupHtml } from "../../src/ui/docsSidebar";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { parseDragItem } from "../../src/query/drop";
import type { Facet } from "../../src/model";

const facet: Facet = {
  id: "a&b",
  name: "Alpha <b>",
  tags: ["t"],
  group: "",
  comment: "backend note",
  description: "third party note",
  eventCount: 5,
  fields: [
    {
      id: "size",
      name: "Size",
      typeName: "BIGINT",
      comment: "The size",
      description: "tp",
      values: ["3", "7"],
    },
    { id: "flag", name: "Flag", typeName: "BOOLEAN", comment: "", description: "", values: [] },
  ],
};
const html = facetHtml(facet, 100, buildFieldCatalog([facet]));

describe("data dictionary markup", () => {
  it("escapes names", () => {
    expect(html).toContain("Alpha &lt;b&gt;");
    expect(html).not.toContain("Alpha <b>");
  });

  it("every drag source carries parseable drag data, escaped for the attribute", () => {
    const attrs = [...html.matchAll(/data-item="([^"]*)"/g)].map((m) =>
      m[1]!
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    );
    const items = attrs.map((a) => parseDragItem(a));
    expect(items.every((i) => i !== null)).toBe(true);
    expect(items).toContainEqual({ type: "facet", facetId: "a&b" });
    expect(items).toContainEqual({ type: "field", facetId: "a&b", fieldId: "size" });
    expect(items).toContainEqual({ type: "value", facetId: "a&b", fieldId: "size", value: "7" });
  });

  it("each field row carries its escaped field id, for the search highlight", () => {
    expect(html).toContain('class="qb-doc-field" data-field-id="size"');
    expect(html).toContain('data-field-id="flag"');
  });

  it("only fields with a pick-list get value chips", () => {
    expect(html.match(/qb-doc-value"/g)).toHaveLength(2);
  });

  it("shows the descriptions in the page, not in title tooltips", () => {
    expect(html).toContain("The size");
    expect(html).toContain("tp");
    expect(html).not.toMatch(/title="[^"]*The size/);
  });

  it("every item has a keyboard 'Add to query' button", () => {
    expect(html).toContain('data-action="add-item"');
    expect(html).toContain('aria-label="Add Alpha &lt;b&gt; to the query"');
  });

  it("drag handles are draggable and hidden from screen readers", () => {
    expect(html).toContain('class="qb-grip" draggable="true" aria-hidden="true"');
  });

  it("long value lists are capped, with a count of the rest", () => {
    const many: Facet = {
      ...facet,
      fields: [{ ...facet.fields[0]!, values: Array.from({ length: 70 }, (_, i) => String(i)) }],
    };
    const out = facetHtml(many, 1, buildFieldCatalog([many]));
    expect(out.match(/qb-doc-value"/g)).toHaveLength(30);
    expect(out).toContain("and 40 more");
  });

  it("dragData round-trips through the attribute", () => {
    expect(dragData({ type: "tag", tag: 'x"y' })).toBe(
      "{&quot;type&quot;:&quot;tag&quot;,&quot;tag&quot;:&quot;x\\&quot;y&quot;}",
    );
  });
});

describe("expand and add affordances", () => {
  const chevron = '<i class="angle right icon qb-chevron"></i>';

  it("every expandable row (facet card, field rows) shows a chevron", () => {
    // one facet card + two field rows
    expect(html.split(chevron)).toHaveLength(1 + 3);
  });

  it("each chevron is the first thing in its summary, before the drag grip", () => {
    for (const m of html.matchAll(/<summary>\s*([^<]*<i[^>]*><\/i>)/g)) {
      expect(m[1]).toContain("qb-chevron");
    }
  });

  it("add buttons on cards and rows say 'Add'; value chips stay icon-only", () => {
    // facet + two fields have the visible label, the two value chips don't
    expect(html.match(/<span class="qb-add-label">Add<\/span>/g)).toHaveLength(3);
    const chips =
      html.match(/<span class="qb-doc-value" data-item[\s\S]*?<\/button><\/span>/g) ?? [];
    expect(chips).toHaveLength(2);
    for (const chip of chips) expect(chip).not.toContain("qb-add-label");
  });

  it("the accessible name of an add button is unchanged by the visible label", () => {
    expect(html).toContain('aria-label="Add Alpha &lt;b&gt; to the query"');
  });

  it("a tag section has a chevron and an 'Add all' button after its name and count", () => {
    const out = groupHtml("t", [facet], 100, buildFieldCatalog([facet]));
    const summary = out.slice(out.indexOf("<summary"), out.indexOf("</summary>"));
    expect(summary.indexOf("qb-chevron")).toBeLessThan(summary.indexOf("qb-grip"));
    expect(summary.indexOf("qb-doc-group-name")).toBeLessThan(summary.indexOf("qb-add-btn"));
    expect(summary).toContain('<span class="qb-add-label">Add all</span>');
  });

  it("the untagged section has a chevron but nothing to drag or add", () => {
    const out = groupHtml("", [facet], 100, null);
    const summary = out.slice(out.indexOf("<summary"), out.indexOf("</summary>"));
    expect(summary).toContain("qb-chevron");
    expect(summary).not.toContain("qb-grip");
    expect(summary).not.toContain("qb-add-btn");
  });

  it("the hint tells people to click to expand, and what '+ Add' does", () => {
    expect(DOCS_HINT).toMatch(/click/i);
    expect(DOCS_HINT).toMatch(/expand/i);
    expect(DOCS_HINT).toMatch(/\+ Add/);
  });
});
