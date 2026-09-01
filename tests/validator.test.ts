import { test } from "node:test";
import assert from "node:assert/strict";

import { createConditionNode, createGroupNode } from "../src/core/ast.js";
import { validateExpression, isValidExpression } from "../src/core/validator.js";
import type { FieldDefinition } from "../src/core/types.js";

const FIELDS: FieldDefinition[] = [
  { id: "branches", label: "Branches", valueType: "number" },
  { id: "species", label: "Species", valueType: "enum", options: [{ value: "oak", label: "Oak" }] },
];

test("an empty root group is valid (nothing built yet)", () => {
  const root = createGroupNode("AND", []);
  assert.equal(isValidExpression(root, FIELDS), true);
});

test("an empty nested group is invalid", () => {
  const root = createGroupNode("AND", [createGroupNode("OR", [])]);
  const issues = validateExpression(root, FIELDS);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /empty group/i);
});

test("a condition missing a field is invalid", () => {
  const root = createGroupNode("AND", [createConditionNode()]);
  assert.equal(isValidExpression(root, FIELDS), false);
});

test("an operator not applicable to the field's type is invalid", () => {
  const root = createGroupNode("AND", [
    createConditionNode({ fieldId: "branches", operatorId: "contains", value: "x" }),
  ]);
  assert.equal(isValidExpression(root, FIELDS), false);
});

test("a range condition needs both ends filled in", () => {
  const root = createGroupNode("AND", [
    createConditionNode({ fieldId: "branches", operatorId: "range", value: [10, ""] }),
  ]);
  assert.equal(isValidExpression(root, FIELDS), false);
});

test("a fully specified condition is valid", () => {
  const root = createGroupNode("AND", [
    createConditionNode({ fieldId: "branches", operatorId: "gte", value: 20 }),
  ]);
  assert.equal(isValidExpression(root, FIELDS), true);
});

test("an arity-none operator does not require a value", () => {
  const root = createGroupNode("AND", [createConditionNode({ fieldId: "species", operatorId: "isEmpty" })]);
  assert.equal(isValidExpression(root, FIELDS), true);
});
