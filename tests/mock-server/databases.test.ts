import { describe, it, expect } from "vitest";
import { filterByDatabases } from "../../mock-server/evaluate";

type Row = Record<string, string | number | boolean | null>;

const rows: Row[] = [
  { species: "oak", id: 1 },
  { species: "fern", id: 2 },
  { species: "oak", id: 3 },
  { species: "rose", id: 4 },
];

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
