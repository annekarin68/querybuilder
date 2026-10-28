import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { betterOn, contrastRatio, mixOklab } from "../src/util/colour";

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
  // A field row's background: its "More:" hint (muted: subtle was under 4.5:1
  // on the row's hover tint) and its text sit on it.
  ["qb-subtle", "qb-surface-2"],
  ["qb-muted", "qb-surface-2"],
  // The compliance log in the account menu.
  ["qb-text", "qb-surface-2"],
  ["qb-text-on-fill", "qb-topbar"],
  ["qb-topbar-text", "qb-topbar"],
  ["qb-topbar-muted", "qb-topbar"],
  ["qb-text-on-fill", "qb-and"],
  ["qb-selected-text", "qb-selected-bg"],
  ["qb-selected-text", "qb-chip"],
  ["qb-or-text", "qb-surface"],
  // The id link in the Matching events table (.qb-et-id-btn).
  ["qb-and", "qb-surface"],
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

// Not text: the statistics bars carry meaning by colour and must stand out
// 3:1 from the empty track and the card (WCAG 1.4.11).
const GRAPHICS: [string, string][] = [
  ["qb-and", "qb-track"],
  ["qb-danger", "qb-track"],
  ["qb-danger", "qb-surface"],
  // A failed bar is striped, so "failed" is not told by colour alone: its two
  // stripe colours must be told apart from each other.
  ["qb-danger", "qb-danger-stripe"],
];

describe("statistics bars", () => {
  it.each(GRAPHICS)("%s against %s meets WCAG 1.4.11 (3:1)", (mark, neighbour) => {
    expect(ratio(token(mark), token(neighbour))).toBeGreaterThanOrEqual(3);
  });
});

// Co-occurrence colours (docs/ARCHITECTURE.md, "Pickle theme and mascot").
// The light stops cannot reach 3:1 against the card without losing the
// gradient, so each cell has an outline that does; the stops themselves are
// checked against the card only for the lightest one, at 1.25:1, so it is
// still told from the card.
const stops = (): string[] => {
  const found: string[] = [];
  for (let n = 1; new RegExp(`--qb-cooc-stop-${n}:`).test(root); n++)
    found.push(token(`qb-cooc-stop-${n}`));
  return found;
};

describe("co-occurrence colours", () => {
  it("has at least two stops", () => {
    expect(stops().length).toBeGreaterThanOrEqual(2);
  });

  // The app (coTokens.ts) and `stops()` above both stop counting at the first
  // missing number, so a gap would silently drop every later stop.
  it("numbers its stops 1, 2, 3 … without a gap", () => {
    const numbers = [...root.matchAll(/--qb-cooc-stop-(\d+):/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it.each([
    ["qb-cooc-cell-border", "qb-surface"],
    ["qb-cooc-own", "qb-surface"],
  ])("%s against %s meets WCAG 1.4.11 (3:1)", (mark, neighbour) => {
    expect(contrastRatio(token(mark), token(neighbour))).toBeGreaterThanOrEqual(3);
  });

  // The lightest stop is the "rarely together" box: it must show on the card.
  it("the lightest stop is at least 1.25:1 against the card", () => {
    expect(contrastRatio(stops()[0]!, token("qb-surface"))).toBeGreaterThanOrEqual(1.25);
  });

  // The merged box ("+ N less often") is striped with two greys; its label
  // sits on both.
  it.each(["qb-cooc-merged", "qb-cooc-merged-stripe"])(
    "the merged box's label reaches 4.5:1 on %s",
    (grey) => {
      expect(contrastRatio(token(grey), token("qb-cooc-dot-dark"))).toBeGreaterThanOrEqual(4.5);
    },
  );

  // Every stop, and three blends between each pair of neighbours, as the
  // painter will draw them.
  const backgrounds = (): string[] => {
    const all = stops();
    const out = [...all, token("qb-cooc-never")];
    for (let i = 0; i + 1 < all.length; i++) {
      for (const t of [0.25, 0.5, 0.75]) out.push(mixOklab(all[i]!, all[i + 1]!, t));
    }
    return out;
  };

  it("the chosen dot colour reaches 3:1 on every stop, blend and the never colour", () => {
    for (const bg of backgrounds()) {
      const dot = betterOn(bg, token("qb-cooc-dot-dark"), token("qb-cooc-dot-light"));
      expect(contrastRatio(bg, dot), `${dot} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the chosen box label colour reaches 4.5:1 on every stop, blend and the never colour", () => {
    for (const bg of backgrounds()) {
      const label = betterOn(bg, token("qb-cooc-dot-dark"), token("qb-cooc-dot-light"));
      expect(contrastRatio(bg, label), `${label} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
