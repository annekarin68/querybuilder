import { describe, it, expect } from "vitest";
import { facetDropdown, fieldDropdown } from "../../src/ui/queryBuilder";
import { newCondition } from "../../src/query/tree";

describe("condition row dropdowns", () => {
  // There can be many facets and fields: typing filters the list (Fomantic's
  // `search`) instead of jumping to the first item starting with that letter.
  it("Facet is a search dropdown", () => {
    expect(facetDropdown([], newCondition())).toContain('class="ui search selection dropdown"');
  });

  it("Field is a search dropdown", () => {
    expect(fieldDropdown({ fields: [] }, newCondition())).toContain(
      'class="ui search selection dropdown"',
    );
  });
});
