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

const field = (
  fieldLabel: string,
  valueType: CatalogField["valueType"],
  operatorIds: string[],
  options?: string[],
): CatalogField => ({
  facetLabel: "thing",
  fieldLabel,
  name: fieldLabel,
  fieldName: fieldLabel,
  valueType,
  options,
  operatorIds,
});
const catalog: FieldCatalog = {
  fields: [
    field("color", "string", ["eq", "in", "isEmpty"], ["red", "blue"]),
    field("count", "number", ["eq", "between", "in", "isEmpty"]),
    field("seenAt", "date", ["eq", "between"]),
    field("active", "boolean", ["eq"]),
  ],
};

/** Validate a query holding one condition with `patch` applied. */
function validateOne(patch: NodePatch = {}): { issues: Issue[]; id: string } {
  const root = emptyQuery();
  const c = newCondition();
  const tree = updateNode(addChild(root, root.id, c), c.id, { facetId: "thing", ...patch });
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

  it("a field of another facet is unknown", () => {
    expectIssue(
      { facetId: "other", fieldId: "color", operatorId: "eq", value: "x" },
      "Unknown field.",
      "invalid",
    );
  });

  it("a condition without a facet is incomplete", () => {
    expectIssue({ facetId: null, fieldId: "color" }, "Choose a field.", "incomplete");
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

  describe("value types", () => {
    it.each([
      [
        "a number field holding text",
        { fieldId: "count", operatorId: "eq", value: "12abc" },
        "Enter a number.",
      ],
      [
        "a number field holding a list",
        { fieldId: "count", operatorId: "eq", value: [3] },
        "Enter a number.",
      ],
      [
        "a number range holding text",
        { fieldId: "count", operatorId: "between", value: [1, "x"] },
        "Enter a number.",
      ],
      [
        "a number list holding text",
        { fieldId: "count", operatorId: "in", value: [1, "x"] },
        "Enter a number.",
      ],
      [
        "a boolean field holding text",
        { fieldId: "active", operatorId: "eq", value: "true" },
        "Choose true or false.",
      ],
      [
        "a string field holding a number",
        { fieldId: "color", operatorId: "eq", value: 3 },
        "Enter text.",
      ],
      [
        "a string list holding a number",
        { fieldId: "color", operatorId: "in", value: ["red", 3] },
        "Enter text.",
      ],
    ])("%s is invalid", (_label, patch, message) => {
      expectIssue(patch, message, "invalid");
    });

    it("accepts values of the field's type", () => {
      for (const patch of [
        { fieldId: "count", operatorId: "eq", value: 12 },
        { fieldId: "count", operatorId: "in", value: [1, 2] },
        { fieldId: "active", operatorId: "eq", value: false },
        { fieldId: "color", operatorId: "eq", value: "red" },
      ]) {
        expect(validateOne(patch).issues).toEqual([]);
      }
    });

    it("accepts a value that isn't on the pick-list — the list may be out of date", () => {
      expect(validateOne({ fieldId: "color", operatorId: "eq", value: "violet" }).issues).toEqual(
        [],
      );
      const list = { fieldId: "color", operatorId: "in", value: ["red", "violet"] };
      expect(validateOne(list).issues).toEqual([]);
    });
  });

  describe("ranges", () => {
    it("a number range may not run backwards", () => {
      const patch = { fieldId: "count", operatorId: "between", value: [10, 5] };
      expectIssue(patch, "From must not be greater than To.", "invalid");
    });

    it("a number range may start and end on the same value", () => {
      expect(
        validateOne({ fieldId: "count", operatorId: "between", value: [5, 5] }).issues,
      ).toEqual([]);
    });

    it("a date range's order is left to the backend", () => {
      const patch = { fieldId: "seenAt", operatorId: "between", value: ["2025", "2024"] };
      expect(validateOne(patch).issues).toEqual([]);
    });
  });
});
