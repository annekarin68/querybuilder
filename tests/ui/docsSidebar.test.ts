import { describe, it, expect } from "vitest";
import {
  DOCS_HINT,
  dragData,
  escapeClosesDocs,
  facetHtml,
  groupHtml,
} from "../../src/ui/docsSidebar";
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
  const chevron = '<i class="angle right icon qb-chevron" aria-hidden="true"></i>';
  const spacer = '<span class="qb-chevron-spacer" aria-hidden="true"></span>';
  /** The markup of the field row with this id, up to the start of the next one. */
  const fieldRow = (id: string) => {
    const start = html.indexOf(`data-field-id="${id}"`);
    expect(start).toBeGreaterThanOrEqual(0);
    return html.slice(html.lastIndexOf("<", start), html.indexOf("</details>", start));
  };

  it("every expandable row (the facet card and fields with something to show) has a chevron", () => {
    // the facet card + the "size" field; the "flag" field has nothing to open
    expect(html.split(chevron)).toHaveLength(1 + 2);
  });

  it("each chevron is the first thing in its summary, before the drag grip", () => {
    const chunks = html.split("<summary>");
    // the facet card's summary + the "size" field's summary
    expect(chunks).toHaveLength(1 + 2);
    for (const chunk of chunks.slice(1)) {
      expect(chunk.trimStart().startsWith(chevron)).toBe(true);
      expect(chunk.indexOf("qb-grip")).toBeGreaterThan(chunk.indexOf("qb-chevron"));
    }
  });

  it("the chevron is hidden from screen readers", () => {
    expect(chevron).toContain('aria-hidden="true"');
    expect(html).not.toContain('qb-chevron"></i>');
  });

  it("a field with a comment, description or values is a <details> with a chevron", () => {
    const row = fieldRow("size");
    expect(row.startsWith("<details")).toBe(true);
    expect(row).toContain(chevron);
  });

  it("a field with nothing to show is a plain row: no <details>, no chevron, but a spacer", () => {
    const start = html.indexOf('data-field-id="flag"');
    const row = html.slice(html.lastIndexOf("<", start));
    expect(row.startsWith("<div")).toBe(true);
    expect(row).toContain("is-leaf");
    const rowEnd = row.slice(0, row.indexOf("</button>") + "</button>".length);
    expect(rowEnd).not.toContain("<details");
    expect(rowEnd).not.toContain('qb-chevron"');
    expect(rowEnd).toContain(spacer);
  });

  it("a plain field row keeps its drag data, grip and Add button", () => {
    const start = html.indexOf('data-field-id="flag"');
    const tag = html.slice(html.lastIndexOf("<", start), html.indexOf(">", start));
    const attr = /data-item="([^"]*)"/.exec(tag)?.[1] ?? "";
    expect(parseDragItem(attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&"))).toEqual({
      type: "field",
      facetId: "a&b",
      fieldId: "flag",
    });
    const row = html.slice(start, html.indexOf("</button>", start));
    expect(row).toContain('class="qb-grip" draggable="true"');
    expect(row).toContain('data-action="add-item"');
    expect(row).toContain('aria-label="Add Flag to the query"');
    expect(row).toContain('<span class="qb-add-label">Add</span>');
  });

  it("a field with only a pick-list (no comment) is still expandable", () => {
    const f: Facet = {
      ...facet,
      fields: [{ ...facet.fields[1]!, typeName: "BIGINT", values: ["3"] }],
    };
    const out = facetHtml(f, 1, buildFieldCatalog([f]));
    expect(out).toContain('<details class="qb-doc-field"');
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
    expect(html).toContain('aria-label="Add Size to the query"');
  });

  it("a tag section has a chevron and an 'Add all N' button after its name and count", () => {
    const out = groupHtml("t", [facet], 100, buildFieldCatalog([facet]));
    const summary = out.slice(out.indexOf("<summary"), out.indexOf("</summary>"));
    const [chevronAt, gripAt, nameAt, buttonAt] = [
      "qb-chevron",
      "qb-grip",
      "qb-doc-group-name",
      "qb-add-btn",
    ].map((part) => summary.indexOf(part));
    for (const at of [chevronAt, gripAt, nameAt, buttonAt]) expect(at).toBeGreaterThanOrEqual(0);
    expect(chevronAt).toBeLessThan(gripAt!);
    expect(nameAt).toBeLessThan(buttonAt!);
    expect(summary).toContain('<span class="qb-add-label">Add all 1</span>');
  });

  it("the tag's Add button carries the number of facets it adds, and its aria-label names the tag", () => {
    const two = [facet, { ...facet, id: "other" }];
    const out = groupHtml("t", two, 100, buildFieldCatalog(two));
    expect(out).toContain('<span class="qb-add-label">Add all 2</span>');
    expect(out).toContain("Add all “");
    expect(out).toMatch(/aria-label="Add all “[^”]*” facets to the query"/);
    // the count pill says what it counts
    expect(out).toContain('title="2 facets"');
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
    expect(DOCS_HINT).toMatch(/with an arrow/);
  });
});

describe("escapeClosesDocs", () => {
  const closing = {
    key: "Escape",
    defaultPrevented: false,
    floating: true,
    collapsed: false,
    focusInDocs: true,
  };

  it("closes the floating docs when Escape is pressed inside them", () => {
    expect(escapeClosesDocs(closing)).toBe(true);
  });

  it("leaves Escape alone when the search box has already used it to clear its text", () => {
    // The search box calls preventDefault() when it clears; the first Escape
    // clears the search, only a second one closes the dictionary.
    expect(escapeClosesDocs({ ...closing, defaultPrevented: true })).toBe(false);
  });

  it("ignores other keys, wide screens, folded docs and focus outside the docs", () => {
    expect(escapeClosesDocs({ ...closing, key: "Enter" })).toBe(false);
    expect(escapeClosesDocs({ ...closing, floating: false })).toBe(false);
    expect(escapeClosesDocs({ ...closing, collapsed: true })).toBe(false);
    expect(escapeClosesDocs({ ...closing, focusInDocs: false })).toBe(false);
  });
});
