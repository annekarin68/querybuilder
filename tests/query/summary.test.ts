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
    field("size", "Size (cm)"),
    field("active", "Active"),
    field("color", "Color", ["red", "blue"]),
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
    t = updateNode(t, c.id, { fieldId: "size", operatorId: "gte", value: 20 });
    expect(queryToText(t, catalog)).toBe("Size (cm) Greater than or equal 20");
  });

  it("values print as-is; nested group gets parens", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const g = { ...newGroup(), children: [] };
    const c2 = newCondition();
    const c3 = newCondition();
    let t = addChild(root, root.id, c1);
    t = updateNode(t, c1.id, { fieldId: "size", operatorId: "gte", value: 20 });
    t = addChild(t, root.id, g);
    t = updateNode(t, g.id, { operator: "OR" });
    t = addChild(t, g.id, c2);
    t = updateNode(t, c2.id, { fieldId: "active", operatorId: "eq", value: true });
    t = addChild(t, g.id, c3);
    t = updateNode(t, c3.id, { fieldId: "color", operatorId: "in", value: ["red", "blue"] });
    expect(queryToText(t, catalog)).toBe(
      "Size (cm) Greater than or equal 20 AND (Active Equals true OR Color Is any of red, blue)",
    );
  });

  it("arity none prints just field + operator", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "color", operatorId: "isEmpty", value: null });
    expect(queryToText(t, catalog)).toBe("Color Is empty");
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
    expect(withValue("size", "gte", null)).toBe("Size (cm) Greater than or equal (value?)");
    expect(withValue("size", "gte", "")).toBe("Size (cm) Greater than or equal (value?)");
  });

  it("shows (value?) for each missing end of a range", () => {
    expect(withValue("size", "between", null)).toBe("Size (cm) Between (value?) to (value?)");
    expect(withValue("size", "between", [5, ""])).toBe("Size (cm) Between 5 to (value?)");
  });

  it("shows (value?) when no value of a list is chosen", () => {
    expect(withValue("color", "in", [])).toBe("Color Is any of (value?)");
  });

  it("still prints false and 0", () => {
    expect(withValue("active", "eq", false)).toBe("Active Equals false");
    expect(withValue("size", "eq", 0)).toBe("Size (cm) Equals 0");
  });
});
