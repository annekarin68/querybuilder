import { describe, it, expect } from "vitest";
import { toWireQuery } from "../../src/query/wire";
import type { CatalogField, FieldCatalog } from "../../src/query/fieldCatalog";
import type { Condition, Group } from "../../src/query/types";

const field = (label: string, valueType: CatalogField["valueType"]) => ({
  label,
  name: label,
  fieldName: label,
  valueType,
  operatorIds: [],
});
const catalog: FieldCatalog = {
  fields: [field("f.seenAt", "date"), field("f.count", "number")],
};

const cond = (fieldId: string, operatorId: string, value: unknown): Condition => ({
  kind: "condition",
  id: "c1",
  facetId: "f",
  fieldId,
  operatorId,
  value,
});
const root = (...children: Condition[]): Group => ({
  kind: "group",
  id: "root",
  operator: "AND",
  children,
});
const only = (c: Condition) => toWireQuery(root(c), catalog).children[0];
const bound = (operatorId: string, value: string) => cond("f.seenAt", operatorId, value);

const DAY = "2024-11-06T00:00:00.000Z";
const NEXT = "2024-11-07T00:00:00.000Z";

describe("toWireQuery: date conditions become UTC timestamp comparisons", () => {
  it("eq covers the whole UTC day: [day start, next day start)", () => {
    expect(only(cond("f.seenAt", "eq", "2024-11-06"))).toEqual({
      kind: "group",
      id: "c1",
      operator: "AND",
      children: [
        { ...bound("gte", DAY), id: "c1.from" },
        { ...bound("lt", NEXT), id: "c1.to" },
      ],
    });
  });

  it("neq is outside the UTC day", () => {
    expect(only(cond("f.seenAt", "neq", "2024-11-06"))).toEqual({
      kind: "group",
      id: "c1",
      operator: "OR",
      children: [
        { ...bound("lt", DAY), id: "c1.from" },
        { ...bound("gte", NEXT), id: "c1.to" },
      ],
    });
  });

  it("before / after exclude the day itself", () => {
    expect(only(cond("f.seenAt", "before", "2024-11-06"))).toEqual(bound("lt", DAY));
    expect(only(cond("f.seenAt", "after", "2024-11-06"))).toEqual(bound("gte", NEXT));
  });

  it("between includes both end days", () => {
    expect(only(cond("f.seenAt", "between", ["2024-11-01", "2024-11-06"]))).toEqual({
      kind: "group",
      id: "c1",
      operator: "AND",
      children: [
        { ...bound("gte", "2024-11-01T00:00:00.000Z"), id: "c1.from" },
        { ...bound("lt", NEXT), id: "c1.to" },
      ],
    });
  });

  it("rolls over month and year ends", () => {
    expect(only(cond("f.seenAt", "after", "2024-12-31"))).toEqual(
      bound("gte", "2025-01-01T00:00:00.000Z"),
    );
    expect(only(cond("f.seenAt", "after", "2024-02-28"))).toEqual(
      bound("gte", "2024-02-29T00:00:00.000Z"),
    );
  });

  it("leaves isEmpty / isNotEmpty and non-date fields alone", () => {
    const empty = cond("f.seenAt", "isEmpty", null);
    const num = cond("f.count", "eq", 3);
    expect(only(empty)).toEqual(empty);
    expect(only(num)).toEqual(num);
  });

  it("recurses into nested groups", () => {
    const nested: Group = {
      kind: "group",
      id: "root",
      operator: "OR",
      children: [
        {
          kind: "group",
          id: "g",
          operator: "AND",
          children: [cond("f.seenAt", "before", "2024-11-06")],
        },
      ],
    };
    const out = toWireQuery(nested, catalog);
    expect(out.children[0]).toMatchObject({ kind: "group", id: "g", children: [bound("lt", DAY)] });
  });

  it("does not modify the query it was given", () => {
    const q = root(cond("f.seenAt", "eq", "2024-11-06"));
    const copy = structuredClone(q);
    toWireQuery(q, catalog);
    expect(q).toEqual(copy);
  });

  it("leaves a value that is not a calendar day for the backend to reject", () => {
    const odd = cond("f.seenAt", "eq", "yesterday");
    expect(only(odd)).toEqual(odd);
  });
});
