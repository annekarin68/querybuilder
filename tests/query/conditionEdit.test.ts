import { describe, it, expect } from "vitest";
import {
  announcementAfterChange,
  cursorAfterChange,
  defaultValueFor,
  nextCondition,
} from "../../src/query/conditionEdit";
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
  facets: [{ id: "thing", name: "Thing" }],
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
    const picks = { facetId: "thing", fieldId: "size", operatorId: "gt", facetOperatorId: null };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toMatchObject({
      fieldId: "size",
      operatorId: "gt",
      value: 70,
    });
  });

  it("changing the facet resets field, operator and value", () => {
    const picks = { facetId: "other", fieldId: "size", operatorId: "gt", facetOperatorId: null };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toEqual({
      facetId: "other",
      fieldId: null,
      operatorId: null,
      value: null,
    });
  });

  it("changing the field resets operator and value", () => {
    const picks = { facetId: "thing", fieldId: "name", operatorId: "gt", facetOperatorId: null };
    expect(nextCondition(cond(), picks, catalog, onScreen(70))).toMatchObject({
      fieldId: "name",
      operatorId: null,
      value: null,
    });
  });

  it("keeps the value when the operator changes to one of the same arity", () => {
    const picks = { facetId: "thing", fieldId: "size", operatorId: "gte", facetOperatorId: null };
    expect(nextCondition(cond(), picks, catalog, onScreen(50)).value).toBe(50);
  });

  it("does not read the stale control when the operator's arity changes", () => {
    const picks = {
      facetId: "thing",
      fieldId: "size",
      operatorId: "between",
      facetOperatorId: null,
    };
    const read = () => {
      throw new Error("must not read the old control");
    };
    expect(nextCondition(cond(), picks, catalog, read).value).toBeNull();
  });

  it("a boolean field defaults to false, since a toggle cannot show 'unset'", () => {
    const picks = { facetId: "thing", fieldId: "active", operatorId: null, facetOperatorId: null };
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

describe("nextCondition with a whole-facet test", () => {
  // The Field dropdown holds the test itself ("Is present" / "Is absent"), so
  // the picks carry it as `facetOperatorId` and there is no Operator dropdown.
  const isPresent = {
    facetId: "thing",
    fieldId: null,
    operatorId: null,
    facetOperatorId: "present",
  };

  it("choosing 'Is present' sets that operator and a null value", () => {
    const start = cond({ fieldId: null, operatorId: null, value: null });
    expect(nextCondition(start, isPresent, catalog, onScreen(null))).toEqual({
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });

  it("switching to 'Is absent' changes the operator, since the choice is the operator", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    const picks = { ...isPresent, facetOperatorId: "absent" };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: null,
      operatorId: "absent",
    });
  });

  it("switching from a field to a whole-facet test drops the field, operator and value", () => {
    expect(nextCondition(cond(), isPresent, catalog, onScreen(70))).toEqual({
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });

  it("switching from a whole-facet test to a field clears the operator", () => {
    const start = cond({ fieldId: null, operatorId: "absent", value: null });
    const picks = { facetId: "thing", fieldId: "size", operatorId: null, facetOperatorId: null };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: "size",
      operatorId: null,
    });
  });

  it("picking 'Is present' again repairs a malformed row: the stray value is dropped", () => {
    // A hand-edited query can hold a value next to "present". The row shows
    // "Choose…" for it (isFacetTest), so picking the test is a real change.
    const start = cond({ fieldId: null, operatorId: "present", value: 5 });
    expect(nextCondition(start, isPresent, catalog, onScreen(5))).toEqual({
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });

  it("picking a test repairs a foreign operator on a whole facet too", () => {
    const start = cond({ fieldId: null, operatorId: "eq", value: "x" });
    expect(nextCondition(start, isPresent, catalog, onScreen("x"))).toEqual({
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });

  it("clearing the choice clears the operator", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    const picks = { facetId: "thing", fieldId: null, operatorId: null, facetOperatorId: null };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: null,
      operatorId: null,
    });
  });

  it("changing the facet resets everything, even from a whole-facet test", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    expect(
      nextCondition(start, { ...isPresent, facetId: "other" }, catalog, onScreen(null)),
    ).toEqual({
      facetId: "other",
      fieldId: null,
      operatorId: null,
      value: null,
    });
  });
});

describe("cursorAfterChange", () => {
  const committed = (over: Partial<Condition> = {}) => cond(over);
  const wholeFacet = committed({ fieldId: null, operatorId: "present", value: null });

  it("moves on to the next part of the row after a choice", () => {
    expect(cursorAfterChange("facet", true, committed({ fieldId: null, operatorId: null }))).toBe(
      "field",
    );
    expect(cursorAfterChange("field", true, committed({ operatorId: null }))).toBe("operator");
    expect(cursorAfterChange("operator", true, committed())).toBe("value");
  });

  it("stays on the closed Field dropdown after a whole-facet test: nothing follows it", () => {
    expect(cursorAfterChange("field", true, wholeFacet)).toBe("field-closed");
  });

  it("opens the Field dropdown after a new facet, whatever the Field dropdown still shows", () => {
    // The row showed "Is present"; a new facet clears it (nextCondition), so
    // the committed condition is unfinished and the cursor must open Field.
    const afterFacetChange = committed({ facetId: "other", fieldId: null, operatorId: null });
    expect(cursorAfterChange("facet", true, afterFacetChange)).toBe("field");
  });

  it("goes nowhere when the dropdown was cleared, or the change is not a dropdown's", () => {
    expect(cursorAfterChange("field", false, committed({ fieldId: null }))).toBeNull();
    expect(cursorAfterChange(undefined, false, committed())).toBeNull();
    expect(cursorAfterChange(undefined, false, wholeFacet)).toBeNull();
  });
});

describe("announcementAfterChange", () => {
  const wholeFacet = cond({ fieldId: null, operatorId: "present", value: null });

  it("says what the whole-facet test means and that the row is done, for screen readers", () => {
    expect(announcementAfterChange("field", true, wholeFacet, catalog)).toBe(
      "Thing is present. Condition complete.",
    );
    expect(
      announcementAfterChange("field", true, { ...wholeFacet, operatorId: "absent" }, catalog),
    ).toBe("Thing is absent. Condition complete.");
  });

  it("says nothing for any other change: the Operator and Value slots are still there", () => {
    expect(announcementAfterChange("field", true, cond(), catalog)).toBeNull();
    expect(announcementAfterChange("facet", true, wholeFacet, catalog)).toBeNull();
    expect(announcementAfterChange("field", false, wholeFacet, catalog)).toBeNull();
    expect(announcementAfterChange(undefined, false, wholeFacet, catalog)).toBeNull();
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
