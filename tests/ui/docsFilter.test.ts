import { describe, it, expect } from "vitest";
import type { Individual } from "../../src/api/types";
import { matchDocs } from "../../src/ui/docsFilter";

function ind(label: string, group: string, name: string, fields: string[]): Individual {
  return {
    label,
    group,
    name,
    tags: [],
    idNumber: 0,
    description: "",
    comment: "",
    totalCount: 0,
    fields: fields.map((f) => ({
      label: f,
      type: "DOUBLE",
      description: "",
      comment: "",
      cardinality: 0,
      values: [],
      format: "",
    })),
  };
}

const items = [
  ind("tire_pressure_front_left", "tires_wheels", "Tire pressure (front left)", [
    "pressure_psi",
    "tread_depth_mm",
  ]),
  ind("engine_oil_pressure", "engine", "Engine oil pressure", ["value_kpa"]),
  ind("engine_rpm", "engine", "Engine RPM", ["value_rpm", "redline_rpm"]),
  ind("brake_pressure", "brakes", "Brake pressure", ["value_kpa", "pedal_position_percentage"]),
];

describe("matchDocs", () => {
  it("returns null for a blank filter", () => {
    expect(matchDocs(items, "")).toBeNull();
    expect(matchDocs(items, "   ")).toBeNull();
  });

  it("matches item names case-insensitively and counts matches per group", () => {
    const m = matchDocs(items, "PRESSURE")!;
    expect([...m.items].sort()).toEqual([
      "brake_pressure",
      "engine_oil_pressure",
      "tire_pressure_front_left",
    ]);
    expect(m.groups).toEqual(
      new Map([
        ["tires_wheels", 1],
        ["engine", 1],
        ["brakes", 1],
      ]),
    );
  });

  it("matches field labels", () => {
    const m = matchDocs(items, "redline")!;
    expect([...m.items]).toEqual(["engine_rpm"]);
    expect(m.groups).toEqual(new Map([["engine", 1]]));
  });

  it("matches a field's display name when the backend supplies one", () => {
    const base = items[1]!;
    const named = { ...base, fields: [{ ...base.fields[0]!, name: "Oil pressure (kPa)" }] };
    expect([...matchDocs([named], "(kpa)")!.items]).toEqual(["engine_oil_pressure"]);
  });

  it("counts several matches in the same group", () => {
    const m = matchDocs(items, "engine")!;
    expect(m.groups.get("engine")).toBe(2);
  });

  it("returns empty sets when nothing matches", () => {
    const m = matchDocs(items, "zzz")!;
    expect(m.items.size).toBe(0);
    expect(m.groups.size).toBe(0);
  });
});
