import { describe, it, expect } from "vitest";
import { validateQuery, hasBlockingErrors } from "../../src/query/validate";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const schema = {
  fields: [
    { id: "species", valueType: "enum" },
    { id: "branches", valueType: "number" },
  ],
  operators: [
    { id: "eq", arity: "one" as const },
    { id: "between", arity: "two" as const },
    { id: "in", arity: "many" as const },
    { id: "isEmpty", arity: "none" as const },
  ],
};

describe("validateQuery", () => {
  it("empty root query has no issues", () => {
    expect(validateQuery(emptyQuery(), schema)).toEqual([]);
  });

  it("condition without a field is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    const tree = addChild(root, root.id, c);
    const issues = validateQuery(tree, schema);
    expect(issues).toContainEqual({ nodeId: c.id, message: "Choose a field.", severity: "error" });
  });

  it("condition with a field but no operator is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species" });
    expect(validateQuery(tree, schema)).toContainEqual({
      nodeId: c.id,
      message: "Choose an operator.",
      severity: "error",
    });
  });

  it("arity 'one' with an empty value is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "eq", value: "" });
    expect(validateQuery(tree, schema)).toContainEqual({
      nodeId: c.id,
      message: "Enter a value.",
      severity: "error",
    });
  });

  it("arity 'two' needs exactly two non-empty values", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "branches", operatorId: "between", value: [1] });
    expect(validateQuery(tree, schema)).toContainEqual({
      nodeId: c.id,
      message: "Enter both values.",
      severity: "error",
    });
  });

  it("arity 'many' needs at least one value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "in", value: [] });
    expect(validateQuery(tree, schema)).toContainEqual({
      nodeId: c.id,
      message: "Choose at least one value.",
      severity: "error",
    });
  });

  it("arity 'none' ignores the value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(validateQuery(tree, schema)).toEqual([]);
  });

  it("a non-root empty group is an error", () => {
    const root = emptyQuery();
    const g = newGroup();
    const tree = addChild(root, root.id, g);
    expect(validateQuery(tree, schema)).toContainEqual({
      nodeId: g.id,
      message: "Add a condition to this group.",
      severity: "error",
    });
  });

  it("hasBlockingErrors is true only when an error-severity issue is present", () => {
    expect(hasBlockingErrors([{ nodeId: "x", message: "m", severity: "warning" }])).toBe(false);
    expect(hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error" }])).toBe(true);
  });
});
