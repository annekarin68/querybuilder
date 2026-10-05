import { describe, it, expect } from "vitest";
import { footerHtml, rowDropdown } from "../../src/ui/queryBuilder";
import { addChild, emptyQuery, newCondition } from "../../src/query/tree";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import type { Issue } from "../../src/query/types";

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

describe("the query footer", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const query = addChild(addChild(root, root.id, newCondition()), root.id, newCondition());
  const issue = (nodeId: string): Issue => ({ nodeId, message: "m", kind: "invalid" });

  it("counts the parts with an issue, not the issues", () => {
    expect(footerHtml(query, [issue(root.id), issue(root.id)], catalog)).toContain(
      "1 part of the query still needs attention.",
    );
    expect(footerHtml(query, [issue(root.id), issue("c")], catalog)).toContain(
      "2 parts of the query still need attention.",
    );
  });

  it("shows the query in plain English when nothing needs attention", () => {
    expect(footerHtml(query, [], catalog)).toContain('class="qb-summary"');
  });
});
