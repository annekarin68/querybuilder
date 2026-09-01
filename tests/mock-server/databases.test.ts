import { describe, it, expect } from "vitest";
import { filterByDatabases, perDatabaseCounts, type JsonNode } from "../../mock-server/evaluate";

type Row = Record<string, string | number | boolean | null>;

const rows: Row[] = [
  { species: "oak", id: 1, branches: 5 },
  { species: "fern", id: 2, branches: 20 },
  { species: "oak", id: 3, branches: 30 },
  { species: "rose", id: 4, branches: 1 },
];

const matchAll: JsonNode = { kind: "group", operator: "AND", children: [] };
const branchesGte10: JsonNode = {
  kind: "group",
  operator: "AND",
  children: [{ kind: "condition", fieldId: "branches", operatorId: "gte", value: 10 }],
};

describe("filterByDatabases", () => {
  it("keeps only rows whose species is a selected database id", () => {
    expect(filterByDatabases(rows, ["oak"]).map((r) => r.id)).toEqual([1, 3]);
    expect(filterByDatabases(rows, ["fern", "rose"]).map((r) => r.id)).toEqual([2, 4]);
  });

  it("an empty id list keeps nothing", () => {
    expect(filterByDatabases(rows, [])).toEqual([]);
  });

  it("unknown ids are simply absent", () => {
    expect(filterByDatabases(rows, ["cactus", "oak"]).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("perDatabaseCounts", () => {
  it("returns match/total per database in the given id order", () => {
    expect(perDatabaseCounts(matchAll, rows, ["fern", "oak"])).toEqual([
      { id: "fern", matchCount: 1, totalCount: 1 },
      { id: "oak", matchCount: 2, totalCount: 2 },
    ]);
  });

  it("matchCount reflects the query; totalCount is the whole database", () => {
    expect(perDatabaseCounts(branchesGte10, rows, ["oak", "fern", "rose"])).toEqual([
      { id: "oak", matchCount: 1, totalCount: 2 }, // only branches:30
      { id: "fern", matchCount: 1, totalCount: 1 }, // branches:20
      { id: "rose", matchCount: 0, totalCount: 1 }, // branches:1
    ]);
  });

  it("an unknown database id yields zero counts", () => {
    expect(perDatabaseCounts(matchAll, rows, ["cactus"])).toEqual([
      { id: "cactus", matchCount: 0, totalCount: 0 },
    ]);
  });
});
