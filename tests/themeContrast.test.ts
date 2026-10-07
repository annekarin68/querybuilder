import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const root = /:root\s*{([^}]*)}/.exec(css)![1]!;
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
  if (!m) throw new Error(`--${name} is not a #rrggbb token in :root`);
  return m[1]!;
};
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text token, background token]
const PAIRS: [string, string][] = [
  ["qb-text", "qb-surface"],
  ["qb-text", "qb-bg"],
  ["qb-muted", "qb-surface"],
  ["qb-muted", "qb-bg"],
  ["qb-subtle", "qb-surface"],
  ["qb-text-on-fill", "qb-topbar"],
  ["qb-topbar-text", "qb-topbar"],
  ["qb-topbar-muted", "qb-topbar"],
  ["qb-text-on-fill", "qb-and"],
  ["qb-selected-text", "qb-selected-bg"],
  ["qb-selected-text", "qb-chip"],
  ["qb-or-text", "qb-surface"],
  ["qb-danger", "qb-surface"],
  ["qb-warn", "qb-surface"],
  // The compliance badges inside the account chip. Their backgrounds must be
  // opaque tokens: a see-through tint was once 3.5:1 on the green chip.
  ["qb-topbar-ok-text", "qb-topbar-ok-bg"],
  ["qb-topbar-warn-text", "qb-topbar-warn-bg"],
];

// Not text: a colour that marks keyboard focus must stand out (WCAG 1.4.11, 3:1)
// from what is on both sides of it.
const FOCUS_INDICATORS: [string, string][] = [
  ["qb-and", "qb-bg"], // the dictionary resize handle (.qb-docs-resize:focus-visible)
  ["qb-and", "qb-surface"],
];

describe("pickle palette", () => {
  it.each(PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("keyboard focus indicators", () => {
  it.each(FOCUS_INDICATORS)("%s against %s meets WCAG 1.4.11 (3:1)", (indicator, neighbour) => {
    expect(ratio(token(indicator), token(neighbour))).toBeGreaterThanOrEqual(3);
  });
});
