import { describe, it, expect } from "vitest";
import { queryToText } from "../../src/query/summary";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const schema = {
  fields: [
    { label: "heightCm", name: "Height (cm)" },
    { label: "foliage", name: "Has foliage" },
    {
      label: "species",
      name: "Species",
      options: [
        { value: "oak", label: "Oak" },
        { value: "fern", label: "Fern" },
      ],
    },
  ],
  operators: [
    { label: "gte", name: "≥", arity: "one" as const },
    { label: "eq", name: "is", arity: "one" as const },
    { label: "in", name: "is any of", arity: "many" as const },
    { label: "isEmpty", name: "is empty", arity: "none" as const },
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
    expect(queryToText(t, schema)).toBe("Height (cm) ≥ 20");
  });

  it("enum value uses the option label; nested group gets parens", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const g = newGroup();
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
      "Height (cm) ≥ 20 AND (Has foliage is true OR Species is any of Oak, Fern)",
    );
  });

  it("arity none prints just field + operator", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(queryToText(t, schema)).toBe("Species is empty");
  });
});
