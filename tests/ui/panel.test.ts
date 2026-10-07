import { describe, it, expect } from "vitest";
import { focusSelectorFor, quoteForCssString, type FocusDescription } from "../../src/ui/panel";

/** A description of a focused element; each test overrides only what it is about. */
function described(overrides: Partial<FocusDescription>): FocusDescription {
  return {
    tagName: "BUTTON",
    data: {},
    nodeId: null,
    id: "",
    inDropdown: false,
    ...overrides,
  };
}

describe("quoteForCssString", () => {
  it("leaves an ordinary value alone", () => {
    expect(quoteForCssString("db-1")).toBe("db-1");
  });

  it("escapes the characters that would end or break a quoted attribute value", () => {
    expect(quoteForCssString('a"b')).toBe('a\\"b');
    expect(quoteForCssString("a\\b")).toBe("a\\\\b");
    expect(quoteForCssString("a\nb")).toBe("a\\a b");
    // A carriage return and a form feed also end a CSS string, and ids come from the backend.
    expect(quoteForCssString("a\rb")).toBe("a\\d b");
    expect(quoteForCssString("a\fb")).toBe("a\\c b");
  });
});

describe("focusSelectorFor", () => {
  it("finds a database checkbox by its database id", () => {
    const d = described({ tagName: "INPUT", data: { dbId: "d1" } });
    expect(focusSelectorFor(d)).toBe('input[data-db-id="d1"]');
  });

  it("escapes the database id", () => {
    const d = described({ tagName: "INPUT", data: { dbId: 'x"]' } });
    expect(focusSelectorFor(d)).toBe('input[data-db-id="x\\"]"]');
  });

  it("finds the All and None buttons", () => {
    expect(focusSelectorFor(described({ data: { dbAll: "" } }))).toBe("[data-db-all]");
    expect(focusSelectorFor(described({ data: { dbNone: "" } }))).toBe("[data-db-none]");
  });

  it("finds a group's or condition's button by node and action", () => {
    const d = described({ data: { action: "add-condition" }, nodeId: "g1" });
    expect(focusSelectorFor(d)).toBe('[data-node-id="g1"] button[data-action="add-condition"]');
  });

  it("names the tag, so a folded group's header (a div with the same action) is not matched", () => {
    // The header carries data-action="toggle-collapse" too but cannot take focus.
    const d = described({ tagName: "BUTTON", data: { action: "toggle-collapse" }, nodeId: "g1" });
    const selector = focusSelectorFor(d)!;
    expect(selector).toBe('[data-node-id="g1"] button[data-action="toggle-collapse"]');
    expect(selector).not.toMatch(/(^|\s)\[data-action/);
  });

  it("finds the warning's dismiss icon by its own tag", () => {
    const d = described({ tagName: "I", data: { action: "dismiss-notice" } });
    expect(focusSelectorFor(d)).toBe('i[data-action="dismiss-notice"]');
  });

  it("finds the dictionary's Clear search button", () => {
    expect(focusSelectorFor(described({ data: { action: "clear-filter" } }))).toBe(
      'button[data-action="clear-filter"]',
    );
  });

  it("finds the account menu's buttons", () => {
    expect(focusSelectorFor(described({ data: { action: "logout" } }))).toBe(
      'button[data-action="logout"]',
    );
  });

  it("gives up on the dictionary's Add buttons: one cannot be told from the next", () => {
    expect(focusSelectorFor(described({ data: { action: "add-item" } }))).toBeNull();
  });

  it("finds a focusable element that has an id", () => {
    expect(focusSelectorFor(described({ tagName: "DIV", id: "qb-x" }))).toBe('[id="qb-x"]');
  });

  it("leaves everything inside a Fomantic dropdown to the dropdown's own focus code", () => {
    const d = described({
      tagName: "INPUT",
      data: { action: "x" },
      nodeId: "c1",
      inDropdown: true,
    });
    expect(focusSelectorFor(d)).toBeNull();
  });

  it("leaves text and number boxes alone (the value box has its own focus code)", () => {
    expect(focusSelectorFor(described({ tagName: "INPUT", nodeId: "c1" }))).toBeNull();
    expect(focusSelectorFor(described({ tagName: "INPUT", id: "qb-docs-filter" }))).toBeNull();
  });

  it("returns null for an element it knows nothing about", () => {
    expect(focusSelectorFor(described({}))).toBeNull();
  });
});
