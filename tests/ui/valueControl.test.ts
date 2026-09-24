import { describe, it, expect } from "vitest";
import type { CatalogField, CatalogOperator } from "../../src/query/fieldCatalog";
import {
  optionEntry,
  parseEntry,
  readValueControl,
  renderValueControl,
} from "../../src/ui/valueControl";

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

function op(arity: CatalogOperator["arity"], label = "o"): CatalogOperator {
  return { label, name: "O", arity };
}

const withPickList = field({ options: ["Apple", "Banana"] });
const FREE_ENTRY = "data-free-entry";

describe("renderValueControl", () => {
  it('arity "none" renders nothing', () => {
    expect(renderValueControl(field(), op("none"), null)).toBe("");
  });

  it('arity "one" + boolean renders a toggle checkbox', () => {
    const html = renderValueControl(field({ valueType: "boolean" }), op("one", "eq"), true);
    expect(html).toContain("ui toggle checkbox");
  });

  it("Equals on a field with a pick-list is a free-entry dropdown of its values", () => {
    const html = renderValueControl(withPickList, op("one", "eq"), "Apple");
    expect(html).toContain(FREE_ENTRY);
    expect(html).toContain('class="ui search selection dropdown"');
    expect(html).toContain('<option value="Apple" selected>Apple</option>');
    expect(html).toContain('<option value="Banana">Banana</option>');
  });

  it("Not equals gets the same dropdown", () => {
    expect(renderValueControl(withPickList, op("one", "neq"), "")).toContain(FREE_ENTRY);
  });

  it("a value that isn't on the pick-list gets its own selected option", () => {
    const html = renderValueControl(withPickList, op("one", "eq"), "Cherry");
    expect(html).toContain('<option value="Cherry" selected>Cherry</option>');
  });

  it("a number field's pick-list marks the current number as chosen", () => {
    const numbers = field({ valueType: "number", options: ["1", "2"] });
    const html = renderValueControl(numbers, op("one", "eq"), 2);
    expect(html).toContain('<option value="2" selected>2</option>');
  });

  it("other operators on a field with a pick-list get a plain input", () => {
    const text = renderValueControl(withPickList, op("one", "contains"), "App");
    expect(text).toContain('<input type="text"');
    expect(text).not.toContain(FREE_ENTRY);
    const numbers = field({ valueType: "number", options: ["1", "2"] });
    expect(renderValueControl(numbers, op("one", "gt"), 1)).toContain('<input type="number"');
  });

  it("Equals on a field without a pick-list is a plain input", () => {
    const html = renderValueControl(field(), op("one", "eq"), "x");
    expect(html).toContain('<input type="text"');
    expect(html).not.toContain(FREE_ENTRY);
  });

  it('arity "many" is a free-entry multiple dropdown, with a pick-list…', () => {
    const html = renderValueControl(withPickList, op("many", "in"), ["Apple"]);
    expect(html).toContain('class="ui multiple search selection dropdown"');
    expect(html).toContain(" multiple");
    expect(html).toContain(FREE_ENTRY);
    expect(html.match(/<option /g) ?? []).toHaveLength(2);
  });

  it("…or without one, showing the values entered so far", () => {
    const html = renderValueControl(field({ valueType: "number" }), op("many", "in"), [3, 7]);
    expect(html).toContain(FREE_ENTRY);
    expect(html).toContain('<option value="3" selected>3</option>');
    expect(html).toContain('<option value="7" selected>7</option>');
  });

  it('arity "two" renders from/to ranges', () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('data-range="from"');
    expect(html).toContain('data-range="to"');
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
      renderValueControl(field(), op("one", "eq"), "x"),
      renderValueControl(withPickList, op("one", "eq"), "Apple"),
      renderValueControl(withPickList, op("many", "in"), []),
      renderValueControl(field({ valueType: "boolean" }), op("one", "eq"), false),
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
    const html = renderValueControl(field({ valueType: "date" }), op("one", "eq"), "2024-11");
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="date"');
    expect(html).toContain('placeholder="YYYY-MM-DDTHH:mm:ssZ"');
    expect(html).toContain('value="2024-11"');
  });
});

describe("parseEntry", () => {
  it("turns a number field's numeric entry into a number", () => {
    expect(parseEntry("3", "number")).toBe(3);
    expect(parseEntry("-1.5", "number")).toBe(-1.5);
  });

  it("keeps any other entry as the text entered, for validation to report", () => {
    expect(parseEntry("3x", "number")).toBe("3x");
    expect(parseEntry("", "number")).toBe("");
    expect(parseEntry("3", "string")).toBe("3");
    expect(parseEntry("2024-11", "date")).toBe("2024-11");
  });
});

/** A stand-in <option>: `added` marks one Fomantic created for a typed entry. */
function option(value: string, added = false): HTMLOptionElement {
  return {
    value,
    classList: { contains: (c: string) => added && c === "addition" },
  } as unknown as HTMLOptionElement;
}

describe("optionEntry", () => {
  it("reads one of our own options exactly", () => {
    expect(optionEntry(option("a&quot;b"))).toBe("a&quot;b");
    expect(optionEntry(option('a"b'))).toBe('a"b');
  });

  it("undoes Fomantic's HTML escaping of a typed entry, so it reads back as typed", () => {
    expect(optionEntry(option("a&quot;b", true))).toBe('a"b');
    expect(optionEntry(option("a&lt;b&gt;c", true))).toBe("a<b>c");
    expect(optionEntry(option("it&#x27;s", true))).toBe("it's");
    expect(optionEntry(option("x&#x60;y", true))).toBe("x`y");
    expect(optionEntry(option("p&amp;q", true))).toBe("p&q");
    expect(optionEntry(option("c,d", true))).toBe("c,d");
  });

  it("decodes in one pass, never twice", () => {
    expect(optionEntry(option("&amp;quot;", true))).toBe("&quot;");
  });
});

describe("readValueControl on a free-entry dropdown", () => {
  function rowWith(...selected: HTMLOptionElement[]): HTMLElement {
    const select = { selectedOptions: selected };
    return { querySelector: () => select } as unknown as HTMLElement;
  }

  it('returns "Is any of" entries exactly as typed or picked', () => {
    const row = rowWith(option("Apple"), option("a&quot;b", true), option("c,d", true));
    expect(readValueControl(row, "many", "string")).toEqual(["Apple", 'a"b', "c,d"]);
  });

  it("still types a number field's entries", () => {
    expect(readValueControl(rowWith(option("4"), option("42", true)), "many", "number")).toEqual([
      4, 42,
    ]);
  });
});
