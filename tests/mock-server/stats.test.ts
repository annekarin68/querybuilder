import { describe, it, expect } from "vitest";
import { computeBlocks, type JsonNode } from "../../mock-server/evaluate";
import type { FieldDef } from "../../mock-server/schema";
import type { StatBlock } from "../../src/api/types";

const fields: FieldDef[] = [
  {
    id: "vehicle_identity.vehicle_type",
    label: "Vehicle identity: vehicle_type",
    valueType: "string",
    description: "",
    operatorIds: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  },
  {
    id: "engine_rpm.value_rpm",
    label: "Engine RPM: value_rpm",
    valueType: "number",
    description: "",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  },
  {
    id: "observation_window.from_timestamp",
    label: "Observation window: from_timestamp",
    valueType: "date",
    description: "",
    operatorIds: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  },
];

const rows = [
  {
    "vehicle_identity.vehicle_type": "delivery_van",
    "engine_rpm.value_rpm": 10,
    "observation_window.from_timestamp": "2015-01-01",
  },
  {
    "vehicle_identity.vehicle_type": "delivery_van",
    "engine_rpm.value_rpm": 20,
    "observation_window.from_timestamp": "2019-06-01",
  },
  {
    "vehicle_identity.vehicle_type": "semi_truck",
    "engine_rpm.value_rpm": null,
    "observation_window.from_timestamp": "2012-03-01",
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
    const blocks = computeBlocks(cond("engine_rpm.value_rpm", "gte", 0), rows, fields);
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "number-summary",
        fieldLabel: "Engine RPM: value_rpm",
        min: 10,
        max: 20,
        nullCount: 1,
      }),
    );
  });

  it("string field -> distribution buckets over matching rows", () => {
    const blocks = computeBlocks(
      cond("vehicle_identity.vehicle_type", "in", ["delivery_van", "semi_truck"]),
      rows,
      fields,
    );
    const dist = blocks.find(
      (b): b is Extract<StatBlock, { kind: "distribution" }> =>
        b.kind === "distribution" && b.fieldLabel === "Vehicle identity: vehicle_type",
    );
    expect(dist?.buckets).toEqual(
      expect.arrayContaining([
        { label: "delivery_van", count: 2 },
        { label: "semi_truck", count: 1 },
      ]),
    );
  });

  it("date field -> date-range", () => {
    const blocks = computeBlocks(
      cond("observation_window.from_timestamp", "after", "2000-01-01"),
      rows,
      fields,
    );
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "date-range",
        fieldLabel: "Observation window: from_timestamp",
        earliest: "2012-03-01",
        latest: "2019-06-01",
      }),
    );
  });

  it("one block per referenced field, nested groups included", () => {
    const q = group(
      "AND",
      cond("vehicle_identity.vehicle_type", "eq", "delivery_van"),
      group(
        "OR",
        cond("engine_rpm.value_rpm", "gte", 5),
        cond("observation_window.from_timestamp", "before", "2099-01-01"),
      ),
    );
    const labels = computeBlocks(q, rows, fields)
      .map((b) => b.fieldLabel)
      .sort();
    expect(labels).toEqual([
      "Engine RPM: value_rpm",
      "Observation window: from_timestamp",
      "Vehicle identity: vehicle_type",
    ]);
  });

  it("scale multiplies count-shaped fields but not min/max/avg", () => {
    const [num] = computeBlocks(cond("engine_rpm.value_rpm", "gte", 0), rows, fields, {
      total: 1_000_000,
      match: 500_000,
    }) as [Extract<StatBlock, { kind: "number-summary" }>];
    expect(num.min).toBe(10); // value — unscaled
    expect(num.max).toBe(20);
    expect(num.nullCount).toBe(1_000_000); // 1 null row × total scale

    const dist = computeBlocks(
      cond("vehicle_identity.vehicle_type", "in", ["delivery_van", "semi_truck"]),
      rows,
      fields,
      { match: 1000 },
    ).find((b) => b.kind === "distribution") as Extract<StatBlock, { kind: "distribution" }>;
    expect(dist.buckets).toEqual(
      expect.arrayContaining([
        { label: "delivery_van", count: 2000 },
        { label: "semi_truck", count: 1000 },
      ]),
    );
  });
});
