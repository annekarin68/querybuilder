# Query Builder Item → Field Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the query builder's condition row from two dropdowns (Field, Operator) to three (Item, Field, Operator): the user first picks an individual from `individual.json`, then a field belonging to that individual, then the operator.

**Architecture:** `Condition` gains a UI-staging field, `individualId: string | null`. `fieldId` (already the dotted `"individualLabel.fieldLabel"` id) stays the single source of truth for validation, the summary text, and the wire format — so `validate.ts`, `summary.ts`, and the mock backend need no changes. `src/ui/queryBuilder.ts` renders an Item dropdown (from `state.individuals`, already loaded for the docs sidebar) that filters the Field dropdown (from `state.schema.fields`, matched by id prefix). Changing Item resets Field/Operator/Value, mirroring the existing Field→Operator reset.

**Tech Stack:** No new dependencies — same TypeScript/Fomantic-UI stack as the rest of the frontend.

**Spec:** No separate spec file — the design was agreed in conversation (bounded change to an existing flow, per `superpowers:brainstorming`'s bounded path). This plan is the record of that design.

## Global Constraints

- **`fieldId` remains the sole source of truth.** `individualId` is never read by `src/query/validate.ts`, `src/query/summary.ts`, or the mock backend — it exists only so the query-builder UI can remember which item is staged before a field is chosen, surviving re-renders.
- **No backend or schema-contract changes.** `mock-server/*` and `src/api/types.ts` are untouched. The Item dropdown's data comes entirely from `state.individuals` (`GET /api/individuals`, already loaded at startup for the docs sidebar) — no new API call.
- **Cascade-reset pattern, one level deeper.** Changing Item resets Field, Operator, and Value to empty/null, exactly like changing Field already resets Operator and Value today (`src/ui/queryBuilder.ts`'s existing `fieldChanged` logic) — same pattern, new level.
- **Fomantic dropdowns already have `fullTextSearch: true` globally** (`src/ui/fomantic.ts`), so the ~157-item Item dropdown needs no additional search wiring.
- **View layer is not unit-tested** (`docs/ARCHITECTURE.md` §12) — verification for the UI changes is a manual walkthrough in the browser, not a new test file.
- **Commit after the task** (and at the step marked "Commit"). Conventional Commit prefix `feat:`.

---

## File Structure

| Path | Change |
|---|---|
| `src/query/types.ts` | `Condition` gains `individualId: string \| null`. |
| `src/query/tree.ts` | `newCondition()` initializes `individualId: null`; `NodePatch` allows patching it. |
| `src/ui/queryBuilder.ts` | New `individualDropdown()`; `fieldDropdown()` filters by `c.individualId`; `conditionHtml`/`groupHtml`/`nodeHtml`/`renderQueryBuilder` thread `state.individuals` through; `handleRowChange` reads the new dropdown and cascades the reset; the Fomantic-managed-select exclusion list in `wireQueryBuilder`'s native `"change"` listener gains `select[data-part="individual"]`. |
| `tests/query/tree.test.ts` | One assertion added: `newCondition().individualId` is `null`. |

No other files change. `src/query/validate.ts`, `src/query/summary.ts`, `src/ui/valueControl.ts`, `src/ui/fomantic.ts`, `mock-server/*`, `src/api/types.ts` are all untouched — verified during design (see Global Constraints).

---

## Task 1: Item → Field → Operator cascade in the query builder

**Files:**
- Modify: `src/query/types.ts`
- Modify: `src/query/tree.ts`
- Modify: `src/ui/queryBuilder.ts`
- Modify: `tests/query/tree.test.ts`

**Interfaces:**
- Consumes: `AppState.individuals: IndividualsResponse | null` (already exists, `src/state.ts`, loaded at startup); `IndividualsResponse` / `Individual` types (already exist, `src/api/types.ts`, `{ individuals: Array<{ label, name, group, tags, id_number, description, comment, stats, fields }> }`).
- Produces: `Condition.individualId: string | null` (used only within `queryBuilder.ts`'s own rendering/event-handling; not consumed by any other module).

- [ ] **Step 1: Add `individualId` to the `Condition` type**

In `src/query/types.ts`, change:

```ts
export interface Condition {
  kind: "condition";
  id: string;
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}
```

to:

```ts
export interface Condition {
  kind: "condition";
  id: string;
  /** Which individual.json item this condition targets — UI staging only; `fieldId` (below) is the authoritative target once chosen. */
  individualId: string | null;
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}
```

- [ ] **Step 2: Update `tree.ts`'s `newCondition()` and `NodePatch`**

In `src/query/tree.ts`, change:

```ts
export type NodePatch = Partial<Pick<Condition, "fieldId" | "operatorId" | "value">> &
  Partial<Pick<Group, "operator" | "collapsed">>;
```

to:

```ts
export type NodePatch = Partial<Pick<Condition, "individualId" | "fieldId" | "operatorId" | "value">> &
  Partial<Pick<Group, "operator" | "collapsed">>;
```

And change:

```ts
export function newCondition(): Condition {
  return { kind: "condition", id: id("c"), fieldId: null, operatorId: null, value: null };
}
```

to:

```ts
export function newCondition(): Condition {
  return {
    kind: "condition",
    id: id("c"),
    individualId: null,
    fieldId: null,
    operatorId: null,
    value: null,
  };
}
```

- [ ] **Step 3: Add the regression check to `tests/query/tree.test.ts`**

Add this assertion inside the existing `it("new nodes get unique ids", ...)` test block (do not create a new `it` block — it belongs with the other `newCondition()` shape check):

```ts
  it("new nodes get unique ids", () => {
    expect(newCondition().id).not.toBe(newCondition().id);
    expect(newGroup().id).not.toBe(newGroup().id);
    expect(newCondition().individualId).toBeNull();
  });
```

Run: `npx vitest run tests/query/tree.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 4: Rewrite `src/ui/queryBuilder.ts`**

Replace the file's import line for API types:

```ts
import type { SchemaResponse } from "../api/types";
```

with:

```ts
import type { IndividualsResponse, SchemaResponse } from "../api/types";
```

Add a new `individualDropdown` function, placed right before the existing `fieldDropdown` function:

```ts
function individualDropdown(individuals: IndividualsResponse | null, c: Condition): string {
  const opts = (individuals?.individuals ?? [])
    .map(
      (ind) =>
        `<option value="${escapeHtml(ind.label)}"${ind.label === c.individualId ? " selected" : ""}>${escapeHtml(ind.name)}</option>`,
    )
    .join("");
  return `<select class="ui selection dropdown" data-part="individual"><option value="">Item…</option>${opts}</select>`;
}
```

Replace the existing `fieldDropdown` function:

```ts
function fieldDropdown(schema: SchemaResponse, c: Condition): string {
  const opts = schema.fields
    .map(
      (f) =>
        `<option value="${escapeHtml(f.id)}"${f.id === c.fieldId ? " selected" : ""}>${escapeHtml(f.label)}</option>`,
    )
    .join("");
  return `<select class="ui selection dropdown" data-part="field"><option value="">Field…</option>${opts}</select>`;
}
```

with:

```ts
function fieldDropdown(schema: SchemaResponse, c: Condition): string {
  const prefix = c.individualId ? `${c.individualId}.` : null;
  const opts = prefix
    ? schema.fields
        .filter((f) => f.id.startsWith(prefix))
        .map(
          (f) =>
            `<option value="${escapeHtml(f.id)}"${f.id === c.fieldId ? " selected" : ""}>${escapeHtml(f.id.slice(prefix.length))}</option>`,
        )
        .join("")
    : "";
  return `<select class="ui selection dropdown" data-part="field"${prefix ? "" : " disabled"}><option value="">Field…</option>${opts}</select>`;
}
```

Replace `conditionHtml` (adds the `individuals` parameter and the new dropdown):

```ts
function conditionHtml(schema: SchemaResponse, c: Condition, issues: Issue[]): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const operator = schema.operators.find((o) => o.id === c.operatorId);
  return `<div class="qb-condition" data-node-id="${c.id}" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.35rem 0">
    ${fieldDropdown(schema, c)}
    ${operatorDropdown(schema, c)}
    <span class="qb-value">${renderValueControl(field, operator, c.value)}</span>
    <button class="ui mini icon button" data-action="remove-node" title="Remove"><i class="trash icon"></i></button>
    ${issuesFor(c.id, issues)}
  </div>`;
}
```

with:

```ts
function conditionHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  c: Condition,
  issues: Issue[],
): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const operator = schema.operators.find((o) => o.id === c.operatorId);
  return `<div class="qb-condition" data-node-id="${c.id}" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.35rem 0">
    ${individualDropdown(individuals, c)}
    ${fieldDropdown(schema, c)}
    ${operatorDropdown(schema, c)}
    <span class="qb-value">${renderValueControl(field, operator, c.value)}</span>
    <button class="ui mini icon button" data-action="remove-node" title="Remove"><i class="trash icon"></i></button>
    ${issuesFor(c.id, issues)}
  </div>`;
}
```

Replace `groupHtml` (threads `individuals` through the recursive call):

```ts
function groupHtml(schema: SchemaResponse, g: Group, issues: Issue[], isRoot: boolean): string {
  const body = g.collapsed
    ? ""
    : `<div class="qb-children" style="padding-left:${isRoot ? 0 : 1}rem">
        ${g.children.map((child) => nodeHtml(schema, child, issues, false)).join("")}
      </div>`;
```

with:

```ts
function groupHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  g: Group,
  issues: Issue[],
  isRoot: boolean,
): string {
  const body = g.collapsed
    ? ""
    : `<div class="qb-children" style="padding-left:${isRoot ? 0 : 1}rem">
        ${g.children.map((child) => nodeHtml(schema, individuals, child, issues, false)).join("")}
      </div>`;
```

(The rest of `groupHtml`'s body is unchanged — only the signature and the one recursive call line above change.)

Replace `nodeHtml`:

```ts
function nodeHtml(
  schema: SchemaResponse,
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, node, issues, isRoot)
    : conditionHtml(schema, node, issues);
}
```

with:

```ts
function nodeHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, individuals, node, issues, isRoot)
    : conditionHtml(schema, individuals, node, issues);
}
```

Replace `renderQueryBuilder`'s body (the call to `nodeHtml`):

```ts
  paint(
    el,
    `<h4 class="ui header">Build your query</h4>${nodeHtml(state.schema, state.query, state.issues, true)}`,
  );
```

with:

```ts
  paint(
    el,
    `<h4 class="ui header">Build your query</h4>${nodeHtml(state.schema, state.individuals, state.query, state.issues, true)}`,
  );
```

Replace `handleRowChange`'s body:

```ts
  function handleRowChange(row: HTMLElement): void {
    const nodeId = row.dataset.nodeId!;
    const q = getQuery();
    const cond = findNode(q, nodeId);
    if (!cond || cond.kind !== "condition") return;

    const fieldSel = row.querySelector<HTMLSelectElement>('[data-part="field"]');
    const opSel = row.querySelector<HTMLSelectElement>('[data-part="operator"]');
    const newFieldId = fieldSel ? fieldSel.value || null : cond.fieldId;
    const fieldChanged = newFieldId !== cond.fieldId;
    let newOperatorId = opSel ? opSel.value || null : cond.operatorId;
    if (fieldChanged) newOperatorId = null; // operators depend on field

    const field = schemaRef?.fields.find((f) => f.id === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.id === newOperatorId);
    let value: unknown = cond.value;
    if (fieldChanged || !operator) {
      value = null;
    } else {
      value = readValueControl(row, operator.arity, field?.valueType ?? "string");
    }
    // A boolean toggle has no "unset" state on screen: an unchecked toggle IS `false`.
    // Default a null value to `false` so the rendered control and the validated value
    // agree, instead of showing an unchecked toggle under an "Enter a value." error.
    if (field?.valueType === "boolean" && operator?.arity === "one" && value == null) {
      value = false;
    }
    onChange(updateNode(q, nodeId, { fieldId: newFieldId, operatorId: newOperatorId, value }));
  }
```

with:

```ts
  function handleRowChange(row: HTMLElement): void {
    const nodeId = row.dataset.nodeId!;
    const q = getQuery();
    const cond = findNode(q, nodeId);
    if (!cond || cond.kind !== "condition") return;

    const individualSel = row.querySelector<HTMLSelectElement>('[data-part="individual"]');
    const fieldSel = row.querySelector<HTMLSelectElement>('[data-part="field"]');
    const opSel = row.querySelector<HTMLSelectElement>('[data-part="operator"]');

    const newIndividualId = individualSel ? individualSel.value || null : cond.individualId;
    const individualChanged = newIndividualId !== cond.individualId;

    const newFieldId = individualChanged
      ? null
      : fieldSel
        ? fieldSel.value || null
        : cond.fieldId;
    const fieldChanged = newFieldId !== cond.fieldId;
    let newOperatorId = fieldChanged ? null : opSel ? opSel.value || null : cond.operatorId;
    if (fieldChanged) newOperatorId = null; // operators depend on field

    const field = schemaRef?.fields.find((f) => f.id === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.id === newOperatorId);
    let value: unknown = cond.value;
    if (fieldChanged || !operator) {
      value = null;
    } else {
      value = readValueControl(row, operator.arity, field?.valueType ?? "string");
    }
    // A boolean toggle has no "unset" state on screen: an unchecked toggle IS `false`.
    // Default a null value to `false` so the rendered control and the validated value
    // agree, instead of showing an unchecked toggle under an "Enter a value." error.
    if (field?.valueType === "boolean" && operator?.arity === "one" && value == null) {
      value = false;
    }
    onChange(
      updateNode(q, nodeId, {
        individualId: newIndividualId,
        fieldId: newFieldId,
        operatorId: newOperatorId,
        value,
      }),
    );
  }
```

Finally, in the same file's `container.addEventListener("change", ...)` block, extend the Fomantic-managed-select exclusion match (the `select[data-part="field"], select[data-part="operator"], select[data-part="value"]` line) to also exclude the new individual dropdown:

```ts
      if (
        target.matches(
          'select[data-part="field"], select[data-part="operator"], select[data-part="value"]',
        )
      ) {
        return;
      }
```

becomes:

```ts
      if (
        target.matches(
          'select[data-part="individual"], select[data-part="field"], select[data-part="operator"], select[data-part="value"]',
        )
      ) {
        return;
      }
```

(No change needed to the block's surrounding comment or to the `onDropdownChange(container, ...)` call below it — `onDropdownChange` already applies to every `.ui.dropdown` in the container generically, so the new individual dropdown is wired automatically once Fomantic activates it.)

- [ ] **Step 5: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass (95 existing + 1 new assertion in Step 3 — the new assertion was added to an existing `it` block, so the total test count doesn't increase; still 95 passing, output pristine).

- [ ] **Step 6: Manual verification in the browser**

Run: `npm run dev`

In the browser (http://localhost:5173):
1. Confirm the query builder's condition row now shows three dropdowns: Item, Field, Operator (in that order), followed by the value control.
2. Confirm the Field dropdown is disabled and empty until an Item is chosen.
3. Pick an item (e.g. type part of a name into the searchable Item dropdown to confirm `fullTextSearch` still works) — confirm the Field dropdown populates with only that item's fields, shown by their short slug (not repeating the item's name).
4. Pick a field, then an operator, then enter a value — confirm the condition validates (no error message) and the stats panel updates.
5. Change the Item on an already-complete condition — confirm Field, Operator, and the value control all reset to empty, and the condition shows a validation error again until re-completed.
6. Stop the dev server (Ctrl-C) after verifying.

- [ ] **Step 7: Commit**

```bash
git add src/query/types.ts src/query/tree.ts src/ui/queryBuilder.ts tests/query/tree.test.ts
git commit -m "feat: cascade the query builder's condition row through item -> field -> operator"
```
