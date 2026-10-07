import { describe, it, expect } from "vitest";
import { fieldDropdown, NO_FIELD, rowDropdown } from "../../src/ui/queryBuilder";

describe("condition row dropdowns", () => {
  // There can be many facets and fields: typing filters the list (Fomantic's
  // `search`) instead of jumping to the first item starting with that letter.
  // Operator is a search dropdown too, so all three behave alike: clicking one
  // whose menu opened on its own (focusPart) keeps it open.
  it.each(["facet", "field", "operator"] as const)("%s is a search dropdown", (part) => {
    expect(rowDropdown(part, [], null, true)).toContain('class="ui search selection dropdown"');
  });

  it("lists the choices by name, with the chosen one selected", () => {
    const html = rowDropdown(
      "field",
      [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      "b",
      true,
    );
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain('<option value="a">Alpha</option>');
    expect(html).toContain('<option value="b" selected>Beta</option>');
  });

  it("is disabled until the dropdown before it has a choice", () => {
    expect(rowDropdown("operator", [], null, false)).toContain(" disabled");
    expect(rowDropdown("operator", [], null, true)).not.toContain(" disabled");
  });
});

describe("field dropdown", () => {
  const fields = [{ id: "a", name: "Alpha" }];

  it("lists the no-field choice first, apart from real fields", () => {
    const html = fieldDropdown(fields, null, false, true);
    expect(html.indexOf(`value="${NO_FIELD}"`)).toBeLessThan(html.indexOf('value="f:a"'));
    expect(html).toContain("— no field (facet only) —");
  });

  it("a real field is encoded so it can never equal the no-field value", () => {
    const html = fieldDropdown([{ id: NO_FIELD, name: "Any field" }], null, false, true);
    expect(html).toContain(`<option value="f:${NO_FIELD}">Any field</option>`);
    expect(html.match(new RegExp(`value="${NO_FIELD}"`, "g"))).toHaveLength(1);
  });

  it("marks the dropdown when no field is chosen", () => {
    expect(fieldDropdown(fields, null, true, true)).toContain("qb-no-field");
    expect(fieldDropdown(fields, null, true, true)).toContain(
      `<option value="${NO_FIELD}" selected>`,
    );
    expect(fieldDropdown(fields, "a", false, true)).not.toContain("qb-no-field");
    expect(fieldDropdown(fields, "a", false, true)).toContain('<option value="f:a" selected>');
  });

  it("is still a labelled search dropdown, disabled until a facet is chosen", () => {
    const html = fieldDropdown(fields, null, false, false);
    expect(html).toContain('class="ui search selection dropdown');
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain(" disabled");
  });
});
