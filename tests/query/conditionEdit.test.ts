import { describe, it, expect } from "vitest";
import { defaultValueFor, nextCondition } from "../../src/query/conditionEdit";
import type { CatalogField, CatalogOperator, FieldCatalog } from "../../src/query/fieldCatalog";
import type { Condition } from "../../src/query/types";

const field = (fieldId: string, valueType: CatalogField["valueType"]): CatalogField => ({
  facetId: "thing",
  fieldId,
  name: fieldId,
  fieldName: fieldId,
  valueType,
  operatorIds: [],
});
const catalog: FieldCatalog = {
  fields: [field("size", "number"), field("active", "boolean"), field("name", "string")],
};

const cond = (over: Partial<Condition> = {}): Condition => ({
  kind: "condition",
  id: "c1",
  facetId: "thing",
  fieldId: "size",
  operatorId: "gt",
  value: 50,
  ...over,
});

/** A stand-in for the row's on-screen value control. */
const onScreen = (value: unknown) => () => value;

describe("nextCondition", () => {
  it("keeps what the user typed when only the value changed", () => {
    const picks = { facetId: "thing", fieldId: "size", operatorId: "gt" };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toMatchObject({
      fieldId: "size",
      operatorId: "gt",
      value: 70,
    });
  });

  it("changing the facet resets field, operator and value", () => {
    const picks = { facetId: "other", fieldId: "size", operatorId: "gt" };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toEqual({
      facetId: "other",
      fieldId: null,
      operatorId: null,
      value: null,
    });
  });

  it("changing the field resets operator and value", () => {
    const picks = { facetId: "thing", fieldId: "name", operatorId: "gt" };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toMatchObject({
      fieldId: "name",
      operatorId: null,
      value: null,
    });
  });

  it("keeps the value when the operator changes to one of the same arity", () => {
    const picks = { facetId: "thing", fieldId: "size", operatorId: "gte" };
    expect(nextCondition(cond(), picks, catalog, onScreen(50)).value).toBe(50);
  });

  it("does not read the stale control when the operator's arity changes", () => {
    const picks = { facetId: "thing", fieldId: "size", operatorId: "between" };
    const read = () => {
      throw new Error("must not read the old control");
    };
    expect(nextCondition(cond(), picks, catalog, read).value).toBeNull();
  });

  it("a boolean field defaults to false, since a toggle cannot show 'unset'", () => {
    const picks = { facetId: "thing", fieldId: "active", operatorId: null };
    const next = nextCondition(cond({ fieldId: "size" }), picks, catalog, onScreen(1));
    expect(next.value).toBeNull();
    const withOp = nextCondition(
      cond({ fieldId: "active", operatorId: null, value: null }),
      { ...picks, operatorId: "eq" },
      catalog,
      onScreen(undefined),
    );
    expect(withOp.value).toBe(false);
  });
});

const op = (arity: CatalogOperator["arity"]): CatalogOperator => ({ id: "o", name: "O", arity });

describe("defaultValueFor", () => {
  it("boolean field + arity one defaults to false (a toggle can't represent unset)", () => {
    expect(defaultValueFor(field("b", "boolean"), op("one"))).toBe(false);
  });

  it("every other field/arity combination defaults to null", () => {
    expect(defaultValueFor(field("s", "string"), op("one"))).toBeNull();
    expect(defaultValueFor(field("b", "boolean"), op("two"))).toBeNull();
    expect(defaultValueFor(field("b", "boolean"), op("many"))).toBeNull();
    expect(defaultValueFor(field("n", "number"), op("one"))).toBeNull();
  });

  it("no field or no operator defaults to null", () => {
    expect(defaultValueFor(undefined, op("one"))).toBeNull();
    expect(defaultValueFor(field("b", "boolean"), undefined)).toBeNull();
  });
});
