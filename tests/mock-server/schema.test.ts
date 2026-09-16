import { describe, it, expect } from "vitest";
import { buildFields, OPERATORS } from "../../mock-server/schema";
import type { Individual } from "../../mock-server/vehicleData";

const individuals: Individual[] = [
  {
    label: "engine_rpm",
    group: "engine",
    tags: [],
    id_number: 1,
    name: "Engine RPM",
    description: "Engine rotational speed.",
    comment: "",
    stats: { percentage: 0.9, count: 100 },
    fields: [
      { label: "value_rpm", type: "int", description: "", comment: "" },
      { label: "redline_rpm", type: "int", description: "Redline for this engine.", comment: "" },
      { label: "is_over_rev", type: "bool", description: "", comment: "" },
    ],
  },
  {
    label: "vehicle_identity",
    group: "metadata",
    tags: [],
    id_number: 2,
    name: "Vehicle identity",
    description: "Identifying info for the vehicle.",
    comment: "",
    stats: { percentage: 1, count: 100 },
    fields: [
      { label: "vin", type: "str", description: "", comment: "" },
      { label: "vehicle_type", type: "str", description: "", comment: "" },
    ],
  },
];

describe("buildFields", () => {
  it("ids are dotted individualLabel.fieldLabel", () => {
    const fields = buildFields(individuals);
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps declared types to valueType", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.id === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.id === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("label combines the individual's name and the field's label", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.label).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("description falls back to the individual's description when the field's is empty", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.description).toBe(
      "Engine rotational speed.",
    );
    expect(fields.find((f) => f.id === "engine_rpm.redline_rpm")?.description).toBe(
      "Redline for this engine.",
    );
  });

  it("assigns operatorIds per valueType, all of which are real operator ids", () => {
    const fields = buildFields(individuals);
    const opIds = new Set(OPERATORS.map((o) => o.id));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const id of f.operatorIds) expect(opIds.has(id)).toBe(true);
    }
    expect(fields.find((f) => f.id === "engine_rpm.is_over_rev")?.operatorIds).toEqual([
      "eq",
      "neq",
    ]);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.operatorIds).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("any field with valueType enum has options (future-proofing; none exist today)", () => {
    for (const f of buildFields(individuals)) {
      if (f.valueType === "enum") expect(f.options && f.options.length).toBeTruthy();
    }
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });
});
