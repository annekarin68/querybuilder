import { describe, it, expect } from "vitest";
import {
  buildFieldCatalog,
  fieldDisplayName,
  findField,
  findOperator,
  OPERATORS,
  valueTypeFor,
} from "../../src/query/fieldCatalog";
import type { Facet } from "../../src/api/types";

const facets: Facet[] = [
  {
    label: "engine_rpm",
    group: "engine",
    tags: [],
    idNumber: 1,
    name: "Engine RPM",
    description: "Engine rotational speed.",
    comment: "",
    totalCount: 100,
    fields: [
      {
        label: "value_rpm",
        type: "BIGINT",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "redline_rpm",
        type: "BIGINT",
        description: "Redline for this engine.",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "is_over_rev",
        type: "BOOLEAN",
        description: "",
        comment: "",
        cardinality: 2,
        values: [],
        format: "",
      },
    ],
  },
  {
    label: "vehicle_identity",
    group: "metadata",
    tags: [],
    idNumber: 2,
    name: "Vehicle identity",
    description: "Identifying info for the vehicle.",
    comment: "",
    totalCount: 100,
    fields: [
      {
        label: "vin",
        type: "VARCHAR",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "vehicle_type",
        type: "VARCHAR",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
    ],
  },
];

describe("buildFieldCatalog", () => {
  it("labels are dotted facetLabel.fieldLabel", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.map((f) => f.label)).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps backend type to valueType", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.label === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("falls back to format when type is empty", () => {
    const withFallback: Facet[] = [
      {
        ...facets[0]!,
        fields: [
          {
            label: "observed_at",
            type: "",
            description: "",
            comment: "",
            cardinality: 100_000,
            values: [],
            format: "TIMESTAMP",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(withFallback);
    expect(fields[0]?.valueType).toBe("date");
  });

  it("name combines the facet's name and the field's label", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.name).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("shows the field's name when the backend sends one, falling back to its label", () => {
    const named: Facet[] = [
      {
        ...facets[0]!,
        fields: [{ ...facets[0]!.fields[0]!, name: "Engine speed" }, facets[0]!.fields[1]!],
      },
    ];
    const { fields } = buildFieldCatalog(named);
    expect(fields[0]).toMatchObject({
      name: "Engine RPM: Engine speed",
      fieldName: "Engine speed",
    });
    expect(fields[1]).toMatchObject({ name: "Engine RPM: redline_rpm", fieldName: "redline_rpm" });
  });

  it("findField looks a field up by its dotted label", () => {
    const catalog = buildFieldCatalog(facets);
    expect(findField(catalog, "vehicle_identity.vin")?.valueType).toBe("string");
    expect(findField(catalog, "nope")).toBeUndefined();
    expect(findField(catalog, null)).toBeUndefined();
  });

  it("assigns operatorIds per valueType, all of which are real operator labels", () => {
    const { fields } = buildFieldCatalog(facets);
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

  it("a field with non-empty values becomes an enum field with matching options, regardless of cardinality", () => {
    const withValues: Facet[] = [
      {
        ...facets[1]!,
        fields: [
          {
            label: "vehicle_type",
            type: "VARCHAR",
            description: "",
            comment: "",
            cardinality: 500, // deliberately high — must be ignored
            values: ["sedan", "van"],
            format: "",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(withValues);
    const field = fields.find((f) => f.label === "vehicle_identity.vehicle_type");
    expect(field?.valueType).toBe("enum");
    expect(field?.options).toEqual(["sedan", "van"]);
    expect(field?.operatorIds).toEqual(["eq", "neq", "in", "isEmpty", "isNotEmpty"]);
  });

  it("a field with empty values is never valueType enum, no matter its cardinality", () => {
    const lowCardinalityNoValues: Facet[] = [
      {
        ...facets[1]!,
        fields: [
          {
            label: "vehicle_type",
            type: "VARCHAR",
            description: "",
            comment: "",
            cardinality: 3, // deliberately low — must still be ignored
            values: [],
            format: "",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(lowCardinalityNoValues);
    expect(fields.every((f) => f.valueType !== "enum")).toBe(true);
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });

  it("findOperator looks an operator up by label", () => {
    expect(findOperator("between")?.arity).toBe("two");
    expect(findOperator("nope")).toBeUndefined();
    expect(findOperator(null)).toBeUndefined();
  });
});

describe("valueTypeFor", () => {
  const t = (type: string, format = "") => valueTypeFor({ type, format });

  it.each([
    ["BIGINT", "number"],
    ["integer", "number"],
    ["SMALLINT", "number"],
    ["DECIMAL(10,2)", "number"],
    ["double precision", "number"],
    ["REAL", "number"],
    ["BOOLEAN", "boolean"],
    ["bool", "boolean"],
    ["DATE", "date"],
    ["TIMESTAMP", "date"],
    ["TIMESTAMP(3) WITH TIME ZONE", "date"],
    ["timestamp without time zone", "date"],
    ["VARCHAR(255)", "string"],
    ["something_new", "string"],
  ] as const)("maps %s -> %s", (type, expected) => {
    expect(t(type)).toBe(expected);
  });

  it("falls back to format only when type is empty", () => {
    expect(t("", "TIMESTAMP")).toBe("date");
    expect(t("BIGINT", "TIMESTAMP")).toBe("number");
  });
});

describe("fieldDisplayName", () => {
  it("is the field's name when the backend sends one, else its label", () => {
    expect(fieldDisplayName({ label: "rpm", name: "Revolutions" })).toBe("Revolutions");
    expect(fieldDisplayName({ label: "rpm", name: "" })).toBe("rpm");
    expect(fieldDisplayName({ label: "rpm" })).toBe("rpm");
  });
});
