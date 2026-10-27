import { describe, it, expect } from "vitest";
import { collapseButton, issuesHtml, moveButtons, nodeGrip } from "../../src/ui/builderParts";

describe("group collapse controls", () => {
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
});

describe("issuesHtml", () => {
  const warning = "Group contains no valid conditions.";

  it("a problem the databases found is highlighted even when it is only incomplete", () => {
    const html = issuesHtml("g1", [
      { nodeId: "g1", message: warning, kind: "incomplete", fromServer: true },
    ]);
    expect(html).toBe(
      `<div class="qb-server-warning"><i class="exclamation triangle icon" aria-hidden="true"></i>${warning}</div>`,
    );
  });

  it("the red invalid icon is decoration, hidden from screen readers like the warning's", () => {
    const html = issuesHtml("g1", [{ nodeId: "g1", message: "Bad date.", kind: "invalid" }]);
    expect(html).toBe(
      '<div class="qb-invalid"><i class="exclamation circle icon" aria-hidden="true"></i>Bad date.</div>',
    );
  });

  it("the user's own unfinished parts stay a quiet grey hint", () => {
    const html = issuesHtml("g1", [
      { nodeId: "g1", message: "Add a condition to this group.", kind: "incomplete" },
    ]);
    expect(html).toBe('<div class="qb-hint">Add a condition to this group.</div>');
  });

  it("only shows the issues of the node it is asked about", () => {
    expect(issuesHtml("g2", [{ nodeId: "g1", message: "x", kind: "invalid" }])).toBe("");
  });
});

describe("Move up / Move down buttons", () => {
  /** The button with `data-action` in `html`, up to its closing tag. */
  const button = (html: string, action: string) => {
    const at = html.indexOf(`data-action="${action}"`);
    return html.slice(html.lastIndexOf("<button", at), html.indexOf("</button>", at));
  };

  it("names what moves and which way, for screen readers", () => {
    const html = moveButtons("Thing", { index: 2, count: 3 });
    expect(button(html, "move-up")).toContain('aria-label="Move Thing up"');
    expect(button(html, "move-down")).toContain('aria-label="Move Thing down"');
    expect(html).toContain('role="group" aria-label="Move Thing"');
    expect(moveButtons("group", { index: 2, count: 3 })).toContain('aria-label="Move group up"');
  });

  it("escapes the name it is given", () => {
    expect(moveButtons('A "B"', { index: 2, count: 3 })).toContain(
      'aria-label="Move A &quot;B&quot; up"',
    );
  });

  it("a middle node can go either way", () => {
    const html = moveButtons("Thing", { index: 2, count: 3 });
    expect(html).not.toContain("disabled");
  });

  // aria-disabled, not disabled: a disabled button loses keyboard focus, and
  // Enter pressed repeatedly would then bounce the node back the other way.
  it("the first node can't go up and the last can't go down", () => {
    const first = moveButtons("Thing", { index: 1, count: 3 });
    expect(button(first, "move-up")).toContain('aria-disabled="true"');
    expect(button(first, "move-down")).not.toContain("disabled");
    const last = moveButtons("Thing", { index: 3, count: 3 });
    expect(button(last, "move-up")).not.toContain("disabled");
    expect(button(last, "move-down")).toContain('aria-disabled="true"');
  });

  it("an unavailable end stays focusable: it has no disabled attribute", () => {
    const first = moveButtons("Thing", { index: 1, count: 3 });
    expect(button(first, "move-up")).not.toMatch(/ disabled[ >=]/);
  });

  it("an only child has nothing to pass either way", () => {
    const only = moveButtons("Thing", { index: 1, count: 1 });
    expect(only.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(only).not.toMatch(/ disabled[ >=]/);
  });
});

describe("facet block parts", () => {
  it("labels a facet's grip and fold button as a facet's", () => {
    expect(nodeGrip("f-1", "facet")).toContain('title="Drag to move this facet"');
    expect(nodeGrip("f-1", "facet")).toContain("qb-grip-facet");
    expect(nodeGrip("g-1", "group")).toContain("qb-grip qb-grip-group");
    expect(collapseButton(false, "facet")).toContain('aria-label="Collapse facet"');
    expect(collapseButton(true)).toContain('aria-label="Expand group"');
  });
});
