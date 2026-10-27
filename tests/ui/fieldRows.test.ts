import { describe, it, expect } from "vitest";
import { fieldRowsHtml, visibleFieldIds } from "../../src/ui/fieldRows";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition } from "../../src/query/types";
import type { Facet } from "../../src/model";

const ids = ["a", "b", "c", "d", "e", "f", "g"];
const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: ids.map((id) => ({ id, name: id, typeName: "BIGINT", values: [] })),
  },
  {
    id: "small",
    name: "Small",
    tags: [],
    fields: [{ id: "x", name: "x", typeName: "VARCHAR", values: [] }],
  },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const ctx = { catalog, issues: [] };
const block = (facetId: string, ...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock(facetId),
  conditions,
});

describe("visibleFieldIds", () => {
  it("shows every field of a small facet", () => {
    expect(visibleFieldIds(["a", "b"], new Set(), false, null)).toEqual({
      shown: ["a", "b"],
      hiddenCount: 0,
    });
  });
  it("folds a large facet to the first 3, the set ones and the selected one, in field order", () => {
    expect(visibleFieldIds(ids, new Set(["f"]), false, "e")).toEqual({
      shown: ["a", "b", "c", "e", "f"],
      hiddenCount: 2,
    });
  });
  it("shows everything when expanded", () => {
    expect(visibleFieldIds(ids, new Set(), true, null).hiddenCount).toBe(0);
  });
});

describe("fieldRowsHtml", () => {
  it("draws an unset row muted, with no visible text and one focusable control", () => {
    const html = fieldRowsHtml(ctx, block("small"), false, null);
    expect(html).toContain('class="qb-field-row is-unset"');
    expect(html).toContain('<span class="qb-sr-only"> (not filtered)</span>');
    expect(html).toContain('data-action="edit-field" aria-label="Filter on x"');
    expect(html).not.toContain("<select");
    expect(html).not.toMatch(/any value/i);
  });

  it("draws a set row with its operator, a Not filtered choice first, and its value", () => {
    const c = newFieldCondition("a", "gt", 3);
    const html = fieldRowsHtml(ctx, block("thing", c), false, null);
    expect(html).toContain(`data-node-id="${c.id}"`);
    expect(html).toContain(
      'data-part="operator" aria-label="Operator for a"><option value="">Not filtered</option>',
    );
    expect(html).toContain('<option value="gt" selected>');
    expect(html).toContain('class="qb-value"');
  });

  it("draws the selected unset row with real dropdowns and no value yet", () => {
    const html = fieldRowsHtml(ctx, block("small"), false, "x");
    expect(html).toContain('data-part="operator"');
    expect(html).not.toContain("is-unset");
    expect(html).not.toContain('class="qb-value"');
  });

  it("folds a large facet and says how many fields are hidden", () => {
    const html = fieldRowsHtml(ctx, block("thing"), false, null);
    expect(html.match(/qb-field-row/g)).toHaveLength(3);
    expect(html).toContain(
      'data-action="toggle-fields" aria-expanded="false">+ 4 more fields</button>',
    );
    expect(fieldRowsHtml(ctx, block("thing"), true, null)).toContain(">Show fewer fields</button>");
    expect(fieldRowsHtml(ctx, block("small"), false, null)).not.toContain("toggle-fields");
  });

  it("keeps an unknown or doubled field as a removable read-only row with its error", () => {
    const gone = newFieldCondition("gone", "eq", 1);
    const first = newFieldCondition("x", "eq", "p");
    const twice = newFieldCondition("x", "eq", "q");
    const issues = [
      { nodeId: gone.id, message: "Unknown field “gone”.", kind: "invalid" as const },
    ];
    const html = fieldRowsHtml(
      { catalog, issues },
      block("small", first, gone, twice),
      false,
      null,
    );
    expect(html.match(/is-stray/g)).toHaveLength(2);
    expect(html).toContain(`data-node-id="${gone.id}"`);
    expect(html).toContain(`data-node-id="${twice.id}"`);
    expect(html).toContain('data-action="remove-condition"');
    expect(html).toContain("Unknown field “gone”.");
  });
});
