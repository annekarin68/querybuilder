import { describe, it, expect } from "vitest";
import { queryProblem } from "../../mock-server/requestBody";

const condition = {
  kind: "condition",
  id: "c1",
  facet_id: "thing",
  field_id: "size",
  operator_id: "gt",
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
      'query.kind must be "group", "facet" or "condition".',
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
      group(condition, { ...condition, field_id: "" }),
      "query.children[1].field_id must be a non-empty string or null.",
    ],
    [
      "no facet",
      group({ ...condition, facet_id: null }),
      "query.children[0].facet_id must be a non-empty string.",
    ],
    [
      "no operator",
      group({ ...condition, operator_id: 5 }),
      "query.children[0].operator_id must be a non-empty string.",
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

describe("queryProblem: a condition about a whole facet", () => {
  it("accepts a null field_id", () => {
    const node = {
      kind: "condition",
      id: "c",
      facet_id: "f",
      field_id: null,
      operator_id: "present",
      value: null,
    };
    expect(queryProblem(node)).toBeNull();
  });
  it("still rejects an empty-string or numeric field_id", () => {
    const base = { kind: "condition", id: "c", facet_id: "f", operator_id: "present", value: null };
    expect(queryProblem({ ...base, field_id: "" })).toMatch(/field_id/);
    expect(queryProblem({ ...base, field_id: 3 })).toMatch(/field_id/);
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
