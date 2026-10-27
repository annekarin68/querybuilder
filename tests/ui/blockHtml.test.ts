import { describe, it, expect } from "vitest";
import { blockHtml, footerHtml, groupHtml, type BlockCtx } from "../../src/ui/blockHtml";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import {
  emptyQuery,
  groupOf,
  newBlock,
  newFieldCondition,
  UNGROUP_BLOCKED_MESSAGE,
} from "../../src/query/tree";
import type { FacetBlock, Group, Issue } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: [] },
      { id: "label", name: "label", typeName: "VARCHAR", values: [] },
    ],
  },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const ctxFor = (query: Group): BlockCtx => ({
  catalog,
  facets,
  issues: [],
  query,
  expandedBlockIds: [],
  openField: null,
  panelTab: "seen",
  selectedField: null,
  totalEvents: 10,
});
const pos = { index: 1, count: 1 };

describe("blockHtml", () => {
  it("draws a block: name, Has on, no ALL/ANY while fewer than two fields are set", () => {
    const b = newBlock("thing");
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain(`class="qb-block qb-block-and" data-node-id="${b.id}"`);
    expect(html).toContain('<span class="qb-block-name">Thing</span>');
    expect(html).toContain('data-action="set-has" aria-pressed="true"');
    expect(html).toContain('data-action="set-has-no" aria-pressed="false"');
    expect(html).not.toContain("set-and");
    expect(html).not.toContain("an occurrence where");
    expect(html).not.toContain("qb-block-match");
    expect(html).toContain('aria-label="Remove Thing"');
  });

  // A page holds many blocks: "Remove facet" or "Has or has no" alone would
  // not say which one a control belongs to. The name comes from the dictionary.
  it("names its controls after its facet", () => {
    const b = newBlock("thing");
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain('aria-label="Remove Thing" title="Remove Thing"');
    expect(html).toContain('role="group" aria-label="Has or has no Thing"');
    expect(html).toContain('aria-label="Move Thing up"');
    expect(html).toContain('aria-label="Move Thing down"');
  });

  it("uses the facet id in the names when the dictionary does not know the facet", () => {
    const b = newBlock("gone");
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain('aria-label="Remove gone"');
  });

  it("offers ALL / ANY once two fields are set", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      negated: true,
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 1), newFieldCondition("label", "eq", "x")],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain('data-action="set-has-no" aria-pressed="true"');
    expect(html).toContain("an occurrence where");
    expect(html).toContain('data-action="set-or" aria-pressed="true"');
    expect(html).toContain("of the set fields match");
  });

  // Its own ALL / ANY colour, not its group's: a green "ANY" would read as ALL.
  it("takes the colour of its own ALL / ANY", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 1), newFieldCondition("label", "eq", "x")],
    };
    const q: Group = { ...emptyQuery(), children: [b] };
    expect(blockHtml(ctxFor(q), b, pos)).toContain('class="qb-block qb-block-or"');
    const folded = { ...b, collapsed: true };
    expect(blockHtml(ctxFor(q), folded, pos)).toContain(
      'class="qb-block qb-block-or is-collapsed"',
    );
  });

  // ALL / ANY are drawn only once two fields are set. Before that an ANY
  // block (a saved one, or one whose second field was cleared) must not show
  // the ANY colour with no ANY button to explain it.
  it("uses the ALL colour while fewer than two fields are set, whatever its ALL / ANY", () => {
    const one: FacetBlock = {
      ...newBlock("thing"),
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 1)],
    };
    const none: FacetBlock = { ...newBlock("thing"), operator: "OR" };
    for (const b of [one, none, { ...one, collapsed: true }]) {
      const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
      expect(html).toContain('class="qb-block qb-block-and');
      expect(html).not.toContain("qb-block-or");
    }
  });

  it("says on a second line which occurrence it means, once a field is set", () => {
    const one: FacetBlock = {
      ...newBlock("thing"),
      conditions: [newFieldCondition("size", "gt", 1)],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [one] }), one, pos);
    expect(html).toContain(
      '<div class="qb-block-line qb-block-match"><span class="qb-group-label">an occurrence where the set field matches</span></div>',
    );
    expect(html).not.toContain("set-and");
  });

  it("puts ALL / ANY on the second line with two or more set fields", () => {
    const two: FacetBlock = {
      ...newBlock("thing"),
      conditions: [newFieldCondition("size", "gt", 1), newFieldCondition("label", "eq", "x")],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [two] }), two, pos);
    const line2 = html.slice(html.indexOf("qb-block-match"));
    expect(line2.indexOf("an occurrence where")).toBeLessThan(
      line2.indexOf('data-action="set-and"'),
    );
    expect(line2.indexOf('data-action="set-or"')).toBeLessThan(
      line2.indexOf("of the set fields match"),
    );
    // Has / Has no stays on the first line.
    expect(html.indexOf("set-has")).toBeLessThan(html.indexOf("qb-block-match"));
  });

  describe("the panel tabs and the panel", () => {
    const b = newBlock("thing");
    const q: Group = { ...emptyQuery(), children: [b] };
    const draw = (panelTab: BlockCtx["panelTab"]) => blockHtml({ ...ctxFor(q), panelTab }, b, pos);

    it("draws Seen together and About as toggle buttons, the open one says it hides", () => {
      const html = draw("seen");
      expect(html).toContain(
        '<button type="button" class="qb-tab-btn is-on" data-action="panel-seen" aria-pressed="true" title="Hide panel">Seen together</button>',
      );
      expect(html).toContain(
        '<button type="button" class="qb-tab-btn" data-action="panel-about" aria-pressed="false">About</button>',
      );
    });

    it("draws the legend's ? button and keeps ✕ last on the first line", () => {
      const html = draw("seen");
      expect(html).toContain('aria-label="Explain the colours"');
      const line1 = html.slice(0, html.indexOf("qb-block-body"));
      expect(line1.indexOf("panel-about")).toBeLessThan(line1.indexOf("Explain the colours"));
      expect(line1.indexOf("Explain the colours")).toBeLessThan(line1.indexOf("remove-node"));
    });

    it("shows the Seen together placeholder beside the rows", () => {
      const html = draw("seen");
      expect(html).toContain('<div class="qb-block-body has-panel">');
      expect(html).toContain(`<div class="qb-seen" data-block-id="${b.id}"></div>`);
      expect(html).not.toContain("qb-about");
    });

    it("shows About with the facet's details", () => {
      const html = draw("about");
      expect(html).toContain(`class="qb-about" data-block-id="${b.id}"`);
      expect(html).toContain("About Thing");
      expect(html).not.toContain("qb-seen");
    });

    it("draws no panel when it is hidden, so the rows take the whole width", () => {
      const html = draw(null);
      expect(html).toContain('<div class="qb-block-body">');
      expect(html).not.toContain(`class="qb-panel"`);
      expect(html).toContain('data-action="panel-seen" aria-pressed="false"');
      expect(html).not.toContain("Hide panel");
    });

    // A folded block has no rows and no panel: tabs would switch nothing in it.
    it("draws no tabs on a folded block", () => {
      const html = blockHtml(ctxFor(q), { ...b, collapsed: true }, pos);
      expect(html).not.toContain("panel-seen");
      expect(html).not.toContain(`class="qb-panel"`);
      // The legend explains the co-occurrence row above every block, folded too.
      expect(html).toContain('aria-label="Explain the colours"');
    });
  });

  it("folds to its head and the summary line", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      collapsed: true,
      conditions: [newFieldCondition("size", "gt", 40)],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain("is-collapsed");
    expect(html).toContain("Thing has size &gt; 40");
    // Like a folded group's line, the whole head unfolds it on a click.
    expect(html).toContain(
      '<div class="qb-block-head" data-action="toggle-collapse" title="Click to expand"><div class="qb-block-line">',
    );
    expect(html).not.toContain("qb-field-row");
  });
});

describe("groupHtml", () => {
  it("offers + Facet as a picker of every facet, and + Group as the focus landing", () => {
    const q = emptyQuery();
    const html = groupHtml(ctxFor(q), q, true);
    expect(html).toContain(
      'data-part="add-facet" aria-label="Add a facet to this group"><option value="">+ Facet</option><option value="thing">Thing</option>',
    );
    expect(html).toMatch(/data-action="add-group" data-focus-landing/);
    expect(html).not.toContain("add-condition");
  });

  it("counts facets in a folded group", () => {
    const g = { ...groupOf([newBlock("thing"), newBlock("thing")]), collapsed: true };
    const q: Group = { ...emptyQuery(), children: [g] };
    expect(groupHtml(ctxFor(q), g, false, pos)).toContain("2 facets");
  });
});

describe("footerHtml", () => {
  it("asks for a facet in an empty query, and shows the summary otherwise", () => {
    expect(footerHtml(emptyQuery(), [], catalog)).toContain(
      "Add a facet to start building the query.",
    );
    const q: Group = { ...emptyQuery(), children: [newBlock("thing")] };
    expect(footerHtml(q, [], catalog)).toContain("Thing present");
  });

  it("counts the parts with an issue, not the issues", () => {
    const root = emptyQuery();
    const query: Group = { ...root, children: [newBlock("thing"), newBlock("thing")] };
    const issue = (nodeId: string): Issue => ({ nodeId, message: "m", kind: "invalid" });
    expect(footerHtml(query, [issue(root.id), issue(root.id)], catalog)).toContain(
      "1 part of the query still needs attention.",
    );
    expect(footerHtml(query, [issue(root.id), issue("c")], catalog)).toContain(
      "2 parts of the query still need attention.",
    );
  });
});

// The tests below came from the builder before facet blocks (queryBuilder.ts
// drew groups then); the group's markup moved here unchanged.

describe("group collapse controls", () => {
  const group = { ...emptyQuery(), id: "g-inner", children: [newBlock("thing")] };
  const ctx = ctxFor(emptyQuery());

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
  const block = newBlock("thing");
  const group = { ...emptyQuery(), id: "g-inner", children: [block] };
  const ctx = ctxFor(emptyQuery());
  const GROUP_GRIP = 'qb-grip qb-grip-group" draggable="true" data-node-item="g-inner"';

  it("a group's grip says it moves the whole group, in its own style", () => {
    const html = groupHtml(ctx, group, false);
    expect(html).toContain(GROUP_GRIP);
    expect(html).toContain('title="Drag to move this group"');
  });

  it("a folded group keeps its grip", () => {
    expect(groupHtml(ctx, { ...group, collapsed: true }, false)).toContain(GROUP_GRIP);
  });

  it("a block's grip says it moves one facet", () => {
    const html = groupHtml(ctx, group, false);
    expect(html).toContain(
      `class="qb-grip qb-grip-facet" draggable="true" data-node-item="${block.id}"`,
    );
    expect(html).toContain('title="Drag to move this facet"');
  });

  it("the root group has no grip: it can't be moved", () => {
    expect(groupHtml(ctx, { ...group, children: [] }, true)).not.toContain("qb-grip-group");
  });
});

describe("Group contents and Ungroup buttons", () => {
  const block = () => newBlock("thing");
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
    const root = group("r", "AND", [block(), block()]);
    const head = headOf(root, "r", true);
    expect(head).toContain('data-action="group-contents"');
    expect(head).toContain("Group contents</button>");
    expect(head).toContain(
      'title="Put this group\'s facets and groups into a new group inside it"',
    );
  });

  it("a group with one item offers no Group contents", () => {
    const root = group("r", "AND", [block()]);
    expect(headOf(root, "r", true)).not.toContain("group-contents");
  });

  it("the root group never offers Ungroup", () => {
    const root = group("r", "AND", [block(), block()]);
    expect(headOf(root, "r", true)).not.toContain('data-action="ungroup"');
  });

  it("a group that matches its parent's ALL/ANY can be ungrouped", () => {
    const root = group("r", "AND", [group("g", "AND", [block(), block()])]);
    const head = headOf(root, "g", false);
    expect(head).toContain('data-action="ungroup"');
    expect(head).not.toContain("aria-disabled");
  });

  it("a group that would change the meaning shows Ungroup as disabled, with the reason", () => {
    const root = group("r", "AND", [group("g", "OR", [block(), block()])]);
    const head = headOf(root, "g", false);
    expect(head).toContain('data-action="ungroup"');
    expect(head).toContain('aria-disabled="true"');
    expect(head).toContain(`title="${UNGROUP_BLOCKED_MESSAGE}"`);
  });

  it("the action buttons share one box and the remove button comes last in it", () => {
    const root = group("r", "AND", [group("g", "AND", [block(), block()])]);
    const head = headOf(root, "g", false);
    const actions = head.slice(head.indexOf('<span class="qb-group-actions">'));
    expect(actions).toContain('data-part="add-facet"');
    expect(actions.lastIndexOf('data-action="remove-node"')).toBeGreaterThan(
      actions.lastIndexOf('data-action="ungroup"'),
    );
  });

  it("a folded group shows neither button", () => {
    const root = group("r", "AND", [{ ...group("g", "AND", [block(), block()]), collapsed: true }]);
    const html = groupHtml(ctxFor(root), root.children[0] as Group, false);
    expect(html).not.toContain("group-contents");
    expect(html).not.toContain('data-action="ungroup"');
  });
});

describe("Move up / Move down buttons", () => {
  const ctx = ctxFor(emptyQuery());
  const [a, b, c] = [newBlock("thing"), newBlock("thing"), newBlock("thing")];

  it("every child of a group gets buttons that fit its place; the root gets none", () => {
    const html = groupHtml(ctx, { ...emptyQuery(), children: [a, b, c] }, true);
    expect(html.match(/data-action="move-up"/g)).toHaveLength(3);
    expect(html.match(/data-action="move-down"/g)).toHaveLength(3);
    expect(html.match(/data-action="move-up"[^>]* aria-disabled="true"/g)).toHaveLength(1);
    expect(html.match(/data-action="move-down"[^>]* aria-disabled="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Move Thing up"');
  });

  it("a nested group has its own buttons, open or folded", () => {
    const inner = { ...emptyQuery(), id: "g-inner", children: [a] };
    const place = { index: 2, count: 3 };
    for (const g of [inner, { ...inner, collapsed: true }]) {
      expect(groupHtml(ctx, g, false, place)).toContain('aria-label="Move group up"');
    }
  });
});
