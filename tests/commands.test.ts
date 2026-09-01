import { test } from "node:test";
import assert from "node:assert/strict";

import { createConditionNode, createGroupNode } from "../src/core/ast.js";
import { applyCommand } from "../src/core/commands.js";

test("update-condition patches only the addressed condition", () => {
  const condition = createConditionNode({ fieldId: "branches" });
  const root = createGroupNode("AND", [condition]);

  const next = applyCommand(root, {
    type: "update-condition",
    nodeId: condition.id,
    patch: { operatorId: "gte", value: 20 },
  });

  const updated = next.children[0];
  assert.ok(updated?.kind === "condition");
  assert.equal(updated.operatorId, "gte");
  assert.equal(updated.value, 20);
  assert.equal(updated.fieldId, "branches", "unpatched fields survive");
});

test("set-group-operator flips AND/OR on the addressed group only", () => {
  const inner = createGroupNode("AND", []);
  const root = createGroupNode("AND", [inner]);

  const next = applyCommand(root, { type: "set-group-operator", nodeId: inner.id, operator: "OR" });

  assert.equal(next.operator, "AND", "root untouched");
  const nextInner = next.children[0];
  assert.ok(nextInner?.kind === "group");
  assert.equal(nextInner.operator, "OR");
});

test("add-condition appends an empty condition to the target group", () => {
  const root = createGroupNode("AND", []);
  const next = applyCommand(root, { type: "add-condition", parentId: root.id });
  assert.equal(next.children.length, 1);
  assert.equal(next.children[0]!.kind, "condition");
});

test("add-group appends a group pre-seeded with one empty condition", () => {
  const root = createGroupNode("AND", []);
  const next = applyCommand(root, { type: "add-group", parentId: root.id });
  const added = next.children[0];
  assert.ok(added?.kind === "group");
  assert.equal(added.children.length, 1);
  assert.equal(added.children[0]!.kind, "condition");
});

test("remove-node deletes the addressed node wherever it is", () => {
  const condition = createConditionNode({ fieldId: "x" });
  const nested = createGroupNode("OR", [condition]);
  const root = createGroupNode("AND", [nested]);

  const next = applyCommand(root, { type: "remove-node", nodeId: condition.id });

  const nextNested = next.children[0];
  assert.ok(nextNested?.kind === "group");
  assert.equal(nextNested.children.length, 0);
});
