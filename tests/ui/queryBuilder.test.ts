import { describe, it, expect } from "vitest";
import { facetDropdown, fieldDropdown, operatorDropdown } from "../../src/ui/queryBuilder";
import { newCondition } from "../../src/query/tree";

describe("condition row dropdowns", () => {
  // There can be many facets and fields: typing filters the list (Fomantic's
  // `search`) instead of jumping to the first item starting with that letter.
  // Operator is a search dropdown too, so all three behave alike: clicking one
  // whose menu opened on its own (focusPart) keeps it open.
  it("Facet is a search dropdown", () => {
    expect(facetDropdown([], newCondition())).toContain('class="ui search selection dropdown"');
  });

  it("Field is a search dropdown", () => {
    expect(fieldDropdown({ fields: [] }, newCondition())).toContain(
      'class="ui search selection dropdown"',
    );
  });

  it("Operator is a search dropdown", () => {
    expect(operatorDropdown({ fields: [] }, newCondition())).toContain(
      'class="ui search selection dropdown"',
    );
  });
});
