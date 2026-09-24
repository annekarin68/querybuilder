import { describe, it, expect } from "vitest";
import {
  buildFieldCatalog,
  fieldsOfFacet,
  findField,
  findOperator,
  isNumberText,
  OPERATORS,
  pickListFor,
  valueTypeFor,
} from "../../src/query/fieldCatalog";
import type { Facet, Field } from "../../src/model";

/** A field with blank text and no values; `over` sets the rest. */
const field = (id: string, typeName: string, over: Partial<Field> = {}): Field => ({
  id,
  name: id,
  typeName,
  comment: "",
  description: "",
  values: [],
  ...over,
});

const facets: Facet[] = [
  {
    id: "engine_rpm",
    name: "Engine RPM",
    tags: [],
    group: "engine",
    comment: "",
    description: "Engine rotational speed.",
    eventCount: 100,
    fields: [
      field("value_rpm", "BIGINT"),
      field("redline_rpm", "BIGINT", { description: "Redline for this engine." }),
      field("is_over_rev", "BOOLEAN"),
    ],
  },
  {
    id: "vehicle_identity",
    name: "Vehicle identity",
    tags: [],
    group: "metadata",
    comment: "",
    description: "Identifying info for the vehicle.",
    eventCount: 100,
    fields: [field("vin", "VARCHAR"), field("vehicle_type", "VARCHAR")],
  },
];

/** The catalog field for (facet id, field id), built from `facets`. */
const pick = (facetId: string, fieldId: string) =>
  findField(buildFieldCatalog(facets), facetId, fieldId);

describe("buildFieldCatalog", () => {
  it("names each field by its facet's id and its own id", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.map((f) => [f.facetId, f.fieldId])).toEqual([
      ["engine_rpm", "value_rpm"],
      ["engine_rpm", "redline_rpm"],
      ["engine_rpm", "is_over_rev"],
      ["vehicle_identity", "vin"],
      ["vehicle_identity", "vehicle_type"],
    ]);
  });

  it("maps the field's type name to valueType", () => {
    expect(pick("engine_rpm", "value_rpm")?.valueType).toBe("number");
    expect(pick("engine_rpm", "is_over_rev")?.valueType).toBe("boolean");
    expect(pick("vehicle_identity", "vin")?.valueType).toBe("string");
  });

  it("name combines the facet's name and the field's name", () => {
    const named: Facet[] = [
      { ...facets[0]!, fields: [field("value_rpm", "BIGINT", { name: "Engine speed" })] },
    ];
    expect(buildFieldCatalog(named).fields[0]).toMatchObject({
      name: "Engine RPM: Engine speed",
      fieldName: "Engine speed",
    });
  });

  it("findField needs both ids", () => {
    const catalog = buildFieldCatalog(facets);
    expect(findField(catalog, "vehicle_identity", "vin")?.valueType).toBe("string");
    expect(findField(catalog, "vehicle_identity", null)).toBeUndefined();
    expect(findField(catalog, null, "vin")).toBeUndefined();
    expect(findField(catalog, "engine_rpm", "vin")).toBeUndefined();
  });

  it("assigns operatorIds per valueType, all of which are real operator ids", () => {
    const { fields } = buildFieldCatalog(facets);
    const opIds = new Set(OPERATORS.map((o) => o.id));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const id of f.operatorIds) expect(opIds.has(id)).toBe(true);
    }
  });

  /** The one field of a facet whose only field has this declared type and these values. */
  const only = (type: string, values: string[]) =>
    buildFieldCatalog([{ ...facets[1]!, fields: [field("f", type, { values })] }]).fields[0]!;

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

    it("no values, no pick-list", () => {
      expect(only("VARCHAR", []).options).toBeUndefined();
    });

    it("pickListFor copies, never shares, the field's list", () => {
      const values = ["a"];
      expect(pickListFor("string", values)).not.toBe(values);
    });
  });
});

describe("field identity: the (facet id, field id) pair", () => {
  // Joined with a dot, both of these fields would be "a.b.c".
  const dotted: Facet[] = [
    { ...facets[0]!, id: "a.b", name: "A.B", fields: [field("c", "BIGINT")] },
    { ...facets[0]!, id: "a", name: "A", fields: [field("b.c", "BOOLEAN")] },
  ];

  it("findField matches both ids, so dotted ids can't collide", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(findField(catalog, "a.b", "c")?.valueType).toBe("number");
    expect(findField(catalog, "a", "b.c")?.valueType).toBe("boolean");
    expect(findField(catalog, "a", "c")).toBeUndefined();
  });

  it("fieldsOfFacet lists only that facet's fields, even when another facet's id starts the same", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(fieldsOfFacet(catalog, "a").map((f) => f.fieldId)).toEqual(["b.c"]);
    expect(fieldsOfFacet(catalog, "a.b").map((f) => f.fieldId)).toEqual(["c"]);
    expect(fieldsOfFacet(catalog, null)).toEqual([]);
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });

  it("findOperator looks an operator up by id", () => {
    expect(findOperator("between")?.arity).toBe("two");
    expect(findOperator("nope")).toBeUndefined();
    expect(findOperator(null)).toBeUndefined();
  });
});

describe("valueTypeFor", () => {
  const t = valueTypeFor;

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
});

describe("isNumberText", () => {
  it.each(["3", "-1.5", "1e3", " 7 "])("%j is a number", (t) => {
    expect(isNumberText(t)).toBe(true);
  });

  it.each(["", "  ", "3x", "N/A", "Infinity", "NaN"])("%j is not", (t) => {
    expect(isNumberText(t)).toBe(false);
  });
});
