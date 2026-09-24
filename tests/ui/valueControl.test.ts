import { describe, it, expect } from "vitest";
import type { CatalogField, CatalogOperator } from "../../src/query/fieldCatalog";
import { renderValueControl } from "../../src/ui/valueControl";

function field(overrides: Partial<CatalogField> = {}): CatalogField {
  return {
    facetLabel: "t",
    fieldLabel: "f",
    name: "F",
    fieldName: "F",
    valueType: "string",
    operatorIds: [],
    ...overrides,
  };
}

function op(arity: CatalogOperator["arity"]): CatalogOperator {
  return { label: "o", name: "O", arity };
}

const enumField = field({ valueType: "enum", options: ["Apple", "Banana"] });

describe("renderValueControl", () => {
  it('arity "none" renders nothing', () => {
    expect(renderValueControl(field(), op("none"), null)).toBe("");
  });

  it('arity "one" + boolean renders a toggle checkbox', () => {
    const html = renderValueControl(field({ valueType: "boolean" }), op("one"), true);
    expect(html).toContain("ui toggle checkbox");
  });

  it('arity "one" + enum renders an <option> per label', () => {
    const html = renderValueControl(enumField, op("one"), "Apple");
    expect(html).toContain("<option");
    expect(html).toContain("Apple");
    expect(html).toContain("Banana");
  });

  it('arity "two" renders from/to ranges', () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('data-range="from"');
    expect(html).toContain('data-range="to"');
  });

  it('arity "many" + enum renders a multiple select with an option per value', () => {
    const html = renderValueControl(enumField, op("many"), ["Apple"]);
    expect(html).toContain('class="ui multiple selection dropdown"');
    expect(html).toContain(" multiple");
    expect(html.match(/<option /g) ?? []).toHaveLength(2);
    expect(html).toContain("Apple");
    expect(html).toContain("Banana");
  });

  it("uses classes, not inline styles, for the range layout", () => {
    const num = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(num).not.toContain("style=");
    expect(num).toContain('class="qb-range"');
    expect(num).toContain('class="qb-range-to"');
  });
});

describe("renderValueControl accessible names", () => {
  it("labels single inputs, dropdowns and toggles as the value", () => {
    for (const html of [
      renderValueControl(field(), op("one"), "x"),
      renderValueControl(enumField, op("one"), "Apple"),
      renderValueControl(enumField, op("many"), []),
      renderValueControl(field({ valueType: "boolean" }), op("one"), false),
    ]) {
      expect(html).toContain('aria-label="Value"');
    }
  });

  it("labels the two ends of a range", () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('aria-label="From"');
    expect(html).toContain('aria-label="To"');
  });

  it("a date field gets a text box for a (partial) UTC timestamp, not a date picker", () => {
    const html = renderValueControl(field({ valueType: "date" }), op("one"), "2024-11");
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="date"');
    expect(html).toContain('placeholder="YYYY-MM-DDTHH:mm:ssZ"');
    expect(html).toContain('value="2024-11"');
  });
});
