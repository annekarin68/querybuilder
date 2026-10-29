import { describe, it, expect } from "vitest";
import { ContractError, ResponseValue } from "../../src/api/contract";
import { toSavedTree } from "../../src/api/request";
import { fromSavedTree } from "../../src/api/response";
import { emptyQuery, newBlock, newFieldCondition } from "../../src/query/tree";
import { NODE_KIND, type SavedGroup } from "../../src/api/types";
import type { FacetBlock, Group } from "../../src/query/types";

const read = (tree: unknown) =>
  fromSavedTree(new ResponseValue(tree, "GET /test").object<SavedGroup>());

/** `tree` without node ids, which are made fresh on every read. */
const withoutIds = (tree: unknown) =>
  JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === "id" ? undefined : value)));

describe("fromSavedTree", () => {
  it("reads back what toSavedTree wrote, with fresh ids", () => {
    const block: FacetBlock = {
      ...newBlock("thing"),
      negated: true,
      conditions: [newFieldCondition("size", "gt", 3)],
    };
    const query: Group = { ...emptyQuery(), children: [block] };
    const back = read(JSON.parse(JSON.stringify(toSavedTree(query))));
    expect(withoutIds(back)).toEqual(withoutIds(query));
    expect(back.children[0]!.id).not.toBe(block.id);
  });

  it("refuses the old shape: a condition directly in a group", () => {
    const old = {
      kind: NODE_KIND.group,
      operator: "AND",
      children: [
        {
          kind: NODE_KIND.condition,
          facet_id: "thing",
          field_id: null,
          operator_id: "present",
          value: null,
        },
      ],
    };
    expect(() => read(old)).toThrow(ContractError);
    expect(() => read(old)).toThrow('"children[0].kind" should be "group" or "facet"');
  });

  it("refuses a block without negated, or a condition without a field", () => {
    const facet = (over: object) => ({
      kind: NODE_KIND.group,
      operator: "AND",
      children: [
        {
          kind: NODE_KIND.facet,
          facet_id: "thing",
          negated: false,
          operator: "AND",
          conditions: [],
          ...over,
        },
      ],
    });
    expect(() => read(facet({ negated: undefined }))).toThrow(ContractError);
    expect(() =>
      read(
        facet({
          conditions: [
            { kind: NODE_KIND.condition, field_id: null, operator_id: null, value: null },
          ],
        }),
      ),
    ).toThrow(ContractError);
  });
});
