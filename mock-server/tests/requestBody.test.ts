import { describe, it, expect } from "vitest";
import { queryProblem } from "../requestBody";
import { toQueryRequest } from "../../src/api/request";
import { groupOf, newBlock, newFieldCondition } from "../../src/query/tree";

// A set field of a block, and a block holding it (the wire format, spelled out).
const condition = { kind: "condition", id: "c1", field_id: "size", operator_id: "gt", value: 3 };
const block = (...conditions: unknown[]) => ({
  kind: "facet",
  id: "f1",
  facet_id: "thing",
  negated: false,
  operator: "AND",
  conditions,
});
const group = (...children: unknown[]) => ({ kind: "group", id: "g1", operator: "AND", children });

describe("queryProblem: is this a well-formed RequestNode?", () => {
  it("accepts a well-formed tree", () => {
    expect(queryProblem(group(block(condition), group(block())))).toBeNull();
  });

  it("accepts a body made by toQueryRequest from the facet-block model", () => {
    // The seam between the frontend's model and the mock's check.
    const b = { ...newBlock("thing"), conditions: [newFieldCondition("size", "gt", 3)] };
    const body = toQueryRequest(groupOf([b, groupOf([newBlock("other")], "OR")]), ["x"]);
    expect(queryProblem(body.query)).toBeNull();
  });

  // One-element rows: it.each spreads an array row into arguments, so a list
  // value must be wrapped to arrive as one argument.
  it.each([[null], [3], ["x"], [["a"]], [[1, "b", true]], [true]])(
    "accepts the value %j",
    (value) => {
      expect(queryProblem(group(block({ ...condition, value })))).toBeNull();
    },
  );

  it.each([
    ["not an object", [], "query must be an object."],
    ["an unknown kind", { ...group(), kind: "rule" }, 'query.kind must be "group" or "facet".'],
    [
      "the old condition node, which a group no longer holds",
      group({ ...condition, facet_id: "thing" }),
      'query.children[0].kind must be "group" or "facet".',
    ],
    ["no id", { ...group(block()), id: 7 }, "query.id must be a string."],
    [
      "a bad operator",
      { ...group(block()), operator: "XOR" },
      'query.operator must be "AND" or "OR".',
    ],
    ["an empty group", group(), "query.children must be a non-empty list."],
    [
      "a child's problem, with its path",
      group(block(condition), { ...block(), facet_id: "" }),
      "query.children[1].facet_id must be a non-empty string.",
    ],
    [
      "a set field with no operator",
      group(block({ ...condition, operator_id: 5 })),
      "query.children[0].conditions[0].operator_id must be a non-empty string.",
    ],
    [
      "an object value",
      group(block({ ...condition, value: { from: 1 } })),
      "query.children[0].conditions[0].value must be null, a string, number or boolean, or a list of them.",
    ],
    [
      "a list value holding an object",
      group(block({ ...condition, value: [1, {}] })),
      "query.children[0].conditions[0].value must be null, a string, number or boolean, or a list of them.",
    ],
  ])("reports %s", (_label, node, problem) => {
    expect(queryProblem(node)).toBe(problem);
  });
});

describe("queryProblem with facet blocks", () => {
  const facet = (over: object) => ({
    kind: "group",
    id: "g",
    operator: "AND",
    children: [
      {
        kind: "facet",
        id: "f",
        facet_id: "thing",
        negated: false,
        operator: "AND",
        conditions: [],
        ...over,
      },
    ],
  });
  it("accepts a block, with or without conditions", () => {
    expect(queryProblem(facet({}))).toBeNull();
    expect(
      queryProblem(
        facet({
          conditions: [
            { kind: "condition", id: "c", field_id: "size", operator_id: "gt", value: 3 },
          ],
        }),
      ),
    ).toBeNull();
  });
  it.each([
    [{ facet_id: "" }, "query.children[0].facet_id must be a non-empty string."],
    [{ negated: "no" }, "query.children[0].negated must be true or false."],
    [{ conditions: {} }, "query.children[0].conditions must be a list."],
    [
      { conditions: [{ kind: "condition", id: "c", field_id: null, operator_id: "gt", value: 3 }] },
      "query.children[0].conditions[0].field_id must be a non-empty string.",
    ],
  ])("names the first problem of %o", (over, message) => {
    expect(queryProblem(facet(over))).toBe(message);
  });
});
