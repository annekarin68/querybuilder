import { describe, it, expect } from "vitest";
import {
  decodeFieldValue,
  fieldDropdown,
  collapseButton,
  footerHtml,
  groupHtml,
  noticeHtml,
  queryTitleHtml,
  rowDropdown,
} from "../../src/ui/queryBuilder";
import { LOGIN_FIRST_NOTE } from "../../src/ui/dataPreview";
import { escapeHtml } from "../../src/ui/panel";
import { initialState, type AppState } from "../../src/state";
import { addChild, emptyQuery, newCondition } from "../../src/query/tree";
import { buildFieldCatalog, type FieldCatalog } from "../../src/query/fieldCatalog";
import { UNGROUP_BLOCKED_MESSAGE } from "../../src/query/tree";
import type { Condition, Group, Issue } from "../../src/query/types";

describe("condition row dropdowns", () => {
  // There can be many facets and fields: typing filters the list (Fomantic's
  // `search`) instead of jumping to the first item starting with that letter.
  // Operator is a search dropdown too, so they behave alike: clicking one
  // whose menu opened on its own (focusPart) keeps it open. (The Field
  // dropdown has its own builder, below.)
  it.each(["facet", "operator"] as const)("%s is a search dropdown", (part) => {
    expect(rowDropdown(part, [], null, true)).toContain('class="ui search selection dropdown"');
  });

  it("lists the choices by name, with the chosen one selected", () => {
    const html = rowDropdown(
      "facet",
      [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      "b",
      true,
    );
    expect(html).toContain('aria-label="Facet"');
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

  it("lists the whole-facet tests first, in their own group, apart from the fields", () => {
    const html = fieldDropdown(fields, null, null, true);
    expect(html).toContain('<optgroup label="About the whole facet">');
    expect(html).toContain('<option value="op:present">Is present</option>');
    expect(html).toContain('<option value="op:absent">Is absent</option>');
    expect(html).toContain('<optgroup label="About a field">');
    expect(html.indexOf('value="op:present"')).toBeLessThan(html.indexOf('value="f:a"'));
  });

  it("a facet with no fields offers only the whole-facet tests", () => {
    const html = fieldDropdown([], null, null, true);
    expect(html).toContain('value="op:present"');
    expect(html).not.toContain("About a field");
  });

  it("a real field is encoded so it can never equal a whole-facet test", () => {
    const html = fieldDropdown([{ id: "present", name: "Present" }], null, null, true);
    expect(html).toContain('<option value="f:present">Present</option>');
    expect(html.match(/value="op:present"/g)).toHaveLength(1);
  });

  it("selects the chosen test or the chosen field", () => {
    expect(fieldDropdown(fields, null, "absent", true)).toContain(
      '<option value="op:absent" selected>',
    );
    expect(fieldDropdown(fields, "a", null, true)).toContain('<option value="f:a" selected>');
    expect(fieldDropdown(fields, "a", null, true)).not.toContain('op:absent" selected');
  });

  it("is a search dropdown whose name says it holds both kinds of choice, disabled until a facet is chosen", () => {
    const html = fieldDropdown(fields, null, null, false);
    // `qb-field-select` is what styles.css scopes the header wrapping and the
    // two-column span of a whole-facet row to.
    expect(html).toContain('class="ui search selection dropdown qb-field-select"');
    expect(html).toContain('aria-label="Field, or presence of the facet"');
    expect(html).toContain('data-part="field"');
    expect(html).toContain(" disabled");
    expect(fieldDropdown(fields, null, null, true)).not.toContain(" disabled");
  });
});

describe("condition row slots", () => {
  const catalog: FieldCatalog = {
    facets: [{ id: "thing", name: "Thing" }],
    fields: [
      {
        facetId: "thing",
        fieldId: "size",
        name: "Thing: size",
        fieldName: "size",
        valueType: "number",
        operatorIds: ["gt", "present"],
      },
    ],
  };
  const row = (over: object) => {
    const root = emptyQuery();
    const c = { ...newCondition(), facetId: "thing", ...over };
    return groupHtml(
      { catalog, facets: null, issues: [], query: root },
      { ...root, children: [c] },
      true,
    );
  };

  it("a whole-facet condition has no Operator or Value slot: the test is the whole sentence", () => {
    const html = row({ operatorId: "present" });
    expect(html).not.toContain('data-part="operator"');
    expect(html).not.toContain('class="qb-value"');
    expect(html).toContain('<option value="op:present" selected>');
  });

  it("a malformed whole-facet row shows 'Choose…', so picking a test is a real change that repairs it", () => {
    // A foreign operator, or a value a presence test cannot take: the row has no
    // Operator or Value slot, so the Field dropdown is the only way to fix it.
    for (const bad of [{ operatorId: "eq" }, { operatorId: "present", value: 5 }]) {
      const html = row(bad);
      expect(html).not.toContain(" selected>");
      expect(html).not.toContain('data-part="operator"');
    }
  });

  it("a field condition and an unfinished one keep both slots", () => {
    expect(row({ fieldId: "size", operatorId: "gt" })).toContain('data-part="operator"');
    expect(row({})).toContain('data-part="operator"');
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
    expect(html).not.toContain('role="status"');
  });
});

describe("decodeFieldValue", () => {
  it("reads op:present and op:absent as whole-facet tests", () => {
    expect(decodeFieldValue("op:present")).toEqual({ facetOperatorId: "present", fieldId: null });
    expect(decodeFieldValue("op:absent")).toEqual({ facetOperatorId: "absent", fieldId: null });
  });
  it("ignores an operator a whole facet can't take: the value comes from the DOM", () => {
    expect(decodeFieldValue("op:eq")).toEqual({ facetOperatorId: null, fieldId: null });
  });
  it("strips the field prefix once", () => {
    expect(decodeFieldValue("f:x")).toEqual({ facetOperatorId: null, fieldId: "x" });
    expect(decodeFieldValue("f:f:x")).toEqual({ facetOperatorId: null, fieldId: "f:x" });
  });
  it("a field whose id looks like a test is a field, not a test", () => {
    expect(decodeFieldValue("f:op:present")).toEqual({
      facetOperatorId: null,
      fieldId: "op:present",
    });
    expect(decodeFieldValue("f:present")).toEqual({ facetOperatorId: null, fieldId: "present" });
  });
  it("nothing chosen gives neither", () => {
    for (const empty of ["f:", "", null]) {
      expect(decodeFieldValue(empty)).toEqual({ facetOperatorId: null, fieldId: null });
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
  const ctx = { catalog, facets: null, issues: [], query: emptyQuery() };
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

describe("node grips", () => {
  const catalog = buildFieldCatalog([]);
  const ctx = { catalog, facets: null, issues: [], query: emptyQuery() };
  const condition = newCondition();
  const group = { ...emptyQuery(), id: "g-inner", children: [condition] };
  const GROUP_GRIP = 'qb-grip qb-grip-group" draggable="true" data-node-item="g-inner"';

  it("a group's grip says it moves the whole group, in its own style", () => {
    const html = groupHtml(ctx, group, false);
    expect(html).toContain(GROUP_GRIP);
    expect(html).toContain('title="Drag to move this group"');
  });

  it("a folded group keeps its grip", () => {
    expect(groupHtml(ctx, { ...group, collapsed: true }, false)).toContain(GROUP_GRIP);
  });

  it("a condition's grip stays plain and says it moves one condition", () => {
    const html = groupHtml(ctx, group, false);
    expect(html).toContain(`class="qb-grip" draggable="true" data-node-item="${condition.id}"`);
    expect(html).toContain('title="Drag to move this condition"');
  });

  it("the root group has no grip: it can't be moved", () => {
    expect(groupHtml(ctx, { ...group, children: [] }, true)).not.toContain("qb-grip");
  });
});

describe("Group contents and Ungroup buttons", () => {
  const catalog = buildFieldCatalog([]);
  const ctxFor = (query: Group) => ({ catalog, facets: null, issues: [], query });
  const cond = (id: string): Condition => ({ ...newCondition(), id });
  const group = (id: string, operator: "AND" | "OR", children: Group["children"]): Group => ({
    ...emptyQuery(),
    id,
    operator,
    children,
  });
  /** The HTML of the header of the group `id` (up to the start of its children). */
  const headOf = (root: Group, id: string, isRoot: boolean): string => {
    const target = isRoot ? root : (root.children.find((c) => c.id === id) as Group);
    const html = groupHtml(ctxFor(root), target, isRoot);
    return html.slice(0, html.indexOf('<div class="qb-children">'));
  };

  it("a group with two items offers Group contents, with a tooltip", () => {
    const root = group("r", "AND", [cond("a"), cond("b")]);
    const head = headOf(root, "r", true);
    expect(head).toContain('data-action="group-contents"');
    expect(head).toContain("Group contents</button>");
    expect(head).toContain(
      'title="Put this group\'s conditions and groups into a new group inside it"',
    );
  });

  it("a group with one item offers no Group contents", () => {
    const root = group("r", "AND", [cond("a")]);
    expect(headOf(root, "r", true)).not.toContain("group-contents");
  });

  it("the root group never offers Ungroup", () => {
    const root = group("r", "AND", [cond("a"), cond("b")]);
    expect(headOf(root, "r", true)).not.toContain('data-action="ungroup"');
  });

  it("a group that matches its parent's ALL/ANY can be ungrouped", () => {
    const root = group("r", "AND", [group("g", "AND", [cond("a"), cond("b")])]);
    const head = headOf(root, "g", false);
    expect(head).toContain('data-action="ungroup"');
    expect(head).not.toContain("aria-disabled");
  });

  it("a group that would change the meaning shows Ungroup as disabled, with the reason", () => {
    const root = group("r", "AND", [group("g", "OR", [cond("a"), cond("b")])]);
    const head = headOf(root, "g", false);
    expect(head).toContain('data-action="ungroup"');
    expect(head).toContain('aria-disabled="true"');
    expect(head).toContain(`title="${UNGROUP_BLOCKED_MESSAGE}"`);
  });

  it("the action buttons share one box and the remove button comes last in it", () => {
    const root = group("r", "AND", [group("g", "AND", [cond("a"), cond("b")])]);
    const head = headOf(root, "g", false);
    const actions = head.slice(head.indexOf('<span class="qb-group-actions">'));
    expect(actions).toContain('data-action="add-condition"');
    expect(actions.lastIndexOf('data-action="remove-node"')).toBeGreaterThan(
      actions.lastIndexOf('data-action="ungroup"'),
    );
  });

  it("a folded group shows neither button", () => {
    const root = group("r", "AND", [
      { ...group("g", "AND", [cond("a"), cond("b")]), collapsed: true },
    ]);
    const html = groupHtml(ctxFor(root), root.children[0] as Group, false);
    expect(html).not.toContain("group-contents");
    expect(html).not.toContain('data-action="ungroup"');
  });
});

describe("the query card's title", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const query = addChild(root, root.id, newCondition());
  const loaded: AppState = {
    ...initialState,
    catalog,
    databases: [{ id: "a", name: "A", description: "", owner: "", eventCount: 1 }],
    selectedDatabaseIds: ["a"],
    query,
  };
  const opened = (name: string): AppState => ({
    ...loaded,
    openSaved: { id: "sq-1", name, note: "", query, databaseIds: ["a"] },
  });
  /** The words on screen: tags dropped, spaces collapsed. */
  const text = (html: string) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("says Query and offers Save… and Saved queries", () => {
    const html = queryTitleHtml(loaded);
    expect(text(html)).toBe("Query Save… Saved queries");
    expect(html).toMatch(/<button[^>]*data-action="open-save-dialog"[^>]*>Save…<\/button>/);
    expect(html).toMatch(/<button[^>]*data-action="open-saved-list"[^>]*>Saved queries<\/button>/);
  });

  it("names the open saved query", () => {
    expect(text(queryTitleHtml(opened("Weekly")))).toContain("Query · Weekly");
    expect(queryTitleHtml(opened("Weekly"))).not.toContain("(edited)");
  });

  it("says (edited) once the query differs from what was saved", () => {
    const edited = { ...opened("Weekly"), query: addChild(query, root.id, newCondition()) };
    expect(queryTitleHtml(edited)).toContain('<span class="qb-muted">(edited)</span>');
  });

  it("says (edited) once the database selection differs", () => {
    const edited = { ...opened("Weekly"), selectedDatabaseIds: [] };
    expect(queryTitleHtml(edited)).toContain("(edited)");
  });

  it("escapes the name", () => {
    const html = queryTitleHtml(opened("<b>x</b>"));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  // Run warns a logged-out user ("You'll be asked to log in first."); Save…
  // and Saved queries send them to login just the same, so they say it too.
  describe("for a logged-out user", () => {
    const anonymous: AppState = { ...loaded, auth: { status: "anonymous" } };
    const NOTE = "You'll be asked to log in first.";

    it("says they will be asked to log in, and ties both buttons to that note", () => {
      const html = queryTitleHtml(anonymous);
      // `text` drops the tags and turns the entity for the apostrophe back.
      expect(html).toMatch(/<[^>]*id="qb-saved-login-note"[^>]*>/);
      expect(text(html).replace("&#39;", "'")).toContain(NOTE);
      expect(html).toMatch(
        /<button[^>]*data-action="open-save-dialog"[^>]*aria-describedby="qb-saved-login-note"/,
      );
      expect(html).toMatch(
        /<button[^>]*data-action="open-saved-list"[^>]*aria-describedby="qb-saved-login-note"/,
      );
    });

    it("uses the sentence Run shows", () => {
      expect(LOGIN_FIRST_NOTE).toBe(NOTE);
      expect(queryTitleHtml(anonymous)).toContain(escapeHtml(LOGIN_FIRST_NOTE));
    });

    it.each([
      ["loading", { status: "loading" }],
      ["authenticated", { status: "authenticated", user: { name: "U" } }],
    ] as const)("says nothing while auth is %s", (_name, auth) => {
      const html = queryTitleHtml({ ...loaded, auth } as AppState);
      expect(html).not.toContain("log in");
      expect(html).not.toContain("qb-saved-login-note");
      expect(html).not.toContain("aria-describedby");
      expect(html).toContain('data-action="open-save-dialog"');
    });

    it("says nothing before the buttons exist", () => {
      for (const partial of [{ databases: null }, { catalog: null }]) {
        const html = queryTitleHtml({ ...anonymous, ...partial });
        expect(html).not.toContain("log in");
        expect(html).not.toContain("qb-saved-login-note");
      }
    });
  });

  // Opening a saved query before start() has finished would be overwritten by
  // start() (it sets the query and selection when it ends).
  it("draws no buttons until the databases and the field catalog have loaded", () => {
    expect(queryTitleHtml({ ...loaded, databases: null })).not.toContain("<button");
    expect(queryTitleHtml({ ...loaded, catalog: null })).not.toContain("<button");
  });
});
