import { describe, it, expect } from "vitest";
import {
  buildStatsLine,
  eventMatches,
  filterByDatabases,
  MAX_TEXT_LENGTH,
  perDatabaseCounts,
  queryErrors,
  scaleCount,
  utcSpan,
} from "../evaluate";
import type {
  RequestFacet,
  RequestFieldCondition,
  RequestGroup,
  RequestNode,
  RequestValue,
} from "../../src/api/types";
import { MALFORMED, WELL_FORMED } from "../../tests/dateCases";
import { EVENTS, toMockEvent, type MockEvent } from "../rows";
import { ENTRYSETS, type Occurrence } from "../vehicleData";
import { toQueryRequest } from "../../src/api/request";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";

// ---- building queries and events --------------------------------------------

const cond = (fieldId: string, operatorId: string, value: RequestValue, id = "c") => ({
  kind: "condition" as const,
  id,
  field_id: fieldId,
  operator_id: operatorId,
  value,
});
/** A block on the facet "thing" with `conditions`, ALL of them by default. */
const block = (
  conditions: RequestFieldCondition[],
  over: Partial<RequestFacet> = {},
): RequestFacet => ({
  kind: "facet",
  id: "f",
  facet_id: "thing",
  negated: false,
  operator: "AND",
  conditions,
  ...over,
});
const group = (operator: "AND" | "OR", ...children: RequestNode[]): RequestGroup => ({
  kind: "group",
  id: "g",
  operator,
  children,
});
/** An event whose facet "thing" occurs once, with these values. */
const eventWith = (occurrence: Occurrence): MockEvent => ({
  id: 1,
  db: "a",
  occurrences: { thing: [occurrence] },
});

const thing: Occurrence = {
  color: "red",
  count: 12,
  size: 200,
  active: true,
  madeOn: "2018-05-01",
  note: "all good",
};
/** Whether one condition on the field matches the sample `thing`. */
const holds = (fieldId: string, operatorId: string, value: RequestValue, o: Occurrence = thing) =>
  eventMatches(block([cond(fieldId, operatorId, value)]), eventWith(o));

describe("a field condition's operators (the mock's reading)", () => {
  it("an empty group matches everything", () => {
    expect(eventMatches(group("AND"), eventWith(thing))).toBe(true);
  });
  it("eq / neq on strings and numbers", () => {
    expect(holds("color", "eq", "red")).toBe(true);
    expect(holds("color", "neq", "red")).toBe(false);
    expect(holds("count", "eq", 12)).toBe(true);
  });
  it("numeric comparisons", () => {
    expect(holds("count", "gte", 12)).toBe(true);
    expect(holds("count", "gt", 12)).toBe(false);
    expect(holds("size", "lt", 300)).toBe(true);
  });
  it("between is inclusive", () => {
    expect(holds("count", "between", [10, 12])).toBe(true);
    expect(holds("count", "between", [0, 11])).toBe(false);
  });
  it("in", () => {
    expect(holds("color", "in", ["red", "blue"])).toBe(true);
    expect(holds("color", "in", ["blue"])).toBe(false);
  });
  it("not_in matches a value that is none of the list", () => {
    expect(holds("count", "not_in", [1, 2])).toBe(true);
    expect(holds("count", "not_in", [12, 13])).toBe(false);
  });
  it("contains on text", () => {
    expect(holds("note", "contains", "good")).toBe(true);
  });
  it("date before / after", () => {
    expect(holds("madeOn", "before", "2019-01-01")).toBe(true);
    expect(holds("madeOn", "after", "2019-01-01")).toBe(false);
  });
  it("absent / present: a field the occurrence doesn't hold is blank", () => {
    expect(holds("spare", "absent", null)).toBe(true);
    expect(holds("spare", "present", null)).toBe(false);
    expect(holds("color", "present", null)).toBe(true);
    expect(holds("color", "absent", null)).toBe(false);
  });
  it("AND / OR groups of blocks", () => {
    const red = block([cond("color", "eq", "red")], { id: "a" });
    const blue = block([cond("color", "eq", "blue")], { id: "b" });
    expect(eventMatches(group("AND", red, blue), eventWith(thing))).toBe(false);
    expect(eventMatches(group("OR", red, blue), eventWith(thing))).toBe(true);
  });
  it("reads the value stored under the field id, in the block's own facet", () => {
    expect(
      eventMatches(block([cond("color", "eq", "red")], { facet_id: "other" }), eventWith(thing)),
    ).toBe(false);
  });
  it("typed values match typed stored values, not their text", () => {
    expect(holds("active", "eq", true)).toBe(true);
    expect(holds("count", "in", [12, 13])).toBe(true);
    expect(holds("count", "eq", "12")).toBe(false);
  });
  it("an unknown operator matches nothing", () => {
    expect(holds("color", "nope", "red")).toBe(false);
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
  const seen = { seenAt: "2024-11-06T14:32:00Z" };
  const is = (operatorId: string, value: RequestValue) => holds("seenAt", operatorId, value, seen);

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
    const late = { seenAt: "2024-11-06T23:30:00-02:00" }; // 2024-11-07 01:30 UTC
    expect(holds("seenAt", "eq", "2024-11-07", late)).toBe(true);
  });

  it('a plain "YYYY-MM-DD" stored value is midnight UTC', () => {
    const day = { madeOn: "2024-11-06" };
    expect(holds("madeOn", "eq", "2024-11-06T00", day)).toBe(true);
    expect(holds("madeOn", "before", "2024-11-06", day)).toBe(false);
  });
});

// ---- database scoping and counts ------------------------------------------

const event = (db: string, id: number, count: number): MockEvent => ({
  id,
  db,
  occurrences: { thing: [{ count }] },
});
const rows: MockEvent[] = [
  event("alpha", 1, 5),
  event("beta", 2, 20),
  event("alpha", 3, 30),
  event("gamma", 4, 1),
];

const matchAll: RequestNode = group("AND");
const countGte10: RequestNode = group("AND", block([cond("count", "gte", 10)]));

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
  const noValid = (kind: string, nodeId: string) => ({
    node_id: nodeId,
    kind: "incomplete",
    message: `${kind} contains no valid conditions.`,
  });
  /** A block with one set field: too long (`bad`) or fine (`good`). */
  const bad = (id: string): RequestFacet => ({
    ...block([cond("note", "eq", tooLong, `${id}-c`)]),
    id,
  });
  const good = (id: string): RequestFacet => ({
    ...block([cond("note", "eq", "fine", `${id}-c`)]),
    id,
  });
  const named = (id: string, g: RequestGroup): RequestGroup => ({ ...g, id });

  it("points at each set field with a too-long text, inside groups too", () => {
    const query = group(
      "AND",
      block([cond("note", "eq", tooLong, "c1"), cond("note", "eq", "fine", "c2")]),
      named(
        "g2",
        group(
          "OR",
          block([cond("note", "in", ["ok", tooLong], "c3"), cond("note", "eq", "", "c4")], {
            id: "f2",
          }),
        ),
      ),
    );
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c3")]);
  });

  it("reports a block whose every set field has an error, as incomplete", () => {
    const query = block([cond("note", "eq", tooLong, "c1"), cond("note", "eq", tooLong, "c2")]);
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c2"), noValid("Facet", "f")]);
  });

  it("does not report a block with one good field, or with none set", () => {
    const mixed = block([cond("note", "eq", tooLong, "c1"), cond("note", "eq", "fine", "c2")]);
    expect(queryErrors(mixed)).toEqual([problem("c1")]);
    expect(queryErrors(block([]))).toEqual([]);
  });

  it("reports a group whose every child has an error, as incomplete", () => {
    const query = named("g1", group("AND", bad("f1"), bad("f2")));
    expect(queryErrors(query)).toEqual([
      problem("f1-c"),
      noValid("Facet", "f1"),
      problem("f2-c"),
      noValid("Facet", "f2"),
      noValid("Group", "g1"),
    ]);
  });

  it("does not report a group with one good child", () => {
    const query = named("g1", group("OR", bad("f1"), good("f2")));
    expect(queryErrors(query)).toEqual([problem("f1-c"), noValid("Facet", "f1")]);
  });

  it("reports an all-bad inner group but not a root that has another good child", () => {
    const inner = named("inner", group("AND", bad("f1")));
    const query = named("root", group("AND", inner, good("f3")));
    expect(queryErrors(query)).toEqual([
      problem("f1-c"),
      noValid("Facet", "f1"),
      noValid("Group", "inner"),
    ]);
  });

  it("reports the root too when its only child is an all-bad group", () => {
    const inner = named("inner", group("AND", bad("f1")));
    const query = named("root", group("AND", inner));
    expect(queryErrors(query)).toEqual([
      problem("f1-c"),
      noValid("Facet", "f1"),
      noValid("Group", "inner"),
      noValid("Group", "root"),
    ]);
  });

  it("does not report an empty group (the frontend's own validation does)", () => {
    expect(queryErrors(named("g1", group("AND")))).toEqual([]);
  });

  it("accepts text up to the limit, and values that aren't text", () => {
    const query = group(
      "AND",
      block([
        cond("note", "eq", "x".repeat(MAX_TEXT_LENGTH)),
        cond("count", "gt", 5),
        cond("spare", "absent", null),
      ]),
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

  it("matches a query built with the facet-block model and sent by toQueryRequest", () => {
    // The seam between the frontend's new model and the mock: no hand-written wire JSON.
    const block = (value: unknown) => ({
      ...newBlock("gps_position"),
      conditions: [newFieldCondition("latitude", "eq", value as number)],
    });
    const q = (value: unknown) => groupOf([block(value)]);
    expect(eventMatches(toQueryRequest(q(first!["latitude"]), ["x"]).query, two)).toBe(true);
    expect(eventMatches(toQueryRequest(q("no such latitude"), ["x"]).query, two)).toBe(false);
    expect(eventMatches(toQueryRequest(emptyQuery(), ["x"]).query, two)).toBe(true);
  });

  it("knows every event", () => {
    expect(EVENTS).toHaveLength(Object.keys(ENTRYSETS).length);
  });
});
