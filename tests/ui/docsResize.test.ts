import { describe, it, expect } from "vitest";
import {
  clampDocsWidth,
  docsWidthAfterKey,
  DOCS_DEFAULT_REM,
  DOCS_MAX_REM,
  DOCS_MIN_REM,
} from "../../src/ui/docsResize";

describe("clampDocsWidth", () => {
  it("keeps the sidebar between 20 and 40rem", () => {
    expect(DOCS_MIN_REM).toBe(20);
    expect(DOCS_MAX_REM).toBe(40);
    expect(clampDocsWidth(5)).toBe(20);
    expect(clampDocsWidth(30)).toBe(30);
    expect(clampDocsWidth(99)).toBe(40);
  });
  it("falls back to the default for nonsense", () => {
    expect(clampDocsWidth(NaN)).toBe(DOCS_DEFAULT_REM);
  });
});

// Left (shrinking) steps from the width the user can SEE: under 1100 px a
// stored width wider than the window is cut by CSS, so stepping from the
// stored number would change nothing on screen for the first few presses.
// Right (growing) steps from the STORED width, so a grow key never lowers the
// remembered width (or the announced aria-valuenow).
describe("docsWidthAfterKey", () => {
  it("steps from the stored width when the whole width is visible (wide windows)", () => {
    expect(docsWidthAfterKey(30, 30, -1)).toBe(29);
    expect(docsWidthAfterKey(30, 30, 1)).toBe(31);
  });

  it("shrinks from the visible width when the column is cut to fit the window", () => {
    // Stored 40rem, but a 512 px window shows only about 33.6rem.
    expect(docsWidthAfterKey(40, 33.6, -1)).toBeCloseTo(32.6, 5);
    expect(docsWidthAfterKey(30, 25, -1)).toBe(24);
  });

  it("grows from the stored width when the column is cut, never lowering it", () => {
    // At the stored maximum a Right press leaves it at the maximum...
    expect(docsWidthAfterKey(40, 33.6, 1)).toBe(40);
    // ...and below it the stored width goes up, though the cut column looks the same.
    expect(docsWidthAfterKey(30, 25, 1)).toBe(31);
  });

  it("never lowers the stored width on a growing step", () => {
    for (const stored of [20, 26, 33.5, 39.5, 40]) {
      for (const visible of [5, 20, 25, stored, 45]) {
        expect(docsWidthAfterKey(stored, visible, 1)).toBeGreaterThanOrEqual(stored);
      }
    }
  });

  it("steps from the stored width when the visible width is larger", () => {
    expect(docsWidthAfterKey(26, 30, -1)).toBe(25);
    expect(docsWidthAfterKey(26, 30, 1)).toBe(27);
  });

  it("keeps the result within the allowed range", () => {
    expect(docsWidthAfterKey(DOCS_MIN_REM, DOCS_MIN_REM, -1)).toBe(DOCS_MIN_REM);
    expect(docsWidthAfterKey(DOCS_MAX_REM, DOCS_MAX_REM, 1)).toBe(DOCS_MAX_REM);
    // Visible just under the maximum: Right is capped by the clamp.
    expect(docsWidthAfterKey(DOCS_MAX_REM, DOCS_MAX_REM - 0.5, 1)).toBe(DOCS_MAX_REM);
    // Visible under the minimum (a very small window): Left stays at the minimum.
    expect(docsWidthAfterKey(DOCS_MAX_REM, 15, -1)).toBe(DOCS_MIN_REM);
  });

  it("falls back to the stored width when the visible width is not a usable number", () => {
    for (const unusable of [NaN, 0, -3, Infinity]) {
      expect(docsWidthAfterKey(30, unusable, -1)).toBe(29);
      expect(docsWidthAfterKey(30, unusable, 1)).toBe(31);
    }
  });

  it("falls back to the default width when the stored width is not a number", () => {
    expect(docsWidthAfterKey(NaN, 30, -1)).toBe(DOCS_DEFAULT_REM);
    expect(docsWidthAfterKey(NaN, NaN, 1)).toBe(DOCS_DEFAULT_REM);
    expect(docsWidthAfterKey(Infinity, 0, 1)).toBe(DOCS_DEFAULT_REM);
  });
});
