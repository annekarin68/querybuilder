import { describe, it, expect } from "vitest";
import { toQueryRequest } from "../../src/api/request";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";
import type { NodePatch } from "../../src/query/tree";
import type { RequestCondition } from "../../src/api/types";

/** Root AND of: size > 3, and a collapsed OR group holding color in [red, blue]. */
function sample() {
  const root = emptyQuery();
  const c1 = newCondition();
  const g = { ...newGroup(), children: [] };
  const c2 = newCondition();
  let t = addChild(root, root.id, c1);
  t = updateNode(t, c1.id, { facetId: "thing", fieldId: "size", operatorId: "gt", value: 3 });
  t = addChild(t, root.id, g);
  t = updateNode(t, g.id, { operator: "OR", collapsed: true });
  t = addChild(t, g.id, c2);
  t = updateNode(t, c2.id, {
    facetId: "thing",
    fieldId: "color",
    operatorId: "in",
    value: ["red", "blue"],
  });
  return { tree: t, ids: { root: root.id, c1: c1.id, g: g.id, c2: c2.id } };
}

/** A query holding one condition with `patch` applied. */
function oneCondition(patch: NodePatch) {
  const root = emptyQuery();
  const c = newCondition();
  return updateNode(addChild(root, root.id, c), c.id, patch);
}

describe("toQueryRequest", () => {
  it("builds the body: the databases, and the tree with its ids, operators and values", () => {
    const { tree, ids } = sample();
    expect(toQueryRequest(tree, ["alpha", "beta"])).toEqual({
      databases: ["alpha", "beta"],
      query: {
        kind: "group",
        id: ids.root,
        operator: "AND",
        children: [
          {
            kind: "condition",
            id: ids.c1,
            facetId: "thing",
            fieldId: "size",
            operatorId: "gt",
            value: 3,
          },
          {
            kind: "group",
            id: ids.g,
            operator: "OR",
            children: [
              {
                kind: "condition",
                id: ids.c2,
                facetId: "thing",
                fieldId: "color",
                operatorId: "in",
                value: ["red", "blue"],
              },
            ],
          },
        ],
      },
    });
  });

  it("leaves out display state: no `collapsed` anywhere", () => {
    expect(JSON.stringify(toQueryRequest(sample().tree, ["alpha"]))).not.toContain("collapsed");
  });

  it("sends operators and values exactly as built", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const c2 = newCondition();
    const c3 = newCondition();
    let t = addChild(addChild(addChild(root, root.id, c1), root.id, c2), root.id, c3);
    t = updateNode(t, c1.id, {
      facetId: "thing",
      fieldId: "seenAt",
      operatorId: "eq",
      value: "2024-11",
    });
    t = updateNode(t, c2.id, {
      facetId: "thing",
      fieldId: "note",
      operatorId: "isEmpty",
      value: null,
    });
    t = updateNode(t, c3.id, {
      facetId: "thing",
      fieldId: "active",
      operatorId: "eq",
      value: false,
    });
    const sent = toQueryRequest(t, ["alpha"]).query.children as RequestCondition[];
    expect(sent.map((c) => [c.operatorId, c.value])).toEqual([
      ["eq", "2024-11"],
      ["isEmpty", null],
      ["eq", false],
    ]);
  });

  it.each([
    ["no facet", { facetId: null, fieldId: "size", operatorId: "gt", value: 3 }],
    ["no field", { facetId: "thing", fieldId: null, operatorId: "gt", value: 3 }],
    ["no operator", { facetId: "thing", fieldId: "size", operatorId: null, value: 3 }],
  ])("throws on an unfinished condition (%s)", (_label, patch) => {
    expect(() => toQueryRequest(oneCondition(patch), ["alpha"])).toThrow(/unfinished/);
  });

  it.each([
    ["an object", { from: 1 }],
    ["a list holding an object", [1, {}]],
    ["undefined", undefined],
  ])("throws on a value that is %s", (_label, value) => {
    const patch = { facetId: "thing", fieldId: "size", operatorId: "gt", value };
    expect(() => toQueryRequest(oneCondition(patch), ["alpha"])).toThrow(/cannot be sent/);
  });
});
