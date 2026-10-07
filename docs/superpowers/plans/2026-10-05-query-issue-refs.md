# Backend issues that point at parts of the query — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each `/stats` line's `errorMessages` point at a group or condition by its request `id`, show those problems in the query builder (never losing one whose id is unknown or hidden in a collapsed group), and block Run while any database reports one.

**Architecture:** `errorMessages` items become `{ nodeId?, message, kind }` objects, read into a new `DatabaseError` model type. A new pure module, `src/query/issues.ts`, derives builder `Issue`s from `state.stats` at render time (`serverIssues`), places every issue on a node that is actually drawn (`placeIssues`), and combines both (`shownIssues`). `runBlocker` gets a last reason, `"rejected"`, from the same `serverIssues`. No new state.

**Tech Stack:** TypeScript, Vite, Vitest (node environment, no DOM), Fomantic UI, plain Node `http` mock server.

**Spec:** `docs/superpowers/specs/2026-10-05-query-issue-refs-design.md`

## Global Constraints

- Gates before every commit: `npm test`, `npm run typecheck`, `npm run lint` all pass.
- This is a git worktree. If `node_modules` is missing or is a symlink, run `npm ci` first (a symlinked `node_modules` breaks Vite).
- Only `src/api/` may import `src/api/types.ts` (ESLint enforces it). The rest of `src/` uses `src/model.ts`.
- `src/` must never name backend items, fields, tags or groups (`tests/noBackendDataInSrc.test.ts`).
- The frontend sends the query as the user built it. Nothing here changes the request.
- Code must be junior-friendly: short functions, a comment saying *why* where it isn't obvious, matching the comment density and wording style of the surrounding code.
- `docs/CHANGELOG.md` is archived: do not edit it.
- Commit messages: a short sentence-case summary line (no `feat:` prefix), and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Exact user-visible texts:
  - blank-message fallback: `The server found a problem in the query.`
  - Run blocked: `A database found a problem in the query (shown above). Change the query to run it.`
  - mock: `Text is too long (at most 100 characters).`

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/api/types.ts` | modify | `StatsErrorMessage`; `StatsResponse.errorMessages` becomes `StatsErrorMessage[]`. |
| `src/api/contract.ts` | modify | New read `optionalList`. |
| `src/model.ts` | modify | New `DatabaseError`; a failed `DatabaseResult` has `errors: DatabaseError[]`. |
| `src/api/response.ts` | modify | `toDatabaseError`; `toDatabaseResult` reads the new items. |
| `src/query/issues.ts` | create | `serverIssues`, `placeIssues`, `shownIssues`. |
| `src/state.ts` | modify | `RunBlocker` gets `"rejected"`; `runBlocker` reads `stats`. |
| `src/ui/statsPanel.ts` | modify | Messages from `DatabaseError`s; pure `statsPanelHtml`; ignores `"rejected"`. |
| `src/ui/dataPreview.ts` | modify | Message for `"rejected"`. |
| `src/ui/queryBuilder.ts` | modify | Uses `shownIssues`; exported `footerHtml`; no repeated messages. |
| `mock-server/evaluate.ts` | modify | `StatsErrorMessage[]` in `DatabaseOutcome`; `queryErrors`, `MAX_TEXT_LENGTH`. |
| `mock-server/server.ts` | modify | `statsOutcome` helper; too-long text fails every database. |
| `docs/ARCHITECTURE.md` | modify | Describe all of the above. |

---

### Task 1: The new `errorMessages` items, end to end through the contract

The type change breaks compilation in `src/` and `mock-server/` at once, so
everything that reads or writes `errorMessages` / `errors` changes in this task.

**Files:**
- Modify: `src/api/types.ts` (the `StatsResponse` interface, around line 32-52)
- Modify: `src/api/contract.ts` (the "required" section of `ResponseObject`, after `object<U>`)
- Modify: `src/model.ts` (the `DatabaseResult` type, around line 78-95)
- Modify: `src/api/response.ts` (imports; `toDatabaseResult`)
- Modify: `src/ui/statsPanel.ts` (`failureRowHtml`)
- Modify: `mock-server/evaluate.ts` (import; `DatabaseOutcome`)
- Test: `tests/api/contract.test.ts`, `tests/api/response.test.ts`, `tests/api/client.test.ts`, `tests/ui/statsPanel.test.ts`, `tests/mock-server/evaluate.test.ts`

**Interfaces:**
- Produces:
  - `src/api/types.ts`: `export interface StatsErrorMessage { nodeId?: string; message: string; kind: "incomplete" | "invalid"; }`
  - `ResponseObject<T>.optionalList<U>(key: Key<T>): ResponseObject<U>[]`
  - `src/model.ts`: `export interface DatabaseError { message: string; kind: "incomplete" | "invalid"; nodeId: string | null; }`, and the failed `DatabaseResult` variant has `errors: DatabaseError[]`
  - `src/api/response.ts`: `export function toDatabaseError(e: ResponseObject<StatsErrorMessage>): DatabaseError`

- [ ] **Step 1: Write the failing tests**

In `tests/api/contract.test.ts`, add `extraParts?: Thing[];` to the `Thing` interface (after `parts: Thing[];`), then add this block after the `describe("required reads", …)` block:

```ts
describe("optionalList", () => {
  it("is [] when the key is missing or null, without a warning", () => {
    expect(thing({}).optionalList<Thing>("extraParts")).toEqual([]);
    expect(thing({ extraParts: null }).optionalList<Thing>("extraParts")).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reads a list of objects like `list`", () => {
    const parts = thing({ extraParts: [{ label: "a" }] }).optionalList<Thing>("extraParts");
    expect(parts.map((p) => p.id("label"))).toEqual(["a"]);
  });

  it("throws when the value is there but isn't a list of objects", () => {
    expect(() => thing({ extraParts: "a" }).optionalList<Thing>("extraParts")).toThrow(
      '"extraParts" should be a list, but it is the text "a".',
    );
    expect(() => thing({ extraParts: ["a"] }).optionalList<Thing>("extraParts")).toThrow(
      '"extraParts[0]" should be an object, but it is the text "a".',
    );
  });
});
```

In `tests/api/response.test.ts`, replace the tests `"a failed line carries its messages, never a count"` and `"a success without a count is a failure, not a made-up 0"` with:

```ts
  it("a failed line carries its errors and notes, never a count", () => {
    expect(
      toDatabaseResult(
        read<StatsResponse>({
          label: "beta",
          success: false,
          errorMessages: [
            { nodeId: "c1", message: "Operator no longer supported.", kind: "invalid" },
            { message: "Query too complex.", kind: "incomplete" },
          ],
          infoMessages: ["timeout"],
        }),
      ),
    ).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [
        { nodeId: "c1", message: "Operator no longer supported.", kind: "invalid" },
        { nodeId: null, message: "Query too complex.", kind: "incomplete" },
      ],
      notes: ["timeout"],
    });
    expect(toDatabaseResult(read<StatsResponse>({ label: "beta", success: false }))).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [],
      notes: [],
    });
    // Leaving out the optional keys is normal, not worth a warning.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("an error of an unknown kind is invalid; a blank message gets a stand-in", () => {
    const result = toDatabaseResult(
      readBroken<StatsResponse>({
        label: "beta",
        success: false,
        errorMessages: [{ nodeId: "c1", message: " ", kind: "fatal" }],
      }),
    );
    expect(result).toMatchObject({
      errors: [
        { nodeId: "c1", message: "The server found a problem in the query.", kind: "invalid" },
      ],
    });
  });

  it("a plain-text error (the old contract) throws a ContractError", () => {
    expect(() =>
      toDatabaseResult(
        readBroken<StatsResponse>({ label: "beta", success: false, errorMessages: ["bad date"] }),
      ),
    ).toThrow('"errorMessages[0]" should be an object, but it is the text "bad date".');
  });

  it("a success without a count is a failure, not a made-up 0", () => {
    expect(toDatabaseResult(read<StatsResponse>({ label: "alpha", success: true }))).toMatchObject({
      status: "failed",
      errors: [
        { message: "The server sent no count for this database.", kind: "invalid", nodeId: null },
      ],
    });
  });
```

In `tests/api/client.test.ts`, in the test `"getStats streams NDJSON lines, …"`, change the second line and its expected result:

```ts
      { label: "beta", success: false, errorMessages: [{ message: "bad query", kind: "invalid" }] },
```

```ts
      {
        databaseId: "beta",
        status: "failed",
        errors: [{ message: "bad query", kind: "invalid", nodeId: null }],
        notes: [],
      },
```

In `tests/ui/statsPanel.test.ts`, change the `failed` helper and its one call with errors:

```ts
const failed = (databaseId: string, errors: DatabaseError[] = []): DatabaseResult => ({
  databaseId,
  status: "failed",
  errors,
  notes: [],
});
```

```ts
    const html = headline("ok", [
      ok("a", 5),
      failed("b", [{ message: "timeout", kind: "invalid", nodeId: null }]),
    ]);
```

and import `DatabaseError`: `import type { Database, DatabaseError, DatabaseResult } from "../../src/model";`.

In `tests/mock-server/evaluate.test.ts`, in `"builds a failure line when fail is given, …"`, use an object item on both sides:

```ts
      fail: { errorMessages: [{ nodeId: "c", message: "bad field", kind: "invalid" }], infoMessages: [] },
```

```ts
      errorMessages: [{ nodeId: "c", message: "bad field", kind: "invalid" }],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api tests/ui/statsPanel.test.ts tests/mock-server/evaluate.test.ts`
Expected: FAIL. `optionalList is not a function`, and `toDatabaseResult` still returns strings.

- [ ] **Step 3: Implement**

`src/api/types.ts`: replace the `errorMessages` member of `StatsResponse`, and add the new interface right after `StatsResponse`:

```ts
  /** Problems with the query itself — an operator this database no longer
   *  supports, a value it can't accept (a malformed date, a too-long text, …). */
  errorMessages?: StatsErrorMessage[];
```

```ts
/** One problem with the query, found by the backend in one database. */
export interface StatsErrorMessage {
  /** The `id` of the group or condition from the request (RequestGroup.id,
   *  RequestCondition.id) that the problem is in. Left out when the problem
   *  is not in one place. */
  nodeId?: string;
  message: string;
  /** "incomplete": something is missing. "invalid": something can't work. */
  kind: "incomplete" | "invalid";
}
```

In the same file, the `RequestGroup.id` comment ends with "Reserved so a later error response can point at a node." Replace that sentence with: "Quoted back as `StatsErrorMessage.nodeId` when a database finds a problem in this node."

`src/api/contract.ts`, in `ResponseObject`, after `object<U>(…)`:

```ts
  /** Like `list`, for a key marked `?` in src/api/types.ts: [] when the key
   *  is missing or null. A value that is there but isn't a list of objects
   *  still throws. */
  optionalList<U>(key: Key<T>): ResponseObject<U>[] {
    return isAbsent(this.fields[key]) ? [] : this.list<U>(key);
  }
```

Also add `optionalList` to the list of required reads in the file's top comment: `- **Required**: \`id\`, \`number\`, \`boolean\`, \`list\`, \`optionalList\`, \`object\`.` and after "A missing or wrong value throws a `ContractError`." add "(`optionalList` allows a missing one.)".

`src/model.ts`: add before `DatabaseResult`:

```ts
/** One problem a database found in the query. */
export interface DatabaseError {
  message: string;
  /** "incomplete": something is missing. "invalid": something can't work. */
  kind: "incomplete" | "invalid";
  /** The `id` of the query node (group or condition) it is in, or null when
   *  it is not in one place. */
  nodeId: string | null;
}
```

and in the failed variant of `DatabaseResult`:

```ts
      /** Problems with the query itself (a malformed value, …). May be empty. */
      errors: DatabaseError[];
```

`src/api/response.ts`: add `StatsErrorMessage` to the import from `./types` and `DatabaseError` to the import from `../model`. Add before `toDatabaseResult`:

```ts
/**
 * One item of a stats line's `errorMessages`. These decide whether Run is
 * allowed (src/state.ts), so the item must be an object; within it, a kind
 * this app doesn't know is "invalid" (the safe choice, as in toCompliance).
 */
export function toDatabaseError(e: ResponseObject<StatsErrorMessage>): DatabaseError {
  return {
    message: e.text("message") || "The server found a problem in the query.",
    kind: e.text("kind") === "incomplete" ? "incomplete" : "invalid",
    nodeId: e.optionalText("nodeId") || null,
  };
}
```

In `toDatabaseResult`, replace the `errors` constant:

```ts
  const errors: DatabaseError[] = success
    ? [{ message: "The server sent no count for this database.", kind: "invalid", nodeId: null }]
    : line.optionalList<StatsErrorMessage>("errorMessages").map(toDatabaseError);
```

`src/ui/statsPanel.ts`, in `failureRowHtml`:

```ts
  const errors = result.errors.length
    ? messagesHtml(
        result.errors.map((e) => e.message),
        "qb-db-msg qb-db-error",
      )
    : `<span class="qb-db-msg qb-db-error">Failed.</span>`;
```

`mock-server/evaluate.ts`: change the first import to `import type { RequestCondition, RequestNode, StatsErrorMessage, StatsResponse } from "../src/api/types";` and in `DatabaseOutcome`:

```ts
  fail?: { errorMessages: StatsErrorMessage[]; infoMessages: string[] };
```

`mock-server/server.ts` still passes `errorMessages: []`, which fits the new type.

- [ ] **Step 4: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. If `prettier --check` complains, run `npx prettier --write` on the files you changed and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/contract.ts src/model.ts src/api/response.ts src/ui/statsPanel.ts mock-server/evaluate.ts tests/api tests/ui/statsPanel.test.ts tests/mock-server/evaluate.test.ts
git commit -m "Stats errors are objects that can point at a query node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `src/query/issues.ts`: server issues and where every issue is shown

**Files:**
- Create: `src/query/issues.ts`
- Test: `tests/query/issues.test.ts`

**Interfaces:**
- Consumes: `DatabaseError`, `DatabaseResult` (Task 1, `src/model.ts`); `StatsState`, `AppState` (types, `src/state.ts`); `Issue`, `Group`, `QueryNode` (`src/query/types.ts`)
- Produces:
  - `serverIssues(stats: StatsState): Issue[]`
  - `placeIssues(query: Group, issues: Issue[]): Issue[]`
  - `shownIssues(state: Pick<AppState, "query" | "issues" | "stats">): Issue[]`

- [ ] **Step 1: Write the failing test**

Create `tests/query/issues.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { placeIssues, serverIssues, shownIssues } from "../../src/query/issues";
import type { DatabaseError, DatabaseResult } from "../../src/model";
import type { Condition, Group, Issue, QueryNode } from "../../src/query/types";

const cond = (id: string): Condition => ({
  kind: "condition",
  id,
  facetId: null,
  fieldId: null,
  operatorId: null,
  value: null,
});
const group = (id: string, children: QueryNode[], collapsed = false): Group => ({
  kind: "group",
  id,
  operator: "AND",
  children,
  collapsed,
});

const err = (
  nodeId: string | null,
  message = "Bad.",
  kind: DatabaseError["kind"] = "invalid",
): DatabaseError => ({ nodeId, message, kind });
const failed = (databaseId: string, ...errors: DatabaseError[]): DatabaseResult => ({
  databaseId,
  status: "failed",
  errors,
  notes: [],
});
const ok: DatabaseResult = { databaseId: "ok", status: "ok", matchCount: 1, notes: [] };
const issue = (nodeId: string, message = "Bad."): Issue => ({ nodeId, message, kind: "invalid" });

describe("serverIssues", () => {
  it("turns every error that names a node into an issue, once", () => {
    const results = [failed("a", err("c1")), failed("b", err("c1"), err("c1", "Other."))];
    expect(serverIssues({ status: "ok", results })).toEqual([issue("c1"), issue("c1", "Other.")]);
  });

  it("keeps the same message with another kind or node apart", () => {
    const results = [failed("a", err("c1"), err("c1", "Bad.", "incomplete"), err("c2"))];
    expect(serverIssues({ status: "ok", results })).toHaveLength(3);
  });

  it("ignores errors without a node and databases that succeeded", () => {
    expect(serverIssues({ status: "ok", results: [ok, failed("a", err(null))] })).toEqual([]);
  });

  it("works while the stream is still loading, and is [] when stats failed", () => {
    expect(serverIssues({ status: "loading", results: [failed("a", err("c1"))] })).toEqual([
      issue("c1"),
    ]);
    expect(serverIssues({ status: "error", error: "down" })).toEqual([]);
  });
});

describe("placeIssues", () => {
  const query = group("root", [
    cond("c1"),
    group("g1", [cond("c2"), group("g2", [cond("c3")], true)]),
    group("g3", [group("g4", [cond("c4")])], true),
  ]);

  it("leaves an issue on a node that is drawn where it is", () => {
    expect(placeIssues(query, [issue("c1"), issue("c2"), issue("g2")])).toEqual([
      issue("c1"),
      issue("c2"),
      issue("g2"),
    ]);
  });

  it("moves an issue inside a collapsed group to that group", () => {
    expect(placeIssues(query, [issue("c3")])).toEqual([issue("g2")]);
  });

  it("uses the outermost collapsed group when several are nested", () => {
    expect(placeIssues(query, [issue("g4"), issue("c4")])).toEqual([issue("g3"), issue("g3")]);
  });

  it("moves an issue with an unknown id to the root group", () => {
    expect(placeIssues(query, [issue("gone")])).toEqual([issue("root")]);
  });
});

describe("shownIssues", () => {
  it("places the local and the server issues together", () => {
    const query = group("root", [group("g1", [cond("c1"), cond("c2")], true)]);
    const local: Issue = { nodeId: "c1", message: "Choose a field.", kind: "incomplete" };
    const stats = { status: "ok" as const, results: [failed("a", err("c2"), err("gone"))] };
    expect(shownIssues({ query, issues: [local], stats })).toEqual([
      { ...local, nodeId: "g1" },
      issue("g1"),
      issue("root"),
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/query/issues.test.ts`
Expected: FAIL. The module `src/query/issues` does not exist.

- [ ] **Step 3: Implement**

Create `src/query/issues.ts`:

```ts
import type { AppState, StatsState } from "../state";
import type { Group, Issue, QueryNode } from "./types";

/**
 * The problems the backend found in the query on screen: every error a
 * database's stats line points at a node with (`DatabaseError.nodeId`), as an
 * `Issue`. Derived from `stats` on every render, never stored: any edit or
 * database change resets `stats` (app.ts, changeScope), so these disappear
 * exactly when they stop being true.
 *
 * Several databases often report the same problem; it is shown once. The
 * statistics panel says which databases reported it. Errors that point at no
 * node are shown there only.
 */
export function serverIssues(stats: StatsState): Issue[] {
  if (stats.status === "error") return [];
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const result of stats.results) {
    if (result.status !== "failed") continue;
    for (const { nodeId, message, kind } of result.errors) {
      if (nodeId === null) continue;
      const key = JSON.stringify([nodeId, kind, message]);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ nodeId, message, kind });
    }
  }
  return issues;
}

/**
 * For every node in `query`, the id of the node that is drawn for it: itself,
 * or — inside a collapsed group — the outermost collapsed group around it.
 */
function drawnNodeIds(query: Group): Map<string, string> {
  const drawn = new Map<string, string>();
  const visit = (node: QueryNode, hiddenIn: string | null) => {
    drawn.set(node.id, hiddenIn ?? node.id);
    if (node.kind === "group") {
      const childrenHiddenIn = hiddenIn ?? (node.collapsed ? node.id : null);
      for (const child of node.children) visit(child, childrenHiddenIn);
    }
  };
  visit(query, null);
  return drawn;
}

/**
 * `issues`, each moved to a node that is on screen, so none is ever lost: an
 * issue inside a collapsed group goes to the outermost collapsed group around
 * it, and an issue whose node isn't in `query` goes to the root group. (Only a
 * backend bug sends an unknown id: results for an older query are dropped.)
 */
export function placeIssues(query: Group, issues: Issue[]): Issue[] {
  const drawn = drawnNodeIds(query);
  return issues.map((issue) => ({ ...issue, nodeId: drawn.get(issue.nodeId) ?? query.id }));
}

/** Every issue the query builder shows — the local ones (validate.ts) and the
 *  backend's — each on the node it is shown on. */
export function shownIssues(state: Pick<AppState, "query" | "issues" | "stats">): Issue[] {
  return placeIssues(state.query, [...state.issues, ...serverIssues(state.stats)]);
}
```

- [ ] **Step 4: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/query/issues.ts tests/query/issues.test.ts
git commit -m "Derive the backend's query issues and place every issue on a drawn node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Block Run while a database reports an issue (`"rejected"`)

**Files:**
- Modify: `src/state.ts` (`RunBlocker`, `RunInputs`, `runBlocker`)
- Modify: `src/ui/statsPanel.ts` (`BLOCKED_MESSAGES`, `renderStatsPanel` → `statsPanelHtml`)
- Modify: `src/ui/dataPreview.ts` (`BLOCKED_MESSAGES`)
- Test: `tests/state.test.ts`, `tests/ui/statsPanel.test.ts`

**Interfaces:**
- Consumes: `serverIssues(stats: StatsState): Issue[]` (Task 2)
- Produces:
  - `type RunBlocker = "loading" | "no-database" | "no-condition" | "unfinished" | "rejected"`
  - `runBlocker(state: Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds" | "stats">): RunBlocker | null`
  - `src/ui/statsPanel.ts`: `export function statsPanelHtml(state: AppState): string`

- [ ] **Step 1: Write the failing tests**

In `tests/state.test.ts`, inside `describe("runBlocker", …)`: add `stats: { status: "ok", results: [] },` to `ready`, and change its type to `Parameters<typeof runBlocker>[0]`. Then add:

```ts
  it("is 'rejected', after every other reason, when a database points at a node", () => {
    const rejecting = (nodeId: string | null): Parameters<typeof runBlocker>[0] => ({
      ...ready,
      stats: {
        status: "loading",
        results: [
          {
            databaseId: "alpha",
            status: "failed",
            errors: [{ nodeId, message: "m", kind: "invalid" }],
            notes: [],
          },
        ],
      },
    });
    expect(runBlocker(rejecting("x"))).toBe("rejected");
    expect(
      runBlocker({ ...rejecting("x"), issues: [{ nodeId: "x", message: "m", kind: "invalid" }] }),
    ).toBe("unfinished");
    // An error that points at nothing is the database's own business.
    expect(runBlocker(rejecting(null))).toBeNull();
  });
```

The `type AppState` import in that file is no longer used once `ready`'s type changes: remove it from the import.

In `tests/ui/statsPanel.test.ts`, extend the imports:

```ts
import { headlineHtml, statsPanelHtml } from "../../src/ui/statsPanel";
import { initialState, type AppState } from "../../src/state";
import { addChild, emptyQuery, newCondition } from "../../src/query/tree";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
```

and add at the end:

```ts
describe("statsPanelHtml", () => {
  const root = emptyQuery();
  const condition = newCondition();
  const ready: AppState = {
    ...initialState,
    catalog: buildFieldCatalog([]),
    databases,
    selectedDatabaseIds: ["a", "b"],
    query: addChild(root, root.id, condition),
  };

  it("keeps showing each database's errors while they block Run", () => {
    const html = statsPanelHtml({
      ...ready,
      stats: {
        status: "ok",
        results: [
          ok("a", 5),
          failed("b", [{ nodeId: condition.id, message: "Too long.", kind: "invalid" }]),
        ],
      },
    });
    expect(html).toContain("Too long.");
    expect(html).toContain("Excludes 1 database that failed");
    expect(html).not.toContain("qb-placeholder");
  });

  it("explains every other blocker instead of showing results", () => {
    expect(statsPanelHtml({ ...ready, selectedDatabaseIds: [] })).toContain(
      "Select at least one database to see statistics.",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/state.test.ts tests/ui/statsPanel.test.ts`
Expected: FAIL. `runBlocker` returns `null` instead of `"rejected"`, and `statsPanelHtml` is not exported.

- [ ] **Step 3: Implement**

`src/state.ts`: add `import { serverIssues } from "./query/issues";` at the top. Then:

```ts
/** Why the current query/scope can't run yet, or null when it can. */
export type RunBlocker = "loading" | "no-database" | "no-condition" | "unfinished" | "rejected";

type RunInputs = Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds" | "stats">;
```

In `runBlocker`, after the `"unfinished"` line:

```ts
  // A database found a problem in a part of the query (src/query/issues.ts).
  // Only Run is blocked: the statistics that report it stay on screen, and a
  // query or database change resets them before the next fetch.
  if (serverIssues(state.stats).length > 0) return "rejected";
```

`src/ui/statsPanel.ts`: change the type of `BLOCKED_MESSAGES` to `Record<Exclude<RunBlocker, "loading" | "rejected">, string>`, and replace `renderStatsPanel` with:

```ts
/** The statistics column for `state`: "" while the app is still loading. */
export function statsPanelHtml(state: AppState): string {
  const blocker = runBlocker(state);
  if (blocker === "loading") return "";
  // "rejected" is explained BY the results (each database's errors), so they
  // stay on screen; every other blocker means there are no results to show.
  if (blocker && blocker !== "rejected") {
    return card(state, placeholder(BLOCKED_MESSAGES[blocker]));
  }
  const stats = state.stats;
  if (stats.status === "error") {
    return card(
      state,
      `<div class="ui small negative message"><div class="header">Statistics failed</div><p>${escapeHtml(stats.error)}</p></div>`,
    );
  }
  // "idle" with a complete query = the debounce before the fetch starts.
  if (stats.status === "idle" || (stats.status === "loading" && stats.results.length === 0)) {
    return card(state, placeholder("Counting matches…"));
  }
  // The headline stays on top; the per-database list follows. The whole
  // column is sticky and scrolls internally (styles.css .qb-col-stats).
  return card(
    state,
    headlineHtml(stats, state.databases) +
      perDatabaseHtml(stats.results, state.databases) +
      pendingHtml(stats, state.selectedDatabaseIds.length),
  );
}

export function renderStatsPanel(el: HTMLElement, state: AppState): void {
  paint(el, statsPanelHtml(state));
}
```

`src/ui/dataPreview.ts`, in `BLOCKED_MESSAGES`, add:

```ts
  rejected: "A database found a problem in the query (shown above). Change the query to run it.",
```

`src/app.ts` needs no change: `runPreview` already returns when `runBlocker(state)` is set, and `refreshStats` only runs after `changeScope` has reset `stats`.

- [ ] **Step 4: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/ui/statsPanel.ts src/ui/dataPreview.ts tests/state.test.ts tests/ui/statsPanel.test.ts
git commit -m "Block Run while a database reports a problem in the query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Show the placed issues in the query builder

**Files:**
- Modify: `src/ui/queryBuilder.ts` (`issuesHtml`, `footerHtml`, `paintQueryBuilder`)
- Test: `tests/ui/queryBuilder.test.ts`

**Interfaces:**
- Consumes: `shownIssues(state: Pick<AppState, "query" | "issues" | "stats">): Issue[]` (Task 2)
- Produces: `export function footerHtml(query: Group, issues: Issue[], catalog: FieldCatalog): string`

- [ ] **Step 1: Write the failing test**

Append to `tests/ui/queryBuilder.test.ts`, and change its import line to `import { footerHtml, rowDropdown } from "../../src/ui/queryBuilder";` plus:

```ts
import { addChild, emptyQuery, newCondition } from "../../src/query/tree";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import type { Issue } from "../../src/query/types";
```

```ts
describe("the query footer", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const query = addChild(addChild(root, root.id, newCondition()), root.id, newCondition());
  const issue = (nodeId: string): Issue => ({ nodeId, message: "m", kind: "invalid" });

  it("counts the parts with an issue, not the issues", () => {
    expect(footerHtml(query, [issue(root.id), issue(root.id)], catalog)).toContain(
      "1 part of the query still needs attention.",
    );
    expect(footerHtml(query, [issue(root.id), issue("c")], catalog)).toContain(
      "2 parts of the query still need attention.",
    );
  });

  it("shows the query in plain English when nothing needs attention", () => {
    expect(footerHtml(query, [], catalog)).toContain('class="qb-summary"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ui/queryBuilder.test.ts`
Expected: FAIL. `footerHtml` is not exported.

- [ ] **Step 3: Implement**

In `src/ui/queryBuilder.ts`, add `import { shownIssues } from "../query/issues";`.

Change `issuesHtml` so a message shown twice on one node (two hidden children of a collapsed group, say) appears once:

```ts
function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  // A collapsed group can carry the same message for several hidden children.
  const text = (kind: Issue["kind"]) =>
    [...new Set(mine.filter((i) => i.kind === kind).map((i) => i.message))]
      .map(escapeHtml)
      .join(" ");
```

(the rest of the function is unchanged).

Replace `footerHtml`:

```ts
/** The query card's footer: the whole query in plain English once nothing
 *  needs attention, otherwise how many parts do. `issues` are the shown ones
 *  (shownIssues), so the count matches what is on screen. */
export function footerHtml(query: Group, issues: Issue[], catalog: FieldCatalog): string {
  if (countConditions(query) === 0) {
    return `<span class="qb-muted">Add a condition to start building the query.</span>`;
  }
  const pending = new Set(issues.map((i) => i.nodeId)).size;
  if (pending > 0) {
    const what =
      pending === 1
        ? "1 part of the query still needs"
        : `${pending} parts of the query still need`;
    return `<span class="qb-muted">${what} attention.</span>`;
  }
  const text = queryToText(query, catalog);
  return `<span class="qb-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}
```

In `paintQueryBuilder`:

```ts
  // Local issues (validate.ts) and the backend's, each on a node that is drawn.
  const issues = shownIssues(state);
  const ctx: BuilderCtx = { catalog: state.catalog, facets: state.facets, issues };
  paint(
    el,
    `<div class="qb-card qb-query">
       <h2 class="qb-card-title">Query</h2>
       ${nodeHtml(ctx, state.query, true)}
       <div class="qb-query-foot">${footerHtml(state.query, issues, state.catalog)}</div>
     </div>`,
  );
```

If `AppState` is no longer used in `footerHtml`, it is still used by `paintQueryBuilder` and `wireQueryBuilder`: keep the import.

Update the comment above `issuesHtml` to also say: "Issues come from validate.ts and from the backend (src/query/issues.ts)."

- [ ] **Step 4: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Check it in the browser**

Run `npm run dev`. Build a condition with a text field, operator **Equals**, and a value of 101+ characters. This needs Task 5's mock rule, so if Task 5 isn't done yet, do this check after Task 5. Expected:
- a red issue under the condition saying "Text is too long (at most 100 characters).";
- every database row in Statistics shows that message;
- Run is disabled with "A database found a problem in the query (shown above). Change the query to run it.";
- collapsing the group around it moves the issue onto the collapsed group;
- shortening the value clears all of it.

Use Playwright (`npx playwright` with Chromium, or the Playwright MCP tools if available) to drive and screenshot it if no browser is at hand.

- [ ] **Step 6: Commit**

```bash
git add src/ui/queryBuilder.ts tests/ui/queryBuilder.test.ts
git commit -m "Show the backend's issues in the query builder, never on a hidden node

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The mock rejects too-long text, pointing at the condition

**Files:**
- Modify: `mock-server/evaluate.ts` (add `MAX_TEXT_LENGTH`, `queryErrors`)
- Modify: `mock-server/server.ts` (imports; `streamStats`; new `statsOutcome`)
- Test: `tests/mock-server/evaluate.test.ts`, `tests/mock-server/server.test.ts`, `tests/api/mockContract.test.ts`

**Interfaces:**
- Consumes: `StatsErrorMessage` (Task 1), `DatabaseOutcome` (`mock-server/evaluate.ts`)
- Produces: `export const MAX_TEXT_LENGTH = 100`; `export function queryErrors(node: RequestNode): StatsErrorMessage[]`

- [ ] **Step 1: Write the failing tests**

In `tests/mock-server/evaluate.test.ts`, add `queryErrors` and `MAX_TEXT_LENGTH` to the import from `../../mock-server/evaluate`, and add:

```ts
describe("queryErrors", () => {
  const tooLong = "x".repeat(MAX_TEXT_LENGTH + 1);
  const problem = (nodeId: string) => ({
    nodeId,
    kind: "invalid",
    message: "Text is too long (at most 100 characters).",
  });

  it("points at each condition with a too-long text, inside groups too", () => {
    const query = group("AND", { ...cond("note", "eq", tooLong), id: "c1" }, {
      ...group("OR", { ...cond("note", "in", ["ok", tooLong]), id: "c2" }),
      id: "g2",
    });
    expect(queryErrors(query)).toEqual([problem("c1"), problem("c2")]);
  });

  it("accepts text up to the limit, and values that aren't text", () => {
    const query = group(
      "AND",
      cond("note", "eq", "x".repeat(MAX_TEXT_LENGTH)),
      cond("count", "gt", 10 ** 200),
      cond("spare", "isEmpty", null),
    );
    expect(queryErrors(query)).toEqual([]);
  });
});
```

In `tests/mock-server/server.test.ts`, inside `describe("POST /api/stats", …)`, add:

```ts
  it("fails every database, pointing at the condition, when a text is too long", async () => {
    const tooLong = {
      ...everyEvent,
      children: [{ ...everyEvent.children[0], operatorId: "eq", value: "x".repeat(101) }],
    };
    const res = await post(`${API}/stats`, body(["alpha", "beta"], tooLong));
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual(
      ["alpha", "beta"].map((label) => ({
        label,
        success: false,
        errorMessages: [
          { nodeId: "c1", kind: "invalid", message: "Text is too long (at most 100 characters)." },
        ],
        infoMessages: [],
      })),
    );
  });
```

In `tests/api/mockContract.test.ts`, add `Condition` to the import from `../../src/query/types` and, in the `describe` block:

```ts
  it("statistics for a query every database rejects", async () => {
    const ids = (await client.getDatabases()).map((d) => d.id);
    const query = await everyEventQuery();
    const condition = query.children[0] as Condition;
    const tooLong: Group = {
      ...query,
      children: [{ ...condition, operatorId: "eq", value: "x".repeat(101) }],
    };
    const results: DatabaseResult[] = [];
    await client.getStats(tooLong, ids, (r) => results.push(r));
    expect(results).toHaveLength(ids.length);
    for (const r of results) {
      expect(r).toMatchObject({ status: "failed", errors: [{ nodeId: "c1", kind: "invalid" }] });
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server tests/api/mockContract.test.ts`
Expected: FAIL. `queryErrors` is not exported, and the server answers with successful lines.

- [ ] **Step 3: Implement**

`mock-server/evaluate.ts`, before the `DatabaseOutcome` interface:

```ts
/** The longest text value the mock's databases accept. */
export const MAX_TEXT_LENGTH = 100;

/**
 * The problems the mock's databases find in a query: each condition with a
 * text value (or a text item in a list) longer than MAX_TEXT_LENGTH, pointed
 * at by its `id` — the way a real backend reports a value only it can check.
 * Empty when there are none.
 */
export function queryErrors(node: RequestNode): StatsErrorMessage[] {
  if (node.kind === "group") return node.children.flatMap(queryErrors);
  const values = Array.isArray(node.value) ? node.value : [node.value];
  const tooLong = values.some((v) => typeof v === "string" && v.length > MAX_TEXT_LENGTH);
  if (!tooLong) return [];
  return [
    {
      nodeId: node.id,
      kind: "invalid",
      message: `Text is too long (at most ${MAX_TEXT_LENGTH} characters).`,
    },
  ];
}
```

`mock-server/server.ts`: add `queryErrors` and `type DatabaseOutcome` to the import from `./evaluate`, and change the types import to `import type { QueryRequest, StatsErrorMessage } from "../src/api/types";`. Add before `streamStats`:

```ts
/**
 * One database's outcome for /api/stats. A query with problems (queryErrors)
 * fails in every database, with the problems. Otherwise, dev-only: now and
 * then (failRate) simulate a database that can't answer, so the UI's
 * per-database failure path gets exercised.
 */
function statsOutcome(
  c: { label: string; matchCount: number; totalCount: number },
  errorMessages: StatsErrorMessage[],
  failRate: number,
): DatabaseOutcome {
  if (errorMessages.length > 0) {
    return { label: c.label, fail: { errorMessages, infoMessages: [] } };
  }
  if (Math.random() < failRate) {
    return {
      label: c.label,
      fail: {
        errorMessages: [],
        infoMessages: ["This database could not be reached. Try again shortly."],
      },
    };
  }
  const totalEntrysets = DATABASES.find((d) => d.label === c.label)?.totalEntrysets ?? 0;
  // The sample drives match RATES; DATABASES[].totalEntrysets drives the
  // MAGNITUDE the API reports, so the UI sees realistic numbers.
  return { label: c.label, matchCount: scaleCount(c.matchCount, c.totalCount, totalEntrysets) };
}
```

and make the body of `streamStats` (after `if (!body) return;`):

```ts
  // Compute before committing the response header: if this (pure, cheap)
  // computation ever threw, the server's catch block must still be able to
  // send a normal JSON error response — which requires no header sent yet.
  const counts = perDatabaseCounts(body.query, ROWS, body.databases);
  const errorMessages = queryErrors(body.query);
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
  for (const c of counts) {
    const line = buildStatsLine(statsOutcome(c, errorMessages, config.failRate));
    res.write(JSON.stringify(line) + "\n");
    await delay(config.lineDelayMs());
  }
  res.end();
```

- [ ] **Step 4: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add mock-server/evaluate.ts mock-server/server.ts tests/mock-server tests/api/mockContract.test.ts
git commit -m "Mock: reject too-long text in every database, pointing at the condition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If Task 4's browser check (Task 4, Step 5) was postponed, do it now.

---

### Task 6: Architecture document

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Test: `tests/docReferences.test.ts` (existing; checks cited section titles)

- [ ] **Step 1: Edit the sections**

Make these edits, keeping each section's existing style:

1. **§4 Directory layout**, under `query/`, after the `validate.ts` line:
   ```
       issues.ts          serverIssues / placeIssues / shownIssues — the backend's issues, and where every issue is shown.
   ```
   and in the `state.ts` line, after "runBlocker()": nothing changes in wording.

2. **§5 State and the render loop**, the row "A stats line streams in": append "A line whose `errors` point at query nodes also shows those as issues in the builder and blocks Run (see "Statistics lines")."

3. **§6 Correctness invariant**, the bullet "If the query can't run yet": change the parenthesis to "(`runBlocker`: still loading, no database, no condition, any validation issue, or — for Run only — a database that reported a problem in a part of the query)". Add after it:
   ```
   - **A rejected query keeps its statistics.** When a database's stats line
     points at a node (`"rejected"`), only Run is blocked; the statistics stay
     on screen because they are what explains the block. The next query or
     database change resets them, and with them the block.
   ```

4. **"Data model"**, the bullet "A statistics line becomes a `DatabaseResult` …": change "(with `errors`)" to "(with `errors`, each a `DatabaseError`: `message`, `kind`, and the `nodeId` it points at or `null`)".

5. **"Statistics lines"**, after "carries `errors` (from `errorMessages`) instead.": add
   ```
   Each `errorMessages` item is an object `{ nodeId?, message, kind }`
   (`StatsErrorMessage`). `nodeId` is the `id` of a group or condition from the
   request; `kind` is `"incomplete"` or `"invalid"`, like an `Issue` (any other
   kind reads as `"invalid"`). The items decide whether Run is allowed, so a
   plain-text item is a contract error; a blank `message` reads as "The server
   found a problem in the query." The panel shows every error's `message` in
   the database's row. An error with a `nodeId` is also an issue in the query
   builder (`serverIssues`, `src/query/issues.ts`), shown once however many
   databases report it, and blocks Run (`runBlocker` → `"rejected"`).
   ```

6. **"Wire format of the query"**: replace "The backend treats it as opaque; it is reserved so a later error response can point at a condition." with "The backend treats it as opaque, and quotes it back as `nodeId` in a stats line's `errorMessages` to point at the node a problem is in ("Statistics lines")."

7. **§8 The query model**, after the `validate.ts` bullet, add:
   ```
   - **`issues.ts`** — the backend's issues and where issues are shown.
     `serverIssues` turns each stats error that points at a node into an
     `Issue`, once. `placeIssues` moves an issue to a node that is drawn: the
     outermost collapsed group around a hidden node, or the root group for an
     id the query doesn't have. `shownIssues` does both for the builder.
   ```

8. **"Centre — `queryBuilder.ts`"**: replace "Issues show under their row or group. The footer shows the whole query in plain English once it is complete, otherwise how many parts still need attention." with "Issues — the local ones and the backend's — show under their row or group (`shownIssues`): an issue inside a collapsed group shows on that group, and one whose node is unknown on the root group, so none is lost. The footer shows the whole query in plain English once nothing needs attention, otherwise how many parts do."

9. **§10 Mock server**, the `/api/stats` bullet: append "A text value (or a text item in a list) longer than 100 characters fails in every database, with an `errorMessages` item pointing at its condition (`queryErrors`), so the builder's backend issues can be tried in dev."

10. **§11 Error and loading model**: add a bullet:
    ```
    - A database that finds a problem in the query reports it in its stats
      line, not as an HTTP error: the statistics panel shows it in that
      database's row, and an error that points at a query node is also shown in
      the builder and blocks Run ("Statistics lines").
    ```

- [ ] **Step 2: Run all gates**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass (`tests/docReferences.test.ts` still finds every cited section title).

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "Docs: backend issues that point at parts of the query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
