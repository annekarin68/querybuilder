import { describe, it, expect } from "vitest";
import {
  betterOn,
  contrastRatio,
  mixOklab,
  parseHex,
  relativeLuminance,
  toHex,
} from "../../src/util/colour";

describe("hex conversion", () => {
  it("round-trips", () => {
    expect(parseHex("#1a2b3c")).toEqual([26, 43, 60]);
    expect(toHex([26, 43, 60])).toBe("#1a2b3c");
  });
});

describe("mixOklab", () => {
  it("gives the same colour when both ends are equal", () => {
    expect(mixOklab("#3a7bd5", "#3a7bd5", 0.37)).toBe("#3a7bd5");
  });
  it("gives the ends at t = 0 and t = 1", () => {
    expect(mixOklab("#102030", "#e0d0c0", 0)).toBe("#102030");
    expect(mixOklab("#102030", "#e0d0c0", 1)).toBe("#e0d0c0");
  });
  it("mixes black and white into a grey", () => {
    const [r, g, b] = parseHex(mixOklab("#000000", "#ffffff", 0.5));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(80);
    expect(r).toBeLessThan(160);
  });
});

describe("contrast", () => {
  it("black on white is 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("betterOn picks the colour that contrasts more", () => {
    expect(betterOn("#ffffff", "#000000", "#eeeeee")).toBe("#000000");
    expect(betterOn("#101010", "#000000", "#eeeeee")).toBe("#eeeeee");
  });
});
