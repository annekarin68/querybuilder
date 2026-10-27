import { describe, it, expect } from "vitest";
import { toQueryRequest, toSavedTree } from "../../src/api/request";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";

const cond = newFieldCondition("size", "between", [20, 80]);
const block: FacetBlock = {
  ...newBlock("thing"),
  negated: true,
  operator: "OR",
  conditions: [cond],
  collapsed: true,
};
const inner = groupOf([newBlock("other")], "OR");
const query: Group = { ...emptyQuery(), children: [block, inner], collapsed: false };

describe("toQueryRequest", () => {
  it("projects the tree as built, without display state", () => {
    expect(toQueryRequest(query, ["alpha"])).toEqual({
      databases: ["alpha"],
      query: {
        kind: "group",
        id: query.id,
        operator: "AND",
        children: [
          {
            kind: "facet",
            id: block.id,
            facet_id: "thing",
            negated: true,
            operator: "OR",
            conditions: [
              {
                kind: "condition",
                id: cond.id,
                field_id: "size",
                operator_id: "between",
                value: [20, 80],
              },
            ],
          },
          {
            kind: "group",
            id: inner.id,
            operator: "OR",
            children: [
              {
                kind: "facet",
                id: inner.children[0]!.id,
                facet_id: "other",
                negated: false,
                operator: "AND",
                conditions: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("refuses an unfinished condition: Run must have been blocked", () => {
    const unfinished: Group = {
      ...emptyQuery(),
      children: [{ ...newBlock("thing"), conditions: [newFieldCondition("size", null, null)] }],
    };
    expect(() => toQueryRequest(unfinished, ["alpha"])).toThrow(/unfinished/);
  });
});

describe("toSavedTree", () => {
  it("keeps unfinished parts and leaves out ids and display state", () => {
    const unfinished: Group = {
      ...emptyQuery(),
      children: [
        { ...newBlock("thing"), conditions: [newFieldCondition("size", null, [3, null])] },
      ],
    };
    const saved = toSavedTree(unfinished);
    expect(saved).toEqual({
      kind: "group",
      operator: "AND",
      children: [
        {
          kind: "facet",
          facet_id: "thing",
          negated: false,
          operator: "AND",
          conditions: [
            { kind: "condition", field_id: "size", operator_id: null, value: [3, null] },
          ],
        },
      ],
    });
    expect(JSON.stringify(toSavedTree(query))).not.toMatch(/"id"|collapsed/);
  });
});
