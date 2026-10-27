import { describe, it, expect } from "vitest";
import { placeIssues } from "../../src/query/issues";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group, Issue } from "../../src/query/types";

const issue = (nodeId: string, message = "m"): Issue => ({ nodeId, message, kind: "invalid" });

function sample() {
  const c = newFieldCondition("size", "gt", null);
  const block: FacetBlock = { ...newBlock("thing"), conditions: [c] };
  const inner = groupOf([block]);
  const root: Group = { ...emptyQuery(), children: [inner] };
  return { c, block, inner, root };
}

describe("placeIssues", () => {
  it("keeps an issue on its condition while everything is open", () => {
    const { c, root } = sample();
    expect(placeIssues(root, [issue(c.id)])).toEqual([issue(c.id)]);
  });

  it("moves a condition's issue to its folded block", () => {
    const { c, block, inner, root } = sample();
    const folded: Group = {
      ...root,
      children: [{ ...inner, children: [{ ...block, collapsed: true }] }],
    };
    expect(placeIssues(folded, [issue(c.id)])).toEqual([issue(block.id)]);
  });

  it("moves it to the outermost folded group around it", () => {
    const { c, block, inner, root } = sample();
    const folded: Group = { ...root, children: [{ ...inner, collapsed: true }] };
    expect(placeIssues(folded, [issue(c.id), issue(block.id)])).toEqual([issue(inner.id)]);
  });

  it("puts an unknown id on the root", () => {
    const { root } = sample();
    expect(placeIssues(root, [issue("gone")])).toEqual([issue(root.id)]);
  });
});
