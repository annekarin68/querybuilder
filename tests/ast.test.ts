import { test } from "node:test";
import assert from "node:assert/strict";

import { createConditionNode, createGroupNode, insertChild, removeNode, updateNode, findNode } from "../src/core/ast.js";

test("insertChild appends into the target group without mutating the original tree", () => {
  const root = createGroupNode("AND", []);
  const condition = createConditionNode({ fieldId: "branches" });

  const next = insertChild(root, root.id, condition);

  assert.equal(root.children.length, 0, "original tree must be untouched");
  assert.equal(next.children.length, 1);
  assert.equal(next.children[0], condition);
});

test("insertChild finds a nested group by id", () => {
  const nested = createGroupNode("OR", []);
  const root = createGroupNode("AND", [nested]);
  const condition = createConditionNode({ fieldId: "foliage" });

  const next = insertChild(root, nested.id, condition);

  assert.equal(next.children.length, 1);
  const updatedNested = next.children[0];
  assert.ok(updatedNested.kind === "group");
  assert.equal(updatedNested.children.length, 1);
  assert.equal(updatedNested.children[0], condition);
});

test("updateNode replaces only the targeted node", () => {
  const a = createConditionNode({ fieldId: "a" });
  const b = createConditionNode({ fieldId: "b" });
  const root = createGroupNode("AND", [a, b]);

  const next = updateNode(root, a.id, (node) => ({ ...node, fieldId: "a-renamed" }) as typeof node);

  assert.equal((next.children[0] as typeof a).fieldId, "a-renamed");
  assert.equal(next.children[1], b, "sibling should be structurally shared, not recreated");
});

test("removeNode removes a leaf and leaves the rest intact", () => {
  const a = createConditionNode({ fieldId: "a" });
  const b = createConditionNode({ fieldId: "b" });
  const root = createGroupNode("AND", [a, b]);

  const next = removeNode(root, a.id);

  assert.equal(next.children.length, 1);
  assert.equal(next.children[0], b);
});

test("removeNode is a no-op when targeting the root", () => {
  const root = createGroupNode("AND", [createConditionNode()]);
  const next = removeNode(root, root.id);
  assert.equal(next, root);
});

test("findNode locates nodes at any depth", () => {
  const target = createConditionNode({ fieldId: "target" });
  const nested = createGroupNode("OR", [target]);
  const root = createGroupNode("AND", [nested]);

  assert.equal(findNode(root, target.id), target);
  assert.equal(findNode(root, nested.id), nested);
  assert.equal(findNode(root, "does-not-exist"), undefined);
});
