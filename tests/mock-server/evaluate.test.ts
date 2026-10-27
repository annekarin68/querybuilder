import { describe, it, expect } from "vitest";
import {
  buildStatsLine,
  filterByDatabases,
  matches,
  MAX_TEXT_LENGTH,
  perDatabaseCounts,
  queryErrors,
  rowKey,
  scaleCount,
  utcSpan,
  type MockNode,
  type Row,
} from "../../mock-server/evaluate";
import type { RequestNode } from "../../src/api/legacy/types";
import type { RequestValue } from "../../src/api/types";
import { MALFORMED, WELL_FORMED } from "../dateCases";
import { EVENTS, toMockEvent, type MockEvent } from "../../mock-server/rows";
import { ENTRYSETS } from "../../mock-server/vehicleData";
import { eventMatches } from "../../mock-server/evaluate";
import type { RequestFacet, RequestFieldCondition } from "../../src/api/types";

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
  facet_id: "thing",
  field_id: fieldId,
  operator_id: operatorId,
  value,
});
const facetCond = (facetId: string, operatorId: string) => ({
  kind: "condition" as const,
  id: "x",
  facet_id: facetId,
  field_id: null,
  operator_id: operatorId,
  value: null,
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
  it("not_in matches a value that is none of the list", () => {
    expect(matches(cond("count", "not_in", [1, 2]), row)).toBe(true);
    expect(matches(cond("count", "not_in", [12, 13]), row)).toBe(false);
  });
  it("contains on text", () => {
    expect(matches(cond("note", "contains", "good"), row)).toBe(true);
  });
  it("date before / after", () => {
    expect(matches(cond("madeOn", "before", "2019-01-01"), row)).toBe(true);
    expect(matches(cond("madeOn", "after", "2019-01-01"), row)).toBe(false);
  });
  it("absent / present", () => {
    expect(matches(cond("spare", "absent", null), row)).toBe(true);
    expect(matches(cond("color", "present", null), row)).toBe(true);
  });
  it("facet-level present / absent look at whether the event holds any value for the facet", () => {
    const r: Row = { id: 1, __db: "a", [rowKey("engine", "rpm")]: 3000 };
    expect(matches(facetCond("engine", "present"), r)).toBe(true);
    expect(matches(facetCond("engine", "absent"), r)).toBe(false);
    expect(matches(facetCond("brakes", "present"), r)).toBe(false);
    expect(matches(facetCond("brakes", "absent"), r)).toBe(true);
  });
  it("a key holding null does not count as a value for the facet", () => {
    const r: Row = { id: 1, __db: "a", [rowKey("engine", "rpm")]: null };
    expect(matches(facetCond("engine", "present"), r)).toBe(false);
    expect(matches(facetCond("engine", "absent"), r)).toBe(true);
  });
  it("a facet whose name starts with another facet's name is not confused with it", () => {
    const r: Row = { id: 1, __db: "a", [rowKey("engine_oil", "level")]: 1 };
    expect(matches(facetCond("engine", "present"), r)).toBe(false);
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
    expect(matches({ ...cond("color", "eq", "red"), facet_id: "other" }, row)).toBe(false);
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

const event = (db: string, id: number, count: number): MockEvent => ({
  id,
  db,
  row: { __db: db, id, "thing.count": count },
  occurrences: { thing: [{ count }] },
});
const rows: MockEvent[] = [
  event("alpha", 1, 5),
  event("beta", 2, 20),
  event("alpha", 3, 30),
  event("gamma", 4, 1),
];

const matchAll: MockNode = { kind: "group", id: "g", operator: "AND", children: [] };
const countGte10: MockNode = {
  kind: "group",
  id: "g",
  operator: "AND",
  children: [
    {
      kind: "condition",
      id: "c",
      facet_id: "thing",
      field_id: "count",
      operator_id: "gte",
      value: 10,
    },
  ],
};

describe("filterByDatabases", () => {
  it("keeps only events whose db is a selected database id", () => {
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

// ---- /api/filter/validate lines ---------------------------------------------------------

describe("buildStatsLine", () => {
  it("builds a successful line with match_count", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3 })).toEqual({
      label: "alpha",
      success: true,
      match_count: 3,
    });
  });

  it("builds a failure line when fail is given, omitting match_count entirely", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999, // must be ignored/dropped
      fail: {
        errorMessages: [{ node_id: "c", message: "bad field", kind: "invalid" }],
        infoMessages: [],
      },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      error_messages: [{ node_id: "c", message: "bad field", kind: "invalid" }],
      info_messages: [],
    });
    expect(line).not.toHaveProperty("match_count");
  });
});

describe("queryErrors", () => {
  const tooLong = "x".repeat(MAX_TEXT_LENGTH + 1);
  const problem = (nodeId: string) => ({
    node_id: nodeId,
    kind: "invalid",
    message: "Text is too long (at most 100 characters).",
  });

  it("points at each condition with a too-long text, inside groups too", () => {
    const query = group(
      "AND",
      { ...cond("note", "eq", tooLong), id: "c1" },
      cond("note", "eq", "fine"),
      {
        ...group(
          "OR",
          { ...cond("note", "in", ["ok", tooLong]), id: "c2" },
          cond("note", "eq", ""),
        ),
        id: "g2",
      },
    );
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c2")]);
  });

  const noValidConditions = (groupId: string) => ({
    node_id: groupId,
    kind: "incomplete",
    message: "Group contains no valid conditions.",
  });
  const bad = (id: string) => ({ ...cond("note", "eq", tooLong), id });
  const good = (id: string) => ({ ...cond("note", "eq", "fine"), id });

  it("reports a group whose every child has an error, as incomplete", () => {
    const query = { ...group("AND", bad("c1"), bad("c2")), id: "g1" };
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c2"), noValidConditions("g1")]);
  });

  it("does not report a group with one good child", () => {
    const query = { ...group("OR", bad("c1"), good("c2")), id: "g1" };
    expect(queryErrors(query)).toEqual([problem("c1")]);
  });

  it("reports an all-bad inner group but not a root that has another good child", () => {
    const inner = { ...group("AND", bad("c1"), bad("c2")), id: "inner" };
    const query = { ...group("AND", inner, good("c3")), id: "root" };
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c2"), noValidConditions("inner")]);
  });

  it("reports the root too when its only child is an all-bad group", () => {
    const inner = { ...group("AND", bad("c1")), id: "inner" };
    const query = { ...group("AND", inner), id: "root" };
    expect(queryErrors(query)).toEqual([
      problem("c1"),
      noValidConditions("inner"),
      noValidConditions("root"),
    ]);
  });

  it("does not report an empty group (the frontend's own validation does)", () => {
    expect(queryErrors({ ...group("AND"), id: "g1" })).toEqual([]);
  });

  it("accepts text up to the limit, and values that aren't text", () => {
    const query = group(
      "AND",
      cond("note", "eq", "x".repeat(MAX_TEXT_LENGTH)),
      cond("count", "gt", 5),
      cond("spare", "isEmpty", null),
    );
    expect(queryErrors(query)).toEqual([]);
  });
});

describe("facet blocks match within one occurrence", () => {
  const two = toMockEvent(ENTRYSETS["2"]!);
  const [first, second] = two.occurrences["gps_position"]!;
  const cond = (field_id: string, value: unknown): RequestFieldCondition => ({
    kind: "condition",
    id: `c-${field_id}`,
    field_id,
    operator_id: "eq",
    value: value as RequestFieldCondition["value"],
  });
  const facet = (over: Partial<RequestFacet>): RequestFacet => ({
    kind: "facet",
    id: "f",
    facet_id: "gps_position",
    negated: false,
    operator: "AND",
    conditions: [],
    ...over,
  });
  // Latitude of the first occurrence with longitude of the second: no single
  // occurrence has both.
  const mixed = [cond("latitude", first!["latitude"]), cond("longitude", second!["longitude"])];

  it("has two occurrences in the sample event", () => {
    expect(two.occurrences["gps_position"]).toHaveLength(2);
  });

  it("ALL needs one occurrence that has every value", () => {
    expect(eventMatches(facet({ conditions: mixed }), two)).toBe(false);
    expect(
      eventMatches(
        facet({
          conditions: [
            cond("latitude", second!["latitude"]),
            cond("longitude", second!["longitude"]),
          ],
        }),
        two,
      ),
    ).toBe(true);
  });

  it("ANY needs one occurrence with one of them; two blocks may use different occurrences", () => {
    expect(eventMatches(facet({ operator: "OR", conditions: mixed }), two)).toBe(true);
    const both = {
      kind: "group" as const,
      id: "g",
      operator: "AND" as const,
      children: [
        facet({ id: "a", conditions: [mixed[0]!] }),
        facet({ id: "b", conditions: [mixed[1]!] }),
      ],
    };
    expect(eventMatches(both, two)).toBe(true);
  });

  it("has no inverts the block; an empty block is presence", () => {
    expect(eventMatches(facet({}), two)).toBe(true);
    expect(eventMatches(facet({ negated: true }), two)).toBe(false);
    expect(eventMatches(facet({ facet_id: "nope" }), two)).toBe(false);
    expect(eventMatches(facet({ facet_id: "nope", negated: true }), two)).toBe(true);
    expect(eventMatches(facet({ negated: true, conditions: mixed }), two)).toBe(true);
  });

  it("knows every event", () => {
    expect(EVENTS).toHaveLength(Object.keys(ENTRYSETS).length);
  });
});
