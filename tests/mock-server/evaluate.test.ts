import { describe, it, expect } from "vitest";
import { matches, type JsonNode } from "../../mock-server/evaluate";

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

describe("date conditions on timestamp values (calendar days, UTC)", () => {
  const seen = { seenAt: "2024-11-06T14:32:00Z" };

  it("eq / neq compare the timestamp's day", () => {
    expect(matches(cond("seenAt", "eq", "2024-11-06"), seen)).toBe(true);
    expect(matches(cond("seenAt", "eq", "2024-11-07"), seen)).toBe(false);
    expect(matches(cond("seenAt", "neq", "2024-11-06"), seen)).toBe(false);
  });

  it("between includes both end days", () => {
    expect(matches(cond("seenAt", "between", ["2024-11-06", "2024-11-06"]), seen)).toBe(true);
    expect(matches(cond("seenAt", "between", ["2024-11-01", "2024-11-06"]), seen)).toBe(true);
    expect(matches(cond("seenAt", "between", ["2024-11-07", "2024-11-09"]), seen)).toBe(false);
  });

  it("before / after exclude the day itself", () => {
    expect(matches(cond("seenAt", "after", "2024-11-06"), seen)).toBe(false);
    expect(matches(cond("seenAt", "before", "2024-11-06"), seen)).toBe(false);
    expect(matches(cond("seenAt", "after", "2024-11-05"), seen)).toBe(true);
    expect(matches(cond("seenAt", "before", "2024-11-07"), seen)).toBe(true);
  });

  it("uses the UTC day, whatever offset the timestamp is written in", () => {
    const late = { seenAt: "2024-11-06T23:30:00-02:00" }; // 2024-11-07 01:30 UTC
    expect(matches(cond("seenAt", "eq", "2024-11-07"), late)).toBe(true);
  });
});
