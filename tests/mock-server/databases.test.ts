import { describe, it, expect } from "vitest";
import {
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
  type Row,
} from "../../mock-server/evaluate";

const rows: Row[] = [
  { __db: "alpha", id: 1, branches: 5 },
  { __db: "beta", id: 2, branches: 20 },
  { __db: "alpha", id: 3, branches: 30 },
  { __db: "gamma", id: 4, branches: 1 },
];

const matchAll: JsonNode = { kind: "group", operator: "AND", children: [] };
const branchesGte10: JsonNode = {
  kind: "group",
  operator: "AND",
  children: [{ kind: "condition", fieldId: "branches", operatorId: "gte", value: 10 }],
};

describe("filterByDatabases", () => {
  it("keeps only rows whose __db is a selected database id", () => {
    expect(filterByDatabases(rows, ["alpha"]).map((r) => r.id)).toEqual([1, 3]);
    expect(filterByDatabases(rows, ["beta", "gamma"]).map((r) => r.id)).toEqual([2, 4]);
  });

  it("an empty id list keeps nothing", () => {
    expect(filterByDatabases(rows, [])).toEqual([]);
  });

  it("unknown ids are simply absent", () => {
    expect(filterByDatabases(rows, ["zeta", "alpha"]).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("perDatabaseCounts", () => {
  it("returns match/total per database in the given id order", () => {
    expect(perDatabaseCounts(matchAll, rows, ["beta", "alpha"])).toEqual([
      { label: "beta", matchCount: 1, totalCount: 1 },
      { label: "alpha", matchCount: 2, totalCount: 2 },
    ]);
  });

  it("matchCount reflects the query; totalCount is the whole database", () => {
    expect(perDatabaseCounts(branchesGte10, rows, ["alpha", "beta", "gamma"])).toEqual([
      { label: "alpha", matchCount: 1, totalCount: 2 }, // only branches:30
      { label: "beta", matchCount: 1, totalCount: 1 }, // branches:20
      { label: "gamma", matchCount: 0, totalCount: 1 }, // branches:1
    ]);
  });

  it("an unknown database id yields zero counts", () => {
    expect(perDatabaseCounts(matchAll, rows, ["zeta"])).toEqual([
      { label: "zeta", matchCount: 0, totalCount: 0 },
    ]);
  });
});

describe("scaleCount", () => {
  it("projects a sample part/whole onto a target size", () => {
    expect(scaleCount(1, 40, 1_234_000_000)).toBe(30_850_000); // 1/40 of 1.234B
    expect(scaleCount(40, 40, 5_600_000_000)).toBe(5_600_000_000); // all
    expect(scaleCount(0, 40, 1_234_000_000)).toBe(0);
  });
  it("zero whole → zero (unknown/empty database)", () => {
    expect(scaleCount(0, 0, 999)).toBe(0);
  });
});
