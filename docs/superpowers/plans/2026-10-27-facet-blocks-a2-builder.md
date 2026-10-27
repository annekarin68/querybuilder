# Facet blocks, plan A2: the builder, the switch-over, and removing the old model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users build queries from facet blocks: the builder draws blocks and their field rows, the app runs on the new model end to end (statistics, Run query, saved queries, the kept query, the mock), and the old model is deleted.

**Architecture:** The new model, wire format and mock support exist since plan A1 (`src/query/{types,tree,validate,summary,drop,fieldEdit,issues,saved}.ts`, `src/api/request.ts`, `fromSavedTree` in `src/api/response.ts`, `facetMatches` in the mock). Tasks 1–2 build the block HTML as pure string builders in new files, beside the old builder, Node-tested. Task 3 switches the whole app over in one go (the types are shared, so it cannot be split without breaking the build). Task 4 deletes the old model; Task 5 rewrites the architecture doc; Task 6 checks everything in a real browser.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vite, Vitest (Node, no DOM), Fomantic UI (only through `src/ui/fomantic.ts`), the plain-Node mock in `mock-server/`, Playwright with Chromium for Task 6.

**Spec:** `docs/superpowers/specs/2026-10-27-facet-blocks-design.md` — sections 2 (decisions 1–25), 3, 4 and 5. **Previous plan:** `docs/superpowers/plans/2026-10-27-facet-blocks-a1-model.md`, its section "Carried into plan A2" lists findings this plan must close.

**Not in this plan (plan B):** the co-occurrence row, the Seen together / About panel and its tabs, the legend, the palette tokens for those, the dictionary "open at facet". Leave room for them: do not build tabs.

## Global Constraints

- Before every commit: `npm run typecheck && npm test && npm run lint && npm run build` (the build runs `check:offline`). All four must pass.
- Code for a junior team (CLAUDE.md): comments explain *why*, names say what a thing is, logic in small pure functions the Node-only tests can reach.
- `src/` never names backend data (no facet, field, tag, group or database from the mock), not even in comments; tests use made-up ids like `"thing"`, `"size"`.
- The frontend sends the query exactly as the user built it; unset fields are not part of the query.
- Only `src/ui/fomantic.ts` uses jQuery; `src/` never imports `mock-server/`; only `src/api/` imports `src/api/types.ts`.
- Do not rename headings in `docs/ARCHITECTURE.md`; when code and that doc disagree, fix the doc in the same commit.
- Desktop only, down to a 512 px window; keyboard use works everywhere; targets at least 24 px (WCAG 2.2 AA).
- Unset field row: muted grey label (`var(--qb-muted)`), empty controls, **no visible text**; a visually hidden " (not filtered)" for screen readers (`.qb-sr-only`).
- Operator dropdown's blank first choice: "Not filtered" (picking it clears the field).
- Fold: facets with more than 5 fields show the set fields plus the first 3 (and the selected one), the rest behind "+ N more fields" / "Show fewer fields".
- Summary: `Thing has size > 40`, `Thing has (a AND b)`, `Thing has no (…)` always bracketed, `Thing present` / `Thing absent`, `between (20, 80)`.
- Never `git stash`; never `pkill` (stop only processes you started, by port and working directory). Do not push or open pull requests.
- Commit messages end with a `Co-Authored-By:` line naming the model that wrote the commit.

---

### Task 1: Shared builder parts and the field rows

**Files:**
- Create: `src/ui/builderParts.ts` (moved from `src/ui/queryBuilder.ts`: `issuesHtml`, `moveButtons`, `collapseButton`, `nodeGrip`, `iconButton`, the `Position` type)
- Modify: `src/ui/queryBuilder.ts` (import those from `./builderParts`)
- Create: `src/ui/fieldRows.ts`
- Modify: `src/query/tree.ts` (add `removeCondition`)
- Modify: `src/query/validate.ts` (unknown / doubled field issues back on the condition — they get rows now)
- Test: `tests/ui/builderParts.test.ts` (move the `issuesHtml`, `moveButtons`, `collapseButton`, grip tests out of `tests/ui/queryBuilder.test.ts`), `tests/ui/fieldRows.test.ts`, `tests/query/tree.test.ts`, `tests/query/validate.test.ts`

**Interfaces:**
- Consumes (A1): `FacetBlock`, `FieldCondition`, `Issue` (`src/query/types.ts`); `fieldsOfFacet`, `findOperator`, `OPERATORS`, `CatalogField`, `FieldCatalog` (`fieldCatalog.ts`); `renderValueControl(field, operator, value)` (`valueControl.ts`); `escapeHtml`, `optionsHtml` (`panel.ts`).
- Produces:
  - `builderParts.ts`: `Position = { index: number; count: number }`; `issuesHtml(nodeId: string, issues: Issue[]): string` (unchanged); `moveButtons(kind: "condition" | "group" | "facet", position: Position): string`; `collapseButton(collapsed: boolean, what?: "group" | "facet"): string` (default `"group"`; labels "Expand facet" / "Collapse facet" for a facet); `nodeGrip(nodeId: string, kind: "group" | "condition" | "facet"): string` (a facet's grip: class `qb-grip qb-grip-facet`, title "Drag to move this facet"); `iconButton(action: string, label: string, icon: string): string`.
  - `fieldRows.ts`: `FOLD_AFTER = 5`; `SHOWN_WHEN_FOLDED = 3`; `visibleFieldIds(fieldIds: string[], setIds: ReadonlySet<string>, expanded: boolean, selectedId: string | null): { shown: string[]; hiddenCount: number }`; `RowCtx = { catalog: FieldCatalog; issues: Issue[] }`; `fieldRowsHtml(ctx: RowCtx, block: FacetBlock, expanded: boolean, selectedFieldId: string | null): string`.
  - `tree.ts`: `removeCondition(tree: Group, blockId: string, conditionId: string): Group`.

Row markup contract (Task 3 wires events to it; keep these attributes exactly):
- Every row: `<div class="qb-field-row…" data-field-id="<fieldId>">`.
- Set row and stray row: also `data-node-id="<condition id>"` (so `revealNode`, issue placement and focus memory find it).
- Set row: `<span class="qb-field-label">name</span>`, the operator `<select class="ui search selection dropdown" data-part="operator" aria-label="Operator for <name>">` whose first option is `<option value="">Not filtered</option>`, then `<div class="qb-value">` with `renderValueControl(...)`.
- Unset row (not selected): class `qb-field-row is-unset`; the label with `<span class="qb-sr-only"> (not filtered)</span>`; ONE focusable `<button type="button" class="qb-unset-slot" data-action="edit-field" aria-label="Filter on <name>">` and one decorative `<span class="qb-unset-slot" aria-hidden="true"></span>`.
- Unset row that is selected: drawn like a set row with "Not filtered" chosen and no value control (so the operator dropdown can be opened).
- Stray row (a condition on a field the facet no longer has, or the second condition on one field): class `qb-field-row is-stray`; label = the field id; the operator name and value as plain text (`<span class="qb-stray-text">`); `iconButton("remove-condition", "Remove this condition", "times")`; then `issuesHtml(c.id, …)`.
- Fold button after the rows: `<button type="button" class="ui mini basic button qb-more-fields" data-action="toggle-fields" aria-expanded="<expanded>">` reading `+ N more fields` (`+ 1 more field`) or `Show fewer fields`; only when the facet has more than `FOLD_AFTER` fields.

- [ ] **Step 1: Move the shared parts (no behaviour change)**

Create `src/ui/builderParts.ts` by moving `issuesHtml`, `nodeGrip`, `iconButton`, `Position`, `moveButtons`, `collapseButton` (with their comments) out of `src/ui/queryBuilder.ts`, export them all, and import them back into `queryBuilder.ts`. Widen the kinds as listed under Interfaces (the old callers keep passing `"group"` / `"condition"`). Move their tests to `tests/ui/builderParts.test.ts` and add:

```ts
it("labels a facet's grip, move buttons and fold button as a facet's", () => {
  expect(nodeGrip("f-1", "facet")).toContain('title="Drag to move this facet"');
  expect(nodeGrip("f-1", "facet")).toContain("qb-grip-facet");
  expect(moveButtons("facet", { index: 1, count: 2 })).toContain('aria-label="Move facet down"');
  expect(collapseButton(false, "facet")).toContain('aria-label="Collapse facet"');
  expect(collapseButton(true)).toContain('aria-label="Expand group"');
});
```

Run `npm run typecheck && npx vitest run tests/ui` — PASS.

- [ ] **Step 2: Write the failing tests**

`tests/query/tree.test.ts`, add:

```ts
describe("removeCondition", () => {
  it("removes one condition by its id, even when another has the same field", () => {
    const a = newFieldCondition("size", "gt", 1);
    const b = newFieldCondition("size", "lt", 9);
    const block: FacetBlock = { ...newBlock("thing"), conditions: [a, b] };
    const root: Group = { ...emptyQuery(), children: [block] };
    const next = removeCondition(root, block.id, b.id);
    expect((findNode(next, block.id) as FacetBlock).conditions).toEqual([a]);
  });
});
```

`tests/query/validate.test.ts`: change the expectations for "Unknown field" and "set twice" so they point at the **condition** (`c.id`), not the block, keeping the message texts (`Unknown field “nope”. The data dictionary may have changed; remove this facet and add it again.` becomes `Unknown field “nope”. The data dictionary may have changed; remove this condition.` and `The field “size” is set twice in this facet.` stays). Spec section 5: those conditions now get their own removable row.

`tests/ui/fieldRows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fieldRowsHtml, visibleFieldIds } from "../../src/ui/fieldRows";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, FieldCondition } from "../../src/query/types";
import type { Facet } from "../../src/model";

const ids = ["a", "b", "c", "d", "e", "f", "g"];
const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: ids.map((id) => ({ id, name: id, typeName: "BIGINT", values: [] })),
  },
  { id: "small", name: "Small", tags: [], fields: [{ id: "x", name: "x", typeName: "VARCHAR", values: [] }] },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const ctx = { catalog, issues: [] };
const block = (facetId: string, ...conditions: FieldCondition[]): FacetBlock => ({
  ...newBlock(facetId),
  conditions,
});

describe("visibleFieldIds", () => {
  it("shows every field of a small facet", () => {
    expect(visibleFieldIds(["a", "b"], new Set(), false, null)).toEqual({ shown: ["a", "b"], hiddenCount: 0 });
  });
  it("folds a large facet to the first 3, the set ones and the selected one, in field order", () => {
    expect(visibleFieldIds(ids, new Set(["f"]), false, "e")).toEqual({
      shown: ["a", "b", "c", "e", "f"],
      hiddenCount: 2,
    });
  });
  it("shows everything when expanded", () => {
    expect(visibleFieldIds(ids, new Set(), true, null).hiddenCount).toBe(0);
  });
});

describe("fieldRowsHtml", () => {
  it("draws an unset row muted, with no visible text and one focusable control", () => {
    const html = fieldRowsHtml(ctx, block("small"), false, null);
    expect(html).toContain('class="qb-field-row is-unset"');
    expect(html).toContain('<span class="qb-sr-only"> (not filtered)</span>');
    expect(html).toContain('data-action="edit-field" aria-label="Filter on x"');
    expect(html).not.toContain("<select");
    expect(html).not.toMatch(/any value/i);
  });

  it("draws a set row with its operator, a Not filtered choice first, and its value", () => {
    const c = newFieldCondition("a", "gt", 3);
    const html = fieldRowsHtml(ctx, block("thing", c), false, null);
    expect(html).toContain(`data-node-id="${c.id}"`);
    expect(html).toContain('data-part="operator" aria-label="Operator for a"><option value="">Not filtered</option>');
    expect(html).toContain('<option value="gt" selected>');
    expect(html).toContain('class="qb-value"');
  });

  it("draws the selected unset row with real dropdowns and no value yet", () => {
    const html = fieldRowsHtml(ctx, block("small"), false, "x");
    expect(html).toContain('data-part="operator"');
    expect(html).not.toContain("is-unset");
    expect(html).not.toContain('class="qb-value"');
  });

  it("folds a large facet and says how many fields are hidden", () => {
    const html = fieldRowsHtml(ctx, block("thing"), false, null);
    expect(html.match(/qb-field-row/g)).toHaveLength(3);
    expect(html).toContain('data-action="toggle-fields" aria-expanded="false">+ 4 more fields</button>');
    expect(fieldRowsHtml(ctx, block("thing"), true, null)).toContain(">Show fewer fields</button>");
    expect(fieldRowsHtml(ctx, block("small"), false, null)).not.toContain("toggle-fields");
  });

  it("keeps an unknown or doubled field as a removable read-only row with its error", () => {
    const gone = newFieldCondition("gone", "eq", 1);
    const first = newFieldCondition("x", "eq", "p");
    const twice = newFieldCondition("x", "eq", "q");
    const issues = [{ nodeId: gone.id, message: "Unknown field “gone”.", kind: "invalid" as const }];
    const html = fieldRowsHtml({ catalog, issues }, block("small", first, gone, twice), false, null);
    expect(html.match(/is-stray/g)).toHaveLength(2);
    expect(html).toContain(`data-node-id="${gone.id}"`);
    expect(html).toContain(`data-node-id="${twice.id}"`);
    expect(html).toContain('data-action="remove-condition"');
    expect(html).toContain("Unknown field “gone”.");
  });
});
```

Run: `npx vitest run tests/ui/fieldRows.test.ts tests/query/tree.test.ts tests/query/validate.test.ts` — FAIL (module missing, `removeCondition` missing, issues still on the block).

- [ ] **Step 3: Implement**

`src/query/tree.ts`:

```ts
/** Block `blockId` without the condition `conditionId`: how a stray row (an
 *  unknown field, or a field set twice in a saved query) is removed. Unlike
 *  `clearFieldCondition` it leaves another condition on the same field. */
export function removeCondition(tree: Group, blockId: string, conditionId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "facet" && n.id === blockId
      ? { ...n, conditions: n.conditions.filter((c) => c.id !== conditionId) }
      : n,
  ) as Group;
}
```

`src/query/validate.ts`: push the two issues on `c.id` again, with the texts above, and replace the "these conditions have no row" comment with: "The builder draws such a condition as a removable row of its own (spec section 5), so the issue sits on the condition, next to its ✕."

`src/ui/fieldRows.ts`:

```ts
import { fieldsOfFacet, findOperator, OPERATORS, type CatalogField, type FieldCatalog } from "../query/fieldCatalog";
import type { FacetBlock, FieldCondition, Issue } from "../query/types";
import { issuesHtml, iconButton } from "./builderParts";
import { escapeHtml, optionsHtml } from "./panel";
import { renderValueControl } from "./valueControl";

// One row per field of a block's facet (spec, section 5). An unset field is
// "don't care": a muted label and empty controls, no visible text — the
// words "any value" would read as "must have a value" (maintainers,
// 2026-10-27). Unset rows draw plain buttons, not Fomantic dropdowns: the
// builder repaints on every edit, and twenty fields per block would mean
// hundreds of dropdowns to initialise.

/** Facets with more fields than this fold their unset rows. */
export const FOLD_AFTER = 5;
/** How many of a folded facet's first fields stay visible. */
export const SHOWN_WHEN_FOLDED = 3;

export interface RowCtx {
  catalog: FieldCatalog;
  issues: Issue[];
}

/** Which of a facet's fields get a row: all of them, or — for a large facet
 *  that is not expanded — the first few, the set ones and the selected one,
 *  in the facet's order. */
export function visibleFieldIds(
  fieldIds: string[],
  setIds: ReadonlySet<string>,
  expanded: boolean,
  selectedId: string | null,
): { shown: string[]; hiddenCount: number } {
  if (expanded || fieldIds.length <= FOLD_AFTER) return { shown: fieldIds, hiddenCount: 0 };
  const shown = fieldIds.filter(
    (id, i) => i < SHOWN_WHEN_FOLDED || setIds.has(id) || id === selectedId,
  );
  return { shown, hiddenCount: fieldIds.length - shown.length };
}

function operatorSelect(field: CatalogField, selectedId: string | null): string {
  const choices = OPERATORS.filter((o) => field.operatorIds.includes(o.id));
  const opts = optionsHtml(choices, (o) => o.id, (o) => o.name, (o) => o.id === selectedId);
  return `<select class="ui search selection dropdown" data-part="operator" aria-label="Operator for ${escapeHtml(field.fieldName)}"><option value="">Not filtered</option>${opts}</select>`;
}

/** A field with a condition, or the selected unset field (no condition yet:
 *  its operator dropdown is drawn so it can be opened at once). */
function activeRowHtml(ctx: RowCtx, field: CatalogField, c: FieldCondition | undefined): string {
  const operator = findOperator(c?.operatorId ?? null);
  const nodeId = c ? ` data-node-id="${escapeHtml(c.id)}"` : "";
  const value = c ? `<div class="qb-value">${renderValueControl(field, operator, c.value)}</div>` : "";
  return `<div class="qb-field-row" data-field-id="${escapeHtml(field.fieldId)}"${nodeId}>
      <span class="qb-field-label">${escapeHtml(field.fieldName)}</span>
      ${operatorSelect(field, c?.operatorId ?? null)}
      ${value}
    </div>${c ? issuesHtml(c.id, ctx.issues) : ""}`;
}

function unsetRowHtml(field: CatalogField): string {
  const name = escapeHtml(field.fieldName);
  return `<div class="qb-field-row is-unset" data-field-id="${escapeHtml(field.fieldId)}">
      <span class="qb-field-label">${name}<span class="qb-sr-only"> (not filtered)</span></span>
      <button type="button" class="qb-unset-slot" data-action="edit-field" aria-label="Filter on ${name}"></button>
      <span class="qb-unset-slot" aria-hidden="true"></span>
    </div>`;
}

/** A condition the facet's rows can't show: its field is gone from the
 *  dictionary, or it is a second condition on one field. Kept, read-only,
 *  with its error and a ✕, so a saved query reloads as it was saved. */
function strayRowHtml(ctx: RowCtx, c: FieldCondition): string {
  const op = findOperator(c.operatorId);
  const value = c.value === null || c.value === undefined ? "" : ` ${String(c.value)}`;
  const text = `${op?.name ?? c.operatorId ?? "(operator?)"}${value}`;
  return `<div class="qb-field-row is-stray" data-field-id="${escapeHtml(c.fieldId)}" data-node-id="${escapeHtml(c.id)}">
      <span class="qb-field-label">${escapeHtml(c.fieldId)}</span>
      <span class="qb-stray-text">${escapeHtml(text)}</span>
      ${iconButton("remove-condition", "Remove this condition", "times")}
    </div>${issuesHtml(c.id, ctx.issues)}`;
}

function foldButton(hiddenCount: number, expanded: boolean): string {
  const label = expanded
    ? "Show fewer fields"
    : `+ ${hiddenCount} more ${hiddenCount === 1 ? "field" : "fields"}`;
  return `<button type="button" class="ui mini basic button qb-more-fields" data-action="toggle-fields" aria-expanded="${expanded}">${label}</button>`;
}

/** The rows of `block`: one per visible field of its facet, then any stray
 *  conditions, then the fold button for a large facet. */
export function fieldRowsHtml(
  ctx: RowCtx,
  block: FacetBlock,
  expanded: boolean,
  selectedFieldId: string | null,
): string {
  const fields = fieldsOfFacet(ctx.catalog, block.facetId);
  const known = new Set(fields.map((f) => f.fieldId));
  const firstOf = new Map<string, FieldCondition>();
  const strays: FieldCondition[] = [];
  for (const c of block.conditions) {
    if (known.has(c.fieldId) && !firstOf.has(c.fieldId)) firstOf.set(c.fieldId, c);
    else strays.push(c);
  }
  const { shown, hiddenCount } = visibleFieldIds(
    fields.map((f) => f.fieldId),
    new Set(firstOf.keys()),
    expanded,
    selectedFieldId,
  );
  const rows = fields
    .filter((f) => shown.includes(f.fieldId))
    .map((f) => {
      const c = firstOf.get(f.fieldId);
      return c || f.fieldId === selectedFieldId ? activeRowHtml(ctx, f, c) : unsetRowHtml(f);
    });
  const fold = fields.length > FOLD_AFTER ? foldButton(hiddenCount, expanded) : "";
  return rows.join("") + strays.map((c) => strayRowHtml(ctx, c)).join("") + fold;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/ui tests/query` — PASS. If the exact attribute order in a test differs from the code above only because of whitespace, fix the test's string, never the attribute set.

- [ ] **Step 5: Run the checks and commit**

`npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add -A
git commit -m "Facet blocks: shared builder parts and the field rows"
```

---

### Task 2: The block and group HTML, and their styles

**Files:**
- Create: `src/ui/blockHtml.ts`
- Modify: `src/styles.css` (new section "Facet blocks")
- Test: `tests/ui/blockHtml.test.ts`

**Interfaces:**
- Consumes: Task 1 (`fieldRowsHtml`, `issuesHtml`, `moveButtons`, `collapseButton`, `nodeGrip`, `iconButton`, `Position`); A1 (`blockText`, `queryToText`, `countBlocks`, `ungroupBlocker`, `findFacet`, `FieldRef` from `src/query/drop.ts`).
- Produces: `BlockCtx = { catalog: FieldCatalog; facets: Facet[] | null; issues: Issue[]; query: Group; expandedBlockIds: readonly string[]; selectedField: FieldRef | null }`; `blockHtml(ctx: BlockCtx, block: FacetBlock, position: Position): string`; `groupHtml(ctx: BlockCtx, g: Group, isRoot: boolean, position?: Position | null): string`; `footerHtml(query: Group, issues: Issue[], catalog: FieldCatalog): string`.

Markup contract (Task 3 wires to it):
- Block: `<div class="qb-block" data-node-id="<block id>">`; folded: `class="qb-block is-collapsed"`.
- Block head `<div class="qb-block-head">`: `nodeGrip(id, "facet")`, `moveButtons("facet", position)`, `collapseButton(collapsed, "facet")`, `<span class="qb-block-name">Facet name</span>`, the Has / Has no pair `<span class="qb-logic" role="group" aria-label="Has or has no">` with `<button … class="qb-logic-btn[ is-on]" data-action="set-has" aria-pressed>Has</button>` and `data-action="set-has-no"` "Has no"; when one or more fields are set `<span class="qb-group-label">an occurrence where</span>`; when two or more are set, the ALL / ANY pair (`data-action="set-and"` / `set-or`, the same classes as a group's) followed by `<span class="qb-group-label">of the set fields match</span>`; then `iconButton("remove-node", "Remove facet", "times")` last.
- Folded block: the head with `<span class="qb-group-summary" title="…">blockText</span>` instead of the pairs; no rows.
- `issuesHtml(block.id, …)` right after the head, then `<div class="qb-field-rows">` + `fieldRowsHtml(...)` + `</div>`.
- Group: the same as the old `groupHtml` in `src/ui/queryBuilder.ts` (bracket, joiner, ALL/ANY, Group contents, Ungroup, remove, collapsed summary), except: "+ Condition" becomes the facet picker `<select class="ui search selection dropdown qb-add-facet" data-part="add-facet" aria-label="Add a facet to this group"><option value="">+ Facet</option>…every facet by name…</select>` (from `ctx.facets`), the "+ Group" button carries `data-focus-landing`, a folded group counts `countBlocks(g)` as "N facets", and children are drawn with `blockHtml` / `groupHtml`.
- Footer: empty query → `<span class="qb-muted">Add a facet to start building the query.</span>`; otherwise as the old `footerHtml`, using the new `queryToText`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/blockHtml.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockHtml, footerHtml, groupHtml, type BlockCtx } from "../../src/ui/blockHtml";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group } from "../../src/query/types";
import type { Facet } from "../../src/model";

const facets = [
  {
    id: "thing",
    name: "Thing",
    tags: [],
    fields: [
      { id: "size", name: "size", typeName: "BIGINT", values: [] },
      { id: "label", name: "label", typeName: "VARCHAR", values: [] },
    ],
  },
] as unknown as Facet[];
const catalog = buildFieldCatalog(facets);
const ctxFor = (query: Group): BlockCtx => ({
  catalog,
  facets,
  issues: [],
  query,
  expandedBlockIds: [],
  selectedField: null,
});
const pos = { index: 1, count: 1 };

describe("blockHtml", () => {
  it("draws a block: name, Has on, no ALL/ANY while fewer than two fields are set", () => {
    const b = newBlock("thing");
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain(`class="qb-block" data-node-id="${b.id}"`);
    expect(html).toContain('<span class="qb-block-name">Thing</span>');
    expect(html).toContain('data-action="set-has" aria-pressed="true"');
    expect(html).toContain('data-action="set-has-no" aria-pressed="false"');
    expect(html).not.toContain("set-and");
    expect(html).not.toContain("an occurrence where");
    expect(html).toContain('aria-label="Remove facet"');
  });

  it("offers ALL / ANY once two fields are set", () => {
    const b: FacetBlock = {
      ...newBlock("thing"),
      negated: true,
      operator: "OR",
      conditions: [newFieldCondition("size", "gt", 1), newFieldCondition("label", "eq", "x")],
    };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain('data-action="set-has-no" aria-pressed="true"');
    expect(html).toContain("an occurrence where");
    expect(html).toContain('data-action="set-or" aria-pressed="true"');
    expect(html).toContain("of the set fields match");
  });

  it("folds to its head and the summary line", () => {
    const b: FacetBlock = { ...newBlock("thing"), collapsed: true, conditions: [newFieldCondition("size", "gt", 40)] };
    const html = blockHtml(ctxFor({ ...emptyQuery(), children: [b] }), b, pos);
    expect(html).toContain("is-collapsed");
    expect(html).toContain("Thing has size &gt; 40");
    expect(html).not.toContain("qb-field-row");
  });
});

describe("groupHtml", () => {
  it("offers + Facet as a picker of every facet, and + Group as the focus landing", () => {
    const q = emptyQuery();
    const html = groupHtml(ctxFor(q), q, true);
    expect(html).toContain('data-part="add-facet" aria-label="Add a facet to this group"><option value="">+ Facet</option><option value="thing">Thing</option>');
    expect(html).toMatch(/data-action="add-group" data-focus-landing/);
    expect(html).not.toContain("add-condition");
  });

  it("counts facets in a folded group", () => {
    const g = { ...groupOf([newBlock("thing"), newBlock("thing")]), collapsed: true };
    const q: Group = { ...emptyQuery(), children: [g] };
    expect(groupHtml(ctxFor(q), g, false, pos)).toContain("2 facets");
  });
});

describe("footerHtml", () => {
  it("asks for a facet in an empty query, and shows the summary otherwise", () => {
    expect(footerHtml(emptyQuery(), [], catalog)).toContain("Add a facet to start building the query.");
    const q: Group = { ...emptyQuery(), children: [newBlock("thing")] };
    expect(footerHtml(q, [], catalog)).toContain("Thing present");
  });
});
```

Run: `npx vitest run tests/ui/blockHtml.test.ts` — FAIL (module missing).

- [ ] **Step 2: Implement `src/ui/blockHtml.ts`**

Write it from the markup contract above. Start the group part by copying the old `groupHtml`, `nodeHtml` and `footerHtml` from `src/ui/queryBuilder.ts` (with their comments), then make exactly the listed changes. The block part:

```ts
/** A facet block (spec, section 5): its head, its issues and its field rows.
 *  The facet is fixed: to filter on another facet the user adds a block. */
export function blockHtml(ctx: BlockCtx, block: FacetBlock, position: Position): string {
  const name = findFacet(ctx.catalog, block.facetId)?.name ?? block.facetId;
  const head = (inner: string) =>
    `<div class="qb-block-head">${nodeGrip(block.id, "facet")}${moveButtons("facet", position)}${collapseButton(Boolean(block.collapsed), "facet")}<span class="qb-block-name">${escapeHtml(name)}</span>${inner}<span class="qb-spacer"></span>${iconButton("remove-node", "Remove facet", "times")}</div>`;
  if (block.collapsed) {
    const text = blockText(block, ctx.catalog);
    return `<div class="qb-block is-collapsed" data-node-id="${escapeHtml(block.id)}">${head(
      `<span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`,
    )}${issuesHtml(block.id, ctx.issues)}</div>`;
  }
  const pair = (on: boolean, action: string, label: string) =>
    `<button type="button" class="qb-logic-btn${on ? " is-on" : ""}" data-action="${action}" aria-pressed="${on}">${label}</button>`;
  const has = `<span class="qb-logic" role="group" aria-label="Has or has no">${pair(!block.negated, "set-has", "Has")}${pair(block.negated, "set-has-no", "Has no")}</span>`;
  const setCount = block.conditions.length;
  // ALL / ANY only matter once two fields are set; before that they change nothing.
  const where = setCount >= 1 ? `<span class="qb-group-label">an occurrence where</span>` : "";
  const match =
    setCount >= 2
      ? `<span class="qb-logic" role="group" aria-label="Combine the set fields with">${pair(block.operator === "AND", "set-and", "ALL")}${pair(block.operator === "OR", "set-or", "ANY")}</span><span class="qb-group-label">of the set fields match</span>`
      : "";
  const expanded = ctx.expandedBlockIds.includes(block.id);
  const selected = ctx.selectedField?.blockId === block.id ? ctx.selectedField.fieldId : null;
  const rows = fieldRowsHtml({ catalog: ctx.catalog, issues: ctx.issues }, block, expanded, selected);
  return `<div class="qb-block" data-node-id="${escapeHtml(block.id)}">${head(has + where + match)}${issuesHtml(block.id, ctx.issues)}<div class="qb-field-rows">${rows}</div></div>`;
}
```

(If `.qb-spacer` does not exist in `styles.css`, add it in Step 3: `flex: 1`.)

- [ ] **Step 3: Styles**

Add a section to `src/styles.css`, after the condition-row rules, using only existing tokens (no new colour tokens: plan B adds those):

```css
/* ---- Facet blocks (docs/superpowers/specs/2026-10-27-facet-blocks-design.md, section 5) */
.qb-block {
  container-type: inline-size;
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
  background: var(--qb-surface);
  padding: 0.35rem 0.5rem;
  margin: 0.25rem 0;
}
.qb-block-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.qb-block-name {
  font-weight: 600;
}
.qb-field-row {
  display: grid;
  grid-template-columns: minmax(6rem, 0.8fr) minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 0.4rem;
  align-items: center;
  min-height: 2rem;
  padding: 0.1rem 0;
}
/* "Don't care": a muted label and empty slots, no words (maintainers, 2026-10-27). */
.qb-field-row.is-unset .qb-field-label {
  color: var(--qb-muted);
}
.qb-unset-slot {
  display: block;
  min-height: 2rem; /* a 24px+ target (WCAG 2.5.8) */
  border: 1px dashed var(--qb-border-strong);
  border-radius: var(--qb-radius);
  background: transparent;
  cursor: pointer;
}
.qb-unset-slot:focus-visible {
  outline: 2px solid var(--qb-and);
  outline-offset: 1px;
}
.qb-field-row.is-stray {
  grid-template-columns: minmax(6rem, 0.8fr) minmax(0, 2.4fr) auto;
}
.qb-field-rows .ui.selection.dropdown {
  width: 100%;
  min-width: 0;
}
.qb-more-fields {
  margin-top: 0.25rem !important;
}
/* A narrow block (a 512 px window, or deep nesting): the value moves under
   the label and operator. */
@container (max-width: 420px) {
  .qb-field-row {
    grid-template-columns: minmax(5rem, 0.8fr) minmax(0, 1fr);
  }
  .qb-field-row > .qb-value {
    grid-column: 1 / 3;
  }
}
```

`tests/themeContrast.test.ts` already checks `--qb-muted` on the surface; no new pair is needed.

- [ ] **Step 4: Run the tests, the checks, and commit**

`npx vitest run tests/ui/blockHtml.test.ts` — PASS; then `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add -A
git commit -m "Facet blocks: block and group HTML, and their styles"
```

---

### Task 3: Switch the app to facet blocks

The one large task: after it, the app runs on the new model end to end. Nothing may stay half-switched, because the old and new `Group` types are not compatible. Work in this order and keep `npm run typecheck` as your guide; commit once at the end (or in a few commits that each pass all four checks).

**Files (modify unless noted):** `src/model.ts`, `src/state.ts`, `src/app.ts`, `src/ui/queryBuilder.ts`, `src/ui/statsPanel.ts`, `src/ui/dataPreview.ts`, `src/ui/mascot.ts` (if it uses the old types), `src/util/keptQuery.ts`, `src/api/types.ts`, `src/api/request.ts`, `src/api/response.ts`, `src/api/client.ts`, `mock-server/savedQueries.ts`, and their tests: `tests/app.test.ts`, `tests/ui/queryBuilder.test.ts`, `tests/util/keptQuery.test.ts`, `tests/api/{client,response,request,mockContract}.test.ts`, `tests/mock-server/{savedQueries,server}.test.ts`, `tests/savedQueryFixtures.ts`, `tests/state.test.ts`.

**Interfaces:**
- Consumes: everything from plan A1 and Tasks 1–2.
- Produces: `AppState.expandedBlockIds: string[]` (initial `[]`), `AppState.selectedField: FieldRef | null` (initial `null`); `RunBlocker` reason `"no-facet"` (renamed from `"no-condition"`), with the texts "Add a facet to see statistics." (statsPanel) and "Add a facet, then run the query." (dataPreview); `toSavedQueryRequest(draft: SavedQueryDraft): SavedQueryRequest` and `toSavedQuery(q: ResponseObject<SavedQueryResponse>): SavedQuery` in `src/api/request.ts` / `src/api/response.ts`, on `toSavedTree` / `fromSavedTree`; `SavedQueryRequest` / `SavedQueryResponse` in `src/api/types.ts` with `query: SavedGroup` (new shape). Plan B relies on `selectedField` and `expandedBlockIds`.

- [ ] **Step 1: Model, state, wire**
  - `src/model.ts`: `SavedQuery` / `SavedQueryDraft` use the new `Group` (`./query/types`).
  - `src/state.ts`: import from the new modules (`./query/types`, `./query/tree`, `./query/saved`); add the two fields above; `runBlocker` uses `countBlocks(state.query) === 0` → `"no-facet"`; update the two texts.
  - `src/api/types.ts`: move `SavedQueryRequest` / `SavedQueryResponse` (with doc comments) from `src/api/legacy/types.ts`, typed with the new `SavedGroup`.
  - `src/api/request.ts`: add `toSavedQueryRequest` (port of the legacy one: trims name and note, copies `databaseIds`, `query: toSavedTree(draft.query)`).
  - `src/api/response.ts`: add `toSavedQuery` (port of `src/api/legacy/savedResponse.ts`, with `query: fromSavedTree(root)`).
  - `src/api/client.ts`: import `toQueryRequest`, `toSavedQueryRequest` from `./request` and `toSavedQuery` from `./response`; nothing else changes.
  - `mock-server/savedQueries.ts`: `savedTreeProblem` checks the new saved shape (group / facet / condition, no ids, `operator_id` and `value` may be null, `negated` boolean, a group's children may be empty); an old-shape body (a condition in a group) is a `400` naming the path.
  - `src/util/keptQuery.ts`: `isQueryNode` checks the new shape (a group's children are groups or facet blocks; a block has `facetId` string, `negated` boolean, `operator`, `conditions` each with string `id`, string `fieldId`, `operatorId` string or null); an old-shape entry fails and is dropped (decision 9, accepted). `isWorthRestoring(query)` is `countBlocks(query) > 0`.

- [ ] **Step 2: The app (`src/app.ts`)**
  - `startingQuery()` is `emptyQuery()` (no seed row); `startFresh` and `start` use it.
  - `onDropItem`: a `node` item moves with `moveNode` as before (the target is a group or block id — see Step 3 for how the builder resolves a drop on a row); a dictionary item goes through `dropItem(query, item, targetId, facets, catalog)`: show `problems` with `setNotice`; when `outcome.query !== query`, `onQueryChange(outcome.query)`; set `selectedField: outcome.select` (and add the block to `expandedBlockIds` if the selected field would be folded — `visibleFieldIds` decides); announce `addedNodesMessage(outcome.added)` when something was added, otherwise `Set <field name> to <value>.` for a filled row or `Showing <field name> in <facet name>.` for a focused row (the `DropOutcome` has no message for these; write two small pure functions in `src/query/drop.ts`, `filledRowMessage(fieldName, value)` and `focusedRowMessage(fieldName, facetName)`, with tests). A value dropped on a set row (a new block) announces `Added 1 facet to the query, beside the one that already sets <field name>.` — make `addedNodesMessage` take an optional reason or add a third function; test it.
  - New app functions the builder calls (hooks): `selectField(ref: FieldRef | null)`, `toggleFields(blockId: string)` (adds or removes it from `expandedBlockIds`). Neither is a query edit: they set state directly, without `changeScope`.
  - Everything that read `countConditions`, `isBlankCondition`, `newCondition`, `placeNodes` or the legacy messages now uses the new modules.

- [ ] **Step 3: The builder (`src/ui/queryBuilder.ts`)**
  - Paint with `groupHtml` from `./blockHtml` (ctx from state: `expandedBlockIds`, `selectedField`); delete the old `conditionHtml`, `rowDropdown`, `fieldDropdown`, `decodeFieldValue`, `FACET_TEST_PREFIX`, `FIELD_PREFIX`, the old `groupHtml` / `nodeHtml` / `footerHtml`.
  - A field row's operator dropdown change (via `onDropdownChange`, `data-part="operator"`): find the block (`row.closest(".qb-block")`), the field (`row.dataset.fieldId`) and its condition (the block's first condition on that field); `next = nextFieldCondition(existing, block.facetId, fieldId, picked || null, catalog, (arity, type) => readValueControl(row, arity, type))`; `onChange(next ? setFieldCondition(q, blockId, next) : clearFieldCondition(q, blockId, fieldId))`; when cleared, also `selectField(null)`; then put the cursor on the value when `cursorAfterOperator(next?.operatorId ?? null)` says so (reuse `focusPart`'s approach, keyed by the row's `data-node-id`, which the repaint gives the new condition).
  - Typed values: the existing `afterPointer` path, with rows found by `.qb-field-row[data-node-id]` instead of `.qb-condition`.
  - The `+ Facet` picker change (`data-part="add-facet"`): `onChange(addChild(q, groupId, newBlock(facetId)))`, announce `addedNodesMessage([block])`, and leave the focus on the picker (paint keeps it).
  - Clicks: `edit-field` → `selectField({ blockId, fieldId })` then open that row's operator dropdown after the repaint; `toggle-fields` → `toggleFields(blockId)`; `set-has` / `set-has-no` → `updateNode(q, blockId, { negated })`; `set-and` / `set-or` work for blocks and groups (`updateNode`); `remove-condition` → `removeCondition(q, blockId, conditionId)`; `toggle-collapse` folds blocks too; `remove-node` removes blocks too. Escape inside a block clears `selectedField`.
  - Drag and drop: the drop target is `closest(".qb-block, .qb-group")`'s `data-node-id` (a row's `data-node-id` is a condition, never a drop target); a block shows `is-drop-before`, a group `is-drop-target`; grips carry block ids.
  - `revealNode(container, nodeId)` keeps working for condition ids (rows have `data-node-id`).
  - Check `src/ui/focusMemory.ts` still restores focus after a repaint for: an operator dropdown, a value box, the Has / Has no and ALL / ANY buttons, `+ Facet`, `toggle-fields`, a remove ✕ (falls to `+ Group`, the group's `data-focus-landing`). Fix by adjusting `data-action` / `data-node-id` in the markup only if a case fails.

- [ ] **Step 4: Tests**
  Port every test that built old trees to the new model (fixtures: `tests/savedQueryFixtures.ts` gets a facet-block `unfinishedTree` / `unfinishedRequest`; keep `withoutNodeIds`). Delete tests of deleted UI functions; add tests for: the new app hooks (`selectField`, `toggleFields`, drop outcomes and their announcements, start with an empty query, a kept query in the old shape is dropped, `isWorthRestoring`), `runBlocker` `"no-facet"`, the mock's saved-shape check, and `tests/api/mockContract.test.ts` saving and listing a facet-block query against the mock. Do not delete the legacy folders yet (Task 4), but nothing outside them may import them any more: `grep -rn "legacy/" src tests mock-server --include=*.ts | grep -v "^src/query/legacy\|^src/api/legacy\|^tests/query/legacy\|^tests/api/legacy"` must print only mock-server lines (the mock's old-condition shim stays until Task 4).

- [ ] **Step 5: Run the checks and commit**
  `npm run typecheck && npm test && npm run lint && npm run build` — all pass.

```bash
git add -A
git commit -m "Switch the app to facet blocks"
```

---

### Task 4: Delete the old model, and close the carried-over code findings

**Files:**
- Delete: `src/query/legacy/`, `src/api/legacy/`, `tests/query/legacy/`, `tests/api/legacy/`
- Modify: `src/query/fieldCatalog.ts` (remove `FACET_OPERATOR_IDS`, `FACET_OPERATORS`, `isFacetLevel`, `isFacetTest`, and `operatorName`'s facet-level labels if nothing uses them), `mock-server/{evaluate,requestBody,rows}.ts` (remove the old condition shim: `conditionMatches` on rows, `matches`, `rowHasFacet`, `flattenEntryset`, `Row` if unused, `MockEvent.row`; `queryProblem` accepts only groups and facet blocks), their tests, `src/query/tree.ts`, `src/query/drop.ts`, `src/api/request.ts`
- Test: `tests/query/{tree,validate}.test.ts`, mock tests

Steps:
- [ ] **Step 1:** Before deleting, port the legacy tests that still describe live behaviour to the new modules: `moveSibling` down; ungroup of a one-child group whose operator differs; the `validate.ts` branches "Unknown operator.", "This operator takes no value.", "Remove the empty value.", "Choose true or false.", the date message, a date `between`. Run them — they must pass against the new code (they are characterisation tests).
- [ ] **Step 2:** Delete the folders and the shims above; fix what `npm run typecheck` reports; `grep -rn "legacy" src tests mock-server docs/ARCHITECTURE.md` should then only find prose that Task 5 rewrites.
- [ ] **Step 3: Carried-over code findings** (from plan A1's "Carried into plan A2"), each with a test:
  - `ungroupBlocker(tree, blockId)` says "Only a group can be ungrouped." for a block id.
  - `NodePatch`: split so `negated` only applies to a block — add `setNegated(tree: Group, blockId: string, negated: boolean): Group` and use it in the builder instead of `updateNode(…, { negated })`; `NodePatch` keeps `operator` / `collapsed`.
  - `setFieldCondition` inserts a new condition in the facet's field order when given the field order: add an optional `fieldOrder?: string[]` parameter, pass `fieldsOfFacet(...)` ids from the builder; a test shows clear-then-set no longer moves a condition to the end.
  - `drop.ts`: a number field's value that isn't a number (`Number("")` is 0, `Number("x")` is NaN) is refused with a problem ("isn't a number").
  - `src/api/request.ts` `savedValueOf`: "cannot be saved".
  - The stale path comments in `src/api/client.ts`, `src/ui/queryBuilder.ts`, `src/state.ts`.
- [ ] **Step 4:** Run the checks and commit ("Delete the old query model").

---

### Task 5: Rewrite the architecture doc for the new model

**Files:** `docs/ARCHITECTURE.md` only.

- [ ] **Step 1:** Rewrite, keeping every heading's title (`tests/docReferences.test.ts`):
  - "Directory layout": remove `legacy/` and the "until plan A2" notes; list the new files (`blockHtml.ts`, `fieldRows.ts`, `builderParts.ts`, `fieldEdit.ts`, …).
  - "The query model": the facet-block model of spec section 3 (blocks, field conditions, unset = absent, empty root, the tree functions, validation incl. stray rows, summary format, drops, field edits, issue placement); remove facet-level conditions, the Field dropdown's two kinds of choice, `replaceLoneBlankCondition`.
  - "Wire format of the query" and "Saved queries": the shapes of spec section 4 (facet nodes, `negated`, `kind: "condition"`, `not_in` and that its blank-value meaning is the backend's, saved trees without ids), the backend hand-off list.
  - "Centre — `queryBuilder.ts`": blocks, rows, unset rows as plain buttons and why, fold rule, stray rows, `+ Facet`, moving only blocks and groups, keyboard paths, the announcements, narrow blocks.
  - "Saved query across the login/compliance redirect": the kept query's new shape and that an old-shape entry is dropped once.
  - "Pickle theme and mascot": the mascot rule ("every query starts as a blank row" → "every query starts empty").
  - "Mock server": remove the old-condition shim; split the long "Facet blocks" bullet; keep that `not_in`'s blank-value answer is only the mock's.
  - Every `plan A2` mention goes.
- [ ] **Step 2:** `npx vitest run tests/docReferences.test.ts && npm run lint`, then all four checks; commit ("Docs: the facet-block model").

---

### Task 6: Check it in a real browser

**Files:** whatever the checks show is broken (with a test for each fix where the logic is reachable from Node).

- [ ] **Step 1:** Start your own servers (CLAUDE.md): `DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts` and `DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort`, in the background; Playwright with Chromium is installed at `/tmp/claude-1000/-home-annek-repos-query-builder--claude-worktrees-query-builder-facet-ops-1d4ae7/f8d04979-ff14-4e8e-914e-9e5ee6f6bd88/scratchpad/pw/node_modules` (write your scripts in that folder, run them with `node`). Log in through `http://localhost:5191/api/v1/auth/login` → "Log in as demo.user". Use realistic clicks (press, wait ~100 ms, release); an `aria-disabled` control needs Enter.
- [ ] **Step 2:** At 1280×900 and at 512×900, check and record (screenshot each): the empty start ("Add a facet to start…"); `+ Facet` adds a block; dragging a facet, a field and a value from the dictionary (a field onto its block focuses the row; a value fills an unset row; on a set row it adds a block); an unset row is muted with no text, clicking or Enter opens its operator list; setting and clearing a field ("Not filtered"); Has / Has no; ALL / ANY appears with two set fields; a facet with more than 5 fields folds and unfolds; folding a block shows the summary; moving a block by drag and by Move up/down; statistics update and Run query returns events; event 2's two `gps_position` occurrences: ALL of latitude of one and longitude of the other matches nothing, two blocks match; save, change, open the saved query (it comes back with no "(edited)"); reload restores the kept query; keyboard only: build one block with two fields without the mouse; no console errors anywhere.
- [ ] **Step 3:** Fix what fails (smallest change, a test where possible), re-run the four checks, stop only the servers you started (by port and working directory), commit ("Facet blocks: fixes from the browser check"), and list every check with its result in your report.

## Carried into plan B (from the reviews of A2, 2026-10-27)

- The panel's `selectedField` (what the About tab shows) is separate from `openField` (the row drawn open for editing): selecting by clicking a label or focusing a row must never change row markup (spec section 5, "Panel").
- The block head already wraps at 1280 px with two set fields; plan B adds the Seen together / About tabs and the "?" button — design the head first (e.g. "an occurrence where ALL / ANY of the set fields match" on its own line above the rows).
- Small items that can wait: the stray row prints list values comma-joined; `queryProblem` in the mock accepts a facet block as the root (the server guards it); the summary shows "between (value?)" for a null pair but "(5, (value?))" for one missing end; a comment in `dragMemory.ts` on a dictionary re-render mid-drag; the long `drop.ts` line in "Directory layout"; two repaints inside one Fomantic callback in `handleOperatorChange`; `listSavedQueries` warns once per unreadable entry per fetch.
- Questions for the maintainers: may an unset field's empty slot get a hover title ("Filter on <field>"), or does decision 5 (no visible text) rule that out too? At 512 px the floating dictionary covers the query during a drag; the Run button shifts as statistics stream in; Enter within ~200 ms of typing in "+ Facet" does nothing (Fomantic's search delay).
