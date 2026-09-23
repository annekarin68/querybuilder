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
const schema: FieldCatalog = {
  fields: [
    field("heightCm", "Height (cm)"),
    field("foliage", "Has foliage"),
    field("species", "Species", ["oak", "fern"]),
  ],
};
describe("queryToText", () => {
  it("empty query", () => {
    expect(queryToText(emptyQuery(), schema)).toBe("(empty query)");
  });

  it("single condition, no parens at root", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "heightCm", operatorId: "gte", value: 20 });
    expect(queryToText(t, schema)).toBe("Height (cm) Greater than or equal 20");
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
    expect(queryToText(t, schema)).toBe(
      "Height (cm) Greater than or equal 20 AND (Has foliage Equals true OR Species Is any of oak, fern)",
    );
  });

  it("arity none prints just field + operator", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(queryToText(t, schema)).toBe("Species Is empty");
  });
});
