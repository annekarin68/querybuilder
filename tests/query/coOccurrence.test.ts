import { describe, it, expect } from "vitest";
import type { CoValue, Facet } from "../../src/model";
import {
  connectedFacets,
  coOccurrenceColour,
  coOccurrenceRange,
  formatPercent,
  legendTicks,
  scalePosition,
  squarify,
  stepFactorText,
  type Rect,
} from "../../src/query/coOccurrence";

function co(text: string, tooRare = false): CoValue {
  return { text, percent: tooRare ? 0 : Number(text), tooRare };
}

function facet(id: string, values: Record<string, CoValue> = {}): Facet {
  return {
    id,
    name: id,
    number: 0,
    tags: [],
    group: "",
    comment: "",
    description: "",
    eventCount: 0,
    coOccurrence: new Map(Object.entries({ [id]: co("100"), ...values })),
    fields: [],
  };
}

describe("connectedFacets", () => {
  it("keeps facets mentioned in either direction and drops an isolated one", () => {
    const a = facet("a", { b: co("5") });
    const b = facet("b");
    const c = facet("c");
    expect(connectedFacets([a, b, c]).map((f) => f.id)).toEqual(["a", "b"]);
  });
  it("ignores a facet's own 100 and zeros", () => {
    expect(connectedFacets([facet("a", { b: co("0") }), facet("b")])).toEqual([]);
  });
  it("treats too rare as seen", () => {
    const a = facet("a", { b: co("1e-400", true) });
    expect(connectedFacets([a, facet("b")]).map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("coOccurrenceRange", () => {
  it("ignores own values, zeros and too-rare values", () => {
    const a = facet("a", { b: co("0.5"), c: co("0"), d: co("1e-400", true) });
    const b = facet("b", { a: co("20") });
    expect(coOccurrenceRange([a, b])).toEqual({ min: 0.5, max: 20 });
  });
  it("is null when nothing is positive", () => {
    expect(coOccurrenceRange([facet("a"), facet("b", { a: co("0") })])).toBeNull();
  });
});

describe("scalePosition", () => {
  const range = { min: 1, max: 10000 };
  it("is 0 at the minimum, 1 at the maximum and 0.5 at the geometric middle", () => {
    expect(scalePosition(1, range)).toBe(0);
    expect(scalePosition(10000, range)).toBe(1);
    expect(scalePosition(100, range)).toBeCloseTo(0.5, 10);
  });
  it("is 1 when the range is one value", () => {
    expect(scalePosition(3, { min: 3, max: 3 })).toBe(1);
  });
});

describe("coOccurrenceColour", () => {
  const stops = ["#000000", "#ff0000", "#ffffff"];
  const range = { min: 1, max: 100 };
  it("gives the first stop at the minimum and the last at the maximum", () => {
    expect(coOccurrenceColour(1, range, stops)).toBe("#000000");
    expect(coOccurrenceColour(100, range, stops)).toBe("#ffffff");
  });
  it("gives a stop exactly at its position", () => {
    expect(coOccurrenceColour(10, range, stops)).toBe("#ff0000");
  });
});

describe("squarify", () => {
  const values = [6, 6, 4, 3, 2, 2, 1, 0];
  const rects = squarify(values, 300, 200);
  const at = (i: number): Rect => rects[i] ?? { x: NaN, y: NaN, w: NaN, h: NaN };

  it("keeps the input order and count", () => {
    expect(rects).toHaveLength(values.length);
  });
  it("stays inside the bounds", () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(300 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-6);
    }
  });
  it("makes areas proportional to values", () => {
    const total = values.reduce((s, v) => s + v, 0);
    rects.forEach((r, i) => {
      expect(Math.abs(r.w * r.h - ((values[i] ?? 0) / total) * 300 * 200)).toBeLessThan(1e-6);
    });
  });
  it("never overlaps two rects", () => {
    const eps = 1e-6;
    const overlap = (p: Rect, q: Rect) =>
      Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > eps &&
      Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > eps;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(at(i), at(j))).toBe(false);
      }
    }
  });
  it("gives a zero value an empty rect", () => {
    const zero = at(7);
    expect(zero.w * zero.h).toBe(0);
  });
  it("handles an empty list and all zeros", () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([0, 0], 100, 100).map((r) => r.w * r.h)).toEqual([0, 0]);
  });
});

describe("legend text", () => {
  it("labels 7 stops from 1e-12 % to 100 %", () => {
    const ticks = legendTicks({ min: 1e-12, max: 100 }, 7);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]?.label).toBe("1e-12 %");
    expect(ticks[6]?.label).toBe("100 %");
    expect(ticks[0]?.at).toBe(0);
    expect(ticks[6]?.at).toBe(1);
  });
  it("says how many times more often each step is", () => {
    expect(stepFactorText({ min: 1e-4, max: 100 }, 4)).toBe("about 100 times");
  });
  it("writes values below 1 % as plain decimals down to 0.001 %", () => {
    const labels = (min: number, max: number, n: number) =>
      legendTicks({ min, max }, n).map((t) => t.label);
    expect(labels(0.5, 50, 3)).toEqual(["0.5 %", "5 %", "50 %"]);
    expect(labels(0.04, 4, 2)).toEqual(["0.04 %", "4 %"]);
    expect(labels(0.001, 0.1, 3)).toEqual(["0.001 %", "0.01 %", "0.1 %"]);
    // Below 0.001 % a decimal would be a row of zeros: the exponent, as the
    // backend writes such values in the captions.
    expect(labels(1e-4, 1, 2)).toEqual(["1e-4 %", "1 %"]);
  });
  it("writes a huge step as a power of ten, not a row of digits", () => {
    // Two stops over 1e-12 … 100: one step of 10^14.
    expect(stepFactorText({ min: 1e-12, max: 100 }, 2)).toBe("about 10¹⁴ times");
    expect(stepFactorText({ min: 1e-12, max: 3.2e2 }, 2)).toBe("about 3.2 × 10¹⁴ times");
    // Below a million the digits are still easy to read.
    expect(stepFactorText({ min: 1, max: 500_000 }, 2)).toBe("about 500000 times");
    // Judged after rounding: 999 000 is "about a million".
    expect(stepFactorText({ min: 1, max: 999_000 }, 2)).toBe("about 10⁶ times");
  });
  it("formatPercent adds the unit to the backend's text", () => {
    expect(formatPercent("1.2e-20")).toBe("1.2e-20 %");
  });
});

describe("robustness", () => {
  it("squarify keeps very unequal values inside the box", () => {
    const rects = squarify([1e-12, 100], 300, 200);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(300 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(200 + 1e-6);
    }
    const big = rects[1];
    expect(Math.abs((big?.w ?? 0) * (big?.h ?? 0) - 60000)).toBeLessThan(1e-3);
  });
  it("squarify copes with values whose sum overflows", () => {
    const rects = squarify([1e308, 1e308], 100, 60);
    expect(rects.map((r) => r.w * r.h)).toEqual([3000, 3000]);
  });
  it("squarify gives non-finite values an empty rect", () => {
    const rects = squarify([Infinity, 1, NaN], 100, 100);
    expect(rects.map((r) => r.w * r.h)).toEqual([0, 10000, 0]);
  });
  it("needs at least two stops", () => {
    const range = { min: 1, max: 10 };
    expect(() => coOccurrenceColour(5, range, ["#000000"])).toThrow(
      "coOccurrenceColour needs at least two stops",
    );
    expect(() => legendTicks(range, 1)).toThrow();
    expect(() => stepFactorText(range, 1)).toThrow();
  });
  it("scalePosition of NaN is 0", () => {
    expect(scalePosition(NaN, { min: 1, max: 10 })).toBe(0);
  });
});
