import { describe, it, expect } from "vitest";
import { matches, type JsonNode } from "../../mock-server/evaluate";
import type { FieldCatalog } from "../../src/query/fieldCatalog";
import { toWireQuery } from "../../src/query/wire";

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

describe("date conditions (UTC timestamps on the wire)", () => {
  const seen = { seenAt: "2024-11-06T14:32:00Z" };

  it("gte / lt compare instants, whatever offset the row value is written in", () => {
    expect(matches(cond("seenAt", "gte", "2024-11-06T00:00:00.000Z"), seen)).toBe(true);
    expect(matches(cond("seenAt", "lt", "2024-11-06T14:32:00.000Z"), seen)).toBe(false);
    const late = { seenAt: "2024-11-06T23:30:00-02:00" }; // 2024-11-07 01:30 UTC
    expect(matches(cond("seenAt", "gte", "2024-11-07T00:00:00.000Z"), late)).toBe(true);
  });

  it("a plain calendar-day row value is midnight UTC", () => {
    const day = { plantedOn: "2024-11-06" };
    expect(matches(cond("plantedOn", "gte", "2024-11-06T00:00:00.000Z"), day)).toBe(true);
    expect(matches(cond("plantedOn", "lt", "2024-11-06T00:00:00.000Z"), day)).toBe(false);
  });
});

describe("date conditions end to end (frontend toWireQuery → mock evaluator)", () => {
  const catalog: FieldCatalog = {
    fields: [
      { label: "seenAt", name: "seenAt", fieldName: "seenAt", valueType: "date", operatorIds: [] },
    ],
  };
  const seen = { seenAt: "2024-11-06T14:32:00Z" };
  const day = (operatorId: string, value: unknown) =>
    matches(
      toWireQuery(
        {
          kind: "group",
          id: "root",
          operator: "AND",
          children: [
            { kind: "condition", id: "c", facetId: null, fieldId: "seenAt", operatorId, value },
          ],
        },
        catalog,
      ) as JsonNode,
      seen,
    );

  it("eq / neq match the timestamp's UTC day", () => {
    expect(day("eq", "2024-11-06")).toBe(true);
    expect(day("eq", "2024-11-07")).toBe(false);
    expect(day("neq", "2024-11-06")).toBe(false);
    expect(day("neq", "2024-11-07")).toBe(true);
  });

  it("between includes both end days", () => {
    expect(day("between", ["2024-11-06", "2024-11-06"])).toBe(true);
    expect(day("between", ["2024-11-01", "2024-11-06"])).toBe(true);
    expect(day("between", ["2024-11-07", "2024-11-09"])).toBe(false);
  });

  it("before / after exclude the day itself", () => {
    expect(day("after", "2024-11-06")).toBe(false);
    expect(day("before", "2024-11-06")).toBe(false);
    expect(day("after", "2024-11-05")).toBe(true);
    expect(day("before", "2024-11-07")).toBe(true);
  });
});
