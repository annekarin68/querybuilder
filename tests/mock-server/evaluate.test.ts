import { describe, it, expect } from "vitest";
import {
  buildStatsLine,
  filterByDatabases,
  matches,
  perDatabaseCounts,
  rowKey,
  scaleCount,
  utcSpan,
  type Row,
} from "../../mock-server/evaluate";
import type { RequestNode, RequestValue } from "../../src/api/types";
import { MALFORMED, WELL_FORMED } from "../dateCases";

const row = {
  "thing.color": "red",
  "thing.count": 12,
  "thing.size": 200,
  "thing.active": true,
  "thing.spare": null,
  "thing.madeOn": "2018-05-01",
  "thing.note": "all good",
};

const cond = (fieldId: string, operatorId: string, value: RequestValue) => ({
  kind: "condition" as const,
  id: "c",
  facetId: "thing",
  fieldId,
  operatorId,
  value,
});
const group = (operator: "AND" | "OR", ...children: RequestNode[]) => ({
  kind: "group" as const,
  id: "g",
  operator,
  children,
});

describe("matches", () => {
  it("empty group matches everything", () => {
    expect(matches(group("AND"), row)).toBe(true);
  });
  it("eq / neq on strings and numbers", () => {
    expect(matches(cond("color", "eq", "red"), row)).toBe(true);
    expect(matches(cond("color", "neq", "red"), row)).toBe(false);
    expect(matches(cond("count", "eq", 12), row)).toBe(true);
  });
  it("numeric comparisons", () => {
    expect(matches(cond("count", "gte", 12), row)).toBe(true);
    expect(matches(cond("count", "gt", 12), row)).toBe(false);
    expect(matches(cond("size", "lt", 300), row)).toBe(true);
  });
  it("between is inclusive", () => {
    expect(matches(cond("count", "between", [10, 12]), row)).toBe(true);
    expect(matches(cond("count", "between", [0, 11]), row)).toBe(false);
  });
  it("in", () => {
    expect(matches(cond("color", "in", ["red", "blue"]), row)).toBe(true);
    expect(matches(cond("color", "in", ["blue"]), row)).toBe(false);
  });
  it("contains on text", () => {
    expect(matches(cond("note", "contains", "good"), row)).toBe(true);
  });
  it("date before / after", () => {
    expect(matches(cond("madeOn", "before", "2019-01-01"), row)).toBe(true);
    expect(matches(cond("madeOn", "after", "2019-01-01"), row)).toBe(false);
  });
  it("isEmpty / isNotEmpty", () => {
    expect(matches(cond("spare", "isEmpty", null), row)).toBe(true);
    expect(matches(cond("color", "isNotEmpty", null), row)).toBe(true);
  });
  it("AND / OR groups", () => {
    expect(matches(group("AND", cond("color", "eq", "red"), cond("count", "gte", 12)), row)).toBe(
      true,
    );
    expect(matches(group("AND", cond("color", "eq", "red"), cond("count", "gt", 12)), row)).toBe(
      false,
    );
    expect(matches(group("OR", cond("color", "eq", "blue"), cond("count", "gte", 12)), row)).toBe(
      true,
    );
  });
  it("reads the value stored under rowKey(facetId, fieldId)", () => {
    expect(rowKey("thing", "color")).toBe("thing.color");
    expect(matches({ ...cond("color", "eq", "red"), facetId: "other" }, row)).toBe(false);
  });

  it("typed values match typed stored values, not their text", () => {
    expect(matches(cond("active", "eq", true), row)).toBe(true);
    expect(matches(cond("count", "in", [12, 13]), row)).toBe(true);
    expect(matches(cond("count", "eq", "12"), row)).toBe(false);
  });
});

describe("utcSpan: the time a (partial) UTC timestamp covers", () => {
  const span = (v: string) => utcSpan(v)?.map((t) => new Date(t).toISOString());

  it.each([
    ["2024", "2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
    ["2024-12", "2024-12-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
    ["2024-02-28", "2024-02-28T00:00:00.000Z", "2024-02-29T00:00:00.000Z"],
    ["2024-11-06T23Z", "2024-11-06T23:00:00.000Z", "2024-11-07T00:00:00.000Z"],
    ["2024-11-06T14:32", "2024-11-06T14:32:00.000Z", "2024-11-06T14:33:00.000Z"],
    ["2024-11-06T14:32:05Z", "2024-11-06T14:32:05.000Z", "2024-11-06T14:32:06.000Z"],
    ["2024-11-06T14:32:05.1Z", "2024-11-06T14:32:05.100Z", "2024-11-06T14:32:05.200Z"],
    ["2024-11-06T14:32:05.123Z", "2024-11-06T14:32:05.123Z", "2024-11-06T14:32:05.124Z"],
  ])("%s → [%s, %s)", (v, start, end) => {
    expect(span(v)).toEqual([start, end]);
  });

  it("is null for anything else", () => {
    expect(utcSpan("red")).toBeNull();
    expect(utcSpan(2024)).toBeNull();
  });

  it.each(WELL_FORMED)("reads %s, like the frontend", (v) => {
    expect(utcSpan(v)).not.toBeNull();
  });

  it.each(MALFORMED)("rejects %j, like the frontend", (v) => {
    expect(utcSpan(v)).toBeNull();
  });
});

describe("date conditions: the user's operator at the precision they typed (UTC)", () => {
  const seen = { "thing.seenAt": "2024-11-06T14:32:00Z" };
  const is = (operatorId: string, value: RequestValue) =>
    matches(cond("seenAt", operatorId, value), seen);

  it("eq / neq: the stored time falls inside / outside the span", () => {
    expect(is("eq", "2024")).toBe(true);
    expect(is("eq", "2024-11-06")).toBe(true);
    expect(is("eq", "2024-11-06T14")).toBe(true);
    expect(is("eq", "2024-11-06T14:32Z")).toBe(true);
    expect(is("eq", "2024-11-06T14:33Z")).toBe(false);
    expect(is("eq", "2024-11-07")).toBe(false);
    expect(is("neq", "2024-11-06")).toBe(false);
    expect(is("neq", "2024-11-07")).toBe(true);
  });

  it("before / after exclude the whole span", () => {
    expect(is("after", "2024-11-06")).toBe(false);
    expect(is("before", "2024-11-06")).toBe(false);
    expect(is("after", "2024-11-06T13")).toBe(true);
    expect(is("before", "2024-11-06T15")).toBe(true);
    expect(is("before", "2024-11-07")).toBe(true);
  });

  it("between includes both end spans", () => {
    expect(is("between", ["2024-11-06", "2024-11-06"])).toBe(true);
    expect(is("between", ["2024-11", "2024-11-06T14"])).toBe(true);
    expect(is("between", ["2024-11-06T15", "2024-12"])).toBe(false);
  });

  it("uses UTC, whatever offset the stored value is written in", () => {
    const late = { "thing.seenAt": "2024-11-06T23:30:00-02:00" }; // 2024-11-07 01:30 UTC
    expect(matches(cond("seenAt", "eq", "2024-11-07"), late)).toBe(true);
  });

  it('a plain "YYYY-MM-DD" stored value is midnight UTC', () => {
    const day = { "thing.madeOn": "2024-11-06" };
    expect(matches(cond("madeOn", "eq", "2024-11-06T00"), day)).toBe(true);
    expect(matches(cond("madeOn", "before", "2024-11-06"), day)).toBe(false);
  });
});

// ---- database scoping and counts ------------------------------------------

const rows: Row[] = [
  { __db: "alpha", id: 1, "thing.count": 5 },
  { __db: "beta", id: 2, "thing.count": 20 },
  { __db: "alpha", id: 3, "thing.count": 30 },
  { __db: "gamma", id: 4, "thing.count": 1 },
];

const matchAll: RequestNode = { kind: "group", id: "g", operator: "AND", children: [] };
const countGte10: RequestNode = {
  kind: "group",
  id: "g",
  operator: "AND",
  children: [
    {
      kind: "condition",
      id: "c",
      facetId: "thing",
      fieldId: "count",
      operatorId: "gte",
      value: 10,
    },
  ],
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
    expect(perDatabaseCounts(countGte10, rows, ["alpha", "beta", "gamma"])).toEqual([
      { label: "alpha", matchCount: 1, totalCount: 2 }, // only count:30
      { label: "beta", matchCount: 1, totalCount: 1 }, // count:20
      { label: "gamma", matchCount: 0, totalCount: 1 }, // count:1
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

// ---- /api/stats lines ---------------------------------------------------------

describe("buildStatsLine", () => {
  it("builds a successful line with matchCount", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3 })).toEqual({
      label: "alpha",
      success: true,
      matchCount: 3,
    });
  });

  it("builds a failure line when fail is given, omitting matchCount entirely", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999, // must be ignored/dropped
      fail: { errorMessages: ["bad field"], infoMessages: [] },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      errorMessages: ["bad field"],
      infoMessages: [],
    });
    expect(line).not.toHaveProperty("matchCount");
  });
});
