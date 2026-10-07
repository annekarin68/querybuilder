import { describe, it, expect } from "vitest";
import { controlOf, sameControl } from "../../src/ui/focusMemory";

/** Just enough of an element for controlOf: a tag and some attributes. */
function el(tagName: string, attributes: Record<string, string> = {}) {
  return { tagName, getAttribute: (name: string) => attributes[name] ?? null };
}

describe("controlOf (which control an element is, in words that survive a repaint)", () => {
  it("names a button by what it does", () => {
    expect(controlOf(el("BUTTON", { "data-action": "add-condition" }))).toEqual({
      tag: "BUTTON",
      attribute: "data-action",
      value: "add-condition",
    });
  });

  it("names a database checkbox by its database", () => {
    expect(controlOf(el("INPUT", { "data-db-id": "x" }))).toEqual({
      tag: "INPUT",
      attribute: "data-db-id",
      value: "x",
    });
  });

  it("names the All and None buttons by their marker attribute", () => {
    expect(controlOf(el("BUTTON", { "data-db-all": "" }))?.attribute).toBe("data-db-all");
    expect(controlOf(el("BUTTON", { "data-db-none": "" }))?.attribute).toBe("data-db-none");
  });

  it("tells the two boxes of a range apart, though both are the value", () => {
    const from = controlOf(el("INPUT", { "data-part": "value", "data-range": "from" }));
    const to = controlOf(el("INPUT", { "data-part": "value", "data-range": "to" }));
    expect(from?.value).toBe("from");
    expect(sameControl(from, to)).toBe(false);
  });

  it("prefers what a control does over its label, which may change (Collapse/Expand)", () => {
    const collapse = el("BUTTON", { "data-action": "toggle-collapse", "aria-label": "Collapse" });
    const expand = el("BUTTON", { "data-action": "toggle-collapse", "aria-label": "Expand" });
    expect(sameControl(controlOf(collapse), controlOf(expand))).toBe(true);
  });

  it("falls back to the label: a dropdown's typing box has nothing else", () => {
    expect(controlOf(el("INPUT", { "aria-label": "Operator" }))).toEqual({
      tag: "INPUT",
      attribute: "aria-label",
      value: "Operator",
    });
  });

  it("has no name for an element without any of those attributes", () => {
    expect(controlOf(el("SUMMARY"))).toBeNull();
  });
});

describe("sameControl", () => {
  it("is the same control when tag, attribute and value all match", () => {
    const a = controlOf(el("BUTTON", { "data-action": "set-or" }));
    const b = controlOf(el("BUTTON", { "data-action": "set-or" }));
    expect(sameControl(a, b)).toBe(true);
  });

  it("a folded group's header line is not its collapse button (same action, other tag)", () => {
    const button = controlOf(el("BUTTON", { "data-action": "toggle-collapse" }));
    const line = controlOf(el("DIV", { "data-action": "toggle-collapse" }));
    expect(sameControl(button, line)).toBe(false);
  });

  it("an element without a name is never the same control as anything", () => {
    expect(sameControl(null, null)).toBe(false);
    expect(sameControl(controlOf(el("BUTTON", { "data-action": "run" })), null)).toBe(false);
  });
});
