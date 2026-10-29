import { describe, it, expect } from "vitest";
import { NODE_KIND } from "../../src/api/types";
import { toQueryRequest, toSavedQueryRequest, toSavedTree } from "../../src/api/request";
import { unfinishedDraft, unfinishedRequest } from "../savedQueryFixtures";
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
        kind: NODE_KIND.group,
        id: query.id,
        operator: "AND",
        children: [
          {
            kind: NODE_KIND.facet,
            id: block.id,
            facet_id: "thing",
            negated: true,
            operator: "OR",
            conditions: [
              {
                kind: NODE_KIND.condition,
                id: cond.id,
                field_id: "size",
                operator_id: "between",
                value: [20, 80],
              },
            ],
          },
          {
            kind: NODE_KIND.group,
            id: inner.id,
            operator: "OR",
            children: [
              {
                kind: NODE_KIND.facet,
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
      kind: NODE_KIND.group,
      operator: "AND",
      children: [
        {
          kind: NODE_KIND.facet,
          facet_id: "thing",
          negated: false,
          operator: "AND",
          conditions: [
            { kind: NODE_KIND.condition, field_id: "size", operator_id: null, value: [3, null] },
          ],
        },
      ],
    });
    expect(JSON.stringify(toSavedTree(query))).not.toMatch(/"id"|collapsed/);
  });
});

describe("toSavedQueryRequest", () => {
  it("keeps every unfinished part, trims name and note, and leaves display state out", () => {
    expect(toSavedQueryRequest(unfinishedDraft)).toEqual(unfinishedRequest);
    expect(JSON.stringify(toSavedQueryRequest(unfinishedDraft))).not.toContain("collapsed");
  });

  it("sends no node ids: they only live for one page load", () => {
    expect(JSON.stringify(toSavedQueryRequest(unfinishedDraft).query)).not.toContain('"id"');
  });

  it("does not change the draft it is given", () => {
    const before = JSON.stringify(unfinishedDraft);
    toSavedQueryRequest(unfinishedDraft);
    expect(JSON.stringify(unfinishedDraft)).toBe(before);
  });

  it("sends a note of only spaces as an empty note", () => {
    expect(toSavedQueryRequest({ ...unfinishedDraft, note: "   " }).note).toBe("");
  });

  it.each([
    ["an object", { from: 1 }],
    ["a list holding an object", [1, {}]],
    ["undefined", undefined],
  ])("throws on a value that is %s", (_label, value) => {
    const bad: Group = {
      ...emptyQuery(),
      children: [{ ...newBlock("thing"), conditions: [newFieldCondition("size", "eq", value)] }],
    };
    expect(() => toSavedQueryRequest({ ...unfinishedDraft, query: bad })).toThrow(
      /cannot be saved/,
    );
  });
});
