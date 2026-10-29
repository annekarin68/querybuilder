import { describe, it, expect } from "vitest";
import type { CoValue, Facet } from "../../src/model";
import {
  alwaysTogetherIds,
  connectedFacets,
  coOccurrenceColour,
  formatPercent,
  isFull,
  LEGEND_TICKS,
  roundPercentText,
  scalePosition,
  squarify,
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

describe("alwaysTogetherIds", () => {
  it("finds the facets at 100 % in every other facet's map", () => {
    const a = facet("a", { b: co("100"), c: co("100") });
    const b = facet("b", { a: co("40"), c: co("100") });
    const c = facet("c", { a: co("100"), b: co("100") });
    // c is 100 in a and b; b only in a and c; a only in c.
    expect([...alwaysTogetherIds([a, b, c])]).toEqual(["b", "c"]);
  });
  it("does not count a facet that is not seen with any other, or has no data", () => {
    const a = facet("a", { b: co("100") });
    const b = facet("b", { a: co("100") });
    const empty = facet("e", { a: co("0"), b: co("0") });
    const noData = { ...facet("n"), coOccurrence: null };
    expect([...alwaysTogetherIds([a, b, empty, noData])]).toEqual(["a", "b"]);
  });
  it("is empty when no facet is seen with another", () => {
    expect(alwaysTogetherIds([facet("a"), facet("b", { a: co("0") })]).size).toBe(0);
  });
});

describe("scalePosition", () => {
  // Linear, from 0 % to 100 % (the data analysts, 2026-10-29).
  it("is the share itself, from 0 to 1", () => {
    expect(scalePosition(0)).toBe(0);
    expect(scalePosition(25)).toBe(0.25);
    expect(scalePosition(100)).toBe(1);
  });
  it("stays between 0 and 1", () => {
    expect(scalePosition(-3)).toBe(0);
    expect(scalePosition(120)).toBe(1);
  });
  it("isFull is true only at 100 %", () => {
    expect(isFull(100)).toBe(true);
    expect(isFull(99.99)).toBe(false);
  });
});

describe("coOccurrenceColour", () => {
  const stops = ["#000000", "#ff0000", "#ffffff"];
  it("gives the first stop at 0 % and the last at 100 %", () => {
    expect(coOccurrenceColour(0, stops)).toBe("#000000");
    expect(coOccurrenceColour(100, stops)).toBe("#ffffff");
  });
  it("gives a stop exactly at its position", () => {
    expect(coOccurrenceColour(50, stops)).toBe("#ff0000");
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
  // Five labels whatever the number of stops: one per stop could not be
  // read with 100 stops (maintainers, 2026-10-29).
  it("has five labels from 0 % to 100 %", () => {
    expect(LEGEND_TICKS.map((t) => t.label)).toEqual(["0 %", "25 %", "50 %", "75 %", "100 %"]);
    expect(LEGEND_TICKS.map((t) => t.at)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  it("formatPercent adds the unit to the backend's text, with the app's decimal mark", () => {
    expect(formatPercent("1.2e-20")).toBe("1.2e-20 %");
    expect(formatPercent("76.2", ",")).toBe("76,2 %");
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
    expect(() => coOccurrenceColour(5, ["#000000"])).toThrow(
      "coOccurrenceColour needs at least two stops",
    );
  });
  it("scalePosition of NaN is 0", () => {
    expect(scalePosition(NaN)).toBe(0);
  });
});

describe("facets without data", () => {
  const noData = (id: string): Facet => ({ ...facet(id), coOccurrence: null });

  it("connectedFacets counts a facet without data when another facet names it", () => {
    const a = facet("a", { b: co("5") });
    expect(connectedFacets([a, noData("b"), noData("c")]).map((f) => f.id)).toEqual(["a", "b"]);
  });
});

describe("roundPercentText", () => {
  it.each([
    ["76.19047619047619", "76.2"],
    ["0.000123456", "0.000123"],
    ["100", "100"],
    ["5", "5"],
    ["1.23456e-20", "1.23e-20"],
    ["1.2345E-7", "1.23E-7"],
    ["0.0001", "0.0001"],
    ["100.04", "100"],
    ["100.5", "101"],
    ["1e-400", "1e-400"],
    ["99.96", "100"],
    ["9.996e-5", "1e-4"],
    ["99.96e-5", "10e-4"],
    ["12.30000", "12.3"],
    ["1.20", "1.20"],
    ["0.9996", "1"],
    ["0.0999999", "0.1"],
    ["50.5", "50.5"],
    ["0", "0"],
    ["0.0000", "0.0000"],
    ["12345.6", "12346"],
    ["abc", "abc"],
  ])("%s becomes %s", (text, expected) => {
    expect(roundPercentText(text)).toBe(expected);
  });

  it("takes the number of significant digits as an argument", () => {
    // Digits before the point are never dropped, even with 1 digit asked for.
    expect(roundPercentText("76.19047619047619", 1)).toBe("76");
    expect(roundPercentText("0.76190476", 1)).toBe("0.8");
    expect(roundPercentText("76.19047619047619", 5)).toBe("76.19");
  });
});

describe("squarify with pinned values", () => {
  it("lays the last value out last, in the bottom-right corner, even when it is the largest", () => {
    const rects = squarify([5, 3, 2, 400], 100, 60, { last: true });
    const last = rects[3]!;
    expect(last.x + last.w).toBeCloseTo(100);
    expect(last.y + last.h).toBeCloseTo(60);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBeCloseTo(100 * 60);
  });

  it("does the same as plain squarify when the last value is the smallest", () => {
    expect(squarify([5, 3, 2], 100, 60, { last: true })).toEqual(squarify([5, 3, 2], 100, 60));
  });

  it("lays the first value out first, top-left, even when it is the smallest", () => {
    const rects = squarify([1, 30, 20, 10, 5], 100, 60, { first: true, last: true });
    expect(rects[0]).toMatchObject({ x: 0, y: 0 });
    const last = rects[4]!;
    expect(last.x + last.w).toBeCloseTo(100);
    expect(last.y + last.h).toBeCloseTo(60);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBeCloseTo(100 * 60);
  });
});
