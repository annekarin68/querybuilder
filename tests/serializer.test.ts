import { test } from "node:test";
import assert from "node:assert/strict";

import { createConditionNode, createGroupNode } from "../src/core/ast.js";
import { DslSerializer, JsonSerializer } from "../src/core/serializer.js";

test("DslSerializer reproduces the worked example from the spec", () => {
  const andGroup = createGroupNode("AND", [
    createConditionNode({ fieldId: "branches", operatorId: "gte", value: 20 }),
    createConditionNode({ fieldId: "foliage", operatorId: "eq", value: true }),
  ]);
  const singleConditionGroup = createGroupNode("AND", [
    createConditionNode({ fieldId: "flowering", operatorId: "range", value: ["april", "july"] }),
  ]);
  const root = createGroupNode("OR", [andGroup, singleConditionGroup]);

  const dsl = new DslSerializer().serialize(root);

  assert.equal(dsl, "(branches gte 20 AND foliage eq true) OR (flowering range april,july)");
});

test("DslSerializer leaves a bare top-level condition unparenthesized", () => {
  const root = createGroupNode("AND", [createConditionNode({ fieldId: "species", operatorId: "eq", value: "oak" })]);
  assert.equal(new DslSerializer().serialize(root), "species eq oak");
});

test("DslSerializer quotes string values containing whitespace", () => {
  const root = createGroupNode("AND", [
    createConditionNode({ fieldId: "notes", operatorId: "contains", value: "needs trellis" }),
  ]);
  assert.equal(new DslSerializer().serialize(root), 'notes contains "needs trellis"');
});

test("DslSerializer omits the value for arity-none operators", () => {
  const root = createGroupNode("AND", [createConditionNode({ fieldId: "notes", operatorId: "isEmpty" })]);
  assert.equal(new DslSerializer().serialize(root), "notes isEmpty");
});

test("DslSerializer brackets multi-value operators", () => {
  const root = createGroupNode("AND", [
    createConditionNode({ fieldId: "species", operatorId: "in", value: ["oak", "rose"] }),
  ]);
  assert.equal(new DslSerializer().serialize(root), "species in [oak,rose]");
});

test("JsonSerializer mirrors the tree shape without internal ids", () => {
  const root = createGroupNode("AND", [createConditionNode({ fieldId: "branches", operatorId: "gte", value: 20 })]);
  const json = new JsonSerializer().serialize(root);
  assert.deepEqual(json, {
    operator: "AND",
    children: [{ fieldId: "branches", operatorId: "gte", value: 20 }],
  });
});
