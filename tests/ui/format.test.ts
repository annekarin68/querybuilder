import { describe, it, expect } from "vitest";
import { barWidth, compact, exact, matchRatio } from "../../src/ui/format";

const L = "en-US"; // pin locale so assertions are deterministic

describe("compact", () => {
  it("groups exactly below 100k", () => {
    expect(compact(0, L)).toBe("0");
    expect(compact(999, L)).toBe("999");
    expect(compact(12345, L)).toBe("12,345");
    expect(compact(28.86, L)).toBe("28.86");
  });
  it("compacts at/above 100k", () => {
    expect(compact(100_000, L)).toBe("100K");
    expect(compact(1_234_567, L)).toBe("1.2M");
    expect(compact(1_234_567_890, L)).toBe("1.2B");
  });
  it("handles non-finite", () => {
    expect(compact(NaN, L)).toBe("—");
  });
});

describe("exact", () => {
  it("full grouping for tooltips", () => {
    expect(exact(1_234_567_890, L)).toBe("1,234,567,890");
  });
});

describe("matchRatio", () => {
  it("none / all", () => {
    expect(matchRatio(0, 100, L)).toBe("none");
    expect(matchRatio(5, 0, L)).toBe("none");
    expect(matchRatio(100, 100, L)).toBe("all");
  });
  it("normal percentages", () => {
    expect(matchRatio(62, 100, L)).toBe("62%");
    expect(matchRatio(6, 100, L)).toBe("6.0%");
    expect(matchRatio(1, 200, L)).toBe("0.5%");
    expect(matchRatio(3, 4000, L)).toBe("0.075%");
  });
  it("tiny fractions become a ratio, not a rounded 0%", () => {
    expect(matchRatio(1, 2_900_000_000, L)).toBe("1 in 2.9B");
    expect(matchRatio(2, 10_000_000, L)).toBe("1 in 5M");
  });
  it("near-100% never rounds up to a misleading 100%", () => {
    expect(matchRatio(999, 1000, L)).toBe("99.9%");
    expect(matchRatio(999_999, 1_000_000, L)).toBe(">99.9%");
  });
});

describe("barWidth", () => {
  it("0 for no matches", () => {
    expect(barWidth(0, 100)).toBe("0");
    expect(barWidth(5, 0)).toBe("0");
  });
  it("a 2px-floored max(), never scientific notation", () => {
    expect(barWidth(50, 100)).toBe("max(50%, 2px)");
    expect(barWidth(1234, 10000)).toBe("max(12.34%, 2px)");
    expect(barWidth(1, 1_000_000_000)).toBe("max(0.01%, 2px)");
  });
});
