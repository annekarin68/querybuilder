import { describe, it, expect } from "vitest";
import {
  DATABASES,
  dbIndexForEntrysetId,
  databaseIdForEntrysetId,
} from "../../mock-server/databases";

describe("DATABASES", () => {
  it("has exactly 7 entries named ALPHA..ETA", () => {
    expect(DATABASES.map((d) => d.name)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
      "DELTA",
      "EPSILON",
      "ZETA",
      "ETA",
    ]);
    expect(DATABASES.map((d) => d.label)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ]);
  });

  it("every database has a positive totalEntrysets, spanning several orders of magnitude", () => {
    for (const d of DATABASES) expect(d.totalEntrysets).toBeGreaterThan(0);
    const sizes = DATABASES.map((d) => d.totalEntrysets);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1000);
  });

  it("percentageOfTotal is each database's share of totalEntrysets, summing to ~100", () => {
    const sum = DATABASES.reduce((s, d) => s + d.percentageOfTotal, 0);
    expect(sum).toBeCloseTo(100, 0);
    for (const d of DATABASES) {
      expect(d.percentageOfTotal).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.owner.length).toBeGreaterThan(0);
    }
  });
});

describe("dbIndexForEntrysetId", () => {
  it("is deterministic and within range", () => {
    for (const id of [1, 2, 3, 100, 999]) {
      const idx = dbIndexForEntrysetId(id);
      expect(idx).toBe(dbIndexForEntrysetId(id));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });

  it("matches the precomputed table for entryset ids 1-21", () => {
    const expected: Record<number, number> = {
      1: 6,
      2: 6,
      3: 0,
      4: 5,
      5: 6,
      6: 0,
      7: 5,
      8: 1,
      9: 0,
      10: 5,
      11: 1,
      12: 4,
      13: 5,
      14: 1,
      15: 4,
      16: 2,
      17: 1,
      18: 4,
      19: 2,
      20: 3,
      21: 3,
    };
    for (const [id, idx] of Object.entries(expected)) {
      expect(dbIndexForEntrysetId(Number(id))).toBe(idx);
    }
  });
});

describe("databaseIdForEntrysetId", () => {
  it("returns the DATABASES id at dbIndexForEntrysetId's index", () => {
    expect(databaseIdForEntrysetId(3)).toBe("alpha"); // index 0
    expect(databaseIdForEntrysetId(1)).toBe("eta"); // index 6
  });
});
