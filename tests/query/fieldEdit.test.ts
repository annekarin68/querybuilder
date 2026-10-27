import { describe, it, expect } from "vitest";
import { cursorAfterOperator, nextFieldCondition } from "../../src/query/fieldEdit";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { newFieldCondition } from "../../src/query/tree";
import type { Facet } from "../../src/model";

const catalog = buildFieldCatalog([
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: [] },
      { id: "ok", name: "ok", typeName: "BOOLEAN", values: [] },
    ],
  },
] as unknown as Facet[]);
const never = () => {
  throw new Error("the old control must not be read");
};

describe("nextFieldCondition", () => {
  it("is null for the blank choice: the row is not filtered any more", () => {
    const c = newFieldCondition("size", "gt", 3);
    expect(nextFieldCondition(c, "thing", "size", null, catalog, never)).toBeNull();
  });

  it("starts a condition when an unset row gets an operator", () => {
    const next = nextFieldCondition(undefined, "thing", "size", "gt", catalog, never)!;
    expect(next).toMatchObject({
      kind: "condition",
      fieldId: "size",
      operatorId: "gt",
      value: null,
    });
    // A boolean toggle is never "unset" on screen, so its default is false.
    expect(nextFieldCondition(undefined, "thing", "ok", "eq", catalog, never)!.value).toBe(false);
  });

  it("keeps the condition's id and reads the value while the shape is the same", () => {
    const c = newFieldCondition("size", "gt", 3);
    const next = nextFieldCondition(c, "thing", "size", "lt", catalog, () => 7)!;
    expect(next).toEqual({ ...c, operatorId: "lt", value: 7 });
  });

  it("resets the value when the operator's shape changes", () => {
    const c = newFieldCondition("size", "gt", 3);
    expect(nextFieldCondition(c, "thing", "size", "between", catalog, never)!.value).toBeNull();
  });
});

describe("cursorAfterOperator", () => {
  it("goes to the value, unless the operator takes none", () => {
    expect(cursorAfterOperator("gt")).toBe("value");
    expect(cursorAfterOperator("present")).toBeNull();
    expect(cursorAfterOperator(null)).toBeNull();
  });
});
