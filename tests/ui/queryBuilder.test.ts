import { describe, it, expect } from "vitest";
import {
  decodeFieldValue,
  fieldDropdown,
  collapseButton,
  footerHtml,
  groupHtml,
  NO_FIELD,
  noticeHtml,
  rowDropdown,
} from "../../src/ui/queryBuilder";
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

  it("carries qb-field-select so the CSS can tell it from the facet and operator dropdowns", () => {
    expect(fieldDropdown(fields, null, false, true)).toContain("qb-field-select");
    expect(fieldDropdown(fields, "a", true, true)).toContain("qb-field-select");
    expect(rowDropdown("facet", [], null, true)).not.toContain("qb-field-select");
    expect(rowDropdown("operator", [], null, true)).not.toContain("qb-field-select");
  });

  it("is still a labelled search dropdown, disabled until a facet is chosen", () => {
    const html = fieldDropdown(fields, null, false, false);
    expect(html).toContain('class="ui search selection dropdown');
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain(" disabled");
  });
});

describe("drop warning", () => {
  it("renders nothing without a notice", () => {
    expect(noticeHtml(null)).toBe("");
  });
  it("renders a dismissible warning with the text escaped", () => {
    const html = noticeHtml("Couldn't add <x>");
    expect(html).toContain("ui warning message");
    expect(html).toContain("Couldn&#39;t add &lt;x&gt;");
    expect(html).toContain('data-action="dismiss-notice"');
    expect(html).toContain('role="status"');
  });
});

describe("decodeFieldValue", () => {
  it('reads "none" as the facet-only choice', () => {
    expect(decodeFieldValue("none")).toEqual({ facetOnly: true, fieldId: null });
  });
  it("strips the field prefix once", () => {
    expect(decodeFieldValue("f:x")).toEqual({ facetOnly: false, fieldId: "x" });
    expect(decodeFieldValue("f:f:x")).toEqual({ facetOnly: false, fieldId: "f:x" });
  });
  it('a field whose id is literally "none" is a field, not the no-field choice', () => {
    expect(decodeFieldValue("f:none")).toEqual({ facetOnly: false, fieldId: "none" });
  });
  it("nothing chosen gives no field and no facet-only", () => {
    for (const empty of ["f:", "", null]) {
      expect(decodeFieldValue(empty)).toEqual({ facetOnly: false, fieldId: null });
    }
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

describe("group collapse controls", () => {
  const catalog = buildFieldCatalog([]);
  const ctx = { catalog, facets: null, issues: [] };
  const group = { ...emptyQuery(), id: "g-inner", children: [newCondition()] };

  it("the collapse button is a bordered chevron with an accessible state", () => {
    const open = collapseButton(false);
    expect(open).toContain("angle down icon");
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-label="Collapse group"');
    expect(open).toContain("qb-collapse-btn");
    const closed = collapseButton(true);
    expect(closed).toContain("angle right icon");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('aria-label="Expand group"');
  });

  it("a collapsed group's whole header expands it, and says so", () => {
    const html = groupHtml(ctx, { ...group, collapsed: true }, false);
    const head = html.slice(html.indexOf('<div class="qb-group-head'), html.indexOf("</div>"));
    expect(head).toContain('data-action="toggle-collapse"');
    expect(head).toContain('title="Click to expand"');
  });

  it("an open group's header is not itself a toggle", () => {
    const html = groupHtml(ctx, group, false);
    const head = html.slice(html.indexOf('<div class="qb-group-head'), html.indexOf("</div>"));
    expect(head).not.toContain('class="qb-group-head" data-action');
    // the only toggle in an open header is the chevron button itself
    expect(head.match(/data-action="toggle-collapse"/g)).toHaveLength(1);
    expect(head).toContain('class="qb-icon-btn qb-collapse-btn" data-action="toggle-collapse"');
  });
});
