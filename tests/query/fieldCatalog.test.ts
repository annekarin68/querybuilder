import { describe, it, expect } from "vitest";
import {
  buildFieldCatalog,
  fieldDisplayName,
  fieldsOfFacet,
  findField,
  findOperator,
  isNumberText,
  OPERATORS,
  pickListFor,
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

/** The catalog field for (facet label, field label), built from `facets`. */
const pick = (facetLabel: string, fieldLabel: string) =>
  findField(buildFieldCatalog(facets), facetLabel, fieldLabel);

describe("buildFieldCatalog", () => {
  it("names each field by its facet's label and its own label", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.map((f) => [f.facetLabel, f.fieldLabel])).toEqual([
      ["engine_rpm", "value_rpm"],
      ["engine_rpm", "redline_rpm"],
      ["engine_rpm", "is_over_rev"],
      ["vehicle_identity", "vin"],
      ["vehicle_identity", "vehicle_type"],
    ]);
  });

  it("maps backend type to valueType", () => {
    expect(pick("engine_rpm", "value_rpm")?.valueType).toBe("number");
    expect(pick("engine_rpm", "is_over_rev")?.valueType).toBe("boolean");
    expect(pick("vehicle_identity", "vin")?.valueType).toBe("string");
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
    expect(pick("engine_rpm", "value_rpm")?.name).toBe("Engine RPM: value_rpm");
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

  it("findField needs both labels", () => {
    const catalog = buildFieldCatalog(facets);
    expect(findField(catalog, "vehicle_identity", "vin")?.valueType).toBe("string");
    expect(findField(catalog, "vehicle_identity", null)).toBeUndefined();
    expect(findField(catalog, null, "vin")).toBeUndefined();
    expect(findField(catalog, "engine_rpm", "vin")).toBeUndefined();
  });

  it("assigns operatorIds per valueType, all of which are real operator labels", () => {
    const { fields } = buildFieldCatalog(facets);
    const opLabels = new Set(OPERATORS.map((o) => o.label));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const label of f.operatorIds) expect(opLabels.has(label)).toBe(true);
    }
  });

  /** The one field of a facet whose only field has this declared type and these values. */
  const only = (type: string, values: string[]) =>
    buildFieldCatalog([
      {
        ...facets[1]!,
        fields: [
          { label: "f", type, description: "", comment: "", cardinality: 500, values, format: "" },
        ],
      },
    ]).fields[0]!;

  it("offers operators by value type only", () => {
    expect(only("VARCHAR", []).operatorIds).toEqual([
      "eq",
      "neq",
      "contains",
      "in",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(only("BIGINT", []).operatorIds).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "in",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(only("BOOLEAN", []).operatorIds).toEqual(["eq", "neq"]);
    expect(only("TIMESTAMP", []).operatorIds).toEqual([
      "eq",
      "neq",
      "before",
      "after",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  describe("values: a pick-list, never a type", () => {
    it("a string field suggests all its values and keeps its type and operators", () => {
      const f = only("VARCHAR", ["sedan", "van"]);
      expect(f.valueType).toBe("string");
      expect(f.options).toEqual(["sedan", "van"]);
      expect(f.operatorIds).toContain("contains");
    });

    it("a number field with values stays a number field", () => {
      const f = only("BIGINT", ["1", "2", "3"]);
      expect(f.valueType).toBe("number");
      expect(f.options).toEqual(["1", "2", "3"]);
      expect(f.operatorIds).toContain("gt");
    });

    it("a number field suggests only its numeric values, written the JavaScript way", () => {
      expect(only("DECIMAL(4,1)", ["3.0", "3", "N/A", "", "-1.5"]).options).toEqual(["3", "-1.5"]);
      expect(only("BIGINT", ["N/A"]).options).toBeUndefined();
    });

    it("boolean and date fields never get a pick-list", () => {
      const b = only("BOOLEAN", ["false", "true"]);
      expect(b.valueType).toBe("boolean");
      expect(b.options).toBeUndefined();
      const d = only("TIMESTAMP", ["2024-11-06T14:32:00Z"]);
      expect(d.valueType).toBe("date");
      expect(d.options).toBeUndefined();
    });

    it("no values, no pick-list — whatever the cardinality", () => {
      expect(only("VARCHAR", []).options).toBeUndefined();
    });

    it("pickListFor copies, never shares, the backend's list", () => {
      const values = ["a"];
      expect(pickListFor("string", values)).not.toBe(values);
    });
  });
});

describe("field identity: the (facet label, field label) pair", () => {
  // Joined with a dot, both of these fields would be "a.b.c".
  const dotted: Facet[] = [
    {
      ...facets[0]!,
      label: "a.b",
      name: "A.B",
      fields: [{ ...facets[0]!.fields[0]!, label: "c", type: "BIGINT" }],
    },
    {
      ...facets[0]!,
      label: "a",
      name: "A",
      fields: [{ ...facets[0]!.fields[0]!, label: "b.c", type: "BOOLEAN" }],
    },
  ];

  it("findField matches both labels, so dotted labels can't collide", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(findField(catalog, "a.b", "c")?.valueType).toBe("number");
    expect(findField(catalog, "a", "b.c")?.valueType).toBe("boolean");
    expect(findField(catalog, "a", "c")).toBeUndefined();
  });

  it("fieldsOfFacet lists only that facet's fields, even when another facet's label starts the same", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(fieldsOfFacet(catalog, "a").map((f) => f.fieldLabel)).toEqual(["b.c"]);
    expect(fieldsOfFacet(catalog, "a.b").map((f) => f.fieldLabel)).toEqual(["c"]);
    expect(fieldsOfFacet(catalog, null)).toEqual([]);
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

describe("isNumberText", () => {
  it.each(["3", "-1.5", "1e3", " 7 "])("%j is a number", (t) => {
    expect(isNumberText(t)).toBe(true);
  });

  it.each(["", "  ", "3x", "N/A", "Infinity", "NaN"])("%j is not", (t) => {
    expect(isNumberText(t)).toBe(false);
  });
});
