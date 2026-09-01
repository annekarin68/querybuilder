import { describe, it, expect } from "vitest";
import { computeBlocks, type JsonNode } from "../../mock-server/evaluate";
import type { StatBlock } from "../../src/api/types";

const rows = [
  {
    species: "oak",
    branches: 10,
    heightCm: 100,
    foliage: true,
    flowering: "april",
    plantedOn: "2015-01-01",
    notes: "a",
  },
  {
    species: "oak",
    branches: 20,
    heightCm: 200,
    foliage: false,
    flowering: null,
    plantedOn: "2019-06-01",
    notes: "b",
  },
  {
    species: "fern",
    branches: null,
    heightCm: 300,
    foliage: true,
    flowering: "may",
    plantedOn: "2012-03-01",
    notes: "c",
  },
];

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

describe("computeBlocks", () => {
  it("number field -> number-summary with nullCount", () => {
    const blocks = computeBlocks(cond("branches", "gte", 0), rows);
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "number-summary",
        fieldLabel: "Branch count",
        min: 10,
        max: 20,
        nullCount: 1,
      }),
    );
  });

  it("enum field -> distribution buckets over matching rows", () => {
    const blocks = computeBlocks(cond("species", "in", ["oak", "fern"]), rows);
    const dist = blocks.find(
      (b): b is Extract<StatBlock, { kind: "distribution" }> =>
        b.kind === "distribution" && b.fieldLabel === "Species",
    );
    expect(dist?.buckets).toEqual(
      expect.arrayContaining([
        { label: "oak", count: 2 },
        { label: "fern", count: 1 },
      ]),
    );
  });

  it("date field -> date-range", () => {
    const blocks = computeBlocks(cond("plantedOn", "after", "2000-01-01"), rows);
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "date-range",
        fieldLabel: "Planted on",
        earliest: "2012-03-01",
        latest: "2019-06-01",
      }),
    );
  });

  it("one block per referenced field, nested groups included", () => {
    const q = group(
      "AND",
      cond("species", "eq", "oak"),
      group("OR", cond("branches", "gte", 5), cond("heightCm", "lt", 999)),
    );
    const labels = computeBlocks(q, rows)
      .map((b) => b.fieldLabel)
      .sort();
    expect(labels).toEqual(["Branch count", "Height (cm)", "Species"]);
  });
});
