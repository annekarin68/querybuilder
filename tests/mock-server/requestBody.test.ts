import { describe, it, expect } from "vitest";
import { queryProblem } from "../../mock-server/requestBody";

const condition = {
  kind: "condition",
  id: "c1",
  facetId: "thing",
  fieldId: "size",
  operatorId: "gt",
  value: 3,
};
const group = (...children: unknown[]) => ({ kind: "group", id: "g1", operator: "AND", children });

describe("queryProblem: is this a well-formed RequestNode?", () => {
  it("accepts a well-formed tree", () => {
    expect(queryProblem(group(condition, group(condition)))).toBeNull();
  });

  // One-element rows: it.each spreads an array row into arguments, so a list
  // value must be wrapped to arrive as one argument.
  it.each([[null], [3], ["x"], [["a"]], [[1, "b", true]], [true]])(
    "accepts the value %j",
    (value) => {
      expect(queryProblem(group({ ...condition, value }))).toBeNull();
    },
  );

  it.each([
    ["not an object", [], "query must be an object."],
    [
      "an unknown kind",
      { ...condition, kind: "rule" },
      'query.kind must be "group" or "condition".',
    ],
    ["no id", { ...group(condition), id: 7 }, "query.id must be a string."],
    [
      "a bad operator",
      { ...group(condition), operator: "XOR" },
      'query.operator must be "AND" or "OR".',
    ],
    ["an empty group", group(), "query.children must be a non-empty list."],
    [
      "a child's problem, with its path",
      group(condition, { ...condition, fieldId: "" }),
      "query.children[1].fieldId must be a non-empty string.",
    ],
    [
      "no facet",
      group({ ...condition, facetId: null }),
      "query.children[0].facetId must be a non-empty string.",
    ],
    [
      "no operator",
      group({ ...condition, operatorId: 5 }),
      "query.children[0].operatorId must be a non-empty string.",
    ],
    [
      "an object value",
      group({ ...condition, value: { from: 1 } }),
      "query.children[0].value must be null, a string, number or boolean, or a list of them.",
    ],
    [
      "a list value holding an object",
      group({ ...condition, value: [1, {}] }),
      "query.children[0].value must be null, a string, number or boolean, or a list of them.",
    ],
  ])("reports %s", (_label, node, problem) => {
    expect(queryProblem(node)).toBe(problem);
  });
});
