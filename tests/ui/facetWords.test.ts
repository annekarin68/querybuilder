import { describe, it, expect } from "vitest";
import { facetNameOrId } from "../../src/ui/facetWords";

// Made-up facets: src/ never names backend data, and neither do the tests.
const facets = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];

describe("facetNameOrId", () => {
  it("gives the dictionary's name of a facet it knows", () => {
    expect(facetNameOrId(facets, "b")).toBe("Beta");
  });
  it("gives the id of a facet it does not know", () => {
    expect(facetNameOrId(facets, "gone")).toBe("gone");
  });
  it("gives the id while the dictionary is loading", () => {
    expect(facetNameOrId(null, "a")).toBe("a");
  });
});
