# Facet blocks, plan A1: the new query model beside the old one

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the facet-block query model (types, tree edits, validation, summary, drops, field edits, issue placement, saved-query comparison), its wire projection, and the mock server's support for facet blocks matched per occurrence — while the app keeps running on the old model.

**Architecture:** The old model moves, unchanged, into `src/query/legacy/` and `src/api/legacy/` (Task 1). The new model is written at the final paths (`src/query/tree.ts`, …) with the final names. Nothing in the app uses the new modules yet; plan A2 switches the app over and deletes `legacy/`. This keeps every commit green: the repo requires `npm run typecheck && npm test && npm run lint && npm run build` before each commit (CLAUDE.md).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (Node, no DOM), the plain-Node mock server in `mock-server/`.

**Spec:** `docs/superpowers/specs/2026-10-27-facet-blocks-design.md` (read sections 2–4 before starting; section 3 is the model, section 4 the wire format).

**Follow-up plans:** A2 — the builder UI, switching the app to the new model, deleting `legacy/`. B — co-occurrence data, top row, panel, legend, palette, dictionary link.

## Global Constraints

- Before every commit: `npm run typecheck && npm test && npm run lint && npm run build` (the build runs `check:offline`). All four must pass.
- Code for a junior team: comments explain *why*, names say what a thing is, logic in small pure functions the Node-only tests can reach.
- `src/` never names backend data (no facet, field, tag, group or database from the mock), not even in comments or tests under `tests/` that import `src/` only — use made-up ids like `"thing"`, `"size"`. `tests/noBackendDataInSrc.test.ts` enforces it for `src/`.
- The frontend sends the query exactly as the user built it; it never rewrites conditions. Unset fields are simply not in the query.
- Only `src/ui/fomantic.ts` uses jQuery; `src/` never imports `mock-server/`. Only `src/api/` imports `src/api/types.ts`.
- Do not rename headings in `docs/ARCHITECTURE.md` (`tests/docReferences.test.ts`). If code and that doc disagree, fix the doc in the same commit.
- Node ids: `g-…` group, `f-…` facet block, `c-…` field condition, made by `src/query/tree.ts` only.
- Operator `not_in`: name "Is none of", arity `many`, offered wherever `in` is.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never `git stash`; never `pkill`. Do not push or open pull requests (the controller does).

---

### Task 1: Move the old query model aside

Mechanical: no behaviour changes. Afterwards the old model lives in `legacy/` folders and the final paths are free for the new one.

**Files:**
- Move: `src/query/{types,tree,validate,summary,drop,conditionEdit,issues,saved}.ts` → `src/query/legacy/`
- Move: `tests/query/{tree,validate,summary,drop,conditionEdit,issues,saved}.test.ts` → `tests/query/legacy/`
- Move: `src/api/request.ts` → `src/api/legacy/request.ts`
- Create: `src/api/legacy/types.ts` (the old request and saved-query types, moved out of `src/api/types.ts`)
- Create: `src/api/legacy/savedResponse.ts` (`toSavedQuery` and its helpers, moved out of `src/api/response.ts`)
- Modify: every importer the compiler reports (`src/model.ts`, `src/state.ts`, `src/app.ts`, `src/ui/*.ts`, `src/util/keptQuery.ts`, `src/api/client.ts`, `mock-server/*.ts`, `tests/**`)
- Modify: `docs/ARCHITECTURE.md` ("Directory layout")

**Interfaces:**
- Consumes: nothing.
- Produces: free paths `src/query/{types,tree,validate,summary,drop,issues,saved}.ts`, `src/api/request.ts`; `src/api/types.ts` still exports `RequestScalar`, `RequestValue`, `SavedValue` (shared by old and new) and everything not about query trees; `src/api/legacy/types.ts` exports the old `QueryRequest`, `RequestNode`, `RequestGroup`, `RequestCondition`, `SavedQueryRequest`, `SavedQueryResponse`, `SavedNode`, `SavedGroup`, `SavedCondition`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/query/legacy src/api/legacy tests/query/legacy
git mv src/query/types.ts src/query/tree.ts src/query/validate.ts src/query/summary.ts \
  src/query/drop.ts src/query/conditionEdit.ts src/query/issues.ts src/query/saved.ts src/query/legacy/
git mv tests/query/tree.test.ts tests/query/validate.test.ts tests/query/summary.test.ts \
  tests/query/drop.test.ts tests/query/conditionEdit.test.ts tests/query/issues.test.ts \
  tests/query/saved.test.ts tests/query/legacy/
git mv src/api/request.ts src/api/legacy/request.ts
```

- [ ] **Step 2: Split the wire types**

In `src/api/types.ts`, cut the interfaces `QueryRequest`, `RequestNode`, `RequestGroup`, `RequestCondition` (section "the body of POST …/filter/validate and POST …/filter/execute") and `SavedQueryRequest`, `SavedQueryResponse`, `SavedNode`, `SavedGroup`, `SavedCondition` (section "saved queries") and paste them, with their doc comments, into a new `src/api/legacy/types.ts` that starts with:

```ts
// The query-tree types of the wire format before facet blocks
// (docs/superpowers/specs/2026-10-27-facet-blocks-design.md). The app still
// sends these; plan A2 switches it to the new ones in ../types.ts and deletes
// this file.
import type { RequestValue, SavedValue } from "../types";
```

Leave `RequestScalar`, `RequestValue` and `SavedValue` in `src/api/types.ts` (both shapes use them; `src/api/contract.ts` imports `SavedValue`).

- [ ] **Step 3: Split the saved-query reader**

Move `toSavedQuery`, `toSavedNode`, `toSavedGroup`, `toSavedCondition` and the comment block above them from `src/api/response.ts` into a new `src/api/legacy/savedResponse.ts`, with the imports they need (`SavedQueryResponse`, `SavedGroup`, `SavedNode`, `SavedCondition` from `./types`; `ResponseObject` from `../contract`; `SavedQuery` from `../../model`; `groupOf`, `newCondition` from `../../query/legacy/tree`; `Condition`, `Group`, `QueryNode` from `../../query/legacy/types`). In `src/api/client.ts` import `toSavedQuery` from `./legacy/savedResponse` and `toQueryRequest`, `toSavedQueryRequest` from `./legacy/request`.

- [ ] **Step 4: Fix the import paths**

```bash
# Inside the moved src files: their neighbours moved one level up.
sed -i -E 's#from "\./(fieldCatalog|dates)"#from "../\1"#; s#from "\.\./(model|state)"#from "../../\1"#' src/query/legacy/*.ts
sed -i -E 's#from "\./types"#from "./types"#; s#from "\.\./model"#from "../../model"#; s#from "\.\./query/types"#from "../../query/legacy/types"#' src/api/legacy/request.ts
# Inside the moved tests: one level deeper.
sed -i -E 's#"\.\./\.\./src/#"../../../src/#g; s#"\.\./(savedQueryFixtures|dateCases|statsFixtures)"#"../../\1"#g' tests/query/legacy/*.ts
# Everywhere: the eight modules now live in legacy/.
grep -rlE 'query/(types|tree|validate|summary|drop|conditionEdit|issues|saved)"' src tests mock-server \
  | xargs sed -i -E 's#query/(types|tree|validate|summary|drop|conditionEdit|issues|saved)"#query/legacy/\1"#g'
npx tsc --noEmit
```

The last `sed` also rewrites imports inside `src/query/legacy/` (e.g. `"./tree"` is untouched because it has no `query/` prefix — good). Fix whatever `tsc` still reports by hand; expected leftovers: `mock-server/*.ts` and `tests/**` importing the moved wire types from `../src/api/types` (import them from `../src/api/legacy/types` instead), and `tests/api/request.test.ts` importing `../../src/api/request` (→ `../../src/api/legacy/request`; move that test to `tests/api/legacy/request.test.ts` if you prefer, fixing its relative paths).

- [ ] **Step 5: Update "Directory layout" in `docs/ARCHITECTURE.md`**

Under `query/`, put the eight moved entries (`types.ts` … `summary.ts`, keeping `fieldCatalog.ts` and `dates.ts` where they are) under a new line `legacy/` indented one more level, and add above them:

```
    legacy/            The query model before facet blocks. The app still runs on it until plan A2
                       (docs/superpowers/plans/2026-10-27-facet-blocks-a1-model.md) switches it over
                       and deletes this folder; new code goes in the files next to it.
```

Do the same for `api/request.ts` (now `api/legacy/request.ts`, plus `legacy/types.ts` and `legacy/savedResponse.ts`).

- [ ] **Step 6: Run the checks**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: all pass, same test count as before the move (1439 on this branch).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move the old query model into legacy/ folders

No behaviour change: makes room for the facet-block model at the final
paths (docs/superpowers/plans/2026-10-27-facet-blocks-a1-model.md).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The new query types and tree edits

**Files:**
- Create: `src/query/types.ts`
- Create: `src/query/tree.ts`
- Test: `tests/query/tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  - `types.ts`: `LogicalOperator`, `FieldCondition`, `FacetBlock`, `Group`, `QueryNode = Group | FacetBlock`, `Issue` (same as legacy).
  - `tree.ts`: `NodePatch`; `emptyQuery(): Group`; `newGroup(): Group`; `groupOf(children: QueryNode[], operator?: LogicalOperator): Group`; `newBlock(facetId: string): FacetBlock`; `newFieldCondition(fieldId: string, operatorId: string | null, value: unknown): FieldCondition`; `addChild(tree: Group, parentId: string, node: QueryNode): Group`; `updateNode(tree: Group, nodeId: string, patch: NodePatch): Group`; `removeNode(tree: Group, nodeId: string): Group`; `findNode(tree: QueryNode, nodeId: string): QueryNode | null`; `setFieldCondition(tree: Group, blockId: string, condition: FieldCondition): Group`; `clearFieldCondition(tree: Group, blockId: string, fieldId: string): Group`; `countBlocks(tree: QueryNode): number`; `sameSemantics(a: QueryNode, b: QueryNode): boolean`; `sameTree(a: QueryNode, b: QueryNode): boolean`; `insertNodes(tree: Group, targetId: string, nodes: QueryNode[]): Group`; `moveNode(tree: Group, nodeId: string, targetId: string): Group | null`; `groupContents(tree: Group, groupId: string): Group`; `UNGROUP_BLOCKED_MESSAGE`; `Direction = "up" | "down"`; `positionOf(tree: Group, nodeId: string): { index: number; count: number } | null`; `moveSibling(tree: Group, nodeId: string, direction: Direction): Group | null`; `ungroupBlocker(tree: Group, groupId: string): string | null`; `ungroup(tree: Group, groupId: string): Group | null`.

- [ ] **Step 1: Write the types**

`src/query/types.ts`:

```ts
// The query as the builder holds it (docs/superpowers/specs/2026-10-27-facet-blocks-design.md,
// section 3). Every `…Id` holds the `id` of a facet, field or operator
// (docs/ARCHITECTURE.md, "Naming"); only a node's own `id` is made up by the
// frontend (tree.ts).

export type LogicalOperator = "AND" | "OR";

/**
 * One set field of a facet block. A field the user has not set has no
 * FieldCondition at all: "not filtered" is the absence of a condition, so it is
 * never sent and never rewritten.
 */
export interface FieldCondition {
  kind: "condition";
  /** Generated by tree.ts; ties the row and its issues to this condition. */
  id: string;
  /** The field's own `Field.id` within the block's facet. */
  fieldId: string;
  /** The chosen operator's `CatalogOperator.id`, e.g. "gt". Null only in a
   *  saved query read back unfinished; the builder always sets one. */
  operatorId: string | null;
  /** Shaped by the operator's arity: nothing ("none"), one value, a [from, to]
   *  pair ("two") or a list ("many"). validate.ts checks it. */
  value: unknown;
}

/**
 * One facet of the query. It means: the event has (or, when `negated`, has
 * no) occurrence of the facet in which ALL / ANY of the set fields match.
 * With no conditions: the facet is present (or absent).
 */
export interface FacetBlock {
  kind: "facet";
  id: string;
  /** Fixed when the block is added: its rows belong to this facet. */
  facetId: string;
  /** false: "Has", true: "Has no". */
  negated: boolean;
  /** How the set fields combine, within one occurrence. */
  operator: LogicalOperator;
  /** At most one per `fieldId`. */
  conditions: FieldCondition[];
  /** Folded to its header and a one-line summary. Display only. */
  collapsed?: boolean;
}

export interface Group {
  kind: "group";
  id: string;
  operator: LogicalOperator;
  children: QueryNode[];
  collapsed?: boolean;
}

/** What groups hold, and what can be moved: groups and facet blocks. */
export type QueryNode = Group | FacetBlock;

/** Something that stops the query from running. Any issue blocks Run. */
export interface Issue {
  /** A group's, a block's or a field condition's id. */
  nodeId: string;
  message: string;
  /**
   * "incomplete": something the user simply hasn't filled in yet — shown as a
   * quiet hint. "invalid": the query refers to something that cannot work —
   * shown in red.
   */
  kind: "incomplete" | "invalid";
  /** True for a problem a database found (src/query/issues.ts, serverIssues). */
  fromServer?: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

`tests/query/tree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  addChild,
  clearFieldCondition,
  countBlocks,
  emptyQuery,
  findNode,
  groupContents,
  groupOf,
  insertNodes,
  moveNode,
  moveSibling,
  newBlock,
  newFieldCondition,
  newGroup,
  positionOf,
  removeNode,
  sameSemantics,
  sameTree,
  setFieldCondition,
  ungroup,
  ungroupBlocker,
  updateNode,
} from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";

/** A root holding two blocks and a sub-group with a third. */
function sample() {
  const a = newBlock("thing");
  const b = newBlock("other");
  const c = newBlock("thing");
  const inner = groupOf([c], "OR");
  const root: Group = { ...emptyQuery(), children: [a, b, inner] };
  return { root, a, b, c, inner };
}

describe("new nodes", () => {
  it("starts with an empty ALL root and makes ids by kind", () => {
    const root = emptyQuery();
    expect(root).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(root.id).toMatch(/^g-/);
    expect(newBlock("thing")).toMatchObject({
      kind: "facet",
      facetId: "thing",
      negated: false,
      operator: "AND",
      conditions: [],
    });
    expect(newBlock("thing").id).toMatch(/^f-/);
    expect(newFieldCondition("size", "gt", 3).id).toMatch(/^c-/);
  });

  it("gives every node its own id", () => {
    expect(newBlock("x").id).not.toBe(newBlock("x").id);
  });

  it("makes an empty group for + Group", () => {
    expect(newGroup()).toMatchObject({ kind: "group", operator: "AND", children: [] });
  });
});

describe("editing", () => {
  it("adds, updates and removes nodes without changing the old tree", () => {
    const { root, a, inner } = sample();
    const block = newBlock("third");
    const added = addChild(root, inner.id, block);
    expect((findNode(added, inner.id) as Group).children).toHaveLength(2);
    expect(inner.children).toHaveLength(1);
    const negated = updateNode(added, a.id, { negated: true });
    expect(findNode(negated, a.id)).toMatchObject({ negated: true });
    expect(findNode(removeNode(negated, a.id), a.id)).toBeNull();
  });

  it("sets a field condition, replacing the same field's, and clears it", () => {
    const { root, a } = sample();
    const first = newFieldCondition("size", "gt", 3);
    const once = setFieldCondition(root, a.id, first);
    const again = setFieldCondition(once, a.id, { ...first, operatorId: "lt", value: 9 });
    const block = findNode(again, a.id) as FacetBlock;
    expect(block.conditions).toEqual([{ ...first, operatorId: "lt", value: 9 }]);
    const other = setFieldCondition(again, a.id, newFieldCondition("name", "eq", "x"));
    expect((findNode(other, a.id) as FacetBlock).conditions.map((c) => c.fieldId)).toEqual([
      "size",
      "name",
    ]);
    const cleared = clearFieldCondition(other, a.id, "size");
    expect((findNode(cleared, a.id) as FacetBlock).conditions.map((c) => c.fieldId)).toEqual([
      "name",
    ]);
  });

  it("counts blocks at any depth", () => {
    expect(countBlocks(sample().root)).toBe(3);
    expect(countBlocks(emptyQuery())).toBe(0);
  });

  it("tells a fold from a real edit", () => {
    const { root, a } = sample();
    const folded = updateNode(root, a.id, { collapsed: true });
    expect(sameSemantics(root, folded)).toBe(true);
    expect(sameTree(root, folded)).toBe(false);
    expect(sameSemantics(root, updateNode(root, a.id, { negated: true }))).toBe(false);
  });
});

describe("placing and moving", () => {
  it("inserts at the end of a group, or just before a block", () => {
    const { root, a, b } = sample();
    const n = newBlock("new");
    expect(insertNodes(root, root.id, [n]).children.at(-1)).toBe(n);
    expect(insertNodes(root, b.id, [n]).children.map((c) => c.id)).toEqual([
      a.id,
      n.id,
      b.id,
      root.children[2]!.id,
    ]);
    expect(insertNodes(root, "nope", [n])).toBe(root);
  });

  it("moves a block into a group and refuses impossible moves", () => {
    const { root, a, inner } = sample();
    const moved = moveNode(root, a.id, inner.id)!;
    expect((findNode(moved, inner.id) as Group).children.at(-1)!.id).toBe(a.id);
    expect(moveNode(root, root.id, a.id)).toBeNull();
    expect(moveNode(root, inner.id, inner.children[0]!.id)).toBeNull();
    expect(moveNode(root, "nope", a.id)).toBeNull();
  });

  it("swaps siblings and says where a node stands", () => {
    const { root, a, b } = sample();
    const swapped = moveSibling(root, b.id, "up")!;
    expect(swapped.children.slice(0, 2).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(positionOf(swapped, b.id)).toEqual({ index: 1, count: 3 });
    expect(moveSibling(root, a.id, "up")).toBeNull();
  });
});

describe("grouping", () => {
  it("groups a group's contents and ungroups them again without changing the meaning", () => {
    const { root } = sample();
    const grouped = groupContents(root, root.id);
    expect(grouped.children).toHaveLength(1);
    const innerId = grouped.children[0]!.id;
    expect(ungroupBlocker(grouped, innerId)).toBeNull();
    expect(ungroup(grouped, innerId)!.children.map((c) => c.id)).toEqual(
      root.children.map((c) => c.id),
    );
  });

  it("refuses to ungroup when the meaning would change", () => {
    const { root, inner } = sample();
    const two = addChild(root, inner.id, newBlock("more")); // inner: OR of two, root: AND
    expect(ungroupBlocker(two, inner.id)).toMatch(/both ALL or both ANY/);
    expect(ungroup(two, inner.id)).toBeNull();
    expect(ungroupBlocker(two, two.id)).toBe("The whole query can't be ungrouped.");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/query/tree.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/query/tree"`.

- [ ] **Step 4: Write `src/query/tree.ts`**

```ts
import type { FacetBlock, FieldCondition, Group, LogicalOperator, QueryNode } from "./types";

// Pure, immutable edits of the query (docs/ARCHITECTURE.md, "The query model"):
// every edit reads `state.query`, calls one function here and writes the new
// tree back. Only new nodes get fresh ids. Field conditions live inside facet
// blocks and are never moved on their own (spec, decision 8).

export type NodePatch = Partial<Pick<Group, "operator" | "collapsed">> &
  Partial<Pick<FacetBlock, "negated">>;

let counter = 0;
/** A fresh id: "g-…" for a group, "f-…" for a facet block, "c-…" for a field condition. */
function id(prefix: "g" | "f" | "c"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** The starting query: an empty ALL group, the root. It is "not finished",
 *  not invalid (validate.ts): the builder offers "+ Facet" in it. */
export function emptyQuery(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** What "+ Group" adds: an empty ALL group with its own "+ Facet". */
export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** A new, open group holding `children`: how a tag's facets arrive ("Add
 *  all"), so a misplaced "Add all" is moved or removed in one go, and how a
 *  saved group is read back (with a fresh id). */
export function groupOf(children: QueryNode[], operator: LogicalOperator = "AND"): Group {
  return { kind: "group", id: id("g"), operator, children };
}

/** A new block for a facet: "Has", ALL, nothing set yet. */
export function newBlock(facetId: string): FacetBlock {
  return { kind: "facet", id: id("f"), facetId, negated: false, operator: "AND", conditions: [] };
}

export function newFieldCondition(
  fieldId: string,
  operatorId: string | null,
  value: unknown,
): FieldCondition {
  return { kind: "condition", id: id("c"), fieldId, operatorId, value };
}

/** A copy of `node` with `fn` applied to every group and block (post-order).
 *  Blocks are leaves here: their conditions are edited through the block. */
function mapTree(node: QueryNode, fn: (n: QueryNode) => QueryNode): QueryNode {
  if (node.kind === "group") {
    return fn({ ...node, children: node.children.map((c) => mapTree(c, fn)) });
  }
  return fn({ ...node });
}

export function addChild(tree: Group, parentId: string, node: QueryNode): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === parentId ? { ...n, children: [...n.children, node] } : n,
  ) as Group;
}

export function updateNode(tree: Group, nodeId: string, patch: NodePatch): Group {
  return mapTree(tree, (n) => (n.id === nodeId ? ({ ...n, ...patch } as QueryNode) : n)) as Group;
}

export function removeNode(tree: Group, nodeId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" ? { ...n, children: n.children.filter((c) => c.id !== nodeId) } : n,
  ) as Group;
}

/** The group or block with this id, or null. (Field conditions are found
 *  through their block: `block.conditions`.) */
export function findNode(tree: QueryNode, nodeId: string): QueryNode | null {
  if (tree.id === nodeId) return tree;
  if (tree.kind === "group") {
    for (const child of tree.children) {
      const hit = findNode(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

/** Block `blockId` with `condition` for its field: replacing the condition
 *  the field had (a block holds at most one per field), or added at the end. */
export function setFieldCondition(tree: Group, blockId: string, condition: FieldCondition): Group {
  return mapTree(tree, (n) => {
    if (n.kind !== "facet" || n.id !== blockId) return n;
    const at = n.conditions.findIndex((c) => c.fieldId === condition.fieldId);
    const conditions = [...n.conditions];
    if (at === -1) conditions.push(condition);
    else conditions[at] = condition;
    return { ...n, conditions };
  }) as Group;
}

/** Block `blockId` without a condition on `fieldId`: the row is "not filtered" again. */
export function clearFieldCondition(tree: Group, blockId: string, fieldId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "facet" && n.id === blockId
      ? { ...n, conditions: n.conditions.filter((c) => c.fieldId !== fieldId) }
      : n,
  ) as Group;
}

export function countBlocks(tree: QueryNode): number {
  if (tree.kind === "facet") return 1;
  return tree.children.reduce((sum, c) => sum + countBlocks(c), 0);
}

/**
 * Whether two trees filter the same way, i.e. differ at most in `collapsed`:
 * a display-only flag, not part of what the query means. Compares the two as
 * JSON with every `collapsed` left out.
 */
export function sameSemantics(a: QueryNode, b: QueryNode): boolean {
  const withoutCollapsed = (key: string, value: unknown) =>
    key === "collapsed" ? undefined : value;
  return JSON.stringify(a, withoutCollapsed) === JSON.stringify(b, withoutCollapsed);
}

/** Whether two trees are identical, `collapsed` included: nothing on screen
 *  would change. Tells a move that did something from one that didn't. */
export function sameTree(a: QueryNode, b: QueryNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Put `nodes` where a drop on `targetId` lands: at the end of the target if it
 * is a group, otherwise just before the target block in its parent. An
 * unknown target changes nothing.
 */
export function insertNodes(tree: Group, targetId: string, nodes: QueryNode[]): Group {
  const target = findNode(tree, targetId);
  if (!target) return tree;
  if (target.kind === "group") {
    return mapTree(tree, (n) =>
      n.kind === "group" && n.id === targetId ? { ...n, children: [...n.children, ...nodes] } : n,
    ) as Group;
  }
  return mapTree(tree, (n) => {
    if (n.kind !== "group") return n;
    const at = n.children.findIndex((c) => c.id === targetId);
    if (at === -1) return n;
    const children = [...n.children];
    children.splice(at, 0, ...nodes);
    return { ...n, children };
  }) as Group;
}

/**
 * Move `nodeId` to where a drop on `targetId` lands (see `insertNodes`).
 * Returns null when the move is impossible: an unknown id, the root, or a
 * group moved into itself or something inside it.
 */
export function moveNode(tree: Group, nodeId: string, targetId: string): Group | null {
  const node = findNode(tree, nodeId);
  if (!node || nodeId === tree.id || !findNode(tree, targetId)) return null;
  if (findNode(node, targetId)) return null; // the target is the node itself or inside it
  return insertNodes(removeNode(tree, nodeId), targetId, [node]);
}

/**
 * "Group contents": the group's children move into one new group, with the
 * same ALL/ANY, which becomes the group's only child. The query means the same
 * afterwards. An unknown id (or a block's) changes nothing.
 */
export function groupContents(tree: Group, groupId: string): Group {
  const target = findNode(tree, groupId);
  if (!target || target.kind !== "group") return tree;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === groupId
      ? { ...n, children: [groupOf(n.children, n.operator)] }
      : n,
  ) as Group;
}

export const UNGROUP_BLOCKED_MESSAGE =
  "Ungroup works only when this group and the one around it are both ALL or both ANY, or when it holds one item.";

export type Direction = "up" | "down";

/** The group that holds `nodeId` directly, or null (the root, or unknown). */
function parentOf(tree: Group, nodeId: string): Group | null {
  for (const child of tree.children) {
    if (child.id === nodeId) return tree;
    if (child.kind === "group") {
      const hit = parentOf(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

/** Where `nodeId` stands among its siblings (`index` counts from 1), or null
 *  for the root and unknown ids. */
export function positionOf(tree: Group, nodeId: string): { index: number; count: number } | null {
  const parent = parentOf(tree, nodeId);
  if (!parent) return null;
  return {
    index: parent.children.findIndex((c) => c.id === nodeId) + 1,
    count: parent.children.length,
  };
}

/**
 * Swap `nodeId` with its previous ("up") or next ("down") sibling: the Move
 * up / Move down buttons. Never changes which group a node is in. Null when
 * there is nothing to swap with, for the root and for unknown ids.
 */
export function moveSibling(tree: Group, nodeId: string, direction: Direction): Group | null {
  const parent = parentOf(tree, nodeId);
  if (!parent) return null;
  const from = parent.children.findIndex((c) => c.id === nodeId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= parent.children.length) return null;
  return mapTree(tree, (n) => {
    if (n.kind !== "group" || n.id !== parent.id) return n;
    const children = [...n.children];
    [children[from], children[to]] = [children[to]!, children[from]!];
    return { ...n, children };
  }) as Group;
}

/**
 * Why `groupId` can't be ungrouped, or null if it can. Ungrouping must never
 * change what the query means: that holds when the group combines its items
 * the same way as its parent, or when it holds only one item.
 */
export function ungroupBlocker(tree: Group, groupId: string): string | null {
  if (groupId === tree.id) return "The whole query can't be ungrouped.";
  const node = findNode(tree, groupId);
  const parent = parentOf(tree, groupId);
  if (!node || node.kind !== "group" || !parent) return "That group is no longer in the query.";
  if (node.operator === parent.operator || node.children.length === 1) return null;
  return UNGROUP_BLOCKED_MESSAGE;
}

/** Put `groupId`'s children in its place in its parent; null when `ungroupBlocker` says no. */
export function ungroup(tree: Group, groupId: string): Group | null {
  if (ungroupBlocker(tree, groupId) !== null) return null;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.children.some((c) => c.id === groupId)
      ? {
          ...n,
          children: n.children.flatMap((c) =>
            c.id === groupId && c.kind === "group" ? c.children : [c],
          ),
        }
      : n,
  ) as Group;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/query/tree.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add src/query/types.ts src/query/tree.ts tests/query/tree.test.ts
git commit -m "Facet blocks: the new query types and tree edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The `not_in` operator, and validation of blocks

**Files:**
- Modify: `src/query/fieldCatalog.ts` (`OPERATORS`, `OPERATOR_PROFILE`)
- Modify: `tests/query/fieldCatalog.test.ts` (the operator lists in "offers operators by value type only")
- Modify: `mock-server/evaluate.ts` (`conditionMatches`: `not_in`)
- Modify: `tests/mock-server/evaluate.test.ts`
- Create: `src/query/validate.ts`
- Test: `tests/query/validate.test.ts`
- Modify: `docs/ARCHITECTURE.md` ("Wire format of the query": the arity table)

**Interfaces:**
- Consumes: Task 2 types (`FacetBlock`, `FieldCondition`, `Group`, `Issue`, `QueryNode`).
- Produces: `validateQuery(tree: Group, catalog: FieldCatalog): Issue[]`; `isBlankValue(v: unknown): boolean`; operator `{ id: "not_in", name: "Is none of", arity: "many" }`.

- [ ] **Step 1: Write the failing tests**

In `tests/query/fieldCatalog.test.ts`, "offers operators by value type only": insert `"not_in"` right after `"in"` in the VARCHAR and BIGINT lists. Add:

```ts
  it("offers Is none of wherever it offers Is any of", () => {
    expect(findOperator("not_in")).toEqual({ id: "not_in", name: "Is none of", arity: "many" });
  });
```

(import `findOperator` from `../../src/query/fieldCatalog` if the file does not yet.)

In `tests/mock-server/evaluate.test.ts`, next to the existing `in` case, add a case the same way the file builds rows and conditions (copy the nearest `in` test and change the operator):

```ts
  it("not_in matches a value that is none of the list", () => {
    const row = { id: 1, __db: "a", [rowKey("thing", "size")]: 3 };
    const cond = (value: unknown) =>
      ({ kind: "condition", id: "c", facet_id: "thing", field_id: "size", operator_id: "not_in", value }) as RequestCondition;
    expect(matches(cond([1, 2]), row)).toBe(true);
    expect(matches(cond([3, 4]), row)).toBe(false);
  });
```

`tests/query/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateQuery } from "../../src/query/validate";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, fields: [string, string][]): Facet =>
  ({
    id,
    name: id,
    tags: [],
    fields: fields.map(([fid, typeName]) => ({ id: fid, name: fid, typeName, values: [] })),
  }) as unknown as Facet;
const catalog = buildFieldCatalog([
  facet("thing", [
    ["size", "BIGINT"],
    ["label", "VARCHAR"],
  ]),
]);

const block = (...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock("thing"),
  conditions,
});
const query = (...children: Group["children"]): Group => ({ ...emptyQuery(), children });
const issues = (q: Group) => validateQuery(q, catalog).map((i) => [i.kind, i.message]);

describe("validateQuery with facet blocks", () => {
  it("accepts an empty root: not finished, but nothing to fix", () => {
    expect(issues(emptyQuery())).toEqual([]);
  });

  it("asks for a facet in an empty group below the root", () => {
    expect(issues(query(groupOf([])))).toEqual([["incomplete", "Add a facet to this group."]]);
  });

  it("accepts a block with nothing set (the facet is present / absent)", () => {
    expect(issues(query(block()))).toEqual([]);
  });

  it("rejects a block for an unknown facet", () => {
    expect(issues(query({ ...newBlock("nope") }))).toEqual([["invalid", "Unknown facet."]]);
  });

  it("checks every set field", () => {
    expect(issues(query(block(newFieldCondition("size", "gt", 3))))).toEqual([]);
    expect(issues(query(block(newFieldCondition("size", "gt", null))))).toEqual([
      ["incomplete", "Enter a value."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "gt", "big"))))).toEqual([
      ["invalid", "Enter a number."],
    ]);
    expect(issues(query(block(newFieldCondition("nope", "eq", 1))))).toEqual([
      ["invalid", "Unknown field."],
    ]);
    expect(issues(query(block(newFieldCondition("size", null, null))))).toEqual([
      ["incomplete", "Choose an operator."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "contains", "x"))))).toEqual([
      ["invalid", "That operator isn't available for this field."],
    ]);
    expect(issues(query(block(newFieldCondition("size", "between", [9, 2]))))).toEqual([
      ["invalid", "From must not be greater than To."],
    ]);
  });

  it("checks not_in like in", () => {
    expect(issues(query(block(newFieldCondition("label", "not_in", ["a", "b"]))))).toEqual([]);
    expect(issues(query(block(newFieldCondition("label", "not_in", []))))).toEqual([
      ["incomplete", "Choose at least one value."],
    ]);
  });

  it("rejects a field set twice in one block (only a tampered saved query can do that)", () => {
    const twice = block(newFieldCondition("size", "gt", 1), newFieldCondition("size", "lt", 9));
    expect(issues(query(twice))).toEqual([["invalid", "This field is set twice in this facet."]]);
  });

  it("points each issue at the condition, the block or the group", () => {
    const c = newFieldCondition("size", "gt", null);
    const b = block(c);
    const unknown = newBlock("nope");
    const g = groupOf([]);
    const ids = validateQuery(query(b, unknown, g), catalog).map((i) => i.nodeId);
    expect(ids).toEqual([c.id, unknown.id, g.id]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/query/validate.test.ts tests/query/fieldCatalog.test.ts tests/mock-server/evaluate.test.ts`
Expected: FAIL — `validate.ts` cannot be resolved; `not_in` missing from the operator lists; the mock's `not_in` case returns false.

- [ ] **Step 3: Add the operator**

In `src/query/fieldCatalog.ts`, in `OPERATORS` right after the `in` entry:

```ts
  { id: "not_in", name: "Is none of", arity: "many" },
```

and in `OPERATOR_PROFILE` put `"not_in"` right after `"in"` for `string` and `number`.

In `mock-server/evaluate.ts`, `conditionMatches`, after `case "in":`:

```ts
    case "not_in":
      return Array.isArray(c.value) && !c.value.includes(v as never);
```

- [ ] **Step 4: Write `src/query/validate.ts`**

```ts
import {
  findFacet,
  findField,
  findOperator,
  type Arity,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { isUtcTimestamp } from "./dates";
import type { FacetBlock, FieldCondition, Group, Issue, QueryNode } from "./types";

/** Whether a single value is still unset: nothing chosen or typed yet. */
export function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function incomplete(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "incomplete" };
}

function invalid(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "invalid" };
}

/** What the user still has to fill in for the operator's arity, or null. */
function shapeProblem(arity: Arity, v: unknown): string | null {
  switch (arity) {
    case "none": // checked before this, in checkCondition
      return null;
    case "one":
      return isBlankValue(v) ? "Enter a value." : null;
    case "two":
      return Array.isArray(v) && v.length === 2 && !v.some(isBlankValue)
        ? null
        : "Enter both values.";
    case "many":
      // An empty list is the normal "nothing chosen yet"; a blank item inside
      // a list only comes from a tampered saved query.
      if (!Array.isArray(v) || v.length === 0) return "Choose at least one value.";
      return v.some(isBlankValue) ? "Remove the empty value." : null;
  }
}

/** Why a single value isn't of the field's type, or null. Values off a
 *  field's pick-list are fine: the list can be out of date. */
function typeProblem(valueType: ValueType, v: unknown): string | null {
  switch (valueType) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "Enter a number.";
    case "boolean":
      return typeof v === "boolean" ? null : "Choose true or false.";
    case "string":
      return typeof v === "string" ? null : "Enter text.";
    case "date":
      return isUtcTimestamp(v)
        ? null
        : "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z.";
  }
}

function checkCondition(
  block: FacetBlock,
  c: FieldCondition,
  catalog: FieldCatalog,
  out: Issue[],
): void {
  const fieldDef = findField(catalog, block.facetId, c.fieldId);
  if (!fieldDef) {
    out.push(invalid(c.id, "Unknown field."));
    return;
  }
  if (!c.operatorId) {
    out.push(incomplete(c.id, "Choose an operator."));
    return;
  }
  const op = findOperator(c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!fieldDef.operatorIds.includes(c.operatorId)) {
    out.push(invalid(c.id, "That operator isn't available for this field."));
    return;
  }
  // A no-value operator's value goes out as `null` (docs/ARCHITECTURE.md,
  // "Wire format of the query"); anything else came from a tampered saved query.
  if (op.arity === "none") {
    if (c.value !== null) out.push(invalid(c.id, "This operator takes no value."));
    return;
  }
  const shape = shapeProblem(op.arity, c.value);
  if (shape) {
    out.push(incomplete(c.id, shape));
    return;
  }
  // Each single value: the value itself, each end of a range, each list item.
  const values = op.arity === "one" ? [c.value] : (c.value as unknown[]);
  const wrongType = values.map((v) => typeProblem(fieldDef.valueType, v)).find(Boolean);
  if (wrongType) {
    out.push(invalid(c.id, wrongType));
    return;
  }
  // A backwards number range matches nothing. A date range's order is the
  // backend's call: with partial timestamps, "in order" is its interpretation.
  if (op.arity === "two" && fieldDef.valueType === "number") {
    const [from, to] = c.value as [number, number];
    if (from > to) out.push(invalid(c.id, "From must not be greater than To."));
  }
}

/** A block with nothing set is fine: it asks whether the facet is present
 *  (or absent). Unset fields are simply not in `conditions`. */
function checkBlock(block: FacetBlock, catalog: FieldCatalog, out: Issue[]): void {
  if (!findFacet(catalog, block.facetId)) {
    out.push(invalid(block.id, "Unknown facet."));
    return;
  }
  const seen = new Set<string>();
  for (const c of block.conditions) {
    // The builder keeps one condition per field; two only come from a
    // tampered saved query, and the row could show only one of them.
    if (seen.has(c.fieldId)) {
      out.push(invalid(c.id, "This field is set twice in this facet."));
      continue;
    }
    seen.add(c.fieldId);
    checkCondition(block, c, catalog, out);
  }
}

function walk(node: QueryNode, isRoot: boolean, catalog: FieldCatalog, out: Issue[]): void {
  if (node.kind === "facet") {
    checkBlock(node, catalog, out);
    return;
  }
  // An empty root is the starting query: "not finished" without a message
  // (runBlocker in state.ts keeps Run off; the footer says what to do).
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a facet to this group."));
  }
  for (const child of node.children) walk(child, false, catalog, out);
}

export function validateQuery(tree: Group, catalog: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, catalog, out);
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/query/validate.test.ts tests/query/fieldCatalog.test.ts tests/mock-server/evaluate.test.ts`
Expected: PASS. If `facet(...)` in the test does not match `Facet` in `src/model.ts`, adjust the helper to the real field names (read `src/model.ts`), not the assertions.

- [ ] **Step 6: Update the doc**

In `docs/ARCHITECTURE.md`, "Wire format of the query", change the arity row to:

```
| `many` (`in`, `not_in`) | a non-empty list with no blank item |
```

and add after the table: "`not_in` ("Is none of") matches a value that is none of the list. **Backend hand-off:** implement `not_in`."

- [ ] **Step 7: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass (the old builder now also offers "Is none of"; the mock answers it).

```bash
git add -A
git commit -m "Facet blocks: not_in (Is none of) and validation of blocks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The summary line

**Files:**
- Create: `src/query/summary.ts`
- Test: `tests/query/summary.test.ts`

**Interfaces:**
- Consumes: Task 2 types; `isBlankValue` (Task 3); `fieldsOfFacet`, `findFacet`, `findField`, `findOperator` from `fieldCatalog.ts`.
- Produces: `queryToText(tree: QueryNode, catalog: FieldCatalog): string`; `blockText(block: FacetBlock, catalog: FieldCatalog): string` (plan A2 uses it for a folded block).

The format is fixed by the spec, section 5 "Summary" — short, because it is often cut off.

- [ ] **Step 1: Write the failing tests**

`tests/query/summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockText, queryToText } from "../../src/query/summary";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, name: string, fields: [string, string][]): Facet =>
  ({
    id,
    name,
    tags: [],
    fields: fields.map(([fid, typeName]) => ({ id: fid, name: fid, typeName, values: [] })),
  }) as unknown as Facet;
const catalog = buildFieldCatalog([
  facet("thing", "Thing", [
    ["size", "BIGINT"],
    ["label", "VARCHAR"],
  ]),
  facet("other", "Other", [["when", "TIMESTAMP"]]),
]);
const block = (facetId: string, ...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock(facetId),
  conditions,
});

describe("blockText", () => {
  it("says present / absent when nothing is set", () => {
    expect(blockText(block("thing"), catalog)).toBe("Thing present");
    expect(blockText({ ...block("thing"), negated: true }, catalog)).toBe("Thing absent");
  });

  it("writes one set field without brackets", () => {
    expect(blockText(block("thing", newFieldCondition("size", "gt", 40)), catalog)).toBe(
      "Thing has size > 40",
    );
  });

  it("brackets two or more, joined by the block's ALL / ANY, in the facet's field order", () => {
    const b = block(
      "thing",
      newFieldCondition("label", "in", ["a", "b"]),
      newFieldCondition("size", "between", [20, 80]),
    );
    expect(blockText(b, catalog)).toBe("Thing has (size between (20, 80) AND label in (a, b))");
    expect(blockText({ ...b, operator: "OR", negated: true }, catalog)).toBe(
      "Thing has no (size between (20, 80) OR label in (a, b))",
    );
  });

  it("writes every operator in its short form", () => {
    const one = (operatorId: string, value: unknown, fieldId = "size") =>
      blockText(block("thing", newFieldCondition(fieldId, operatorId, value)), catalog);
    expect(one("eq", 1)).toBe("Thing has size = 1");
    expect(one("neq", 1)).toBe("Thing has size ≠ 1");
    expect(one("gte", 1)).toBe("Thing has size ≥ 1");
    expect(one("lt", 1)).toBe("Thing has size < 1");
    expect(one("lte", 1)).toBe("Thing has size ≤ 1");
    expect(one("contains", "x", "label")).toBe("Thing has label contains x");
    expect(one("not_in", ["a"], "label")).toBe("Thing has label not in (a)");
    expect(one("present", null)).toBe("Thing has size present");
    expect(one("absent", null)).toBe("Thing has size absent");
    expect(
      blockText(block("other", newFieldCondition("when", "before", "2024")), catalog),
    ).toBe("Other has when before 2024");
  });

  it("marks what is not filled in yet", () => {
    expect(blockText(block("thing", newFieldCondition("size", "gt", null)), catalog)).toBe(
      "Thing has size > (value?)",
    );
    expect(blockText(block("thing", newFieldCondition("size", null, null)), catalog)).toBe(
      "Thing has size (operator?)",
    );
    expect(blockText(block("nope"), catalog)).toBe("(facet?) present");
  });
});

describe("queryToText", () => {
  it("joins blocks with the group's ALL / ANY and brackets sub-groups", () => {
    const q: Group = {
      ...emptyQuery(),
      children: [
        block("thing", newFieldCondition("size", "gt", 40)),
        groupOf([block("other"), { ...block("thing"), negated: true }], "OR"),
      ],
    };
    expect(queryToText(q, catalog)).toBe(
      "Thing has size > 40 AND (Other present OR Thing absent)",
    );
  });

  it("names an empty query and an empty group", () => {
    expect(queryToText(emptyQuery(), catalog)).toBe("(empty query)");
    expect(queryToText({ ...emptyQuery(), children: [groupOf([])] }, catalog)).toBe("()");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/query/summary.test.ts`
Expected: FAIL — `../../src/query/summary` cannot be resolved.

- [ ] **Step 3: Write `src/query/summary.ts`**

```ts
import { fieldsOfFacet, findFacet, findField, findOperator, type FieldCatalog } from "./fieldCatalog";
import { isBlankValue } from "./validate";
import type { FacetBlock, FieldCondition, QueryNode } from "./types";

// The query in plain words, e.g. "Thing has (size > 40 AND label in (a, b))".
// Display only. As short as it can be without becoming ambiguous, because it
// is often cut off (spec, section 5 "Summary"): operators are symbols or one
// word, and a block's fields are bracketed so an AND inside a block (one
// occurrence) can't be read as the AND between two blocks.

/** Stands in for a value the user hasn't entered yet. */
const MISSING = "(value?)";

/** Each operator's short form. `between` is written "between (20, 80)", never
 *  "20–80", which can read as "twenty minus eighty" (maintainers, 2026-10-27). */
const OPERATOR_TEXT: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "before",
  after: "after",
  contains: "contains",
  between: "between",
  in: "in",
  not_in: "not in",
  present: "present",
  absent: "absent",
};

function valueText(v: unknown): string {
  return isBlankValue(v) ? MISSING : String(v);
}

/** A list or a from–to pair, in brackets: "(a, b)", "(20, 80)". */
function listText(v: unknown): string {
  return Array.isArray(v) && v.length > 0 ? `(${v.map(valueText).join(", ")})` : MISSING;
}

function conditionText(block: FacetBlock, c: FieldCondition, catalog: FieldCatalog): string {
  const name = findField(catalog, block.facetId, c.fieldId)?.fieldName ?? "(field?)";
  const op = findOperator(c.operatorId);
  if (!op) return `${name} (operator?)`;
  const opText = OPERATOR_TEXT[op.id] ?? op.name;
  switch (op.arity) {
    case "none":
      return `${name} ${opText}`;
    case "one":
      return `${name} ${opText} ${valueText(c.value)}`;
    case "two":
    case "many":
      return `${name} ${opText} ${listText(c.value)}`;
  }
}

/** The block's conditions in the facet's own field order, which is how its
 *  rows are drawn; a field the catalog no longer knows goes last. */
function inFieldOrder(block: FacetBlock, catalog: FieldCatalog): FieldCondition[] {
  const order = fieldsOfFacet(catalog, block.facetId).map((f) => f.fieldId);
  const rank = (c: FieldCondition) => {
    const at = order.indexOf(c.fieldId);
    return at === -1 ? order.length : at;
  };
  return [...block.conditions].sort((a, b) => rank(a) - rank(b));
}

/** One block in words: "Thing present", "Thing has size > 40",
 *  "Thing has no (size > 40 AND label = x)". */
export function blockText(block: FacetBlock, catalog: FieldCatalog): string {
  const facet = findFacet(catalog, block.facetId)?.name ?? "(facet?)";
  const parts = inFieldOrder(block, catalog).map((c) => conditionText(block, c, catalog));
  if (parts.length === 0) return `${facet} ${block.negated ? "absent" : "present"}`;
  const has = block.negated ? "has no" : "has";
  const inner = parts.length === 1 ? parts[0]! : `(${parts.join(` ${block.operator} `)})`;
  return `${facet} ${has} ${inner}`;
}

function nodeText(node: QueryNode, isRoot: boolean, catalog: FieldCatalog): string {
  if (node.kind === "facet") return blockText(node, catalog);
  if (node.children.length === 0) return isRoot ? "(empty query)" : "()";
  const inner = node.children.map((c) => nodeText(c, false, catalog)).join(` ${node.operator} `);
  return isRoot ? inner : `(${inner})`;
}

export function queryToText(tree: QueryNode, catalog: FieldCatalog): string {
  return nodeText(tree, true, catalog);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/query/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add src/query/summary.ts tests/query/summary.test.ts
git commit -m "Facet blocks: the short summary line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: What a drop adds, and how a field row changes

**Files:**
- Create: `src/query/drop.ts`
- Create: `src/query/fieldEdit.ts`
- Test: `tests/query/drop.test.ts`, `tests/query/fieldEdit.test.ts`

**Interfaces:**
- Consumes: Task 2 (`newBlock`, `newFieldCondition`, `groupOf`, `insertNodes`, `findNode`, `setFieldCondition`, `countBlocks`, `Direction`); `findField`, `findOperator` from `fieldCatalog.ts`.
- Produces:
  - `drop.ts`: `DRAG_MIME`, `DragItem`, `parseDragItem(text: string): DragItem | null` (unchanged from legacy); `FieldRef = { blockId: string; fieldId: string }`; `DropOutcome = { query: Group; added: QueryNode[]; select: FieldRef | null; problems: string[] }`; `dropItem(query: Group, item: Exclude<DragItem, { type: "node" }>, targetId: string, facets: Facet[], catalog: FieldCatalog): DropOutcome`; `dropNotice(problems: string[]): string | null`; `addedNodesMessage(nodes: QueryNode[]): string`; `ADDED_GROUP_MESSAGE`; `groupedMessage(count: number): string`; `UNGROUPED_MESSAGE`; `movedMessage(kind: QueryNode["kind"]): string`; `reorderedMessage(kind: QueryNode["kind"], direction: Direction, position: { index: number; count: number }): string`.
  - `fieldEdit.ts`: `defaultValueFor(field, operator): unknown`; `nextFieldCondition(existing: FieldCondition | undefined, facetId: string, fieldId: string, operatorId: string | null, catalog: FieldCatalog, readValue: (arity: Arity, valueType: ValueType) => unknown): FieldCondition | null`; `cursorAfterOperator(operatorId: string | null): "value" | null`.

Rules (spec, section 5 "Adding"): a facet → new block; a field on a block of its facet → focus that row (no tree change); elsewhere → new block with that row focused; a value → fills the row with "equals value" if that row is unset, otherwise a new block (never overwrites a choice); a tag → one ALL group of blocks (just the block for one facet). A target that isn't in the query (stale) means the root.

- [ ] **Step 1: Write the failing tests**

`tests/query/drop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  addedNodesMessage,
  dropItem,
  movedMessage,
  parseDragItem,
  reorderedMessage,
} from "../../src/query/drop";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, findNode, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: ["t"],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: ["3", "4"] },
      { id: "label", name: "label", typeName: "VARCHAR", values: ["a"] },
    ],
  },
  { id: "other", name: "Other", tags: ["t"], fields: [] },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const withBlock = () => {
  const block = newBlock("thing");
  const query: Group = { ...emptyQuery(), children: [block] };
  return { query, block };
};

describe("parseDragItem", () => {
  it("reads our own payloads and nothing else", () => {
    expect(parseDragItem('{"type":"facet","facetId":"thing"}')).toEqual({
      type: "facet",
      facetId: "thing",
    });
    expect(parseDragItem('{"type":"facet"}')).toBeNull();
    expect(parseDragItem("not json")).toBeNull();
  });
});

describe("dropItem", () => {
  it("adds a facet as a new block at the end of the group", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "thing" }, q.id, facets, catalog);
    expect(out.problems).toEqual([]);
    expect(out.query.children).toHaveLength(1);
    expect(out.query.children[0]).toMatchObject({ kind: "facet", facetId: "thing" });
    expect(out.added).toEqual(out.query.children);
    expect(out.select).toBeNull();
  });

  it("puts a drop on a block just before it", () => {
    const { query, block } = withBlock();
    const out = dropItem(query, { type: "facet", facetId: "other" }, block.id, facets, catalog);
    expect(out.query.children.map((c) => (c as FacetBlock).facetId)).toEqual(["other", "thing"]);
  });

  it("focuses the row when a field is dropped on a block of its facet", () => {
    const { query, block } = withBlock();
    const out = dropItem(
      query,
      { type: "field", facetId: "thing", fieldId: "size" },
      block.id,
      facets,
      catalog,
    );
    expect(out.query).toBe(query);
    expect(out.added).toEqual([]);
    expect(out.select).toEqual({ blockId: block.id, fieldId: "size" });
  });

  it("adds a new block for a field dropped anywhere else, and focuses its row", () => {
    const q = emptyQuery();
    const out = dropItem(
      q,
      { type: "field", facetId: "thing", fieldId: "size" },
      q.id,
      facets,
      catalog,
    );
    const added = out.query.children[0] as FacetBlock;
    expect(added.conditions).toEqual([]);
    expect(out.select).toEqual({ blockId: added.id, fieldId: "size" });
  });

  it("fills an unset row with equals value (a number field gets a number)", () => {
    const { query, block } = withBlock();
    const out = dropItem(
      query,
      { type: "value", facetId: "thing", fieldId: "size", value: "3" },
      block.id,
      facets,
      catalog,
    );
    const filled = findNode(out.query, block.id) as FacetBlock;
    expect(filled.conditions).toMatchObject([{ fieldId: "size", operatorId: "eq", value: 3 }]);
    expect(out.added).toEqual([]);
    expect(out.select).toEqual({ blockId: block.id, fieldId: "size" });
  });

  it("never overwrites a set row: a value for it becomes a new block", () => {
    const block: FacetBlock = {
      ...newBlock("thing"),
      conditions: [newFieldCondition("size", "gt", 1)],
    };
    const query: Group = { ...emptyQuery(), children: [block] };
    const out = dropItem(
      query,
      { type: "value", facetId: "thing", fieldId: "size", value: "4" },
      block.id,
      facets,
      catalog,
    );
    expect((findNode(out.query, block.id) as FacetBlock).conditions[0]!.value).toBe(1);
    expect(out.query.children).toHaveLength(2);
    expect(out.query.children[0]).toMatchObject({
      conditions: [{ fieldId: "size", operatorId: "eq", value: 4 }],
    });
  });

  it("adds a tag's facets as one ALL group of blocks", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "tag", tag: "t" }, q.id, facets, catalog);
    expect(out.query.children).toHaveLength(1);
    expect(out.query.children[0]).toMatchObject({ kind: "group", operator: "AND" });
    expect(addedNodesMessage(out.added)).toBe("Added a group of 2 facets to the query.");
  });

  it("explains what it can't add, and changes nothing", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "nope" }, q.id, facets, catalog);
    expect(out.query).toBe(q);
    expect(out.problems[0]).toMatch(/Couldn't add “nope”/);
    const value = dropItem(
      q,
      { type: "value", facetId: "thing", fieldId: "size", value: "9" },
      q.id,
      facets,
      catalog,
    );
    expect(value.problems).toEqual(["Couldn't add “9”: it is not one of size's known values."]);
  });

  it("adds at the root when the target is gone (a stale drop)", () => {
    const q = emptyQuery();
    const out = dropItem(q, { type: "facet", facetId: "thing" }, "gone", facets, catalog);
    expect(out.query.children).toHaveLength(1);
  });
});

describe("messages", () => {
  it("counts facets and names what moved", () => {
    expect(addedNodesMessage([newBlock("thing")])).toBe("Added 1 facet to the query.");
    expect(movedMessage("facet")).toBe("Moved the facet.");
    expect(reorderedMessage("facet", "up", { index: 1, count: 3 })).toBe(
      "Moved the facet up, to position 1 of 3.",
    );
  });
});
```

`tests/query/fieldEdit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cursorAfterOperator, nextFieldCondition } from "../../src/query/fieldEdit";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { newFieldCondition } from "../../src/query/tree";
import type { Facet } from "../../src/model";

const catalog = buildFieldCatalog([
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: [] },
      { id: "ok", name: "ok", typeName: "BOOLEAN", values: [] },
    ],
  },
] as unknown as Facet[]);
const never = () => {
  throw new Error("the old control must not be read");
};

describe("nextFieldCondition", () => {
  it("is null for the blank choice: the row is not filtered any more", () => {
    const c = newFieldCondition("size", "gt", 3);
    expect(nextFieldCondition(c, "thing", "size", null, catalog, never)).toBeNull();
  });

  it("starts a condition when an unset row gets an operator", () => {
    const next = nextFieldCondition(undefined, "thing", "size", "gt", catalog, never)!;
    expect(next).toMatchObject({ kind: "condition", fieldId: "size", operatorId: "gt", value: null });
    // A boolean toggle is never "unset" on screen, so its default is false.
    expect(nextFieldCondition(undefined, "thing", "ok", "eq", catalog, never)!.value).toBe(false);
  });

  it("keeps the condition's id and reads the value while the shape is the same", () => {
    const c = newFieldCondition("size", "gt", 3);
    const next = nextFieldCondition(c, "thing", "size", "lt", catalog, () => 7)!;
    expect(next).toEqual({ ...c, operatorId: "lt", value: 7 });
  });

  it("resets the value when the operator's shape changes", () => {
    const c = newFieldCondition("size", "gt", 3);
    expect(nextFieldCondition(c, "thing", "size", "between", catalog, never)!.value).toBeNull();
  });
});

describe("cursorAfterOperator", () => {
  it("goes to the value, unless the operator takes none", () => {
    expect(cursorAfterOperator("gt")).toBe("value");
    expect(cursorAfterOperator("present")).toBeNull();
    expect(cursorAfterOperator(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/query/drop.test.ts tests/query/fieldEdit.test.ts`
Expected: FAIL — the two modules cannot be resolved.

- [ ] **Step 3: Write `src/query/drop.ts`**

Copy `DRAG_MIME`, `DragItem` (with its comment), `isString` and `parseDragItem` verbatim from `src/query/legacy/drop.ts`, then add:

```ts
import type { Facet } from "../model";
import { findField, type FieldCatalog } from "./fieldCatalog";
import {
  countBlocks,
  findNode,
  groupOf,
  insertNodes,
  newBlock,
  newFieldCondition,
  setFieldCondition,
  type Direction,
} from "./tree";
import type { FacetBlock, Group, QueryNode } from "./types";

/** A field row of one block: what a drop asks the builder to focus. */
export interface FieldRef {
  blockId: string;
  fieldId: string;
}

/** What a dropped dictionary item did to the query. */
export interface DropOutcome {
  /** The new query; the same object when nothing changed. */
  query: Group;
  /** New blocks or a new group, for the announcement. Empty when the drop
   *  only focused or filled a row of an existing block. */
  added: QueryNode[];
  /** The row to focus afterwards, or null. */
  select: FieldRef | null;
  /** What couldn't be added, in words for the user. */
  problems: string[];
}

const NOT_LOADED =
  "it is not in the loaded data dictionary. The dictionary may be out of date; reload the page.";

/**
 * What dropping a dictionary item on `targetId` (a group or a block) does.
 * Never throws and never ignores anything silently: whatever can't be added
 * is explained in `problems`. Never overwrites a field the user has set.
 */
export function dropItem(
  query: Group,
  item: Exclude<DragItem, { type: "node" }>,
  targetId: string,
  facets: Facet[],
  catalog: FieldCatalog,
): DropOutcome {
  const target = findNode(query, targetId);
  // A stale drop (the target was removed meanwhile) adds at the root.
  const at = target ? targetId : query.id;
  const targetBlock = target?.kind === "facet" ? target : null;
  const refused = (problem: string): DropOutcome => ({
    query,
    added: [],
    select: null,
    problems: [problem],
  });
  const inserted = (nodes: QueryNode[], select: FieldRef | null): DropOutcome => ({
    query: insertNodes(query, at, nodes),
    added: nodes,
    select,
    problems: [],
  });

  switch (item.type) {
    case "facet": {
      if (!facets.some((f) => f.id === item.facetId)) {
        return refused(`Couldn't add “${item.facetId}”: ${NOT_LOADED}`);
      }
      return inserted([newBlock(item.facetId)], null);
    }
    case "field": {
      if (!findField(catalog, item.facetId, item.fieldId)) {
        return refused(`Couldn't add “${item.fieldId}”: ${NOT_LOADED}`);
      }
      // The block already has a row for every field of its facet: focus it.
      if (targetBlock?.facetId === item.facetId) {
        return {
          query,
          added: [],
          select: { blockId: targetBlock.id, fieldId: item.fieldId },
          problems: [],
        };
      }
      const block = newBlock(item.facetId);
      return inserted([block], { blockId: block.id, fieldId: item.fieldId });
    }
    case "value": {
      const field = findField(catalog, item.facetId, item.fieldId);
      if (!field) return refused(`Couldn't add “${item.value}”: ${NOT_LOADED}`);
      if (!field.options?.includes(item.value)) {
        return refused(
          `Couldn't add “${item.value}”: it is not one of ${field.fieldName}'s known values.`,
        );
      }
      // The pick-list holds text; a number field's value goes out as a number.
      const value = field.valueType === "number" ? Number(item.value) : item.value;
      const condition = newFieldCondition(item.fieldId, "eq", value);
      const rowIsUnset =
        targetBlock?.facetId === item.facetId &&
        !targetBlock.conditions.some((c) => c.fieldId === item.fieldId);
      if (targetBlock && rowIsUnset) {
        return {
          query: setFieldCondition(query, targetBlock.id, condition),
          added: [],
          select: { blockId: targetBlock.id, fieldId: item.fieldId },
          problems: [],
        };
      }
      // The row is set already (or the drop is elsewhere): a new block, so
      // nothing the user chose is overwritten.
      const block: FacetBlock = { ...newBlock(item.facetId), conditions: [condition] };
      return inserted([block], { blockId: block.id, fieldId: item.fieldId });
    }
    case "tag": {
      const tagged = facets.filter((f) => f.tags.includes(item.tag));
      if (tagged.length === 0) return refused(`The tag “${item.tag}” has no facets.`);
      const blocks = tagged.map((f) => newBlock(f.id));
      // Two or more facets arrive as one ALL group (2026-10-13), so a
      // misplaced "Add all" is moved or removed in one go.
      return inserted(blocks.length > 1 ? [groupOf(blocks)] : blocks, null);
    }
  }
}

/** The warning to show for a drop's problems, or null when there were none. */
export function dropNotice(problems: string[]): string | null {
  return problems.length > 0 ? problems.join(" ") : null;
}

/** "1 facet", "3 facets". (Not ui/format's countLabel: the query layer does
 *  not import from the UI.) */
function facetCount(count: number): string {
  return `${count} ${count === 1 ? "facet" : "facets"}`;
}

/** What a screen reader hears after a drop or "+ Facet" added `nodes`: the
 *  builder repaints, so nothing on screen says that something happened. */
export function addedNodesMessage(nodes: QueryNode[]): string {
  const [only] = nodes;
  if (nodes.length === 1 && only?.kind === "group") {
    return `Added a group of ${facetCount(countBlocks(only))} to the query.`;
  }
  return `Added ${facetCount(nodes.length)} to the query.`;
}

/** What a screen reader hears after the builder's own "+ Group". */
export const ADDED_GROUP_MESSAGE = "Added a group to the query.";

/** What a screen reader hears after "Group contents". */
export function groupedMessage(count: number): string {
  return count === 1 ? "Grouped 1 item." : `Grouped ${count} items.`;
}

/** What a screen reader hears after "Ungroup". */
export const UNGROUPED_MESSAGE = "Ungrouped.";

/** What a screen reader hears after a group or block was moved. */
export function movedMessage(kind: QueryNode["kind"]): string {
  return `Moved the ${kind}.`;
}

/** What a screen reader hears after Move up / Move down. */
export function reorderedMessage(
  kind: QueryNode["kind"],
  direction: Direction,
  position: { index: number; count: number },
): string {
  return `Moved the ${kind} ${direction}, to position ${position.index} of ${position.count}.`;
}
```

(Put the imports at the top of the file, above the copied `DRAG_MIME`.)

- [ ] **Step 4: Write `src/query/fieldEdit.ts`**

```ts
import {
  findField,
  findOperator,
  type Arity,
  type CatalogField,
  type CatalogOperator,
  type FieldCatalog,
  type ValueType,
} from "./fieldCatalog";
import { newFieldCondition } from "./tree";
import type { FieldCondition } from "./types";

/**
 * The value a condition holds before the user enters one. Not every control
 * can show "unset" (a boolean toggle is always true or false), so this is
 * where a field's real default lives.
 */
export function defaultValueFor(
  field: CatalogField | undefined,
  operator: CatalogOperator | undefined,
): unknown {
  if (field?.valueType === "boolean" && operator?.arity === "one") return false;
  return null;
}

/**
 * A field row after the user picked an operator or typed a value. Null means
 * "not filtered": the blank choice at the top of the operator dropdown was
 * picked, and the block no longer holds a condition for this field.
 *
 * `readValue` reads the row's value control. It is only called while that
 * control still has the right shape: after an operator change that alters the
 * arity ("Greater than" → "Between") the row still shows the old control until
 * the repaint, so the value is reset instead.
 */
export function nextFieldCondition(
  existing: FieldCondition | undefined,
  facetId: string,
  fieldId: string,
  operatorId: string | null,
  catalog: FieldCatalog,
  readValue: (arity: Arity, valueType: ValueType) => unknown,
): FieldCondition | null {
  if (!operatorId) return null;
  const field = findField(catalog, facetId, fieldId);
  const operator = findOperator(operatorId);
  let value = defaultValueFor(field, operator);
  const sameShape =
    existing !== undefined && findOperator(existing.operatorId)?.arity === operator?.arity;
  if (sameShape && field && operator) value = readValue(operator.arity, field.valueType) ?? value;
  return existing
    ? { ...existing, operatorId, value }
    : newFieldCondition(fieldId, operatorId, value);
}

/** Where the cursor goes after an operator was picked: to its value, unless
 *  the operator takes none ("present"). */
export function cursorAfterOperator(operatorId: string | null): "value" | null {
  const op = findOperator(operatorId);
  return op && op.arity !== "none" ? "value" : null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/query/drop.test.ts tests/query/fieldEdit.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add src/query/drop.ts src/query/fieldEdit.ts tests/query/drop.test.ts tests/query/fieldEdit.test.ts
git commit -m "Facet blocks: what a drop adds and how a field row changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Where issues are shown, and the saved-query comparisons

**Files:**
- Create: `src/query/issues.ts`
- Create: `src/query/saved.ts`
- Test: `tests/query/issues.test.ts`, `tests/query/saved.test.ts`

**Interfaces:**
- Consumes: Task 2 (`countBlocks`, `sameSemantics`, types); `StatsState` from `src/state.ts` (type only).
- Produces:
  - `issues.ts`: `serverIssues(stats: StatsState): Issue[]` (same behaviour as legacy); `placeIssues(query: Group, issues: Issue[]): Issue[]`.
  - `saved.ts`: `OpenSaved { id: string; name: string; note: string; query: Group; databaseIds: string[] }`; `sameName(a: string, b: string): boolean`; `isEdited(open: OpenSaved, query: Group, databaseIds: string[]): boolean`; `hasUnsavedWork(open: OpenSaved | null, query: Group, databaseIds: string[]): boolean`; `saveTarget(name: string, open: OpenSaved | null): { kind: "update"; id: string } | { kind: "create" }`.

- [ ] **Step 1: Write the failing tests**

`tests/query/issues.test.ts`:

```ts
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
```

`tests/query/saved.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasUnsavedWork, isEdited, saveTarget, type OpenSaved } from "../../src/query/saved";
import { emptyQuery, newBlock, updateNode } from "../../src/query/tree";
import type { Group } from "../../src/query/types";

const block = newBlock("thing");
const query: Group = { ...emptyQuery(), children: [block] };
const open: OpenSaved = { id: "s1", name: "Weekly", note: "", query, databaseIds: ["a", "b"] };

describe("saved-query comparisons", () => {
  it("is not edited by a fold or a different database order", () => {
    expect(isEdited(open, updateNode(query, block.id, { collapsed: true }), ["b", "a"])).toBe(
      false,
    );
  });

  it("is edited by a real change", () => {
    expect(isEdited(open, updateNode(query, block.id, { negated: true }), ["a", "b"])).toBe(true);
    expect(isEdited(open, query, ["a"])).toBe(true);
  });

  it("has unsaved work once a block exists that is not saved", () => {
    expect(hasUnsavedWork(null, emptyQuery(), [])).toBe(false);
    expect(hasUnsavedWork(null, query, [])).toBe(true);
    expect(hasUnsavedWork(open, query, ["a", "b"])).toBe(false);
  });

  it("updates under its own name, creates under another", () => {
    expect(saveTarget(" weekly ", open)).toEqual({ kind: "update", id: "s1" });
    expect(saveTarget("Monthly", open)).toEqual({ kind: "create" });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/query/issues.test.ts tests/query/saved.test.ts`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Write `src/query/issues.ts`**

Copy `withoutRepeats` and `serverIssues` (with their comments) verbatim from `src/query/legacy/issues.ts`, with these imports and this new placement code:

```ts
import type { StatsState } from "../state";
import type { Group, Issue, QueryNode } from "./types";

/**
 * For every group, block and field condition in `query`, the id of the node
 * that is drawn for it: itself, or — inside a folded group or block — the
 * outermost folded node around it. (A set field's row is always drawn while
 * its block is open: "+ N more fields" only hides unset rows.)
 */
function drawnNodeIds(query: Group): Map<string, string> {
  const drawn = new Map<string, string>();
  const visit = (node: QueryNode, hiddenIn: string | null) => {
    drawn.set(node.id, hiddenIn ?? node.id);
    const inside = hiddenIn ?? (node.collapsed ? node.id : null);
    if (node.kind === "group") {
      for (const child of node.children) visit(child, inside);
    } else {
      for (const c of node.conditions) drawn.set(c.id, inside ?? c.id);
    }
  };
  visit(query, null);
  return drawn;
}

/**
 * `issues`, each moved to a node that is on screen, so none is ever lost: an
 * issue inside a folded group or block goes to the outermost folded node
 * around it, and one whose node isn't in `query` goes to the root group.
 * Issues that end up the same on one node are kept once.
 */
export function placeIssues(query: Group, issues: Issue[]): Issue[] {
  const drawn = drawnNodeIds(query);
  return withoutRepeats(
    issues.map((issue) => ({ ...issue, nodeId: drawn.get(issue.nodeId) ?? query.id })),
  );
}
```

- [ ] **Step 4: Write `src/query/saved.ts`**

Copy `src/query/legacy/saved.ts` and change only:
- imports: `import { countBlocks, sameSemantics } from "./tree";` and `import type { Group } from "./types";`
- delete `hasChosenCondition`, and in `hasUnsavedWork` replace `if (!hasChosenCondition(query)) return false;` with:

```ts
  // An empty query is nothing to lose; any block is something the user chose.
  if (countBlocks(query) === 0) return false;
```

and its doc comment's "holds a condition with anything chosen" with "holds a facet block".

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/query/issues.test.ts tests/query/saved.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add src/query/issues.ts src/query/saved.ts tests/query/issues.test.ts tests/query/saved.test.ts
git commit -m "Facet blocks: issue placement and saved-query comparisons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The new wire format, both ways

**Files:**
- Modify: `src/api/types.ts` (new query-tree types)
- Create: `src/api/request.ts`
- Modify: `src/api/response.ts` (add `fromSavedTree`)
- Test: `tests/api/request.test.ts` (new file; if Task 1 left the old test at this path, it is at `tests/api/legacy/request.test.ts` now — keep it there), `tests/api/savedTree.test.ts`

**Interfaces:**
- Consumes: Task 2 (`groupOf`, `newBlock`, `newFieldCondition`, types); `ResponseObject` from `src/api/contract.ts` (`oneOf`, `id`, `nullableId`, `boolean`, `list`, `savedValue`).
- Produces:
  - `types.ts`: `QueryRequest`, `RequestNode = RequestGroup | RequestFacet`, `RequestGroup`, `RequestFacet`, `RequestFieldCondition`, `SavedNode = SavedGroup | SavedFacet`, `SavedGroup`, `SavedFacet`, `SavedFieldCondition` (exact fields below).
  - `request.ts`: `toQueryRequest(query: Group, databases: string[]): QueryRequest`; `toSavedTree(query: Group): SavedGroup`.
  - `response.ts`: `fromSavedTree(root: ResponseObject<SavedGroup>): Group`.
  Plan A2 builds `toSavedQueryRequest` / `toSavedQuery` on `toSavedTree` / `fromSavedTree` and points `client.ts` at them.

- [ ] **Step 1: Add the wire types**

Append to `src/api/types.ts` (after `RequestScalar` / `RequestValue`):

```ts
// ---- the query tree with facet blocks (docs/superpowers/specs/2026-10-27-facet-blocks-design.md, section 4)

/** The body of POST {prefix}/filter/validate and /filter/execute. */
export interface QueryRequest {
  /** `DatabasesResponse.label` of each database to run against. Never empty. */
  databases: string[];
  query: RequestGroup;
}

export type RequestNode = RequestGroup | RequestFacet;

export interface RequestGroup {
  kind: "group";
  /** The frontend's id for this node: opaque, unique within the request.
   *  Quoted back as `StatsErrorMessage.node_id`. */
  id: string;
  operator: "AND" | "OR";
  /** Never empty. */
  children: RequestNode[];
}

/**
 * The event has (when `negated`: has no) occurrence of `facet_id` in which
 * ALL ("AND") / ANY ("OR") of `conditions` hold. No conditions: the facet is
 * present (absent). The backend interprets it.
 */
export interface RequestFacet {
  kind: "facet";
  id: string;
  /** `IndividualResponse.label`. */
  facet_id: string;
  negated: boolean;
  operator: "AND" | "OR";
  /** At most one per field; may be empty. */
  conditions: RequestFieldCondition[];
}

export interface RequestFieldCondition {
  kind: "condition";
  id: string;
  /** `IndividualFieldResponse.label`, within the facet of the block. */
  field_id: string;
  /** An operator label, e.g. "gt". */
  operator_id: string;
  value: RequestValue;
}

/** A saved query's tree: the request's shape without node ids (they only
 *  live for one page load) and with unfinished parts allowed. */
export type SavedNode = SavedGroup | SavedFacet;

export interface SavedGroup {
  kind: "group";
  operator: "AND" | "OR";
  /** May be empty. */
  children: SavedNode[];
}

export interface SavedFacet {
  kind: "facet";
  facet_id: string;
  negated: boolean;
  operator: "AND" | "OR";
  conditions: SavedFieldCondition[];
}

export interface SavedFieldCondition {
  kind: "condition";
  field_id: string;
  operator_id: string | null;
  value: SavedValue;
}
```

- [ ] **Step 2: Write the failing tests**

`tests/api/request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toQueryRequest, toSavedTree } from "../../src/api/request";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";

const cond = newFieldCondition("size", "between", [20, 80]);
const block: FacetBlock = {
  ...newBlock("thing"),
  negated: true,
  operator: "OR",
  conditions: [cond],
  collapsed: true,
};
const inner = groupOf([newBlock("other")], "OR");
const query: Group = { ...emptyQuery(), children: [block, inner], collapsed: false };

describe("toQueryRequest", () => {
  it("projects the tree as built, without display state", () => {
    expect(toQueryRequest(query, ["alpha"])).toEqual({
      databases: ["alpha"],
      query: {
        kind: "group",
        id: query.id,
        operator: "AND",
        children: [
          {
            kind: "facet",
            id: block.id,
            facet_id: "thing",
            negated: true,
            operator: "OR",
            conditions: [
              {
                kind: "condition",
                id: cond.id,
                field_id: "size",
                operator_id: "between",
                value: [20, 80],
              },
            ],
          },
          {
            kind: "group",
            id: inner.id,
            operator: "OR",
            children: [
              {
                kind: "facet",
                id: inner.children[0]!.id,
                facet_id: "other",
                negated: false,
                operator: "AND",
                conditions: [],
              },
            ],
          },
        ],
      },
    });
  });

  it("refuses an unfinished condition: Run must have been blocked", () => {
    const unfinished: Group = {
      ...emptyQuery(),
      children: [{ ...newBlock("thing"), conditions: [newFieldCondition("size", null, null)] }],
    };
    expect(() => toQueryRequest(unfinished, ["alpha"])).toThrow(/unfinished/);
  });
});

describe("toSavedTree", () => {
  it("keeps unfinished parts and leaves out ids and display state", () => {
    const unfinished: Group = {
      ...emptyQuery(),
      children: [{ ...newBlock("thing"), conditions: [newFieldCondition("size", null, [3, null])] }],
    };
    const saved = toSavedTree(unfinished);
    expect(saved).toEqual({
      kind: "group",
      operator: "AND",
      children: [
        {
          kind: "facet",
          facet_id: "thing",
          negated: false,
          operator: "AND",
          conditions: [{ kind: "condition", field_id: "size", operator_id: null, value: [3, null] }],
        },
      ],
    });
    expect(JSON.stringify(toSavedTree(query))).not.toMatch(/"id"|collapsed/);
  });
});
```

`tests/api/savedTree.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ContractError, ResponseValue } from "../../src/api/contract";
import { toSavedTree } from "../../src/api/request";
import { fromSavedTree } from "../../src/api/response";
import { emptyQuery, newBlock, newFieldCondition } from "../../src/query/tree";
import type { SavedGroup } from "../../src/api/types";
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
      kind: "group",
      operator: "AND",
      children: [{ kind: "condition", facet_id: "thing", field_id: null, operator_id: "present", value: null }],
    };
    expect(() => read(old)).toThrow(ContractError);
    expect(() => read(old)).toThrow('"children[0].kind" should be "group" or "facet"');
  });

  it("refuses a block without negated, or a condition without a field", () => {
    const facet = (over: object) => ({
      kind: "group",
      operator: "AND",
      children: [{ kind: "facet", facet_id: "thing", negated: false, operator: "AND", conditions: [], ...over }],
    });
    expect(() => read(facet({ negated: undefined }))).toThrow(ContractError);
    expect(() =>
      read(facet({ conditions: [{ kind: "condition", field_id: null, operator_id: null, value: null }] })),
    ).toThrow(ContractError);
  });
});
```

(If the path in the second expected message differs, e.g. it carries a leading `"query."`, match the exact text `ContractError` produces for a `ResponseValue` read at the top level — run the test once and copy it.)

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/api/request.test.ts tests/api/savedTree.test.ts`
Expected: FAIL — `../../src/api/request` cannot be resolved; `fromSavedTree` is not exported.

- [ ] **Step 4: Write `src/api/request.ts`**

```ts
import type {
  QueryRequest,
  RequestFacet,
  RequestFieldCondition,
  RequestGroup,
  RequestNode,
  RequestScalar,
  RequestValue,
  SavedFacet,
  SavedFieldCondition,
  SavedGroup,
  SavedNode,
  SavedValue,
} from "./types";
import type { FacetBlock, FieldCondition, Group, QueryNode } from "../query/types";

// The builders below write the wire's snake_case keys (`facet_id`) from the
// model's camelCase properties (`facetId`): this file is where the two meet.

/**
 * The body of POST …/filter/validate and …/filter/execute, built from the
 * query on screen (docs/ARCHITECTURE.md, "Wire format of the query"). A
 * projection, never a rewrite: every operator and value goes out as the user
 * built it. Unset fields are not in the query, so they are not sent; only
 * display state (`collapsed`) is left out.
 *
 * Call it only for a query that can run (`runBlocker` in src/state.ts). An
 * unfinished condition, or a value that isn't JSON scalars, throws: a bug.
 */
export function toQueryRequest(query: Group, databases: string[]): QueryRequest {
  return { databases: [...databases], query: groupOf(query) };
}

function nodeOf(node: QueryNode): RequestNode {
  return node.kind === "group" ? groupOf(node) : facetOf(node);
}

function groupOf(g: Group): RequestGroup {
  return { kind: "group", id: g.id, operator: g.operator, children: g.children.map(nodeOf) };
}

function facetOf(b: FacetBlock): RequestFacet {
  return {
    kind: "facet",
    id: b.id,
    facet_id: b.facetId,
    negated: b.negated,
    operator: b.operator,
    conditions: b.conditions.map(conditionOf),
  };
}

function conditionOf(c: FieldCondition): RequestFieldCondition {
  if (c.operatorId === null) throw new Error(`Condition ${c.id} is unfinished and cannot be sent.`);
  return {
    kind: "condition",
    id: c.id,
    field_id: c.fieldId,
    operator_id: c.operatorId,
    value: valueOf(c),
  };
}

const isScalar = (v: unknown): v is RequestScalar =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function valueOf(c: FieldCondition): RequestValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every(isScalar)) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}

/**
 * A saved query's tree (docs/ARCHITECTURE.md, "Saved queries"): unfinished
 * parts kept, node ids and `collapsed` left out (ids only live for one page
 * load). Throws only on a value that is not JSON scalars and nulls (a bug).
 */
export function toSavedTree(query: Group): SavedGroup {
  return savedGroupOf(query);
}

function savedNodeOf(node: QueryNode): SavedNode {
  return node.kind === "group" ? savedGroupOf(node) : savedFacetOf(node);
}

function savedGroupOf(g: Group): SavedGroup {
  return { kind: "group", operator: g.operator, children: g.children.map(savedNodeOf) };
}

function savedFacetOf(b: FacetBlock): SavedFacet {
  return {
    kind: "facet",
    facet_id: b.facetId,
    negated: b.negated,
    operator: b.operator,
    conditions: b.conditions.map(savedConditionOf),
  };
}

function savedConditionOf(c: FieldCondition): SavedFieldCondition {
  return { kind: "condition", field_id: c.fieldId, operator_id: c.operatorId, value: savedValueOf(c) };
}

function savedValueOf(c: FieldCondition): SavedValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every((item) => item === null || isScalar(item))) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}
```

- [ ] **Step 5: Add `fromSavedTree` to `src/api/response.ts`**

Add the imports (`SavedFacet`, `SavedFieldCondition`, `SavedGroup`, `SavedNode` from `./types`; `groupOf`, `newBlock`, `newFieldCondition` from `../query/tree`; `FacetBlock`, `FieldCondition`, `Group`, `QueryNode` from `../query/types` — rename any clash with the legacy names still imported in this file, e.g. `import type { Group as BlockGroup }`, only if the compiler reports one), then:

```ts
/**
 * A saved query's tree, read strictly (a malformed node is a ContractError
 * naming its path: half of a user's query would be worse than saying it can't
 * be read). Every node gets a fresh id, as any new node does: a saved tree
 * has none. The tree comes back as it was saved, unfinished parts included.
 */
export function fromSavedTree(root: ResponseObject<SavedGroup>): Group {
  root.oneOf("kind", ["group"]); // a saved query's root is always a group
  return savedGroupOf(root);
}

function savedNodeOf(n: ResponseObject<SavedNode>): QueryNode {
  return n.oneOf("kind", ["group", "facet"]) === "group"
    ? savedGroupOf(n as ResponseObject<SavedGroup>)
    : savedFacetOf(n as ResponseObject<SavedFacet>);
}

function savedGroupOf(g: ResponseObject<SavedGroup>): Group {
  const operator = g.oneOf("operator", ["AND", "OR"]);
  return groupOf(g.list<SavedNode>("children").map(savedNodeOf), operator);
}

function savedFacetOf(f: ResponseObject<SavedFacet>): FacetBlock {
  return {
    ...newBlock(f.id("facet_id")),
    negated: f.boolean("negated"),
    operator: f.oneOf("operator", ["AND", "OR"]),
    conditions: f.list<SavedFieldCondition>("conditions").map(savedConditionOf),
  };
}

function savedConditionOf(c: ResponseObject<SavedFieldCondition>): FieldCondition {
  c.oneOf("kind", ["condition"]);
  return newFieldCondition(c.id("field_id"), c.nullableId("operator_id"), c.savedValue("value"));
}
```

If the names `savedNodeOf` / `savedGroupOf` clash with anything left in `response.ts`, prefix the new ones with `facetTree…`; the exported name stays `fromSavedTree`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/api/request.test.ts tests/api/savedTree.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add -A
git commit -m "Facet blocks: the wire format, both ways

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The mock matches facet blocks, per occurrence

The mock's events hold one occurrence per facet today, so "ALL within one occurrence" could not be told apart from the old behaviour. This task lets an event hold several occurrences of a facet, adds one such event, and teaches the mock the facet node — while it still accepts the old condition nodes the app sends until plan A2.

**Files:**
- Modify: `mock-server/vehicleData.ts` (`Occurrence`, `Entryset`, `occurrencesOf`)
- Modify: `mock-server/data/entrysets.json` (event 2: two occurrences of one facet)
- Modify: `mock-server/rows.ts` (`MockEvent`, `toMockEvent`, `EVENTS`)
- Modify: `mock-server/evaluate.ts` (`fieldMatches`, `facetMatches`, `eventMatches`, `queryErrors`, `perDatabaseCounts`, `filterByDatabases`)
- Modify: `mock-server/requestBody.ts` (`queryProblem`: facet nodes)
- Modify: `mock-server/events.ts` (`toEventResponse`: all occurrences)
- Modify: `mock-server/server.ts` (use `EVENTS`, `eventMatches`)
- Test: `tests/mock-server/{evaluate,requestBody,rows,events,data}.test.ts`
- Modify: `docs/ARCHITECTURE.md` ("Mock server")

**Interfaces:**
- Consumes: Task 7 wire types (`RequestFacet`, `RequestFieldCondition`, `RequestGroup`); legacy `RequestCondition` from `src/api/legacy/types.ts`.
- Produces: `Occurrence = Record<string, string | number | boolean>`; `occurrencesOf(e: Entryset, facetLabel: string): Occurrence[]`; `MockEvent { id: number; db: string; row: Row; occurrences: Record<string, Occurrence[]> }`; `toMockEvent(e: Entryset): MockEvent`; `EVENTS: MockEvent[]`; `MockGroup { kind: "group"; id: string; operator: "AND" | "OR"; children: MockNode[] }`; `MockNode = MockGroup | RequestFacet | RequestCondition` (legacy); `eventMatches(node: MockNode, event: MockEvent): boolean`; `facetMatches(f: RequestFacet, event: MockEvent): boolean`; `perDatabaseCounts(query: MockNode, events: MockEvent[], databaseIds: string[])`; `filterByDatabases(events: MockEvent[], databaseIds: string[]): MockEvent[]`; `queryErrors(node: MockNode): StatsErrorMessage[]`.

- [ ] **Step 1: Give event 2 a second occurrence**

In `mock-server/data/entrysets.json`, event `"2"`: replace the value of `items.gps_position` (an object) with a list of two objects — the original one first, then:

```json
{ "latitude": 40.7128, "longitude": -74.006, "altitude_m": 10, "heading_deg": 90 }
```

If event 2 has no `gps_position`, use the first event that has it and use that event's id in the tests below. Keep the file's formatting style.

- [ ] **Step 2: Write the failing tests**

In `tests/mock-server/evaluate.test.ts` add:

```ts
import { EVENTS, toMockEvent } from "../../mock-server/rows";
import { ENTRYSETS } from "../../mock-server/vehicleData";
import { eventMatches } from "../../mock-server/evaluate";
import type { RequestFacet, RequestFieldCondition } from "../../src/api/types";

describe("facet blocks match within one occurrence", () => {
  const two = toMockEvent(ENTRYSETS["2"]!);
  const [first, second] = two.occurrences["gps_position"]!;
  const cond = (field_id: string, value: unknown): RequestFieldCondition => ({
    kind: "condition",
    id: `c-${field_id}`,
    field_id,
    operator_id: "eq",
    value: value as RequestFieldCondition["value"],
  });
  const facet = (over: Partial<RequestFacet>): RequestFacet => ({
    kind: "facet",
    id: "f",
    facet_id: "gps_position",
    negated: false,
    operator: "AND",
    conditions: [],
    ...over,
  });
  // Latitude of the first occurrence with longitude of the second: no single
  // occurrence has both.
  const mixed = [cond("latitude", first!["latitude"]), cond("longitude", second!["longitude"])];

  it("has two occurrences in the sample event", () => {
    expect(two.occurrences["gps_position"]).toHaveLength(2);
  });

  it("ALL needs one occurrence that has every value", () => {
    expect(eventMatches(facet({ conditions: mixed }), two)).toBe(false);
    expect(
      eventMatches(
        facet({ conditions: [cond("latitude", second!["latitude"]), cond("longitude", second!["longitude"])] }),
        two,
      ),
    ).toBe(true);
  });

  it("ANY needs one occurrence with one of them; two blocks may use different occurrences", () => {
    expect(eventMatches(facet({ operator: "OR", conditions: mixed }), two)).toBe(true);
    const both = {
      kind: "group" as const,
      id: "g",
      operator: "AND" as const,
      children: [facet({ id: "a", conditions: [mixed[0]!] }), facet({ id: "b", conditions: [mixed[1]!] })],
    };
    expect(eventMatches(both, two)).toBe(true);
  });

  it("has no inverts the block; an empty block is presence", () => {
    expect(eventMatches(facet({}), two)).toBe(true);
    expect(eventMatches(facet({ negated: true }), two)).toBe(false);
    expect(eventMatches(facet({ facet_id: "nope" }), two)).toBe(false);
    expect(eventMatches(facet({ facet_id: "nope", negated: true }), two)).toBe(true);
    expect(eventMatches(facet({ negated: true, conditions: mixed }), two)).toBe(true);
  });

  it("knows every event", () => {
    expect(EVENTS).toHaveLength(Object.keys(ENTRYSETS).length);
  });
});
```

In `tests/mock-server/requestBody.test.ts` add:

```ts
describe("queryProblem with facet blocks", () => {
  const facet = (over: object) => ({
    kind: "group",
    id: "g",
    operator: "AND",
    children: [
      { kind: "facet", id: "f", facet_id: "thing", negated: false, operator: "AND", conditions: [], ...over },
    ],
  });
  it("accepts a block, with or without conditions", () => {
    expect(queryProblem(facet({}))).toBeNull();
    expect(
      queryProblem(
        facet({ conditions: [{ kind: "condition", id: "c", field_id: "size", operator_id: "gt", value: 3 }] }),
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
```

Update the existing tests that call `perDatabaseCounts` / `filterByDatabases` with rows to pass `MockEvent`s instead (build them with `toMockEvent`, or with `{ id, db, row, occurrences }` literals), and `tests/mock-server/events.test.ts` / `data.test.ts` where they assume `items[facet]` is always an object: read values through `occurrencesOf`. In `events.test.ts` add: event 2's `gps_position` item has two `values`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/mock-server`
Expected: FAIL — `toMockEvent`, `EVENTS`, `eventMatches` not exported; facet nodes rejected by `queryProblem`.

- [ ] **Step 4: Occurrences in the data layer**

`mock-server/vehicleData.ts`: replace the `Entryset` interface with:

```ts
/** One occurrence of a facet in an event: its fields' values. */
export type Occurrence = Record<string, string | number | boolean>;

/** One event as stored in data/entrysets.json: the mock's own format. A facet
 *  that occurs more than once in the event is stored as a list. The API
 *  answers with `EventResponse` (src/api/types.ts), built by `toEventResponse`
 *  (events.ts). */
export interface Entryset {
  id: number;
  items: Record<string, Occurrence | Occurrence[]>;
}

/** A facet's occurrences in an event: none, one, or several. */
export function occurrencesOf(e: Entryset, facetLabel: string): Occurrence[] {
  const stored = e.items[facetLabel];
  if (stored === undefined) return [];
  return Array.isArray(stored) ? stored : [stored];
}
```

`mock-server/rows.ts`:

```ts
import { ENTRYSETS, occurrencesOf, type Entryset, type Occurrence } from "./vehicleData";
import { databaseIdForEntrysetId } from "./databases";
import { rowKey, type Row } from "./evaluate";

/**
 * Flattens one entryset into `rowKey(individualLabel, fieldLabel)` keys plus
 * the synthetic `__db` key (mock-server/databases.ts). Only for the old
 * condition nodes, which the app sends until plan A2: they look at the first
 * occurrence of a facet. Facet blocks use `MockEvent.occurrences`.
 */
export function flattenEntryset(entryset: Entryset): Row {
  const row: Row = { id: entryset.id, __db: databaseIdForEntrysetId(entryset.id) };
  for (const individualLabel of Object.keys(entryset.items)) {
    const [first] = occurrencesOf(entryset, individualLabel);
    for (const [fieldLabel, value] of Object.entries(first ?? {})) {
      row[rowKey(individualLabel, fieldLabel)] = value;
    }
  }
  return row;
}

/** One event as the mock's matcher sees it (evaluate.ts, `eventMatches`). */
export interface MockEvent {
  id: number;
  /** The database it belongs to (databases.ts, by its numeric id only). */
  db: string;
  /** The flattened form the old condition nodes are matched against. */
  row: Row;
  /** Every occurrence of every facet the event holds. */
  occurrences: Record<string, Occurrence[]>;
}

export function toMockEvent(e: Entryset): MockEvent {
  const occurrences: Record<string, Occurrence[]> = {};
  for (const facet of Object.keys(e.items)) occurrences[facet] = occurrencesOf(e, facet);
  return { id: e.id, db: String(databaseIdForEntrysetId(e.id)), row: flattenEntryset(e), occurrences };
}

/** Every event the mock server has, prepared once at startup. */
export const EVENTS: MockEvent[] = Object.values(ENTRYSETS).map(toMockEvent);
```

(Delete `ROWS`; fix its users in Step 6.)

`mock-server/events.ts`, `toEventResponse`:

```ts
/** An event in the shape POST …/filter/execute answers with: one item per
 *  facet, holding every occurrence of it. */
export function toEventResponse(e: Entryset): EventResponse {
  return {
    id: eventGuid(e.id),
    items: Object.keys(e.items).map((facet_label) => ({
      facet_label,
      values: occurrencesOf(e, facet_label),
    })),
  };
}
```

- [ ] **Step 5: Matching and checking facet nodes**

`mock-server/evaluate.ts`:
1. Change `dateMatches(c, v)` to `dateMatches(operatorId: string, value: unknown, v: Row[string] | undefined)` (read `operatorId` / `value` where it read `c.operator_id` / `c.value`).
2. Extract the field-level `switch` of `conditionMatches` into:

```ts
/** Whether a stored value `v` matches `operatorId` with the condition's
 *  `value`: the mock's reading of every field-level operator. */
function fieldMatches(operatorId: string, value: unknown, v: Row[string] | undefined): boolean {
  const asDate = dateMatches(operatorId, value, v);
  if (asDate !== undefined) return asDate;
  switch (operatorId) {
    // … the cases moved from conditionMatches, reading `value` for `c.value` …
  }
}
```

and make `conditionMatches` call `fieldMatches(c.operator_id, c.value, row[rowKey(c.facet_id, c.field_id)])` after its facet-level branch.
3. Add:

```ts
import type { RequestFacet, RequestGroup } from "../src/api/types";
import type { RequestCondition } from "../src/api/legacy/types";
import type { MockEvent } from "./rows";
import type { Occurrence } from "./vehicleData";

/** A query tree as the mock accepts it while the app moves to facet blocks:
 *  groups may hold facet blocks and, until plan A2, the old condition nodes. */
export interface MockGroup {
  kind: "group";
  id: string;
  operator: RequestGroup["operator"];
  children: MockNode[];
}
export type MockNode = MockGroup | RequestFacet | RequestCondition;

/** Whether one occurrence matches the block's set fields; no set fields: yes. */
function occurrenceMatches(f: RequestFacet, occ: Occurrence): boolean {
  if (f.conditions.length === 0) return true;
  const test = (c: RequestFacet["conditions"][number]) =>
    fieldMatches(c.operator_id, c.value, occ[c.field_id]);
  return f.operator === "AND" ? f.conditions.every(test) : f.conditions.some(test);
}

/** The event has (or, negated, has no) occurrence of the facet in which the
 *  block's fields match: "ALL" means all within ONE occurrence. This is the
 *  mock's reading; the real backend owns the rule. */
export function facetMatches(f: RequestFacet, event: MockEvent): boolean {
  const has = (event.occurrences[f.facet_id] ?? []).some((occ) => occurrenceMatches(f, occ));
  return f.negated ? !has : has;
}

export function eventMatches(node: MockNode, event: MockEvent): boolean {
  if (node.kind === "facet") return facetMatches(node, event);
  if (node.kind === "condition") return conditionMatches(node, event.row);
  if (node.children.length === 0) return true;
  return node.operator === "AND"
    ? node.children.every((c) => eventMatches(c, event))
    : node.children.some((c) => eventMatches(c, event));
}
```

4. `filterByDatabases(events: MockEvent[], databaseIds: string[])` filters on `event.db`; `perDatabaseCounts(query: MockNode, events: MockEvent[], databaseIds)` counts with `eventMatches`. Keep the old `matches(node, row)` export (its tests still use it) and type its `node` as the legacy `RequestNode` from `../src/api/legacy/types`.
5. `queryErrors(node: MockNode)`: add before the group branch:

```ts
  if (node.kind === "facet") {
    const errors = node.conditions.flatMap(textTooLong);
    // Mirrors the group rule below: a block whose every set field failed.
    if (node.conditions.length > 0 && errors.length === node.conditions.length) {
      errors.push({ node_id: node.id, kind: "incomplete", message: "Facet contains no valid conditions." });
    }
    return errors;
  }
```

with the condition branch's too-long check moved into `function textTooLong(c: { id: string; value: unknown }): StatsErrorMessage[]`, used by both.

`mock-server/requestBody.ts`, `queryProblem`: accept `node.kind === "facet"` (update the kind message to `must be "group", "facet" or "condition".`) and check it with:

```ts
  if (node.kind === "facet") {
    if (!isNonEmptyString(node.facet_id)) return `${at}.facet_id must be a non-empty string.`;
    if (typeof node.negated !== "boolean") return `${at}.negated must be true or false.`;
    if (node.operator !== "AND" && node.operator !== "OR") {
      return `${at}.operator must be "AND" or "OR".`;
    }
    if (!Array.isArray(node.conditions)) return `${at}.conditions must be a list.`;
    for (const [i, c] of node.conditions.entries()) {
      const problem = fieldConditionProblem(c, `${at}.conditions[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
```

```ts
/** What is wrong with `c` as a RequestFieldCondition (a set field of a block), or null. */
function fieldConditionProblem(c: unknown, at: string): string | null {
  if (!isObject(c) || c.kind !== "condition") return `${at} must be a condition.`;
  if (typeof c.id !== "string") return `${at}.id must be a string.`;
  for (const key of ["field_id", "operator_id"] as const) {
    if (!isNonEmptyString(c[key])) return `${at}.${key} must be a non-empty string.`;
  }
  const v = c.value;
  if (v === null || isScalar(v) || (Array.isArray(v) && v.every(isScalar))) return null;
  return `${at}.value must be null, a string, number or boolean, or a list of them.`;
}
```

(The `typeof node.id` check stays before the kind branches, so a block needs an id too.) Update the tests whose expected kind message changed.

- [ ] **Step 6: Use the events in the server**

`mock-server/server.ts`: import `EVENTS` instead of `ROWS` and `eventMatches` instead of `matches`; `perDatabaseCounts(body.query, EVENTS, body.databases)`; in `queryEvents`:

```ts
  const matching = filterByDatabases(EVENTS, body.databases)
    .filter((event) => eventMatches(body.query, event))
    .map((event) => ENTRYSETS[String(event.id)])
    .filter((e): e is Entryset => e !== undefined);
```

Type the checked body's `query` as `MockGroup` where the server reads it (`readQueryBody`).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/mock-server tests/api/mockContract.test.ts`
Expected: PASS (the old app's requests still match through the condition branch).

- [ ] **Step 8: Update the doc**

In `docs/ARCHITECTURE.md`, "Mock server": in the **Data** bullet add "An event may hold a facet more than once (stored as a list in `entrysets.json`; event 2 has two `gps_position` occurrences), so facet blocks can be tried in dev." Replace the **`present` / `absent`** bullet's first sentence with: "**Facet blocks** (`facetMatches` in `evaluate.ts`) match within one occurrence: ALL needs one occurrence in which every set field matches, ANY one in which one does; `negated` inverts the block; no set fields means the facet is present. Until the app switches over (plan A2) the mock also accepts the old condition nodes, matched against an event's first occurrence of a facet." Keep the rest of the bullet for the field-level `present` / `absent`. In **Request bodies** mention that facet blocks are checked too (`fieldConditionProblem`).

- [ ] **Step 9: Run the checks and commit**

Run: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add -A
git commit -m "Mock: match facet blocks within one occurrence

Events may hold a facet more than once; event 2 now does, so ALL
within one occurrence can be told apart from two separate blocks.
The old condition nodes are still accepted until the app switches.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes (for the controller)

- Spec coverage for A1: section 3 (model) → Tasks 2, 3, 5, 6; section 4 (wire, saved shape, `not_in`, backend hand-off) → Tasks 3, 7 (the hand-off text lands with the doc rewrite in A2); section 5 "Adding" and "Summary" → Tasks 4, 5; section 9 Node tests for model/wire/mock → every task; mock per occurrence → Task 8. Not in A1 by design: the builder UI, `AppState.panelTab` / `selectedField`, the switch-over, the saved-query endpoints' new shape (`toSavedQueryRequest`, `toSavedQuery`, `readSavedQueryBody`), the kept-query check, deleting `legacy/`, the full ARCHITECTURE rewrite → plan A2; co-occurrence and palette → plan B.
- Names used across tasks: `newBlock`, `newFieldCondition`, `setFieldCondition`, `clearFieldCondition`, `countBlocks`, `insertNodes`, `findNode` (Task 2) are the ones Tasks 5–8 import; `FieldRef` / `DropOutcome` (Task 5) and `blockText` (Task 4) are for A2.

## Carried into plan A2 (from the reviews of A1, 2026-10-27)

Small findings the reviews deferred to A2, because A2 rewrites or deletes the code involved:

- Rewrite "The query model", "Wire format of the query" and "Saved queries" in `docs/ARCHITECTURE.md` for the new model; drop the "until plan A2" notes and the remaining bare `request.ts` / `response.ts` / `validate.ts` mentions; record that "+ N more fields" only hides unset rows.
- Fix stale path comments: `src/api/client.ts` (names `src/api/request.ts`), `src/ui/queryBuilder.ts`, `src/state.ts` (name `src/query/issues.ts`).
- `ungroupBlocker` on a block id says "That group is no longer in the query."; `NodePatch` lets `negated` land on a group — add a block-only setter when the header handlers are written.
- Move the legacy tests for `moveSibling` down, one-child ungroup and the untested `validate.ts` branches (Unknown operator, takes no value, Remove the empty value, boolean/date type messages) to the new modules before deleting `legacy/`.
- Announcements: a value dropped on a set row says "Added 1 facet" without saying it is a separate block; a drop that only fills or focuses a row has `added: []` and needs its own message (e.g. "Set size to 3.").
- `isEdited` compares JSON in key and condition order; `setFieldCondition` appends, so clear-then-set moves a condition to the end (shows *(edited)*). Consider inserting in field order.
- `src/api/request.ts`: `savedValueOf` error says "cannot be sent" on the save path; `fromSavedTree` / `toSavedTree` naming reads as two directions with one pattern.
- `drop.ts`: `Number(item.value)` is unguarded (`Number("")` is 0).
- Mock: split the long "Facet blocks" bullet in "Mock server"; share one value-shape check in `requestBody.ts`; drop `Row.__db` and the redundant `String(...)` in `rows.ts` with the legacy shim; the saved-queries body check (`savedTreeProblem`) still only knows the old shape.
- Answered by the maintainers (2026-10-27): what "Is none of" matches for a field with no value is the backend's call (spec decision 23); "has no" is always bracketed (done in A1, decision 24); unknown or doubled fields of a saved block get a removable read-only row with their error (spec section 5, decision 25) — A2 draws those rows and moves the two `validate.ts` issues from the block to the row.
