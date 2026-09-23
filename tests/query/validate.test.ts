import { describe, it, expect } from "vitest";
import { validateQuery, hasBlockingErrors } from "../../src/query/validate";
import type { CatalogField, FieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const field = (label: string, valueType: CatalogField["valueType"], operatorIds: string[]) => ({
  label,
  name: label,
  fieldName: label,
  valueType,
  operatorIds,
});
const catalog: FieldCatalog = {
  fields: [
    field("species", "enum", ["eq", "in", "isEmpty"]),
    field("branches", "number", ["eq", "between", "isEmpty"]),
    field("seenAt", "date", ["eq", "between"]),
  ],
};

describe("validateQuery", () => {
  it("empty root query has no issues", () => {
    expect(validateQuery(emptyQuery(), catalog)).toEqual([]);
  });

  it("condition without a field is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    const tree = addChild(root, root.id, c);
    const issues = validateQuery(tree, catalog);
    expect(issues).toContainEqual({
      nodeId: c.id,
      message: "Choose a field.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("condition with a field but no operator is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species" });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Choose an operator.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("arity 'one' with an empty value is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "eq", value: "" });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Enter a value.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("arity 'two' needs exactly two non-empty values", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "branches", operatorId: "between", value: [1] });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Enter both values.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("arity 'many' needs at least one value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "in", value: [] });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Choose at least one value.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("arity 'none' ignores the value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(validateQuery(tree, catalog)).toEqual([]);
  });

  it("a field that is not in the catalog is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "nope", operatorId: "eq", value: "x" });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Unknown field.",
      severity: "error",
      kind: "invalid",
    });
  });

  it("an operator the field does not offer is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    // "between" exists globally but is not in species.operatorIds.
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "between", value: [1, 2] });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "That operator isn't available for this field.",
      severity: "error",
      kind: "invalid",
    });
  });

  it("an operator that is not in the catalog is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "nope", value: "x" });
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: c.id,
      message: "Unknown operator.",
      severity: "error",
      kind: "invalid",
    });
  });

  it("a non-root empty group is an error", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    const tree = addChild(root, root.id, g);
    expect(validateQuery(tree, catalog)).toContainEqual({
      nodeId: g.id,
      message: "Add a condition to this group.",
      severity: "error",
      kind: "incomplete",
    });
  });

  it("hasBlockingErrors is true only when an error-severity issue is present", () => {
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "warning", kind: "incomplete" }]),
    ).toBe(false);
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error", kind: "invalid" }]),
    ).toBe(true);
  });

  it("incomplete issues block running just like invalid ones", () => {
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error", kind: "incomplete" }]),
    ).toBe(true);
  });

  describe("date values", () => {
    const withDate = (operatorId: string, value: unknown) => {
      const root = emptyQuery();
      const c = newCondition();
      const tree = updateNode(addChild(root, root.id, c), c.id, {
        fieldId: "seenAt",
        operatorId,
        value,
      });
      return { issues: validateQuery(tree, catalog), id: c.id };
    };
    const badDate = (nodeId: string) => ({
      nodeId,
      message: "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z.",
      severity: "error",
      kind: "invalid",
    });

    it("accepts a full or partial UTC timestamp", () => {
      expect(withDate("eq", "2024-11").issues).toEqual([]);
      expect(withDate("between", ["2024", "2024-11-06T14:30Z"]).issues).toEqual([]);
    });

    it("rejects anything else", () => {
      const one = withDate("eq", "06/11/2024");
      expect(one.issues).toEqual([badDate(one.id)]);
      const two = withDate("between", ["2024", "2024-11-06 14:30"]);
      expect(two.issues).toEqual([badDate(two.id)]);
    });

    it("an empty value is still just incomplete", () => {
      const { issues } = withDate("eq", "");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: "incomplete" });
    });
  });
});
