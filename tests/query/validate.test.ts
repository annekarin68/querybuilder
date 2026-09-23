import { describe, it, expect } from "vitest";
import { validateQuery } from "../../src/query/validate";
import type { CatalogField, FieldCatalog } from "../../src/query/fieldCatalog";
import {
  emptyQuery,
  newCondition,
  newGroup,
  addChild,
  updateNode,
  type NodePatch,
} from "../../src/query/tree";
import type { Issue } from "../../src/query/types";

const field = (label: string, valueType: CatalogField["valueType"], operatorIds: string[]) => ({
  label,
  name: label,
  fieldName: label,
  valueType,
  operatorIds,
});
const catalog: FieldCatalog = {
  fields: [
    field("color", "enum", ["eq", "in", "isEmpty"]),
    field("count", "number", ["eq", "between", "isEmpty"]),
    field("seenAt", "date", ["eq", "between"]),
  ],
};

/** Validate a query holding one condition with `patch` applied. */
function validateOne(patch: NodePatch = {}): { issues: Issue[]; id: string } {
  const root = emptyQuery();
  const c = newCondition();
  const tree = updateNode(addChild(root, root.id, c), c.id, patch);
  return { issues: validateQuery(tree, catalog), id: c.id };
}

/** Expect the single condition built from `patch` to have exactly this issue. */
function expectIssue(patch: NodePatch, message: string, kind: Issue["kind"]): void {
  const { issues, id } = validateOne(patch);
  expect(issues).toEqual([{ nodeId: id, message, kind }]);
}

describe("validateQuery", () => {
  it("empty root query has no issues", () => {
    expect(validateQuery(emptyQuery(), catalog)).toEqual([]);
  });

  it("condition without a field is incomplete", () => {
    expectIssue({}, "Choose a field.", "incomplete");
  });

  it("condition with a field but no operator is incomplete", () => {
    expectIssue({ fieldId: "color" }, "Choose an operator.", "incomplete");
  });

  it("arity 'one' with an empty value is incomplete", () => {
    expectIssue({ fieldId: "color", operatorId: "eq", value: "" }, "Enter a value.", "incomplete");
  });

  it("arity 'two' needs exactly two non-empty values", () => {
    const patch = { fieldId: "count", operatorId: "between", value: [1] };
    expectIssue(patch, "Enter both values.", "incomplete");
  });

  it("arity 'many' needs at least one value", () => {
    const patch = { fieldId: "color", operatorId: "in", value: [] };
    expectIssue(patch, "Choose at least one value.", "incomplete");
  });

  it("arity 'none' ignores the value", () => {
    expect(validateOne({ fieldId: "color", operatorId: "isEmpty", value: null }).issues).toEqual(
      [],
    );
  });

  it("a field that is not in the catalog is invalid", () => {
    expectIssue({ fieldId: "nope", operatorId: "eq", value: "x" }, "Unknown field.", "invalid");
  });

  it("an operator the field does not offer is invalid", () => {
    // "between" exists globally but is not in color.operatorIds.
    const patch = { fieldId: "color", operatorId: "between", value: [1, 2] };
    expectIssue(patch, "That operator isn't available for this field.", "invalid");
  });

  it("an operator that is not in the catalog is invalid", () => {
    expectIssue(
      { fieldId: "color", operatorId: "nope", value: "x" },
      "Unknown operator.",
      "invalid",
    );
  });

  it("a non-root empty group is incomplete", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    const tree = addChild(root, root.id, g);
    expect(validateQuery(tree, catalog)).toEqual([
      { nodeId: g.id, message: "Add a condition to this group.", kind: "incomplete" },
    ]);
  });

  describe("date values", () => {
    const badDate = "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z.";

    it("accepts a full or partial UTC timestamp", () => {
      expect(validateOne({ fieldId: "seenAt", operatorId: "eq", value: "2024-11" }).issues).toEqual(
        [],
      );
      const range = {
        fieldId: "seenAt",
        operatorId: "between",
        value: ["2024", "2024-11-06T14:30Z"],
      };
      expect(validateOne(range).issues).toEqual([]);
    });

    it("rejects anything else", () => {
      expectIssue({ fieldId: "seenAt", operatorId: "eq", value: "06/11/2024" }, badDate, "invalid");
      const range = {
        fieldId: "seenAt",
        operatorId: "between",
        value: ["2024", "2024-11-06 14:30"],
      };
      expectIssue(range, badDate, "invalid");
    });

    it("an empty value is still just incomplete", () => {
      expectIssue(
        { fieldId: "seenAt", operatorId: "eq", value: "" },
        "Enter a value.",
        "incomplete",
      );
    });
  });
});
