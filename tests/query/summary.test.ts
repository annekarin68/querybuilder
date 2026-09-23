import { describe, it, expect } from "vitest";
import { queryToText } from "../../src/query/summary";
import type { CatalogField, FieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const field = (label: string, name: string, options?: string[]): CatalogField => ({
  label,
  name,
  fieldName: name,
  valueType: options ? "enum" : "string",
  options,
  operatorIds: [],
});
const catalog: FieldCatalog = {
  fields: [
    field("heightCm", "Height (cm)"),
    field("foliage", "Has foliage"),
    field("species", "Species", ["oak", "fern"]),
  ],
};
describe("queryToText", () => {
  it("empty query", () => {
    expect(queryToText(emptyQuery(), catalog)).toBe("(empty query)");
  });

  it("single condition, no parens at root", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "heightCm", operatorId: "gte", value: 20 });
    expect(queryToText(t, catalog)).toBe("Height (cm) Greater than or equal 20");
  });

  it("values print as-is; nested group gets parens", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const g = { ...newGroup(), children: [] };
    const c2 = newCondition();
    const c3 = newCondition();
    let t = addChild(root, root.id, c1);
    t = updateNode(t, c1.id, { fieldId: "heightCm", operatorId: "gte", value: 20 });
    t = addChild(t, root.id, g);
    t = updateNode(t, g.id, { operator: "OR" });
    t = addChild(t, g.id, c2);
    t = updateNode(t, c2.id, { fieldId: "foliage", operatorId: "eq", value: true });
    t = addChild(t, g.id, c3);
    t = updateNode(t, c3.id, { fieldId: "species", operatorId: "in", value: ["oak", "fern"] });
    expect(queryToText(t, catalog)).toBe(
      "Height (cm) Greater than or equal 20 AND (Has foliage Equals true OR Species Is any of oak, fern)",
    );
  });

  it("arity none prints just field + operator", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(queryToText(t, catalog)).toBe("Species Is empty");
  });
});

// A collapsed group shows its summary even while a condition is unfinished.
describe("queryToText with a value not entered yet", () => {
  const withValue = (fieldId: string, operatorId: string, value: unknown) => {
    const root = emptyQuery();
    const c = newCondition();
    return queryToText(
      updateNode(addChild(root, root.id, c), c.id, { fieldId, operatorId, value }),
      catalog,
    );
  };

  it("shows (value?) for a missing single value", () => {
    expect(withValue("heightCm", "gte", null)).toBe("Height (cm) Greater than or equal (value?)");
    expect(withValue("heightCm", "gte", "")).toBe("Height (cm) Greater than or equal (value?)");
  });

  it("shows (value?) for each missing end of a range", () => {
    expect(withValue("heightCm", "between", null)).toBe("Height (cm) Between (value?) to (value?)");
    expect(withValue("heightCm", "between", [5, ""])).toBe("Height (cm) Between 5 to (value?)");
  });

  it("shows (value?) when no value of a list is chosen", () => {
    expect(withValue("species", "in", [])).toBe("Species Is any of (value?)");
  });

  it("still prints false and 0", () => {
    expect(withValue("foliage", "eq", false)).toBe("Has foliage Equals false");
    expect(withValue("heightCm", "eq", 0)).toBe("Height (cm) Equals 0");
  });
});
