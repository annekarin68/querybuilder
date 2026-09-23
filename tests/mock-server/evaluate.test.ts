import { describe, it, expect } from "vitest";
import { matches, utcSpan, type JsonNode } from "../../mock-server/evaluate";
import { MALFORMED, WELL_FORMED } from "../dateCases";

const row = {
  species: "oak",
  branches: 12,
  heightCm: 200,
  foliage: true,
  flowering: null,
  plantedOn: "2018-05-01",
  notes: "healthy",
};

const cond = (fieldId: string, operatorId: string, value: unknown) => ({
  kind: "condition" as const,
  fieldId,
  operatorId,
  value,
});
const group = (operator: "AND" | "OR", ...children: JsonNode[]) => ({
  kind: "group" as const,
  operator,
  children,
});

describe("matches", () => {
  it("empty group matches everything", () => {
    expect(matches(group("AND"), row)).toBe(true);
  });
  it("eq / neq on strings and numbers", () => {
    expect(matches(cond("species", "eq", "oak"), row)).toBe(true);
    expect(matches(cond("species", "neq", "oak"), row)).toBe(false);
    expect(matches(cond("branches", "eq", 12), row)).toBe(true);
  });
  it("numeric comparisons", () => {
    expect(matches(cond("branches", "gte", 12), row)).toBe(true);
    expect(matches(cond("branches", "gt", 12), row)).toBe(false);
    expect(matches(cond("heightCm", "lt", 300), row)).toBe(true);
  });
  it("between is inclusive", () => {
    expect(matches(cond("branches", "between", [10, 12]), row)).toBe(true);
    expect(matches(cond("branches", "between", [0, 11]), row)).toBe(false);
  });
  it("in", () => {
    expect(matches(cond("species", "in", ["oak", "fern"]), row)).toBe(true);
    expect(matches(cond("species", "in", ["fern"]), row)).toBe(false);
  });
  it("contains on text", () => {
    expect(matches(cond("notes", "contains", "health"), row)).toBe(true);
  });
  it("date before / after", () => {
    expect(matches(cond("plantedOn", "before", "2019-01-01"), row)).toBe(true);
    expect(matches(cond("plantedOn", "after", "2019-01-01"), row)).toBe(false);
  });
  it("isEmpty / isNotEmpty", () => {
    expect(matches(cond("flowering", "isEmpty", null), row)).toBe(true);
    expect(matches(cond("species", "isNotEmpty", null), row)).toBe(true);
  });
  it("AND / OR groups", () => {
    expect(
      matches(group("AND", cond("species", "eq", "oak"), cond("branches", "gte", 12)), row),
    ).toBe(true);
    expect(
      matches(group("AND", cond("species", "eq", "oak"), cond("branches", "gt", 12)), row),
    ).toBe(false);
    expect(
      matches(group("OR", cond("species", "eq", "fern"), cond("branches", "gte", 12)), row),
    ).toBe(true);
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
    expect(utcSpan("oak")).toBeNull();
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
  const is = (operatorId: string, value: unknown) =>
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
    const late = { seenAt: "2024-11-06T23:30:00-02:00" }; // 2024-11-07 01:30 UTC
    expect(matches(cond("seenAt", "eq", "2024-11-07"), late)).toBe(true);
  });

  it('a plain "YYYY-MM-DD" stored value is midnight UTC', () => {
    const day = { plantedOn: "2024-11-06" };
    expect(matches(cond("plantedOn", "eq", "2024-11-06T00"), day)).toBe(true);
    expect(matches(cond("plantedOn", "before", "2024-11-06"), day)).toBe(false);
  });
});
