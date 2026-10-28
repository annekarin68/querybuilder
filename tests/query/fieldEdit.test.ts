import { describe, it, expect } from "vitest";
import {
  cursorAfterOperator,
  nextFieldCondition,
  queryAfterFieldEdit,
} from "../../src/query/fieldEdit";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, findNode, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";
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

  it("never reads a control for an operator with no value (present -> absent)", () => {
    const c = newFieldCondition("size", "present", null);
    const next = nextFieldCondition(c, "thing", "size", "absent", catalog, never)!;
    expect(next).toEqual({ ...c, operatorId: "absent", value: null });
  });

  it("leaves a condition on a field the catalog doesn't know as it is", () => {
    // A stray row has no value control to read; writing its value as null
    // would erase what the saved query held.
    const c = newFieldCondition("gone", "eq", "kept");
    expect(nextFieldCondition(c, "thing", "gone", "eq", catalog, never)).toBe(c);
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

describe("queryAfterFieldEdit", () => {
  /** A root with one block of "thing" holding `conditions`. */
  const withConditions = (...conditions: ReturnType<typeof newFieldCondition>[]) => {
    const block: FacetBlock = { ...newBlock("thing"), conditions };
    const query: Group = { ...emptyQuery(), children: [block] };
    return { query, block };
  };
  const fieldsAfter = (query: Group, blockId: string) =>
    (findNode(query, blockId) as FacetBlock).conditions.map((c) => [c.fieldId, c.operatorId]);

  it("sets the condition, in the facet's field order", () => {
    const ok = newFieldCondition("ok", "eq", true);
    const { query, block } = withConditions(ok);
    const size = newFieldCondition("size", "gt", 3);
    expect(
      fieldsAfter(queryAfterFieldEdit(query, block, undefined, size, catalog), block.id),
    ).toEqual([
      ["size", "gt"],
      ["ok", "eq"],
    ]);
  });

  it('"Not filtered" removes only the row\'s own condition, never a stray one on the same field', () => {
    const row = newFieldCondition("size", "gt", 1);
    const stray = newFieldCondition("size", "lt", 9); // a field set twice: a tampered saved query
    const { query, block } = withConditions(row, stray);
    const next = queryAfterFieldEdit(query, block, row.id, null, catalog);
    expect((findNode(next, block.id) as FacetBlock).conditions).toEqual([stray]);
  });

  it('"Not filtered" on a row that was never set changes nothing', () => {
    const { query, block } = withConditions(newFieldCondition("ok", "eq", true));
    expect(queryAfterFieldEdit(query, block, undefined, null, catalog)).toBe(query);
  });
});
