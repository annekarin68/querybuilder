# Drag-to-build, facet presence and the pickle theme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build queries by dragging facets, fields, values and tags from the docs sidebar; allow facet-level "present" conditions; restyle the app with an offline pickle theme and a replaceable mascot.

**Architecture:** Keep one `condition` node; a condition with `fieldId: null` and an operator set is facet-level. `isEmpty`/`isNotEmpty` become `present`/`absent`. Drag payloads are parsed and turned into nodes by a pure module (`src/query/drop.ts`) that reports problems instead of ignoring them; `app.ts` applies them and sets `dropNotice`. Native HTML5 drag-and-drop, native `<details>` for the sidebar cards, CSS-only mascot animation.

**Tech Stack:** TypeScript, Vite, Vitest (node environment — no DOM in tests, so DOM modules keep their logic in pure functions), Fomantic UI (via `src/ui/fomantic.ts` only), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-drag-build-facet-presence-pickle-theme-design.md`

## Global Constraints

- Fully offline: no CDN, webfont or remote image; `npm run build` (includes `check:offline`) must pass.
- The frontend sends the query as the user built it; no rewriting of conditions (`docs/ARCHITECTURE.md`, "Wire format of the query").
- `src/` must never name backend facets/fields/tags/groups (`tests/noBackendDataInSrc.test.ts`); deployment names live only in `src/config.ts`.
- Only `src/ui/fomantic.ts` uses jQuery.
- UI text is unchanged except what the spec names (operator labels, "no field" choice, drop warnings, sidebar controls, easter-egg toast).
- Code citing `docs/ARCHITECTURE.md, "Title"` must use an existing section title (`tests/docReferences.test.ts`).
- Every task ends with `npm run typecheck && npm test && npm run lint` passing. Do not push or open a PR unless asked.
- Update `docs/ARCHITECTURE.md` with each architectural change (Task 9 collects the edits; earlier tasks note what to record).

## Spec corrections found while planning

Apply these to the spec in Task 0 so spec and plan agree:

1. **"No field" choice identification.** The spec said it is identified by `value=""`, but `""` already means "nothing chosen" in the Field dropdown. Real fields are encoded as `f:<fieldId>`, the no-field choice is `none`, unset is `""`.
2. **Search exclusion dropped.** Fomantic offers no hook to exclude one item from search; the distinction is visual only.
3. **Sidebar cards use native `<details>`** (as the tag groups already do) instead of Fomantic's accordion: no JS, keyboard-accessible, works with the existing filter.
4. **Facet-level state.** A condition is facet-level when `facetId` is set, `fieldId` is `null` and `operatorId` is set. Choosing "no field" sets `operatorId: "present"` immediately, so "unset" and "chose no field" are different states.
5. **Mascot "disappointed" state** shows only for `invalid` issues (the red ones), not for unfinished ones, so adding an empty row does not make the pickle sad.
6. **Drop-problem table.** Tag drops look their facets up in the loaded data, so "some facets unknown" cannot occur; replace that row with: "Tag drop: the facets carrying the tag in the loaded docs are added; a tag with none gets the 'has no facets' message." Also drop the spec's `docs/CHANGELOG.md` update (that file is archived and no longer updated).

## File Structure

| File | Responsibility |
|---|---|
| `src/query/fieldCatalog.ts` (modify) | `present`/`absent` operators, `FACET_OPERATOR_IDS`, `operatorName`, `isFacetLevel`, `catalog.facets`, `findFacet` |
| `src/query/validate.ts` (modify) | facet-level validation |
| `src/query/summary.ts` (modify) | "Facet is present" text |
| `src/query/conditionEdit.ts` (modify) | facet-only picks |
| `src/api/types.ts`, `src/api/request.ts` (modify) | `fieldId: string \| null` on the wire |
| `mock-server/requestBody.ts`, `mock-server/evaluate.ts` (modify) | accept null `fieldId`, evaluate `present`/`absent` |
| `src/query/tree.ts` (modify) | `insertNodes`, `moveNode`, `parentOf` |
| `src/query/drop.ts` (create) | drag payload parsing, nodes for a drop, problems |
| `src/state.ts`, `src/app.ts` (modify) | `dropNotice`, `onDropItem`, `onAddItem`, `dismissDropNotice`, sidebar open by default |
| `src/ui/docsSidebar.ts` (modify) | redesigned cards, grips, add buttons, drag start |
| `src/ui/docsResize.ts` (create) | sidebar width clamp, resize handle, remembered width |
| `src/ui/queryBuilder.ts` (modify) | no-field dropdown, drop targets, notice, node grips |
| `src/ui/layout.ts` (modify) | logo `<img>`, resize handle, "Hide docs" |
| `src/ui/mascot.ts` (create) | `mascotFor(state)` |
| `src/ui/pickleRain.ts` (create) | click counter, rain plan, DOM overlay |
| `src/ui/fomantic.ts` (modify) | `showToast` |
| `src/config.ts` (modify) | mascot paths, easter-egg text |
| `public/pickle/*.svg` (create) | four replaceable mascot files |
| `src/styles.css`, `index.html` (modify) | palette tokens, new component styles, favicon |
| `docs/ARCHITECTURE.md`, `docs/CHANGELOG.md` (modify) | keep docs current |

---

### Task 0: Working install, baseline, spec corrections

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-drag-build-facet-presence-pickle-theme-design.md`

- [ ] **Step 1: Real install (no symlinked node_modules)**

Run: `npm ci`
Expected: completes without error.

- [ ] **Step 2: Baseline**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass. If anything fails here, stop and report: the baseline must be green before changes.

- [ ] **Step 3: Apply the six spec corrections**

Edit the spec: in section 4 "Condition row", replace the bullet beginning `- it is identified by value=""` and the bullet `it reads … and is excluded from search matching` so they say: the no-field option has `value="none"`, real fields are `f:<id>`, unset is `""`, and search exclusion is not attempted. In section 5 replace "(Fomantic accordion)" with "(native `<details>`, like the tag groups)". In section 6 mascot table, change the `disappointed.svg` row to "while the query has invalid (red) issues". Apply correction 6 to the section 4 drop-feedback table and section 7. Add to section 3: "A condition is facet-level when `facetId` is set, `fieldId` is null and `operatorId` is set; choosing the no-field option sets `operatorId` to `present`."

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs
git commit -m "Spec: settle no-field value, facet-level state, details cards

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Operators `present`/`absent` and facet info in the catalog

**Files:**
- Modify: `src/query/fieldCatalog.ts`
- Modify: `tests/query/fieldCatalog.test.ts`, and every test fixture that builds a `FieldCatalog` literal (`tests/query/validate.test.ts`, `tests/query/summary.test.ts`, `tests/query/conditionEdit.test.ts`; typecheck lists any others)

**Interfaces:**
- Produces (used by Tasks 2–6):
  - `interface CatalogFacet { id: string; name: string }`
  - `FieldCatalog = { facets: CatalogFacet[]; fields: CatalogField[] }`
  - `const FACET_OPERATOR_IDS: string[]` = `["present", "absent"]`
  - `findFacet(catalog, facetId: string | null): CatalogFacet | undefined`
  - `operatorName(op: CatalogOperator, facetLevel: boolean): string`
  - `isFacetLevel(c: { facetId: string | null; fieldId: string | null; operatorId: string | null }): boolean`

- [ ] **Step 1: Write the failing tests**

Add to `tests/query/fieldCatalog.test.ts` (import the new names at the top):

```ts
import {
  FACET_OPERATOR_IDS,
  findFacet,
  isFacetLevel,
  operatorName,
  findOperator,
} from "../../src/query/fieldCatalog";

describe("presence operators", () => {
  it("present / absent replace isNotEmpty / isEmpty", () => {
    expect(findOperator("present")).toMatchObject({ arity: "none" });
    expect(findOperator("absent")).toMatchObject({ arity: "none" });
    expect(findOperator("isEmpty")).toBeUndefined();
    expect(findOperator("isNotEmpty")).toBeUndefined();
  });

  it("labels depend on whether the condition is about a facet or a field", () => {
    const present = findOperator("present")!;
    const absent = findOperator("absent")!;
    expect(operatorName(present, false)).toBe("Has any value");
    expect(operatorName(present, true)).toBe("Is present");
    expect(operatorName(absent, false)).toBe("Has no value");
    expect(operatorName(absent, true)).toBe("Is absent");
    expect(operatorName(findOperator("eq")!, true)).toBe("Equals");
  });

  it("a facet-level condition offers only present / absent", () => {
    expect(FACET_OPERATOR_IDS).toEqual(["present", "absent"]);
  });

  it("isFacetLevel needs a facet, no field and an operator", () => {
    expect(isFacetLevel({ facetId: "a", fieldId: null, operatorId: "present" })).toBe(true);
    expect(isFacetLevel({ facetId: "a", fieldId: null, operatorId: null })).toBe(false);
    expect(isFacetLevel({ facetId: "a", fieldId: "f", operatorId: "present" })).toBe(false);
    expect(isFacetLevel({ facetId: null, fieldId: null, operatorId: "present" })).toBe(false);
  });
});
```

Add a test in the existing `buildFieldCatalog` describe block (reuse that file's facet fixture helper; if none, build a one-facet array):

```ts
it("lists every facet, even one with no fields", () => {
  const catalog = buildFieldCatalog([
    { id: "a", name: "Alpha", tags: [], group: "", comment: "", description: "", eventCount: 1, fields: [] },
  ]);
  expect(catalog.facets).toEqual([{ id: "a", name: "Alpha" }]);
  expect(findFacet(catalog, "a")?.name).toBe("Alpha");
  expect(findFacet(catalog, "zzz")).toBeUndefined();
  expect(findFacet(catalog, null)).toBeUndefined();
});
```

In the three existing operator-list assertions in that file, replace `"isEmpty", "isNotEmpty"` with `"present", "absent"`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query/fieldCatalog.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement in `src/query/fieldCatalog.ts`**

Add after `CatalogOperator`:

```ts
/** One facet the query can be about, even a facet with no fields. */
export interface CatalogFacet {
  id: string;
  name: string;
}
```

Change `FieldCatalog`:

```ts
export interface FieldCatalog {
  facets: CatalogFacet[];
  fields: CatalogField[];
}
```

Replace the last two entries of `OPERATORS`:

```ts
  { id: "present", name: "Has any value", arity: "none" },
  { id: "absent", name: "Has no value", arity: "none" },
```

Below `OPERATORS` add:

```ts
/** The only operators a condition about a whole facet (no field) offers. */
export const FACET_OPERATOR_IDS = ["present", "absent"];

const FACET_OPERATOR_NAMES: Record<string, string> = {
  present: "Is present",
  absent: "Is absent",
};

/** An operator's label. "present" / "absent" read differently for a whole
 *  facet ("Is present") than for a field ("Has any value"); the id is the same. */
export function operatorName(op: CatalogOperator, facetLevel: boolean): string {
  return (facetLevel && FACET_OPERATOR_NAMES[op.id]) || op.name;
}

/** Whether a condition is about the facet itself: a facet and an operator are
 *  chosen, but no field. (A facet with nothing else chosen is just unfinished.) */
export function isFacetLevel(c: {
  facetId: string | null;
  fieldId: string | null;
  operatorId: string | null;
}): boolean {
  return c.facetId !== null && c.fieldId === null && c.operatorId !== null;
}

export function findFacet(
  catalog: FieldCatalog,
  facetId: string | null,
): CatalogFacet | undefined {
  return facetId ? catalog.facets.find((f) => f.id === facetId) : undefined;
}
```

In `OPERATOR_PROFILE` replace `"isEmpty", "isNotEmpty"` with `"present", "absent"` (string, number, date). In `buildFieldCatalog` change the return to:

```ts
  return { facets: facets.map((f) => ({ id: f.id, name: f.name })), fields };
```

- [ ] **Step 4: Fix fixtures**

Run: `npm run typecheck`. For each `FieldCatalog` literal in tests it flags, add `facets: [{ id: "thing", name: "Thing" }],` (validate/summary/conditionEdit fixtures all use facet id `"thing"`). In `tests/query/validate.test.ts` and `tests/api/*.test.ts`/`tests/mock-server/*.test.ts` replace operator ids `isEmpty`→`absent` and `isNotEmpty`→`present` (semantics: `isEmpty` = absent, `isNotEmpty` = present). `tests/query/summary.test.ts` line ~73: operator `isEmpty` → `absent`; expected text `"Color Is empty"` → `"Color Has no value"`. In `mock-server/evaluate.ts` change `case "isEmpty":` → `case "absent":` and `case "isNotEmpty":` → `case "present":` for now (Task 2 adds the facet-level behaviour); update `tests/mock-server/evaluate.test.ts` test name and ids the same way.

Also update `summary.ts` `conditionText` to use `operatorName(op, false)` instead of `op.name`:

```ts
import { findField, findOperator, operatorName, type Arity, type FieldCatalog } from "./fieldCatalog";
...
  const parts = [field?.name ?? "(field?)", op ? operatorName(op, false) : "(operator?)"];
```

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src tests mock-server
git commit -m "Rename isEmpty/isNotEmpty to absent/present; catalog lists facets

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Facet-level conditions in validation, summary, wire format and mock

**Files:**
- Modify: `src/query/validate.ts`, `src/query/summary.ts`, `src/api/types.ts`, `src/api/request.ts`, `mock-server/requestBody.ts`, `mock-server/evaluate.ts`
- Test: `tests/query/validate.test.ts`, `tests/query/summary.test.ts`, `tests/api/request.test.ts`, `tests/mock-server/requestBody.test.ts`, `tests/mock-server/evaluate.test.ts`

**Interfaces:**
- Consumes: Task 1 (`findFacet`, `FACET_OPERATOR_IDS`, `isFacetLevel`, `operatorName`)
- Produces: `RequestCondition.fieldId: string | null`; `present`/`absent` evaluated per facet in the mock.

- [ ] **Step 1: Write failing tests**

`tests/query/validate.test.ts` (catalog fixture now has `facets: [{ id: "thing", name: "Thing" }]`; `validateOne` already defaults `facetId: "thing"`):

```ts
describe("facet-level conditions (no field)", () => {
  it("present with no value is complete", () => {
    expect(validateOne({ fieldId: null, operatorId: "present", value: null }).issues).toEqual([]);
  });
  it("absent is complete too", () => {
    expect(validateOne({ fieldId: null, operatorId: "absent", value: null }).issues).toEqual([]);
  });
  it("a facet alone, with no operator, still says Choose a field.", () => {
    expectIssue({ fieldId: null, operatorId: null }, "Choose a field.", "incomplete");
  });
  it("an unknown facet is invalid", () => {
    expectIssue(
      { facetId: "nope", fieldId: null, operatorId: "present", value: null },
      "Unknown facet.",
      "invalid",
    );
  });
  it("an operator that needs a field is invalid", () => {
    expectIssue(
      { fieldId: null, operatorId: "eq", value: "x" },
      "That operator isn't available for a whole facet.",
      "invalid",
    );
  });
  it("a value on a facet-level condition is invalid", () => {
    expectIssue(
      { fieldId: null, operatorId: "present", value: "x" },
      "This operator takes no value.",
      "invalid",
    );
  });
});
```

`tests/query/summary.test.ts`:

```ts
it("a facet-level condition reads 'Facet is present'", () => {
  const root = emptyQuery();
  const c = newCondition();
  let t = addChild(root, root.id, c);
  t = updateNode(t, c.id, { facetId: "thing", fieldId: null, operatorId: "present", value: null });
  expect(queryToText(t, catalog)).toBe("Thing is present");
  t = updateNode(t, c.id, { operatorId: "absent" });
  expect(queryToText(t, catalog)).toBe("Thing is absent");
});
```

`tests/api/request.test.ts` (use that file's existing helpers `addChild`, `updateNode`, `toQueryRequest`):

```ts
it("sends a facet-level condition with fieldId null", () => {
  const root = emptyQuery();
  const c = newCondition();
  const t = updateNode(addChild(root, root.id, c), c.id, {
    facetId: "thing",
    fieldId: null,
    operatorId: "present",
    value: null,
  });
  const sent = toQueryRequest(t, ["alpha"]).query.children as RequestCondition[];
  expect(sent[0]).toMatchObject({ facetId: "thing", fieldId: null, operatorId: "present", value: null });
});

it("still rejects a condition with no facet", () => {
  const root = emptyQuery();
  const c = newCondition();
  const t = updateNode(addChild(root, root.id, c), c.id, { operatorId: "present", value: null });
  expect(() => toQueryRequest(t, ["alpha"])).toThrow(/unfinished/);
});
```

`tests/mock-server/requestBody.test.ts`:

```ts
it("accepts a null fieldId", () => {
  const node = { kind: "condition", id: "c", facetId: "f", fieldId: null, operatorId: "present", value: null };
  expect(queryProblem(node)).toBeNull();
});
it("still rejects an empty-string or numeric fieldId", () => {
  const base = { kind: "condition", id: "c", facetId: "f", operatorId: "present", value: null };
  expect(queryProblem({ ...base, fieldId: "" })).toMatch(/fieldId/);
  expect(queryProblem({ ...base, fieldId: 3 })).toMatch(/fieldId/);
});
```

`tests/mock-server/evaluate.test.ts` — look at that file's `cond(...)` helper and `row`; add (the helper takes a field label and builds `facetId`; check its signature first and add a `facetCond` local helper if it only builds field conditions):

```ts
const facetCond = (facetId: string, operatorId: string): RequestCondition => ({
  kind: "condition", id: "x", facetId, fieldId: null, operatorId, value: null,
});
it("facet-level present / absent look at whether the event holds any value for the facet", () => {
  const r: Row = { id: 1, __db: "a", [rowKey("engine", "rpm")]: 3000 };
  expect(matches(facetCond("engine", "present"), r)).toBe(true);
  expect(matches(facetCond("engine", "absent"), r)).toBe(false);
  expect(matches(facetCond("brakes", "present"), r)).toBe(false);
  expect(matches(facetCond("brakes", "absent"), r)).toBe(true);
});
it("a facet whose name starts with another facet's name is not confused with it", () => {
  const r: Row = { id: 1, __db: "a", [rowKey("engine_oil", "level")]: 1 };
  expect(matches(facetCond("engine", "present"), r)).toBe(false);
});
```

(Use the file's own facet labels if `engine`/`rpm` read like real mock data — pick any two labels; the mock tests may name mock data, `src/` may not.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query tests/api/request.test.ts tests/mock-server`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`src/query/validate.ts` — replace the head of `checkCondition` and add the facet-level function. Import `findFacet`, `FACET_OPERATOR_IDS`:

```ts
/** A condition about a whole facet: no field, so only presence operators. */
function checkFacetCondition(c: Condition, catalog: FieldCatalog, out: Issue[]): void {
  if (!findFacet(catalog, c.facetId)) {
    out.push(invalid(c.id, "Unknown facet."));
    return;
  }
  const op = findOperator(c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!FACET_OPERATOR_IDS.includes(op.id)) {
    out.push(invalid(c.id, "That operator isn't available for a whole facet."));
    return;
  }
  if (c.value !== null) out.push(invalid(c.id, "This operator takes no value."));
}

function checkCondition(c: Condition, catalog: FieldCatalog, out: Issue[]): void {
  if (!c.facetId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  if (c.fieldId === null) {
    // No field: either nothing chosen yet, or a deliberate facet-only condition.
    if (c.operatorId === null) out.push(incomplete(c.id, "Choose a field."));
    else checkFacetCondition(c, catalog, out);
    return;
  }
  const fieldDef = findField(catalog, c.facetId, c.fieldId);
  // ... the rest of the function is unchanged
```

Delete the old first `if (!c.facetId || !c.fieldId)` block. Leave the remainder as it was (`if (!fieldDef) …`).

`src/query/summary.ts` — facet-level branch at the top of `conditionText`:

```ts
import { findFacet, findField, findOperator, isFacetLevel, operatorName, type Arity, type FieldCatalog } from "./fieldCatalog";

function conditionText(catalog: FieldCatalog, c: Condition): string {
  if (isFacetLevel(c)) {
    const facet = findFacet(catalog, c.facetId)?.name ?? "(facet?)";
    const op = findOperator(c.operatorId);
    return `${facet} ${op ? operatorName(op, true).toLowerCase() : "(operator?)"}`;
  }
  // ... unchanged
```

`operatorName(present, true)` is "Is present" → lowercased "is present" → "Thing is present". ✔.

`src/api/types.ts` — in `RequestCondition` replace the `fieldId` member:

```ts
  /** `IndividualFieldResponse.label`, within that individual — or `null` for a
   *  condition about the individual (facet) itself, e.g. "is present". What a
   *  null field means is the backend's to interpret. */
  fieldId: string | null;
```

`src/api/request.ts` — in `conditionOf` change the guard to `if (c.facetId === null || c.operatorId === null)` and keep `fieldId: c.fieldId`.

`mock-server/requestBody.ts` — replace the loop:

```ts
  for (const key of ["facetId", "operatorId"] as const) {
    if (!isNonEmptyString(node[key])) return `${at}.${key} must be a non-empty string.`;
  }
  if (node.fieldId !== null && !isNonEmptyString(node.fieldId)) {
    return `${at}.fieldId must be a non-empty string or null.`;
  }
```

`mock-server/evaluate.ts` — at the top of `conditionMatches`:

```ts
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Whether the event holds any value at all for the facet (see `rowKey`). */
function rowHasFacet(row: Row, facetId: string): boolean {
  const prefix = `${facetId}.`;
  return Object.keys(row).some((k) => k.startsWith(prefix));
}

function conditionMatches(c: RequestCondition, row: Row): boolean {
  if (c.fieldId === null) {
    // A condition about the facet itself: only presence makes sense.
    if (c.operatorId === "present") return rowHasFacet(row, c.facetId);
    if (c.operatorId === "absent") return !rowHasFacet(row, c.facetId);
    return false;
  }
  const v = row[rowKey(c.facetId, c.fieldId)];
```

and replace the two `present`/`absent` cases with `return !isBlank(v);` / `return isBlank(v);`. The `__db` and `id` keys never start with a facet prefix because facet ids have no dots and those keys have no dot — if the mock's data ever has such ids, the existing comment on `rowKey` already warns.

Also check `mock-server` for any place that reads `condition.fieldId` as a string (`grep -n "fieldId" mock-server/*.ts`) and make it null-safe (`computeBlocks` etc. work on schema fields, not conditions; adjust only what typecheck flags).

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tests mock-server
git commit -m "Facet-level conditions: validation, summary, wire format, mock

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Condition row — the "no field" choice

**Files:**
- Modify: `src/query/conditionEdit.ts`, `src/ui/queryBuilder.ts`, `src/styles.css`
- Test: `tests/query/conditionEdit.test.ts`, `tests/ui/queryBuilder.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isFacetLevel`, `FACET_OPERATOR_IDS`, `operatorName`)
- Produces:
  - `RowPicks` gains `facetOnly: boolean`.
  - `export const NO_FIELD = "none"`, `export const FIELD_PREFIX = "f:"` and `export function fieldDropdown(fields: {id: string; name: string}[], selectedId: string | null, facetOnly: boolean, enabled: boolean): string` in `src/ui/queryBuilder.ts`.

- [ ] **Step 1: Write failing tests**

`tests/query/conditionEdit.test.ts` — existing `picks` literals need `facetOnly: false`; add:

```ts
describe("nextCondition with the no-field choice", () => {
  const none = { facetId: "thing", fieldId: null, operatorId: null, facetOnly: true };

  it("choosing no field sets 'present' and a null value", () => {
    const start = cond({ fieldId: null, operatorId: null, value: null });
    expect(nextCondition(start, none, catalog, onScreen(null))).toEqual({
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    });
  });

  it("keeps the operator the user switched to (absent)", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    const picks = { ...none, operatorId: "absent" };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: null,
      operatorId: "absent",
    });
  });

  it("switching from no field to a real field clears the operator", () => {
    const start = cond({ fieldId: null, operatorId: "absent", value: null });
    const picks = { facetId: "thing", fieldId: "size", operatorId: "absent", facetOnly: false };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: "size",
      operatorId: null,
    });
  });

  it("clearing the field choice clears the operator", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    const picks = { facetId: "thing", fieldId: null, operatorId: "present", facetOnly: false };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toMatchObject({
      fieldId: null,
      operatorId: null,
    });
  });

  it("changing the facet resets everything, even from no field", () => {
    const start = cond({ fieldId: null, operatorId: "present", value: null });
    const picks = { facetId: "other", fieldId: null, operatorId: "present", facetOnly: true };
    expect(nextCondition(start, picks, catalog, onScreen(null))).toEqual({
      facetId: "other",
      fieldId: null,
      operatorId: null,
      value: null,
    });
  });
});
```

`tests/ui/queryBuilder.test.ts`:

```ts
import { fieldDropdown, NO_FIELD } from "../../src/ui/queryBuilder";

describe("field dropdown", () => {
  const fields = [{ id: "a", name: "Alpha" }];

  it("lists the no-field choice first, apart from real fields", () => {
    const html = fieldDropdown(fields, null, false, true);
    expect(html.indexOf(`value="${NO_FIELD}"`)).toBeLessThan(html.indexOf('value="f:a"'));
    expect(html).toContain("— no field (facet only) —");
  });

  it("a real field is encoded so it can never equal the no-field value", () => {
    const html = fieldDropdown([{ id: NO_FIELD, name: "Any field" }], null, false, true);
    expect(html).toContain(`<option value="f:${NO_FIELD}">Any field</option>`);
    expect(html.match(new RegExp(`value="${NO_FIELD}"`, "g"))).toHaveLength(1);
  });

  it("marks the dropdown when no field is chosen", () => {
    expect(fieldDropdown(fields, null, true, true)).toContain("qb-no-field");
    expect(fieldDropdown(fields, null, true, true)).toContain(`<option value="${NO_FIELD}" selected>`);
    expect(fieldDropdown(fields, "a", false, true)).not.toContain("qb-no-field");
    expect(fieldDropdown(fields, "a", false, true)).toContain('<option value="f:a" selected>');
  });

  it("is still a labelled search dropdown, disabled until a facet is chosen", () => {
    const html = fieldDropdown(fields, null, false, false);
    expect(html).toContain('class="ui search selection dropdown');
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain(" disabled");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query/conditionEdit.test.ts tests/ui/queryBuilder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `conditionEdit.ts`**

Add `facetOnly: boolean` to `RowPicks` (doc: "true when the Field dropdown shows the no-field choice"). Replace the body of `nextCondition` up to the `field`/`operator` lookups:

```ts
export function nextCondition(cond, picks, catalog, readValue) {
  const facetId = picks.facetId;
  const facetChanged = facetId !== cond.facetId;
  // A new facet starts over: neither a field nor "no field" carries across.
  const facetOnly = !facetChanged && picks.facetOnly;
  const fieldId = facetChanged || facetOnly ? null : picks.fieldId;
  const wasFacetOnly = isFacetLevel(cond);
  const fieldChanged = facetChanged || fieldId !== cond.fieldId || facetOnly !== wasFacetOnly;
  // Choosing "no field" picks "present" straight away, so the condition is
  // already complete and can be told apart from "nothing chosen yet".
  const operatorId = fieldChanged ? (facetOnly ? "present" : null) : picks.operatorId;

  const field = findField(catalog, facetId, fieldId);
  const operator = findOperator(operatorId);
  const sameShape = findOperator(cond.operatorId)?.arity === operator?.arity;

  let value = defaultValueFor(field, operator);
  if (!fieldChanged && sameShape && field && operator) {
    value = readValue(operator.arity, field.valueType) ?? value;
  }
  return { facetId, fieldId, operatorId, value };
}
```

Import `isFacetLevel` from `./fieldCatalog`. (For a facet-level condition `field` is undefined so `value` stays `defaultValueFor(undefined, op)` = `null`. ✔)

- [ ] **Step 4: Implement `queryBuilder.ts`**

Add exports and the dropdown:

```ts
/** The Field dropdown's value for "no field — about the facet itself". "" means
 *  nothing chosen yet; real fields are `FIELD_PREFIX` + id, so no field can
 *  ever collide with this value (or with a field literally named "Any field"). */
export const NO_FIELD = "none";
export const FIELD_PREFIX = "f:";

/** The row's Field dropdown: nothing chosen, the no-field choice, then the fields. */
export function fieldDropdown(
  fields: { id: string; name: string }[],
  selectedId: string | null,
  facetOnly: boolean,
  enabled: boolean,
): string {
  const opts = optionsHtml(
    fields,
    (f) => FIELD_PREFIX + f.id,
    (f) => f.name,
    (f) => f.id === selectedId,
  );
  const noField = `<option value="${NO_FIELD}"${facetOnly ? " selected" : ""}>— no field (facet only) —</option>`;
  // Fomantic copies the <select>'s classes onto the dropdown it builds, so
  // `qb-no-field` lets the CSS style the shown text and the menu item.
  return `<select class="ui search selection dropdown${facetOnly ? " qb-no-field" : ""}" data-part="field" aria-label="Field"${enabled ? "" : " disabled"}><option value="">Field…</option>${noField}${opts}</select>`;
}
```

In `conditionHtml`: compute `const facetLevel = isFacetLevel(c);` (import `isFacetLevel`, `FACET_OPERATOR_IDS`, `operatorName`), then:

```ts
  const operators = facetLevel
    ? OPERATORS.filter((o) => FACET_OPERATOR_IDS.includes(o.id))
    : field
      ? OPERATORS.filter((o) => field.operatorIds.includes(o.id))
      : [];
  const operatorChoices = operators.map((o) => ({ id: o.id, name: operatorName(o, facetLevel) }));
```

and in the grid use `fieldDropdown(fields, c.fieldId, facetLevel, Boolean(c.facetId))` and `rowDropdown("operator", operatorChoices, c.operatorId, field !== undefined || facetLevel)`.

In `handleRowChange`, build the picks. The field select now holds encoded values, so replace the `picked` usage:

```ts
    const fieldValue = picked("field");
    const facetOnly = fieldValue === NO_FIELD;
    const fieldId = fieldValue?.startsWith(FIELD_PREFIX) ? fieldValue.slice(FIELD_PREFIX.length) : null;
    const nextPart = changedPart && picked(changedPart) ? NEXT_PART[changedPart] : undefined;
    const patch = nextCondition(cond, { facetId: picked("facet"), fieldId, operatorId: picked("operator"), facetOnly }, catalog, ...);
```

After choosing "no field" the cursor should go to the operator: `NEXT_PART.field` is already `"operator"`. ✔ The operator dropdown is enabled for facet-level, so `focusPart` opens it.

- [ ] **Step 5: Styles**

Append to `src/styles.css` (inside the condition-row area, after `.qb-cond-grid .ui.selection.dropdown > .text`):

```css
/* The "no field" choice must never look like a real field (a field could
   literally be named "Any field"): muted italics and a dashed outline, both in
   the shown text and in the menu. */
.qb-cond-grid .ui.selection.dropdown.qb-no-field {
  border-style: dashed;
}
.qb-cond-grid .ui.selection.dropdown.qb-no-field > .text,
.qb-cond-grid .ui.dropdown .menu > .item[data-value="none"] {
  font-style: italic;
  color: var(--qb-muted);
}
.qb-cond-grid .ui.dropdown .menu > .item[data-value="none"] {
  border-bottom: 1px dashed var(--qb-border-strong);
}
```

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Browser check (Playwright)**

Run `npm run dev` in the background, open the app, and check: (a) the Field menu shows the dashed italic no-field item first; (b) choosing it sets the operator to "Is present", the dropdown text is italic/dashed, and the footer summary reads "<Facet> is present"; (c) switching to a real field resets the operator. If the dashed/italic style does not apply to the shown text, Fomantic did not copy the select's class: add a `data-no-field` marker check in `onDropdownChange` and toggle the class on the built `.ui.dropdown` element instead, then re-check. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "Condition row: a visually distinct 'no field' choice for facet-level conditions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tree moves and drop logic (pure)

**Files:**
- Modify: `src/query/tree.ts`
- Create: `src/query/drop.ts`
- Test: `tests/query/tree.test.ts`, `tests/query/drop.test.ts`

**Interfaces:**
- Consumes: Task 1 catalog types
- Produces:
  - `tree.ts`: `insertNodes(tree: Group, targetId: string, nodes: QueryNode[]): Group`; `moveNode(tree: Group, nodeId: string, targetId: string): Group | null`
  - `drop.ts`:

```ts
export const DRAG_MIME = "application/x-qb-item";
export type DragItem =
  | { type: "facet"; facetId: string }
  | { type: "field"; facetId: string; fieldId: string }
  | { type: "value"; facetId: string; fieldId: string; value: string }
  | { type: "tag"; tag: string }
  | { type: "node"; nodeId: string };
export function parseDragItem(text: string): DragItem | null;
export interface DropResult { nodes: QueryNode[]; problems: string[] }
export function nodesForItem(item: Exclude<DragItem, { type: "node" }>, facets: Facet[], catalog: FieldCatalog): DropResult;
export function dropNotice(problems: string[]): string | null;
```

- [ ] **Step 1: Write failing tests**

`tests/query/tree.test.ts` (append; uses the file's existing imports plus `insertNodes`, `moveNode`, `findNode`):

```ts
describe("insertNodes", () => {
  it("appends to a group", () => {
    const root = emptyQuery();
    const a = newCondition();
    const b = newCondition();
    const t = insertNodes(addChild(root, root.id, a), root.id, [b]);
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual([a.id, b.id]);
  });
  it("inserts before a condition", () => {
    const root = emptyQuery();
    const a = newCondition();
    const b = newCondition();
    const c = newCondition();
    const t = insertNodes(addChild(addChild(root, root.id, a), root.id, b), b.id, [c]);
    expect(t.children.map((n) => n.id)).toEqual([a.id, c.id, b.id]);
  });
  it("does nothing for an unknown target", () => {
    const root = emptyQuery();
    expect(insertNodes(root, "nope", [newCondition()])).toEqual(root);
  });
});

describe("moveNode", () => {
  it("moves a condition into another group", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = addChild(t, root.id, g);
    const moved = moveNode(t, c.id, g.id)!;
    expect(moved.children.map((n) => n.id)).toEqual([g.id]);
    const inner = findNode(moved, g.id);
    expect(inner?.kind === "group" && inner.children.map((n) => n.id)).toEqual([c.id]);
  });
  it("reorders before a sibling and keeps the node's data", () => {
    const root = emptyQuery();
    const a = { ...newCondition(), facetId: "x" };
    const b = newCondition();
    const t = addChild(addChild(root, root.id, a), root.id, b);
    const moved = moveNode(t, b.id, a.id)!;
    expect(moved.children.map((n) => n.id)).toEqual([b.id, a.id]);
    expect(findNode(moved, a.id)).toMatchObject({ facetId: "x" });
  });
  it("refuses to move a group into itself or a descendant", () => {
    const root = emptyQuery();
    const outer = { ...newGroup(), children: [] };
    const inner = { ...newGroup(), children: [] };
    let t = addChild(root, root.id, outer);
    t = addChild(t, outer.id, inner);
    expect(moveNode(t, outer.id, outer.id)).toBeNull();
    expect(moveNode(t, outer.id, inner.id)).toBeNull();
  });
  it("refuses to move the root", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    expect(moveNode(addChild(root, root.id, g), root.id, g.id)).toBeNull();
  });
  it("returns null for unknown ids", () => {
    const root = emptyQuery();
    expect(moveNode(root, "a", "b")).toBeNull();
  });
});
```

`tests/query/drop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dropNotice, nodesForItem, parseDragItem } from "../../src/query/drop";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import type { Condition } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facet = (id: string, tags: string[], fields: Facet["fields"] = []): Facet => ({
  id, name: id.toUpperCase(), tags, group: "", comment: "", description: "", eventCount: 1, fields,
});
const fld = (id: string, typeName: string, values: string[] = []) => ({
  id, name: id, typeName, comment: "", description: "", values,
});
const facets = [
  facet("a", ["t1"], [fld("size", "BIGINT", ["3.0", "7"]), fld("color", "VARCHAR(9)", ["red"]), fld("on", "BOOLEAN")]),
  facet("b", ["t1", "t2"]),
  facet("c", []),
];
const catalog = buildFieldCatalog(facets);
const conds = (r: { nodes: unknown[] }) => r.nodes as Condition[];

describe("parseDragItem", () => {
  it("reads each kind", () => {
    expect(parseDragItem('{"type":"facet","facetId":"a"}')).toEqual({ type: "facet", facetId: "a" });
    expect(parseDragItem('{"type":"field","facetId":"a","fieldId":"size"}')).toEqual({ type: "field", facetId: "a", fieldId: "size" });
    expect(parseDragItem('{"type":"value","facetId":"a","fieldId":"size","value":"7"}')).toEqual({ type: "value", facetId: "a", fieldId: "size", value: "7" });
    expect(parseDragItem('{"type":"tag","tag":"t1"}')).toEqual({ type: "tag", tag: "t1" });
    expect(parseDragItem('{"type":"node","nodeId":"c-1"}')).toEqual({ type: "node", nodeId: "c-1" });
  });
  it("rejects anything else", () => {
    for (const bad of ["", "nope", "[]", "null", '{"type":"facet"}', '{"type":"zzz"}', '{"type":"field","facetId":"a"}', '{"type":"value","facetId":"a","fieldId":"b","value":3}']) {
      expect(parseDragItem(bad)).toBeNull();
    }
  });
});

describe("nodesForItem", () => {
  it("a facet becomes a facet-level 'present' condition", () => {
    const r = nodesForItem({ type: "facet", facetId: "a" }, facets, catalog);
    expect(r.problems).toEqual([]);
    expect(conds(r)).toHaveLength(1);
    expect(conds(r)[0]).toMatchObject({ kind: "condition", facetId: "a", fieldId: null, operatorId: "present", value: null });
  });
  it("a field becomes a condition with no operator yet", () => {
    const r = nodesForItem({ type: "field", facetId: "a", fieldId: "size" }, facets, catalog);
    expect(conds(r)[0]).toMatchObject({ facetId: "a", fieldId: "size", operatorId: null, value: null });
  });
  it("a string value becomes 'eq'", () => {
    const r = nodesForItem({ type: "value", facetId: "a", fieldId: "color", value: "red" }, facets, catalog);
    expect(conds(r)[0]).toMatchObject({ fieldId: "color", operatorId: "eq", value: "red" });
  });
  it("a number field's value is sent as a number, matching the pick-list", () => {
    const r = nodesForItem({ type: "value", facetId: "a", fieldId: "size", value: "3" }, facets, catalog);
    expect(conds(r)[0]).toMatchObject({ operatorId: "eq", value: 3 });
  });
  it("a tag becomes one 'present' per facet carrying it", () => {
    const r = nodesForItem({ type: "tag", tag: "t1" }, facets, catalog);
    expect(conds(r).map((c) => c.facetId)).toEqual(["a", "b"]);
    expect(r.problems).toEqual([]);
  });
  it("every created condition has its own id", () => {
    const ids = conds(nodesForItem({ type: "tag", tag: "t1" }, facets, catalog)).map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });
  it("reports an unknown facet", () => {
    const r = nodesForItem({ type: "facet", facetId: "zzz" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems[0]).toMatch(/“zzz”.*not in the loaded docs/);
  });
  it("reports an unknown field", () => {
    const r = nodesForItem({ type: "field", facetId: "a", fieldId: "nope" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems).toHaveLength(1);
  });
  it("reports a value that is not in the field's list, and a field with no list", () => {
    expect(nodesForItem({ type: "value", facetId: "a", fieldId: "color", value: "green" }, facets, catalog).problems).toHaveLength(1);
    expect(nodesForItem({ type: "value", facetId: "a", fieldId: "on", value: "true" }, facets, catalog).problems).toHaveLength(1);
  });
  it("reports a tag nobody carries", () => {
    const r = nodesForItem({ type: "tag", tag: "ghost" }, facets, catalog);
    expect(r.nodes).toEqual([]);
    expect(r.problems).toEqual(["The tag “ghost” has no facets."]);
  });
});

describe("dropNotice", () => {
  it("is null without problems", () => expect(dropNotice([])).toBeNull());
  it("joins problems", () => expect(dropNotice(["One.", "Two."])).toBe("One. Two."));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/query/tree.test.ts tests/query/drop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `tree.ts`**

Append:

```ts
/**
 * Put `nodes` where a drop on `targetId` lands: at the end of the target if it
 * is a group, otherwise just before the target in its parent. An unknown
 * target changes nothing.
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
  if (findNode(node, targetId)) return null; // target is the node itself or inside it
  return insertNodes(removeNode(tree, nodeId), targetId, [node]);
}
```

(`findNode(node, targetId)` searches the moved node's own subtree, so it is true for the node itself and its descendants.)

- [ ] **Step 4: Implement `src/query/drop.ts`**

```ts
import type { Facet } from "../model";
import { findField, type FieldCatalog } from "./fieldCatalog";
import { newCondition } from "./tree";
import type { Condition, QueryNode } from "./types";

/** The drag-and-drop data type our own drags carry. Drags from elsewhere
 *  (files, text) lack it, so the query builder doesn't offer itself as a target. */
export const DRAG_MIME = "application/x-qb-item";

/** What is being dragged: something from the docs sidebar, or a node of the
 *  query being moved. Ids are the backend's (`Facet.id`, `Field.id`). */
export type DragItem =
  | { type: "facet"; facetId: string }
  | { type: "field"; facetId: string; fieldId: string }
  | { type: "value"; facetId: string; fieldId: string; value: string }
  | { type: "tag"; tag: string }
  | { type: "node"; nodeId: string };

const isString = (v: unknown): v is string => typeof v === "string";

/** Read drag data. It is untrusted (any page element can set it), so anything
 *  that isn't exactly one of the shapes above is null. */
export function parseDragItem(text: string): DragItem | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "facet":
      return isString(o.facetId) ? { type: "facet", facetId: o.facetId } : null;
    case "field":
      return isString(o.facetId) && isString(o.fieldId)
        ? { type: "field", facetId: o.facetId, fieldId: o.fieldId }
        : null;
    case "value":
      return isString(o.facetId) && isString(o.fieldId) && isString(o.value)
        ? { type: "value", facetId: o.facetId, fieldId: o.fieldId, value: o.value }
        : null;
    case "tag":
      return isString(o.tag) ? { type: "tag", tag: o.tag } : null;
    case "node":
      return isString(o.nodeId) ? { type: "node", nodeId: o.nodeId } : null;
    default:
      return null;
  }
}

/** What a drop creates, and what couldn't be created (and why, in words for the user). */
export interface DropResult {
  nodes: QueryNode[];
  problems: string[];
}

const NOT_LOADED = "it is not in the loaded docs. The docs may be out of date; reload the page.";

function condition(over: Partial<Condition>): Condition {
  return { ...newCondition(), ...over };
}

/** A condition meaning "this facet is present, whatever its values". */
function facetPresent(facetId: string): Condition {
  return condition({ facetId, operatorId: "present" });
}

/**
 * The nodes a dragged docs item creates. Never throws and never ignores
 * anything silently: whatever can't be created is explained in `problems`.
 */
export function nodesForItem(
  item: Exclude<DragItem, { type: "node" }>,
  facets: Facet[],
  catalog: FieldCatalog,
): DropResult {
  switch (item.type) {
    case "facet": {
      if (!facets.some((f) => f.id === item.facetId)) {
        return { nodes: [], problems: [`Couldn't add “${item.facetId}”: ${NOT_LOADED}`] };
      }
      return { nodes: [facetPresent(item.facetId)], problems: [] };
    }
    case "field": {
      if (!findField(catalog, item.facetId, item.fieldId)) {
        return { nodes: [], problems: [`Couldn't add “${item.fieldId}”: ${NOT_LOADED}`] };
      }
      return {
        nodes: [condition({ facetId: item.facetId, fieldId: item.fieldId })],
        problems: [],
      };
    }
    case "value": {
      const field = findField(catalog, item.facetId, item.fieldId);
      if (!field) {
        return { nodes: [], problems: [`Couldn't add “${item.value}”: ${NOT_LOADED}`] };
      }
      if (!field.options?.includes(item.value)) {
        return {
          nodes: [],
          problems: [`Couldn't add “${item.value}”: it is not one of ${field.fieldName}'s known values.`],
        };
      }
      // The pick-list holds text; a number field's value goes out as a number.
      const value = field.valueType === "number" ? Number(item.value) : item.value;
      return {
        nodes: [condition({ facetId: item.facetId, fieldId: item.fieldId, operatorId: "eq", value })],
        problems: [],
      };
    }
    case "tag": {
      const tagged = facets.filter((f) => f.tags.includes(item.tag));
      if (tagged.length === 0) {
        return { nodes: [], problems: [`The tag “${item.tag}” has no facets.`] };
      }
      return { nodes: tagged.map((f) => facetPresent(f.id)), problems: [] };
    }
  }
}

/** The warning to show for a drop's problems, or null when there were none. */
export function dropNotice(problems: string[]): string | null {
  return problems.length > 0 ? problems.join(" ") : null;
}
```

Note `newCondition()` gives `value: null`, which is correct for facet-level and unfinished rows.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "Pure drop logic: parse drag data, build nodes, move nodes in the tree

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: App state and actions for drops

**Files:**
- Modify: `src/state.ts`, `src/app.ts`
- Test: `tests/app.test.ts`, `tests/state.test.ts`

**Interfaces:**
- Consumes: Task 4 (`DragItem`, `nodesForItem`, `dropNotice`, `moveNode`, `insertNodes`)
- Produces (on `createApp()`'s return): `onDropItem(item: DragItem | null, targetNodeId: string): void` (`null` = drag data that could not be read), `onAddItem(item: DragItem): void`, `dismissDropNotice(): void`. `AppState.dropNotice: string | null`. `initialState.sidebarCollapsed === false`.

- [ ] **Step 1: Failing tests**

`tests/state.test.ts` line ~39: change to `expect(initialState.sidebarCollapsed).toBe(false);` and add `expect(initialState.dropNotice).toBeNull();`.

`tests/app.test.ts` — use the file's `setup()` and `ready()` fixtures. First read `setup`'s return value (just below line 90) and use its names (`store`, `app`); the fixture facet there is `thing` with field `size`. Add:

```ts
describe("dropping docs items", () => {
  it("a facet drop adds a facet-level 'present' condition and validates it", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    const q = store.getState().query;
    expect(q.children).toHaveLength(1);
    expect(q.children[0]).toMatchObject({ facetId: "thing", fieldId: null, operatorId: "present" });
    expect(store.getState().issues).toEqual([]);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("an unknown facet adds nothing and says why", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem({ type: "facet", facetId: "ghost" }, store.getState().query.id);
    expect(store.getState().query.children).toHaveLength(0);
    expect(store.getState().dropNotice).toMatch(/ghost/);
  });

  it("unreadable drag data adds nothing and says so", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onDropItem(null, store.getState().query.id);
    expect(store.getState().query.children).toHaveLength(0);
    expect(store.getState().dropNotice).toBe("That item can't be added to a query.");
  });

  it("a successful drop clears an earlier warning", () => {
    const { store, app } = setup({ ...ready(emptyQuery()), dropNotice: "old" });
    app.onDropItem({ type: "facet", facetId: "thing" }, store.getState().query.id);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("dismissDropNotice clears the warning", () => {
    const { store, app } = setup({ dropNotice: "x" });
    app.dismissDropNotice();
    expect(store.getState().dropNotice).toBeNull();
  });

  it("moving a group into itself is refused with a warning", () => {
    const root = emptyQuery();
    const g = { ...newGroup(), children: [] };
    const { store, app } = setup({ ...ready(addChild(root, root.id, g)) });
    app.onDropItem({ type: "node", nodeId: g.id }, g.id);
    expect(store.getState().dropNotice).toBe("A group can't be moved into itself.");
  });

  it("dropping a node on itself does nothing quietly", () => {
    const q = runnableQuery();
    const c = q.children[0]!;
    const { store, app } = setup({ ...ready(q) });
    app.onDropItem({ type: "node", nodeId: c.id }, c.id);
    expect(store.getState().query).toBe(q);
    expect(store.getState().dropNotice).toBeNull();
  });

  it("onAddItem puts the item in the root group", () => {
    const { store, app } = setup({ ...ready(emptyQuery()) });
    app.onAddItem({ type: "field", facetId: "thing", fieldId: "size" });
    expect(store.getState().query.children[0]).toMatchObject({ facetId: "thing", fieldId: "size" });
  });

  it("with no docs loaded yet, says so instead of ignoring the drop", () => {
    const { store, app } = setup({});
    app.onAddItem({ type: "facet", facetId: "thing" });
    expect(store.getState().dropNotice).toBe("The docs are still loading; try again in a moment.");
  });
});
```

Add `newGroup` to the file's `tree` import. If `setup` returns different names, adapt — do not change `setup`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/app.test.ts tests/state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/state.ts`: in `AppState` add after `sidebarCollapsed`:

```ts
  /** Why the last drop (or "Add to query") couldn't be done in full, shown as
   *  a dismissible warning above the query; null when there is nothing to say. */
  dropNotice: string | null;
```

In `initialState`: `sidebarCollapsed: false,` (replace the "start folded" comment with `// The docs are the main way to build a query, so they start open.`) and `dropNotice: null,`.

`src/app.ts` — imports: `import { dropNotice, nodesForItem, type DragItem } from "./query/drop";`, `insertNodes, moveNode` from `./query/tree`. Inside `createApp`, after `onQueryChange`:

```ts
  /** Show a drop's problems, or clear an old warning when there are none. */
  function setNotice(problems: string[]): void {
    const notice = dropNotice(problems);
    if (notice !== store.getState().dropNotice) store.setState({ dropNotice: notice });
  }

  /**
   * A docs item or a query node was dropped on `targetNodeId` (a group: it goes
   * at the end; a condition: just before it). Nothing is dropped silently: what
   * can't be done is explained in `dropNotice`.
   */
  function onDropItem(item: DragItem | null, targetNodeId: string): void {
    const { query, facets, catalog } = store.getState();
    if (!item) {
      setNotice(["That item can't be added to a query."]);
      return;
    }
    if (item.type === "node") {
      if (item.nodeId === targetNodeId) return;
      const moved = moveNode(query, item.nodeId, targetNodeId);
      if (!moved) {
        setNotice(["A group can't be moved into itself."]);
        return;
      }
      setNotice([]);
      onQueryChange(moved);
      return;
    }
    if (!facets || !catalog) {
      setNotice(["The docs are still loading; try again in a moment."]);
      return;
    }
    const { nodes, problems } = nodesForItem(item, facets, catalog);
    setNotice(problems);
    if (nodes.length > 0) onQueryChange(insertNodes(query, targetNodeId, nodes));
  }

  /** The keyboard path: "Add to query" puts the item in the root group. */
  function onAddItem(item: DragItem): void {
    onDropItem(item, store.getState().query.id);
  }

  function dismissDropNotice(): void {
    store.setState({ dropNotice: null });
  }
```

(`moveNode` returning null also covers a root move or unknown id; those cannot happen from the UI, and the message is accurate for the one reachable case. Add `onDropItem, onAddItem, dismissDropNotice` to the returned object.)

Ordering note: `setNotice` runs before `onQueryChange`, which calls `changeScope`; both use `store.setState`, and `changeScope` spreads only its own patch so `dropNotice` is preserved.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "App: drop actions with visible warnings; docs open by default in state

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sidebar redesign (markup, resize, hide button)

**Files:**
- Modify: `src/ui/docsSidebar.ts`, `src/ui/layout.ts`, `src/main.ts`, `src/styles.css`
- Create: `src/ui/docsResize.ts`
- Test: `tests/ui/docsSidebar.test.ts` (new), `tests/ui/docsResize.test.ts` (new), `tests/ui/docsFilter.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: `AppState.catalog` (pick-list options), `DragItem` (Task 4)
- Produces:
  - `docsSidebar.ts`: `export function facetHtml(facet: Facet, total: number, catalog: FieldCatalog | null): string` and `export function dragData(item: DragItem): string` (JSON for a `data-item` attribute, HTML-escaped). Elements with `data-item='…'` are both drag sources and "Add to query" targets.
  - `docsResize.ts`: `export const DOCS_MIN_REM = 20`, `DOCS_MAX_REM = 40`, `DOCS_DEFAULT_REM = 26`; `export function clampDocsWidth(rem: number): number`; `export function wireDocsResize(handle: HTMLElement): void`.
  - `wireDocsSidebar(container, getFacets, onAdd: (item: DragItem) => void)`.

- [ ] **Step 1: Failing tests**

`tests/ui/docsSidebar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dragData, facetHtml } from "../../src/ui/docsSidebar";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { parseDragItem } from "../../src/query/drop";
import type { Facet } from "../../src/model";

const facet: Facet = {
  id: "a&b", name: "Alpha <b>", tags: ["t"], group: "", comment: "backend note", description: "third party note",
  eventCount: 5,
  fields: [
    { id: "size", name: "Size", typeName: "BIGINT", comment: "The size", description: "tp", values: ["3", "7"] },
    { id: "flag", name: "Flag", typeName: "BOOLEAN", comment: "", description: "", values: [] },
  ],
};
const html = facetHtml(facet, 100, buildFieldCatalog([facet]));

describe("data dictionary markup", () => {
  it("escapes names", () => {
    expect(html).toContain("Alpha &lt;b&gt;");
    expect(html).not.toContain("Alpha <b>");
  });

  it("every drag source carries parseable drag data, escaped for the attribute", () => {
    const attrs = [...html.matchAll(/data-item="([^"]*)"/g)].map((m) =>
      m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
    );
    const items = attrs.map((a) => parseDragItem(a));
    expect(items.every((i) => i !== null)).toBe(true);
    expect(items).toContainEqual({ type: "facet", facetId: "a&b" });
    expect(items).toContainEqual({ type: "field", facetId: "a&b", fieldId: "size" });
    expect(items).toContainEqual({ type: "value", facetId: "a&b", fieldId: "size", value: "7" });
  });

  it("only fields with a pick-list get value chips", () => {
    expect(html.match(/qb-doc-value"/g)).toHaveLength(2);
  });

  it("shows the descriptions in the page, not in title tooltips", () => {
    expect(html).toContain("The size");
    expect(html).toContain("tp");
    expect(html).not.toMatch(/title="[^"]*The size/);
  });

  it("every item has a keyboard 'Add to query' button", () => {
    expect(html).toContain('data-action="add-item"');
    expect(html).toContain('aria-label="Add Alpha &lt;b&gt; to the query"');
  });

  it("drag handles are draggable and hidden from screen readers", () => {
    expect(html).toContain('class="qb-grip" draggable="true" aria-hidden="true"');
  });

  it("long value lists are capped, with a count of the rest", () => {
    const many: Facet = { ...facet, fields: [{ ...facet.fields[0]!, values: Array.from({ length: 70 }, (_, i) => String(i)) }] };
    const out = facetHtml(many, 1, buildFieldCatalog([many]));
    expect(out.match(/qb-doc-value"/g)).toHaveLength(30);
    expect(out).toContain("and 40 more");
  });

  it("dragData round-trips through the attribute", () => {
    expect(dragData({ type: "tag", tag: 'x"y' })).toBe("{&quot;type&quot;:&quot;tag&quot;,&quot;tag&quot;:&quot;x\\&quot;y&quot;}");
  });
});
```

`tests/ui/docsResize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampDocsWidth, DOCS_DEFAULT_REM, DOCS_MAX_REM, DOCS_MIN_REM } from "../../src/ui/docsResize";

describe("clampDocsWidth", () => {
  it("keeps the sidebar between 20 and 40rem", () => {
    expect(DOCS_MIN_REM).toBe(20);
    expect(DOCS_MAX_REM).toBe(40);
    expect(clampDocsWidth(5)).toBe(20);
    expect(clampDocsWidth(30)).toBe(30);
    expect(clampDocsWidth(99)).toBe(40);
  });
  it("falls back to the default for nonsense", () => {
    expect(clampDocsWidth(NaN)).toBe(DOCS_DEFAULT_REM);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui`
Expected: new tests FAIL.

- [ ] **Step 3: Implement `docsResize.ts`**

```ts
export const DOCS_MIN_REM = 20;
export const DOCS_MAX_REM = 40;
export const DOCS_DEFAULT_REM = 26;
const STORAGE_KEY = "qb:docs-width";
const KEY_STEP_REM = 1;

/** A sidebar width in rem, kept within the allowed range. */
export function clampDocsWidth(rem: number): number {
  if (!Number.isFinite(rem)) return DOCS_DEFAULT_REM;
  return Math.min(DOCS_MAX_REM, Math.max(DOCS_MIN_REM, rem));
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function applyWidth(rem: number): number {
  const clamped = clampDocsWidth(rem);
  document.documentElement.style.setProperty("--qb-docs-w", `${clamped}rem`);
  return clamped;
}

function remember(rem: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(rem));
  } catch {
    // Storage unavailable: the width just isn't remembered.
  }
}

function recall(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? DOCS_DEFAULT_REM : Number(saved);
  } catch {
    return DOCS_DEFAULT_REM;
  }
}

/**
 * Make `handle` (the sidebar's right edge) drag-resizable, and by keyboard
 * (Left / Right arrows). Restores the remembered width. Call once at startup.
 */
export function wireDocsResize(handle: HTMLElement): void {
  let current = applyWidth(recall());
  handle.setAttribute("aria-valuemin", String(DOCS_MIN_REM));
  handle.setAttribute("aria-valuemax", String(DOCS_MAX_REM));
  const show = () => handle.setAttribute("aria-valuenow", String(Math.round(current)));
  show();

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const left = handle.parentElement!.getBoundingClientRect().left;
    const move = (m: PointerEvent) => {
      current = applyWidth((m.clientX - left) / remPx());
      show();
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      remember(current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });

  handle.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? KEY_STEP_REM : e.key === "ArrowLeft" ? -KEY_STEP_REM : 0;
    if (!step) return;
    e.preventDefault();
    current = applyWidth(current + step);
    show();
    remember(current);
  });
}
```

- [ ] **Step 4: Implement `docsSidebar.ts`**

Replace `facetHtml` / `groupHtml` and `renderDocsSidebar`; keep `applyFilter` and `totalEvents`, and keep `[data-facet-id]` and `details[data-group]` markers (the filter relies on them). New helpers and markup:

```ts
import type { DragItem } from "../query/drop";
import { DRAG_MIME } from "../query/drop";
import type { FieldCatalog } from "../query/fieldCatalog";
import { findField } from "../query/fieldCatalog";

/** Most sample values shown per field; the rest are counted, not listed. */
const MAX_VALUE_CHIPS = 30;

/** The JSON for an element's `data-item` attribute (already HTML-escaped). It
 *  is what dragging the element carries, and what its "Add to query" button adds. */
export function dragData(item: DragItem): string {
  return escapeHtml(JSON.stringify(item));
}

const grip = `<span class="qb-grip" draggable="true" aria-hidden="true"><i class="grip vertical icon"></i></span>`;

function addButton(label: string): string {
  return `<button type="button" class="qb-icon-btn qb-add-btn" data-action="add-item" aria-label="Add ${escapeHtml(label)} to the query" title="Add to query"><i class="plus icon"></i></button>`;
}

function valuesHtml(facet: Facet, fieldId: string, catalog: FieldCatalog | null): string {
  const options = findField(catalog ?? { facets: [], fields: [] }, facet.id, fieldId)?.options ?? [];
  if (options.length === 0) return "";
  const shown = options.slice(0, MAX_VALUE_CHIPS).map((value) => {
    const item = dragData({ type: "value", facetId: facet.id, fieldId, value });
    return `<span class="qb-doc-value" data-item="${item}">${grip}<span class="qb-doc-value-text">${escapeHtml(value)}</span>${addButton(value)}</span>`;
  });
  const more = options.length - shown.length;
  return `<div class="qb-doc-values" aria-label="Known values">${shown.join("")}${more > 0 ? `<span class="qb-muted">and ${more} more</span>` : ""}</div>`;
}

function fieldHtml(facet: Facet, f: Facet["fields"][number], catalog: FieldCatalog | null): string {
  const item = dragData({ type: "field", facetId: facet.id, fieldId: f.id });
  const blurb = f.comment || f.description;
  return `<details class="qb-doc-field" data-item="${item}">
      <summary>
        ${grip}
        <code class="qb-doc-field-name">${escapeHtml(f.name)}</code>
        <span class="qb-field-type">${escapeHtml(f.typeName)}</span>
        ${addButton(f.name)}
        ${blurb ? `<span class="qb-doc-field-blurb">${escapeHtml(blurb)}</span>` : ""}
      </summary>
      <div class="qb-doc-field-body">
        ${f.comment ? `<p class="qb-doc-comment">${escapeHtml(f.comment)}</p>` : ""}
        ${f.description ? `<p class="qb-doc-desc" title="Third-party description; may contain errors">Third-party: ${escapeHtml(f.description)}</p>` : ""}
        ${valuesHtml(facet, f.id, catalog)}
      </div>
    </details>`;
}

export function facetHtml(facet: Facet, total: number, catalog: FieldCatalog | null): string {
  const tags = facet.tags.length
    ? `<div class="qb-doc-tags">${facet.tags.map((t) => `<span class="qb-tag">${escapeHtml(displayLabel(t))}</span>`).join("")}</div>`
    : "";
  const { group, description, comment } = facet;
  return `<details class="qb-doc-facet" data-facet-id="${escapeHtml(facet.id)}" data-item="${dragData({ type: "facet", facetId: facet.id })}">
      <summary>
        ${grip}
        <span class="qb-doc-name">${escapeHtml(facet.name)}</span>
        <span class="qb-count">${countLabel(facet.fields.length, "field")}</span>
        ${addButton(facet.name)}
      </summary>
      <div class="qb-doc-facet-body">
        ${tags}
        ${group ? `<p class="qb-doc-source" title="Third-party group">Group: ${escapeHtml(displayLabel(group))}</p>` : ""}
        ${comment ? `<p class="qb-doc-comment">${escapeHtml(comment)}</p>` : ""}
        ${description ? `<p class="qb-doc-desc">${escapeHtml(description)}</p>` : ""}
        <p class="qb-doc-count">In ${compact(facet.eventCount)} events (${matchRatio(facet.eventCount, total)})</p>
        <div class="qb-doc-fields">${facet.fields.map((f) => fieldHtml(facet, f, catalog)).join("")}</div>
      </div>
    </details>`;
}
```

Notes: the facet card previously showed its description inline with an exact-count `title`; the exact count tooltip (`exact(...)`) is a number, not documentation, so keep it: `<p class="qb-doc-count" title="${escapeHtml(exact(facet.eventCount))} of ${escapeHtml(exact(total))} events">`. Import `exact`, `countLabel`, `compact`, `displayLabel`, `matchRatio` as the file already does; drop the now-unused `fieldTitle` import (leave `fieldTitle` in `format.ts` if its tests exist, otherwise delete it and its test).

`groupHtml(tag, facets, total, catalog)`: pass `catalog` into `facetHtml`; give the non-`UNTAGGED` tag `<summary>` a `data-item` and grip/add button:

```ts
  const tagItem = tag === UNTAGGED ? "" : ` data-item="${dragData({ type: "tag", tag })}"`;
  const tagTools = tag === UNTAGGED ? "" : grip + addButton(`all “${displayLabel(tag)}” facets`);
  return `<details class="qb-doc-group" data-group="${escapeHtml(tag)}" data-size="${facets.length}">
      <summary${tagItem}>
        ${tagTools}
        ${name}
        <span class="qb-count" data-group-count>${facets.length}</span>
      </summary>
      <div class="qb-doc-facets">${facets.map((facet) => facetHtml(facet, total, catalog)).join("")}</div>
    </details>`;
```

(The `data-item` on the tag's `<summary>` makes `closest("[data-item]")` from its grip and add button resolve to the tag, not to a facet.)

`renderDocsSidebar`: pass `state.catalog`; replace the title block's close button with a labelled hide button:

```ts
       <h2 class="qb-card-title">
         Data dictionary
         <span class="qb-spacer"></span>
         <button type="button" class="ui mini basic button" data-menu="toggle-sidebar" aria-expanded="true" aria-controls="qb-docs"><i class="angle double left icon"></i>Hide docs</button>
       </h2>
       <p class="qb-docs-hint">Drag a facet, field, value or tag into the query, or use its + button.</p>
```

`wireDocsSidebar(container, getFacets, onAdd)`: add

```ts
  /** The drag/add data of the nearest item at or above `el`, if it parses. */
  const itemOf = (el: EventTarget | null): { node: HTMLElement; item: DragItem } | null => {
    const node = (el as HTMLElement | null)?.closest<HTMLElement>("[data-item]");
    const item = node ? parseDragItem(node.dataset.item!) : null;
    return node && item ? { node, item } : null;
  };

  container.addEventListener("dragstart", (e) => {
    const grabbed = (e.target as HTMLElement).closest?.(".qb-grip") ? itemOf(e.target) : null;
    if (!grabbed || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(grabbed.item));
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setDragImage(grabbed.node, 12, 12);
  });
```

and extend the existing click listener: before the clear-filter check, handle add:

```ts
    const add = (e.target as HTMLElement).closest("[data-action='add-item']");
    if (add) {
      e.preventDefault(); // inside a <summary>: don't also open/close the card
      const found = itemOf(add);
      if (found) onAdd(found.item);
      return;
    }
```

Import `parseDragItem`, `DRAG_MIME`. Also clicking the grip inside a `<summary>` would toggle the card: add `if ((e.target as HTMLElement).closest(".qb-grip")) e.preventDefault();` at the top of the click listener.

- [ ] **Step 5: Layout and main**

`layout.ts`: replace the docs `<aside>` line with a panel inside the aside plus a resize handle:

```html
      <aside class="qb-col-docs" id="qb-docs">
        <div data-panel="docs"></div>
        <div class="qb-docs-resize" role="separator" aria-orientation="vertical" aria-label="Resize the data dictionary" tabindex="0"></div>
      </aside>
```

(the `find('[data-panel="docs"]')` lookup keeps working.) Expose `resizeHandle: find(".qb-docs-resize")` on the shell: add `docsResizeHandle: HTMLElement;` to `Shell` (doc: "The sidebar's drag handle; wire it with wireDocsResize.") and return it. In `setSidebarCollapsed` the rail title strings stay. In `src/main.ts`:

```ts
import { wireDocsResize } from "./ui/docsResize";
...
wireDocsSidebar(panels.docs, () => store.getState().facets, app.onAddItem);
wireDocsResize(shell.docsResizeHandle);
```

and change the docs renderer keys to `["facets", "databases", "catalog"]`. Because `initialState.sidebarCollapsed` is now false, `setSidebarCollapsed(false)` runs in the first paint (all renderers run once) and unhides the docs.

- [ ] **Step 6: Styles**

In `src/styles.css`: change `--qb-docs-w: 20rem;` to `26rem`. Replace the block from `.qb-doc-facets {` through `.qb-field-type {…}` (the old chip/fields rules) with:

```css
.qb-docs-hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
}
.qb-col-docs {
  position: sticky; /* already sticky; the resize handle positions against it */
}
.qb-docs-resize {
  position: absolute;
  top: 0;
  right: -0.4rem;
  bottom: 0;
  width: 0.5rem;
  cursor: col-resize;
  touch-action: none;
}
.qb-docs-resize:hover,
.qb-docs-resize:focus-visible {
  background: var(--qb-border-strong);
  outline: none;
}
.qb-doc-facets {
  padding: 0 0 0.5rem 0.4rem;
}
.qb-doc-facet {
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
  background: var(--qb-surface);
  margin: 0.4rem 0;
}
.qb-doc-facet > summary,
.qb-doc-field > summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  list-style: none;
}
.qb-doc-facet > summary::-webkit-details-marker,
.qb-doc-field > summary::-webkit-details-marker {
  display: none;
}
.qb-doc-name {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.qb-doc-facet-body {
  padding: 0 0.6rem 0.6rem;
}
.qb-doc-fields {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.4rem;
}
.qb-doc-field {
  border: 1px solid var(--qb-border);
  border-radius: 4px;
  background: var(--qb-surface-2);
}
.qb-doc-field > summary {
  flex-wrap: wrap;
}
.qb-doc-field-name {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
.qb-field-type {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--qb-subtle);
}
.qb-doc-field-blurb {
  flex: 1 0 100%;
  padding-left: 1.4rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.qb-doc-field[open] .qb-doc-field-blurb {
  display: none; /* the full text is in the body below */
}
.qb-doc-field-body {
  padding: 0 0.6rem 0.6rem 1.9rem;
}
.qb-doc-values {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}
.qb-doc-value {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  max-width: 100%;
  padding: 0 0.2rem;
  border: 1px solid var(--qb-border);
  border-radius: 4px;
  background: var(--qb-surface);
  font-size: 0.78rem;
}
.qb-doc-value-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qb-grip {
  display: inline-flex;
  color: var(--qb-subtle);
  cursor: grab;
}
.qb-grip .icon {
  margin: 0;
}
.qb-grip:active {
  cursor: grabbing;
}
.qb-add-btn {
  margin-left: auto;
}
.qb-doc-value .qb-add-btn {
  margin-left: 0;
}
.qb-doc-group > summary .qb-add-btn {
  margin-left: 0;
}
@media (max-width: 1100px) {
  /* Narrow screens: the docs float over the page instead of squeezing the builder. */
  .qb-body:not(.qb-docs-collapsed) .qb-col-docs {
    position: fixed;
    left: var(--qb-rail-w);
    z-index: 15;
    box-shadow: var(--qb-shadow);
    background: var(--qb-bg);
  }
}
```

Remove the now-unused `.qb-field-chip` rule. Remove the older duplicate `.qb-field-type` block if it remains.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS (including `docsFilter.test.ts` and `noBackendDataInSrc`).

- [ ] **Step 8: Browser check (Playwright)**

Run `npm run dev` and verify: sidebar opens at ~26rem by default; "Hide docs" collapses it and the "Docs" rail reopens it; dragging the right edge resizes between 20 and 40rem and the width survives a reload; arrow keys on the handle resize; facet cards expand to field rows; field rows expand to the comment, third-party text and value chips; the search box still filters (`[data-facet-id]` hiding, groups opening); clicking a grip or + button does not toggle the card; at a 1000px-wide window the docs overlay the page. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add -A src tests
git commit -m "Redesign the docs sidebar: wider, resizable, open by default, readable fields

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Drag and drop in the query builder

**Files:**
- Modify: `src/ui/queryBuilder.ts`, `src/main.ts`, `src/styles.css`
- Test: `tests/ui/queryBuilder.test.ts`

**Interfaces:**
- Consumes: Task 4 (`DRAG_MIME`, `parseDragItem`), Task 5 (`app.onDropItem`, `app.dismissDropNotice`), Task 6 (sidebar sources)
- Produces: `wireQueryBuilder(container, getState, onChange, drops: { onDrop(item: DragItem | null, targetNodeId: string): void; onDismissNotice(): void })`; `export function noticeHtml(notice: string | null): string`; node grips with `data-item` of type `node`.

- [ ] **Step 1: Failing tests**

Append to `tests/ui/queryBuilder.test.ts`:

```ts
import { noticeHtml } from "../../src/ui/queryBuilder";

describe("drop warning", () => {
  it("renders nothing without a notice", () => {
    expect(noticeHtml(null)).toBe("");
  });
  it("renders a dismissible warning with the text escaped", () => {
    const html = noticeHtml("Couldn't add <x>");
    expect(html).toContain("ui warning message");
    expect(html).toContain("Couldn&#39;t add &lt;x&gt;");
    expect(html).toContain('data-action="dismiss-notice"');
    expect(html).toContain('role="alert"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/queryBuilder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement markup**

In `queryBuilder.ts`:

```ts
/** The dismissible warning for a drop that couldn't be done in full. */
export function noticeHtml(notice: string | null): string {
  if (!notice) return "";
  return `<div class="ui warning message qb-notice" role="alert">
      <i class="close icon" data-action="dismiss-notice" role="button" tabindex="0" aria-label="Dismiss"></i>
      <p>${escapeHtml(notice)}</p>
    </div>`;
}

/** A node's drag handle: carries `{type: "node", nodeId}`. */
function nodeGrip(nodeId: string): string {
  return `<span class="qb-grip" draggable="true" data-node-item="${escapeHtml(nodeId)}" aria-hidden="true" title="Drag to move"><i class="grip vertical icon"></i></span>`;
}
```

(`data-node-item` rather than `data-item`: the builder builds the drag payload itself from the id, so no JSON in the DOM.) Put `${nodeGrip(c.id)}` as the first child of `.qb-cond-grid`'s wrapper — change `conditionHtml` to wrap: `<div class="qb-condition" data-node-id=…><div class="qb-cond-row">${nodeGrip(c.id)}<div class="qb-cond-grid">…</div></div>${issuesHtml…}</div>`. In `groupHtml`, add `${isRoot ? "" : nodeGrip(g.id)}` as the first item in both `.qb-group-head` blocks. In `paintQueryBuilder`, render the notice above the card: `${noticeHtml(state.dropNotice)}<div class="qb-card qb-query">…`.

- [ ] **Step 4: Implement wiring**

Change the signature to take `drops` and add, inside `wireQueryBuilder` before the `return`:

```ts
  /** Whether the drag in progress is one of ours (set in dragstart, or seen via the data type). */
  const isOurs = (e: DragEvent) => e.dataTransfer?.types.includes(DRAG_MIME) ?? false;
  let marked: HTMLElement | null = null;
  const unmark = () => {
    marked?.classList.remove("is-drop-target", "is-drop-before");
    marked = null;
  };
  /** Where a drop at `el` lands: the nearest group or condition. */
  const targetOf = (el: EventTarget | null) =>
    (el as HTMLElement | null)?.closest<HTMLElement>("[data-node-id]") ?? null;

  container.addEventListener("dragstart", (e) => {
    const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-node-item]");
    if (!grip || !e.dataTransfer) return;
    const nodeId = grip.dataset.nodeItem!;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: "node", nodeId }));
    e.dataTransfer.effectAllowed = "move";
    const card = grip.closest<HTMLElement>("[data-node-id]");
    if (card) e.dataTransfer.setDragImage(card, 12, 12);
  });

  container.addEventListener("dragover", (e) => {
    if (!isOurs(e)) return; // not ours: no drop target, the browser shows "not allowed"
    const target = targetOf(e.target);
    if (!target) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = e.dataTransfer!.effectAllowed === "move" ? "move" : "copy";
    if (target !== marked) {
      unmark();
      marked = target;
      target.classList.add(target.classList.contains("qb-condition") ? "is-drop-before" : "is-drop-target");
    }
  });

  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget as Node | null)) unmark();
  });

  container.addEventListener("drop", (e) => {
    if (!isOurs(e)) return;
    e.preventDefault();
    unmark();
    const target = targetOf(e.target);
    if (!target) return;
    // An unreadable payload arrives as null; the app explains it to the user.
    drops.onDrop(parseDragItem(e.dataTransfer!.getData(DRAG_MIME)), target.dataset.nodeId!);
  });

  container.addEventListener("dragend", unmark);
```

Extend the click handler for dismiss: at its top, before the `btn`/`nodeId` lookup:

```ts
    if ((e.target as HTMLElement).closest("[data-action='dismiss-notice']")) return drops.onDismissNotice();
```

and a `keydown` listener (Enter/Space on the focused close icon) calling `drops.onDismissNotice()`.

In `main.ts`: `wireQueryBuilder(panels.center, store.getState, app.onQueryChange, { onDrop: app.onDropItem, onDismissNotice: app.dismissDropNotice })` and add `"dropNotice"` to the query builder renderer's `keys`.

- [ ] **Step 5: Styles**

```css
.qb-cond-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.qb-cond-row > .qb-cond-grid {
  flex: 1 1 auto;
  min-width: 0;
}
.qb-group-head .qb-grip {
  margin-right: 0.2rem;
}
.qb-condition.is-drop-before {
  box-shadow: 0 -2px 0 0 var(--qb-and);
}
.qb-group.is-drop-target,
.qb-group.is-drop-target > .qb-group-head {
  outline: 2px dashed var(--qb-and);
  outline-offset: 1px;
}
.qb-notice {
  position: relative;
}
```

(`.qb-notice` sits above the query card in the centre column; give it `margin-bottom: var(--qb-gap)` if the flex gap does not already space it.)

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Browser check (Playwright)**

Run `npm run dev` and verify each (use Playwright's `dragTo`, or `page.dispatchEvent` with a real `DataTransfer` if `dragTo` doesn't carry the custom type):
1. Drag a facet card's grip onto the query: a facet-level "is present" row appears; the summary reads "<Facet> is present"; Run is enabled.
2. Drag a field row: a row with facet and field set and no operator ("Choose an operator.").
3. Drag a value chip: `Equals <value>`.
4. Drag a tag: one "is present" row per facet with the tag.
5. Drag a condition's grip onto another condition: it moves before it; onto a group: it moves to the end of the group; a group onto its own child: warning "A group can't be moved into itself."
6. Edit the DOM in devtools so a card's `data-item` names a facet that doesn't exist, drag it: the yellow warning appears and can be dismissed with the ✕ and with Enter.
7. Drag selected text from the page onto the query: the cursor shows "not allowed".
8. Tab to a "+" button and press Enter: the item is added to the root group.
9. If Firefox is available: check the tag-heading grip drags (a known Firefox limitation is draggable content inside `<summary>`); if it does not, record it in `docs/ARCHITECTURE.md` under the docs-sidebar section as a known limitation rather than working around it.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "Query builder: drop targets, node reordering, visible drop warnings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Pickle theme, mascot files, mascot states

**Files:**
- Create: `public/pickle/favicon.svg`, `public/pickle/logo.svg`, `public/pickle/disappointed.svg`, `public/pickle/loading.svg`, `src/ui/mascot.ts`, `tests/ui/mascot.test.ts`, `tests/themeContrast.test.ts`
- Modify: `src/config.ts`, `src/ui/layout.ts`, `src/main.ts`, `src/styles.css`, `index.html`

**Interfaces:**
- Produces: `config.ts`: `MASCOT = { neutral, disappointed, loading }` (URL paths); `mascot.ts`: `type MascotState = "neutral" | "disappointed" | "loading"`, `mascotFor(s: Pick<AppState, "issues" | "stats" | "preview">): MascotState`; `Shell.setMascot(state: MascotState): void`.

- [ ] **Step 1: Failing tests**

`tests/ui/mascot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mascotFor } from "../../src/ui/mascot";

const base = { issues: [], stats: { status: "idle" as const, results: [] }, preview: { status: "idle" as const } };

describe("mascotFor", () => {
  it("is neutral by default", () => expect(mascotFor(base)).toBe("neutral"));
  it("is loading while statistics load", () => {
    expect(mascotFor({ ...base, stats: { status: "loading", results: [] } })).toBe("loading");
  });
  it("is loading while the events load", () => {
    expect(mascotFor({ ...base, preview: { status: "loading" } })).toBe("loading");
  });
  it("is disappointed for an invalid query", () => {
    expect(mascotFor({ ...base, issues: [{ nodeId: "c", message: "x", kind: "invalid" }] })).toBe("disappointed");
  });
  it("an unfinished query is not a reason to be sad", () => {
    expect(mascotFor({ ...base, issues: [{ nodeId: "c", message: "x", kind: "incomplete" }] })).toBe("neutral");
  });
});
```

`tests/themeContrast.test.ts` — text colours must stay readable (WCAG AA 4.5:1) on the surfaces they sit on, so a future palette edit can't silently break it:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");
const root = /:root\s*{([^}]*)}/.exec(css)![1]!;
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root);
  if (!m) throw new Error(`--${name} is not a #rrggbb token in :root`);
  return m[1]!;
};
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [text token, background token]
const PAIRS: [string, string][] = [
  ["qb-text", "qb-surface"],
  ["qb-text", "qb-bg"],
  ["qb-muted", "qb-surface"],
  ["qb-muted", "qb-bg"],
  ["qb-subtle", "qb-surface"],
  ["qb-text-on-fill", "qb-topbar"],
  ["qb-topbar-text", "qb-topbar"],
  ["qb-topbar-muted", "qb-topbar"],
  ["qb-text-on-fill", "qb-and"],
  ["qb-selected-text", "qb-selected-bg"],
  ["qb-or-text", "qb-surface"],
  ["qb-danger", "qb-surface"],
  ["qb-warn", "qb-surface"],
];

describe("pickle palette", () => {
  it.each(PAIRS)("%s on %s meets WCAG AA (4.5:1)", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/mascot.test.ts tests/themeContrast.test.ts`
Expected: mascot FAIL (missing module); contrast FAIL until the palette lands (the blue tokens may fail `qb-subtle` etc. — that tells you the test works).

- [ ] **Step 3: Mascot module and config**

`src/config.ts` — append:

```ts
/**
 * The pickle mascot's artwork. Replace the files in public/pickle/ (same
 * names) to change it; no code change is needed. `loading` falls back to
 * `neutral` if its file is missing.
 */
export const MASCOT = {
  neutral: "/pickle/logo.svg",
  disappointed: "/pickle/disappointed.svg",
  loading: "/pickle/loading.svg",
} as const;

/** Shown (instead of the falling pickles) for people who prefer reduced motion. */
export const EASTER_EGG_TOAST = "I'm Pickle Rick!";
```

`src/ui/mascot.ts`:

```ts
import type { AppState } from "../state";

export type MascotState = "neutral" | "disappointed" | "loading";

/**
 * Which face the logo pickle shows: busy while results load, disappointed
 * while the query is invalid (a red message — a merely unfinished query is
 * not a mistake), neutral otherwise.
 */
export function mascotFor(s: Pick<AppState, "issues" | "stats" | "preview">): MascotState {
  if (s.stats.status === "loading" || s.preview.status === "loading") return "loading";
  if (s.issues.some((i) => i.kind === "invalid")) return "disappointed";
  return "neutral";
}
```

- [ ] **Step 4: The four SVG files**

All are self-contained (no external references; the xmlns literal is on `check-offline`'s allow list). Each is a pickle: a green rounded body, darker bumps, a face.

`public/pickle/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="rotate(-18 32 32)">
    <rect x="18" y="4" width="28" height="56" rx="14" fill="#6aa84f" stroke="#35601f" stroke-width="3"/>
    <g fill="#4c8a34"><circle cx="24" cy="14" r="2"/><circle cx="40" cy="20" r="2"/><circle cx="25" cy="50" r="2"/><circle cx="39" cy="44" r="2"/></g>
    <circle cx="27" cy="26" r="3.2" fill="#fff"/><circle cx="37" cy="26" r="3.2" fill="#fff"/>
    <circle cx="27.6" cy="26.4" r="1.5" fill="#23301f"/><circle cx="36.4" cy="26.4" r="1.5" fill="#23301f"/>
    <path d="M26 36 Q32 42 38 36" fill="none" stroke="#23301f" stroke-width="2.4" stroke-linecap="round"/>
  </g>
</svg>
```

`public/pickle/disappointed.svg`: same body and bumps; eyes with droopy brows and a downturned mouth:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="rotate(-18 32 32)">
    <rect x="18" y="4" width="28" height="56" rx="14" fill="#7a9a52" stroke="#35601f" stroke-width="3"/>
    <g fill="#5f7e3d"><circle cx="24" cy="14" r="2"/><circle cx="40" cy="20" r="2"/><circle cx="25" cy="50" r="2"/><circle cx="39" cy="44" r="2"/></g>
    <circle cx="27" cy="27" r="3.2" fill="#fff"/><circle cx="37" cy="27" r="3.2" fill="#fff"/>
    <circle cx="27" cy="28" r="1.5" fill="#23301f"/><circle cx="37" cy="28" r="1.5" fill="#23301f"/>
    <path d="M23 22 L30 24.5 M41 22 L34 24.5" stroke="#23301f" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M26 41 Q32 35 38 41" fill="none" stroke="#23301f" stroke-width="2.4" stroke-linecap="round"/>
  </g>
</svg>
```

`public/pickle/loading.svg`: wide eyes looking up, small "o" mouth:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="rotate(-18 32 32)">
    <rect x="18" y="4" width="28" height="56" rx="14" fill="#6aa84f" stroke="#35601f" stroke-width="3"/>
    <g fill="#4c8a34"><circle cx="24" cy="14" r="2"/><circle cx="40" cy="20" r="2"/><circle cx="25" cy="50" r="2"/><circle cx="39" cy="44" r="2"/></g>
    <circle cx="27" cy="26" r="4" fill="#fff"/><circle cx="37" cy="26" r="4" fill="#fff"/>
    <circle cx="27" cy="24.6" r="1.8" fill="#23301f"/><circle cx="37" cy="24.6" r="1.8" fill="#23301f"/>
    <ellipse cx="32" cy="38" rx="3" ry="3.6" fill="#23301f"/>
  </g>
</svg>
```

`public/pickle/favicon.svg`: the body without a face, readable at 16px:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <g transform="rotate(-18 32 32)">
    <rect x="16" y="2" width="32" height="60" rx="16" fill="#6aa84f" stroke="#35601f" stroke-width="4"/>
    <g fill="#35601f"><circle cx="26" cy="18" r="2.5"/><circle cx="39" cy="30" r="2.5"/><circle cx="27" cy="44" r="2.5"/></g>
  </g>
</svg>
```

- [ ] **Step 5: Wire the logo, favicon and states**

`index.html`: replace `<link rel="icon" href="data:," />` with `<link rel="icon" type="image/svg+xml" href="/pickle/favicon.svg" />`.

`layout.ts`: replace `<span class="qb-brand">Query Builder</span>` with

```html
      <span class="qb-brand"><img class="qb-logo" src="/pickle/logo.svg" alt="" width="28" height="28" />Query Builder</span>
```

(Use `MASCOT.neutral` via a template string, importing `MASCOT` from `../config`, so the path is defined once.) Add to `Shell`: `/** Show the pickle with the face for `state`. */ setMascot(state: MascotState): void;` and `logo: HTMLImageElement;`. Implement:

```ts
  const logo = find<HTMLImageElement>(".qb-logo");
  logo.addEventListener("error", () => {
    // A missing loading.svg falls back to the normal face; never loop.
    if (logo.getAttribute("src") !== MASCOT.neutral) logo.src = MASCOT.neutral;
  });
  ...
    setMascot(state) {
      logo.dataset.state = state;
      logo.src = MASCOT[state];
    },
    logo,
```

In `main.ts` add to `panelRenderers`:

```ts
  { keys: ["issues", "stats", "preview"], run: (s) => shell.setMascot(mascotFor(s)) },
```

- [ ] **Step 6: Palette and animation**

In `src/styles.css`'s `:root`, replace the colour tokens (keep names; change values) with:

```css
  --qb-bg: #f4f1e3;
  --qb-surface: #fffdf5;
  --qb-surface-2: #f8f5e6;
  --qb-border: #dcd8bf;
  --qb-border-strong: #c4bf9f;
  --qb-text: #23301f;
  --qb-muted: #4f5c49;
  --qb-subtle: #5f6c58;

  --qb-text-on-fill: #ffffff;
  --qb-hover: rgba(35, 48, 31, 0.07);
  --qb-chip: #ece8d2;
  --qb-track: #e5e1c8;
  --qb-selected-bg: #e3eecb;
  --qb-selected-text: #2b5319;
  --qb-open-row: #f0efd9;
  --qb-shadow: 0 8px 24px rgba(35, 48, 31, 0.2);

  --qb-topbar: #2c4a26;
  --qb-topbar-2: #44683a;
  --qb-topbar-text: #eef3dc;
  --qb-topbar-muted: #b9cba0;
  --qb-topbar-ok-bg: rgba(168, 220, 120, 0.25);
  --qb-topbar-ok-text: #d6f2b0;
  --qb-topbar-warn-bg: rgba(240, 196, 60, 0.25);
  --qb-topbar-warn-text: #ffe9a0;

  /* ALL / AND: pickle green */
  --qb-and: #3f7a2c;
  --qb-and-soft: #a9cf8e;
  --qb-and-tint: rgba(63, 122, 44, 0.06);
  --qb-and-tint-strong: rgba(63, 122, 44, 0.12);
  /* ANY / OR: mustard seed */
  --qb-or: #d9a00a;
  --qb-or-text: #7d5800;
  --qb-or-soft: #ecd48a;
  --qb-or-tint: rgba(217, 160, 10, 0.09);
  --qb-or-tint-strong: rgba(217, 160, 10, 0.17);

  --qb-danger: #b03a1e;
  --qb-warn: #7d5800;
```

Run `npx vitest run tests/themeContrast.test.ts`; if any pair is below 4.5, darken that text token (or lighten its background) until it passes — the test is the authority, the values above are a starting point.

Then find hard-coded blue left over: `grep -n -i "2185d0\|33, 133, 208\|1f5f8f\|1b2a3a\|primary\|\.blue" src/styles.css src/ui/*.ts`. Replace CSS hits with tokens (`--qb-and`, `--qb-selected-*`). For Fomantic's own blue (focused inputs, `.ui.primary.button`, links), append overrides using the tokens:

```css
.ui.primary.button,
.ui.primary.buttons .button {
  background-color: var(--qb-and);
  color: var(--qb-text-on-fill);
}
.ui.primary.button:hover {
  background-color: var(--qb-topbar-2);
}
a {
  color: var(--qb-and);
}
.ui.selection.active.dropdown,
.ui.selection.active.dropdown:hover,
.ui.input.focus > input,
.ui.input > input:focus,
.ui.selection.dropdown:focus {
  border-color: var(--qb-and);
}
.ui.dropdown .menu > .item.selected,
.ui.dropdown .menu .active.item {
  background: var(--qb-selected-bg);
  color: var(--qb-selected-text);
}
```

Logo and mascot styles:

```css
.qb-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.qb-logo {
  width: 28px;
  height: 28px;
  cursor: pointer;
  transform-origin: 50% 90%;
}
.qb-logo[data-state="loading"] {
  animation: qb-wobble 1s ease-in-out infinite;
}
@keyframes qb-wobble {
  0%, 100% { transform: rotate(-8deg); }
  50% { transform: rotate(8deg); }
}
@media (prefers-reduced-motion: reduce) {
  .qb-logo[data-state="loading"] {
    animation: none;
  }
}
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: PASS, including `check:offline`. Also confirm `ls dist/pickle` lists the four SVGs.

- [ ] **Step 8: Browser check (Playwright)**

Run `npm run dev` (or `npm run preview` after the build) and verify: pickle favicon in the tab; logo in the top bar; neutral face by default; disappointed when a condition becomes invalid (e.g. a number field with letters, or From > To); the wobbling loading face while statistics load (throttle the network in the browser to see it); replacing `public/pickle/logo.svg` with another valid SVG changes the logo without code changes; deleting `loading.svg` falls back to the neutral face; green palette everywhere, no leftover blue (open a dropdown, focus an input, hover a button, check ALL and ANY groups are still distinguishable); Fomantic's checkboxes/toggles; a screenshot of the full page for the PR notes.

- [ ] **Step 9: Commit**

```bash
git add -A public src tests index.html
git commit -m "Pickle theme: palette, replaceable mascot files, logo faces, favicon

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Pickle rain easter egg

**Files:**
- Create: `src/ui/pickleRain.ts`, `tests/ui/pickleRain.test.ts`
- Modify: `src/ui/fomantic.ts`, `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `MASCOT`, `EASTER_EGG_TOAST` (Task 8)
- Produces: `createClickCounter(required?: number, windowMs?: number, now?: () => number): () => boolean`; `planRain(srcs: string[], random: () => number, count?: number): RainDrop[]`; `startRain(srcs: string[]): void`; `fomantic.ts`: `showToast(message: string): void`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { createClickCounter, planRain } from "../../src/ui/pickleRain";

describe("createClickCounter", () => {
  it("fires on the fifth click within three seconds", () => {
    let t = 0;
    const click = createClickCounter(5, 3000, () => t);
    expect([1, 2, 3, 4].map(() => click())).toEqual([false, false, false, false]);
    expect(click()).toBe(true);
  });
  it("does not fire when the clicks are too slow", () => {
    let t = 0;
    const click = createClickCounter(5, 3000, () => t);
    for (let i = 0; i < 4; i++) {
      click();
      t += 1000;
    }
    expect(click()).toBe(false); // the first click is now 4s old
  });
  it("starts counting again after firing", () => {
    let t = 0;
    const click = createClickCounter(2, 3000, () => t);
    click();
    expect(click()).toBe(true);
    expect(click()).toBe(false);
    expect(click()).toBe(true);
  });
});

describe("planRain", () => {
  const srcs = ["/a.svg", "/b.svg", "/c.svg"];
  const counter = () => {
    let i = 0;
    return () => [0.05, 0.5, 0.95, 0.3][i++ % 4]!;
  };
  it("plans the requested number of drops using only the given files", () => {
    const drops = planRain(srcs, counter(), 30);
    expect(drops).toHaveLength(30);
    expect(drops.every((d) => srcs.includes(d.src))).toBe(true);
  });
  it("keeps every drop on screen, sized sensibly and with a delay and duration", () => {
    for (const d of planRain(srcs, counter(), 30)) {
      expect(d.leftPct).toBeGreaterThanOrEqual(0);
      expect(d.leftPct).toBeLessThanOrEqual(100);
      expect(d.sizePx).toBeGreaterThanOrEqual(24);
      expect(d.sizePx).toBeLessThanOrEqual(72);
      expect(d.delayMs).toBeGreaterThanOrEqual(0);
      expect(d.delayMs).toBeLessThanOrEqual(1500);
      expect(d.durationMs).toBeGreaterThanOrEqual(1800);
      expect(d.durationMs).toBeLessThanOrEqual(2800);
    }
  });
  it("plans nothing when no file is available", () => {
    expect(planRain([], Math.random, 30)).toEqual([]);
  });
});
```

(Maximum total time = 1500 + 2800 = 4300 ms ≈ "about four seconds".)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/pickleRain.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/ui/pickleRain.ts`**

```ts
/** One falling pickle. All values are plain numbers so they are easy to test. */
export interface RainDrop {
  src: string;
  /** Distance from the left edge, 0–100. */
  leftPct: number;
  sizePx: number;
  delayMs: number;
  durationMs: number;
  /** Total turn while falling. */
  spinDeg: number;
}

const DROPS = 30;

/**
 * A click counter: the returned function is called on every click and says
 * whether this click was the `required`-th within `windowMs`. After it fires
 * it starts counting from zero again.
 */
export function createClickCounter(
  required = 5,
  windowMs = 3000,
  now: () => number = Date.now,
): () => boolean {
  let times: number[] = [];
  return () => {
    const t = now();
    times = [...times.filter((x) => t - x < windowMs), t];
    if (times.length < required) return false;
    times = [];
    return true;
  };
}

/** Where, how big and how fast each pickle falls. `random` returns [0, 1). */
export function planRain(srcs: string[], random: () => number, count = DROPS): RainDrop[] {
  if (srcs.length === 0) return [];
  return Array.from({ length: count }, () => ({
    src: srcs[Math.floor(random() * srcs.length)]!,
    leftPct: random() * 100,
    sizePx: 24 + random() * 48,
    delayMs: random() * 1500,
    durationMs: 1800 + random() * 1000,
    spinDeg: (random() - 0.5) * 720,
  }));
}

/** Resolve to the files among `srcs` that actually load (a replaced or
 *  removed mascot file must not leave broken-image icons falling). */
function loadable(srcs: string[]): Promise<string[]> {
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<string | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(src);
          img.onerror = () => resolve(null);
          img.src = src;
        }),
    ),
  ).then((all) => all.filter((s): s is string => s !== null));
}

let raining = false;

/**
 * Make the given pickle files fall from the top of the screen for a few
 * seconds. Ignored while it is already raining. The overlay ignores the
 * mouse, is hidden from screen readers and removes itself afterwards. The
 * motion is a CSS animation (styles.css, `.qb-rain-drop`); this only creates
 * the elements.
 */
export function startRain(srcs: string[]): void {
  if (raining) return;
  raining = true;
  void loadable([...new Set(srcs)]).then((available) => {
    const drops = planRain(available, Math.random);
    if (drops.length === 0) {
      raining = false;
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "qb-rain";
    overlay.setAttribute("aria-hidden", "true");
    for (const d of drops) {
      const img = document.createElement("img");
      img.className = "qb-rain-drop";
      img.src = d.src;
      img.alt = "";
      img.style.setProperty("--x", `${d.leftPct}%`);
      img.style.setProperty("--size", `${d.sizePx}px`);
      img.style.setProperty("--delay", `${d.delayMs}ms`);
      img.style.setProperty("--dur", `${d.durationMs}ms`);
      img.style.setProperty("--spin", `${d.spinDeg}deg`);
      overlay.append(img);
    }
    document.body.append(overlay);
    const longest = Math.max(...drops.map((d) => d.delayMs + d.durationMs));
    window.setTimeout(() => {
      overlay.remove();
      raining = false;
    }, longest + 200);
  });
}
```

- [ ] **Step 4: Toast and wiring**

`src/ui/fomantic.ts`, append (this file is the only one that may use jQuery):

```ts
/** A small, self-dismissing message at the top of the page. */
export function showToast(message: string): void {
  $("body").toast({ message, class: "success", displayTime: 3000, showProgress: false });
}
```

If `tsc` complains that `toast` is not on `JQuery`, add the line `toast(settings: Record<string, unknown>): JQuery;` to the `JQuery` interface in `src/vendor.d.ts` (look at how `dropdown`/`checkbox` are declared there and follow it).

`src/main.ts` — after the shell is rendered:

```ts
import { EASTER_EGG_TOAST, MASCOT } from "./config";
import { showToast } from "./ui/fomantic";
import { createClickCounter, startRain } from "./ui/pickleRain";
...
// Hidden: five quick clicks on the logo make it rain pickles (instead, a toast
// for people who prefer reduced motion).
const logoClicked = createClickCounter();
shell.logo.addEventListener("click", () => {
  if (!logoClicked()) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) showToast(EASTER_EGG_TOAST);
  else startRain(Object.values(MASCOT));
});
```

- [ ] **Step 5: Styles**

```css
/* Pickle rain (src/ui/pickleRain.ts): above the page, below Fomantic modals,
   and never in the way of the mouse. */
.qb-rain {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 900;
}
.qb-rain-drop {
  position: absolute;
  top: -80px;
  left: var(--x);
  width: var(--size);
  height: var(--size);
  animation: qb-fall var(--dur) linear var(--delay) both;
}
@keyframes qb-fall {
  to {
    transform: translateY(calc(100vh + 160px)) rotate(var(--spin));
  }
}
```

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Browser check (Playwright)**

Run the app and verify: five quick clicks on the logo make pickles of all three faces fall for ~4s and the overlay then disappears from the DOM; clicks and typing underneath still work during the rain; five slow clicks do nothing; a second burst during rain is ignored; with `page.emulateMedia({ reducedMotion: "reduce" })` a toast "I'm Pickle Rick!" appears and nothing falls; with `loading.svg` removed only the other two fall.

- [ ] **Step 8: Commit**

```bash
git add -A src tests
git commit -m "Easter egg: five logo clicks make it rain pickles

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Documentation and final verification

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `README.md` (if it lists scripts/assets or the sidebar), `tests/` (only if a doc test flags something)

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

Make these edits (find each section by its title; do not renumber headings, `tests/docReferences.test.ts` relies on titles):

- **"The field catalog"** (operator table, ~line 488): replace `isEmpty`, `isNotEmpty` with `present`, `absent` in the string, number and date rows; add a paragraph: "`present` / `absent` are the one operator pair for both a whole facet and a single field. Labels: field-level 'Has any value' / 'Has no value', facet-level 'Is present' / 'Is absent'. A condition with no field offers only these two (`FACET_OPERATOR_IDS`). The catalog also lists every facet (`catalog.facets`), including facets with no fields."
- **"Wire format of the query"**: state that `fieldId` is `string | null`; `null` means the condition is about the facet itself; the backend interprets it; a facet-level `present` matches an event holding any value for the facet, `absent` the opposite; field-level `present` matches an event holding a non-blank value for the field. In the arity table replace `isEmpty`, `isNotEmpty` with `present`, `absent`. Add: "Backend hand-off: the real backend must accept `fieldId: null`, implement `present`/`absent` at both levels, and no longer receive `isEmpty`/`isNotEmpty`."
- **"The query model"**: document facet-level conditions (`facetId` set, `fieldId` null, `operatorId` set) and that choosing the row's no-field option sets `present`.
- **"Left — `docsSidebar.ts` (data dictionary)"**: rewrite for the new layout (tag groups → facet cards → field rows → value chips, all native `<details>`; grips; "Add to query" buttons; open by default; width 20–40rem, resizable, remembered in `localStorage`; overlay under 1100px; no `title` tooltips). Mention the Firefox note from Task 7 Step 7 item 9 if it applied.
- **"Centre — `queryBuilder.ts`"**: drop targets, node grips and reordering, `dropNotice` warning, the no-field choice (`NO_FIELD`, `FIELD_PREFIX`).
- **"Error and loading model"**: add one bullet: drops never fail silently; `AppState.dropNotice` shows a dismissible warning.
- **"Mock server"**: `present`/`absent` at facet and field level; `fieldId: null` accepted by `requestBody.ts`.
- **"Directory layout"**: add `src/query/drop.ts`, `src/ui/docsResize.ts`, `src/ui/mascot.ts`, `src/ui/pickleRain.ts`, `public/pickle/`.
- **"Offline-first"**: add: "The mascot SVGs live in `public/pickle/` and are self-contained; `check:offline` scans them."
- A short new subsection under **"Screen layout"** (or the nearest fitting section) titled `### Pickle theme and mascot`: palette lives in the `:root` tokens in `src/styles.css`; `tests/themeContrast.test.ts` guards AA contrast; replaceable files `favicon.svg`, `logo.svg`, `disappointed.svg`, `loading.svg` and what state shows each; the hidden five-click rain and the reduced-motion toast.

- [ ] **Step 2: README**

Run `grep -n -i "sidebar\|docs\|favicon\|isEmpty" README.md`. Update anything it states that is now wrong; add one line about replacing the mascot files in `public/pickle/`. If nothing is wrong, change nothing.

- [ ] **Step 3: Full verification**

Run:

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all pass, `check:offline OK`.

Then confirm by search that nothing stale remains:

```bash
grep -rn "isEmpty\|isNotEmpty" src mock-server tests docs/ARCHITECTURE.md
```

Expected: no hits (the dated spec files under `docs/superpowers/specs/` and `docs/CHANGELOG.md` are history and may keep them).

Run `npm run dev` once more and walk the whole feature set end to end in a browser: build a query only by dragging (facet, field, value, tag), reorder it, run it against the mock, see stats and matching events; verify a facet-only query runs and returns events holding that facet; trigger each drop warning; resize and hide the sidebar; check the mascot states and the rain. Say in the final report what was checked and what could not be (for example Firefox, if not available).

- [ ] **Step 4: Commit**

```bash
git add -A docs README.md
git commit -m "Docs: facet-level conditions, drag-to-build, sidebar, pickle theme

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Goals 1–4: drag sources/targets/reorder (Tasks 4, 6, 7); facet presence (Tasks 1–3); theme + mascot + rain (Tasks 8, 9); sidebar readability (Task 6). Decisions D1–D11: D1/D3 (Tasks 2, 3), D2/D4 (Task 1), D5 (Tasks 6–7, no library), D6 (Tasks 5, 6, 7), D7 (Task 8 check:offline in build), D8 (Task 2 request.ts unchanged projection), D9 (Tasks 4, 6), D10 (Tasks 5, 6), D11 (Task 8). Drop feedback table: each row has a test in Task 4/5 or a browser step in Task 7 (unknown, partial-tag — see below, empty tag, unparseable payload, group into itself). Reduced-motion toast, click-through overlay, missing-file handling: Task 9. Contrast: Task 8 test. Docs/changelog: Task 10 (note: `docs/CHANGELOG.md` is explicitly archived and "not updated any more", so the plan updates only `ARCHITECTURE.md`; the spec's mention of CHANGELOG is superseded).

**Partial tag drops.** Tags are resolved against the loaded facets, so "some facets unknown" cannot happen; spec correction 6 (Task 0) records this.

**Placeholder scan.** No TBD/TODO. Two steps depend on runtime facts and say how to resolve them rather than guessing: Fomantic copying the select's classes (Task 3 Step 7 gives the fallback), and Playwright `dragTo` carrying a custom data type (Task 7 Step 7 gives the fallback). The existing-test edits in Tasks 1–2 name the exact replacements and rely on `npm run typecheck` to list every fixture to touch.

**Type consistency.** `RowPicks.facetOnly` (Task 3) is produced in `handleRowChange` and consumed by `nextCondition`. `DragItem`/`parseDragItem`/`DRAG_MIME` (Task 4) are imported by Tasks 5–7. `onDropItem(item: DragItem | null, targetNodeId)` is declared in Task 5 and amended in Task 7 (the `null` case), with its test; `wireQueryBuilder`'s `drops.onDrop` takes `DragItem | null` to match. `MASCOT` keys (`neutral`, `disappointed`, `loading`) match `MascotState` values in Task 8. `catalog.facets` is required from Task 1 and used in Tasks 2, 3, 6.
