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
  it("labels are dotted individualLabel.fieldLabel", () => {
    const fields = buildFields(individuals);
    const labels = fields.map((f) => f.label);
    expect(labels).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps declared types to valueType", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.label === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("name combines the individual's name and the field's label", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.name).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("description falls back to the individual's description when the field's is empty", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.description).toBe(
      "Engine rotational speed.",
    );
    expect(fields.find((f) => f.label === "engine_rpm.redline_rpm")?.description).toBe(
      "Redline for this engine.",
    );
  });

  it("assigns operatorIds per valueType, all of which are real operator labels", () => {
    const fields = buildFields(individuals);
    const opLabels = new Set(OPERATORS.map((o) => o.label));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const label of f.operatorIds) expect(opLabels.has(label)).toBe(true);
    }
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.operatorIds).toEqual([
      "eq",
      "neq",
    ]);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.operatorIds).toEqual([
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

  it("a field with declared values becomes an enum field with matching options", () => {
    const withValues: Individual[] = [
      {
        ...individuals[1]!,
        fields: [
          { label: "vehicle_type", type: "str", description: "", comment: "", values: ["sedan", "van"] },
        ],
      },
    ];
    const fields = buildFields(withValues);
    const field = fields.find((f) => f.label === "vehicle_identity.vehicle_type");
    expect(field?.valueType).toBe("enum");
    expect(field?.options).toEqual([
      { value: "sedan", label: "sedan" },
      { value: "van", label: "van" },
    ]);
    expect(field?.operatorIds).toEqual(["eq", "neq", "in", "isEmpty", "isNotEmpty"]);
  });

  it("a field with no declared values is never valueType enum", () => {
    const fields = buildFields(individuals);
    expect(fields.every((f) => f.valueType !== "enum")).toBe(true);
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });
});
