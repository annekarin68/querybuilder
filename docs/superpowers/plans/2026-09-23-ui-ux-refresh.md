# UI/UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the query-builder frontend prettier and friendlier: full-width builder with a pinned slim stats column and a docs rail, Run moved into "Matching entrysets", bracket+tint group styling, soft hints instead of red errors for unfinished queries, and an account menu in a dark top bar.

**Architecture:** A theme layer on top of Fomantic UI — CSS custom properties and named classes in `src/styles.css`, a rebuilt shell in `src/ui/layout.ts`, and re-written render functions per panel. The state/render loop, the §6 stale-response guards, the request slots and the login/compliance redirect flow are untouched. Two small model changes (`Issue.kind`, `newGroup()` pre-populated) are unit-tested; all markup changes are verified visually with a Playwright screenshot driver.

**Tech Stack:** Vite 8, TypeScript 5 (strict), Fomantic UI 2.9 (CSS + jQuery plugins), Vitest 4, ESLint 9 + Prettier 3, Node 20.19+.

**Spec:** `docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md` — read it before starting any task.

## Global Constraints

- **Offline only.** No CDN links, web fonts, analytics or any request to a non-`/api` host. `npm run build` runs `check:offline` and must pass.
- **jQuery airlock.** `import $ from "jquery"` only in `src/ui/fomantic.ts` and `src/setup-jquery.ts` (ESLint enforces).
- **Panels update by building an HTML string and calling `paint()`** (`src/ui/panel.ts`). The only direct DOM mutations allowed are the ones this plan spells out (docs filter visibility, `<details>` open state, the shell's rail attributes).
- **One state object** — change it only with `store.setState({...})`.
- **Do not change** request orchestration in `src/main.ts` (`requestSlot`, `runGuarded`, `staleGuard`, `refreshStats`, `runPreview`'s 401/403 handling, `onQueryChange`, `onDatabasesChange`), the API client, or the mock server.
- **Unit tests only** on pure modules — no DOM/component tests (repo rule).
- **Colours:** ALL/AND = `#2185d0`, ANY/OR = `#e08a00`. **Widths:** docs rail 28 px, docs column 20rem, stats column 15rem.
- **Group names and tags** are displayed in the backend's casing with underscores replaced by spaces (`battery_ev` → `battery ev`). No title-casing.
- **Every commit message ends with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Formatting:** run `npx prettier --write <files you touched>` before each commit; `npm run lint` must pass.
- **Delivery:** push the branch `claude/frontend-ui-ux-improvements-73afba`. Do **not** open a pull request.

## File Map

| File | Change | Responsibility after this plan |
|---|---|---|
| `src/query/types.ts` | modify | `Issue` gains `kind: "incomplete" \| "invalid"` |
| `src/query/validate.ts` | modify | tags each issue with its kind |
| `src/query/tree.ts` | modify | `newGroup()` returns a group holding one empty condition |
| `src/ui/format.ts` | modify | + `displayLabel`, `countLabel`, `formatWhen` |
| `src/ui/docsFilter.ts` | **create** | pure `matchDocs(individuals, text)` |
| `src/state.ts` | modify | `sidebarCollapsed` starts `true` |
| `src/styles.css` | rewrite in sections | design tokens, shell layout, every panel's styling |
| `src/ui/layout.ts` | rewrite | top bar (steps + account slot), docs rail, three columns |
| `src/ui/accountMenu.ts` | **create** | login + compliance menu (replaces two files) |
| `src/ui/authStatus.ts`, `src/ui/complianceStatus.ts` | **delete** | merged into `accountMenu.ts` |
| `src/ui/databasePicker.ts` | rewrite render | pill toggles, count, All/None |
| `src/ui/queryBuilder.ts` | rewrite render | brackets, joiners, hints, collapsed summary, footer |
| `src/ui/valueControl.ts` | modify | inline styles → classes |
| `src/ui/statsPanel.ts` | rewrite render | card, labelled headline, compact per-db grid |
| `src/ui/dataPreview.ts` | rewrite | "Matching entrysets" card that owns the Run button |
| `src/ui/docsSidebar.ts` | rewrite | "Data dictionary" with `<details>` groups + filter |
| `src/ui/fomantic.ts` | modify | accordion removed from activate/destroy |
| `src/main.ts` | modify | account menu wiring, Run wiring moved to preview |
| `docs/ARCHITECTURE.md` | modify | §1, §3, §4, §5, §9, §11, §12, §13 |
| `.superpowers/shoot-ui.mjs` | **create (git-ignored)** | Playwright screenshot driver for visual checks |

## Running the app for visual checks (used from Task 5 on)

```bash
# 1. Mock API on :3001. If something is already listening there (e.g. the
#    user's own dev server from the main checkout), reuse it — same API.
lsof -ti:3001 -sTCP:LISTEN || (npx tsx mock-server/index.ts > .superpowers/mock.log 2>&1 &)
# 2. This worktree's Vite on :5199 (5173 may be the user's own dev server).
lsof -ti:5199 -sTCP:LISTEN || (npx vite --port 5199 --strictPort > .superpowers/vite.log 2>&1 &)
timeout 30 bash -c 'until curl -sf http://localhost:5199/api/databases >/dev/null; do sleep 1; done'
# 3. Screenshots
node .superpowers/shoot-ui.mjs .superpowers/shots/<task-name>
```

Then **open the PNGs and look at them** (Read tool). A step's visual check lists what must be visible. Stop servers at the very end only (Task 12).

---

### Task 1: `Issue.kind` — incomplete vs invalid

**Files:**
- Modify: `src/query/types.ts:23-27`
- Modify: `src/query/validate.ts`
- Test: `tests/query/validate.test.ts`, `tests/state.test.ts`

**Interfaces:**
- Produces: `Issue.kind: "incomplete" | "invalid"`. Incomplete messages: "Choose a field.", "Choose an operator.", "Enter a value.", "Enter both values.", "Choose at least one value.", "Add a condition to this group.". Invalid messages: "Unknown field.", "Unknown operator.", "That operator isn't available for this field.". `severity` stays `"error"` for all of them.

- [ ] **Step 1: Update the tests first**

In `tests/query/validate.test.ts`, add `kind` to every expected issue object:
- `kind: "incomplete"` for the tests expecting "Choose a field.", "Choose an operator.", "Enter a value.", "Enter both values.", "Choose at least one value.", "Add a condition to this group.".
- `kind: "invalid"` for "Unknown field." and "That operator isn't available for this field.".

Example (the first one):

```ts
    expect(issues).toContainEqual({
      nodeId: c.id,
      message: "Choose a field.",
      severity: "error",
      kind: "incomplete",
    });
```

Replace the `hasBlockingErrors` test with:

```ts
  it("hasBlockingErrors is true only when an error-severity issue is present", () => {
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "warning", kind: "incomplete" }]),
    ).toBe(false);
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error", kind: "invalid" }]),
    ).toBe(true);
  });

  it("incomplete issues block running just like invalid ones", () => {
    expect(
      hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error", kind: "incomplete" }]),
    ).toBe(true);
  });
```

In `tests/state.test.ts`, add `kind: "invalid"` to the two inline issue objects (the "blocking issue" and "only a warning" tests), e.g.:

```ts
    expect(
      canRunQuery(
        state({ issues: [{ nodeId: "x", message: "m", severity: "error", kind: "invalid" }] }),
      ),
    ).toBe(false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/query/validate.test.ts`
Expected: FAIL — the `toContainEqual` assertions report the missing `kind` property.

- [ ] **Step 3: Implement**

`src/query/types.ts` — replace the `Issue` interface:

```ts
export interface Issue {
  nodeId: string;
  message: string;
  severity: "error" | "warning";
  /**
   * "incomplete": something the user simply hasn't filled in yet — shown as a
   * quiet hint. "invalid": the query refers to something that cannot work —
   * shown in red. Both block running when severity is "error".
   */
  kind: "incomplete" | "invalid";
}
```

`src/query/validate.ts` — add two helpers under `isEmptyScalar` and use them for every `out.push(...)`:

```ts
function incomplete(nodeId: string, message: string): Issue {
  return { nodeId, message, severity: "error", kind: "incomplete" };
}

function invalid(nodeId: string, message: string): Issue {
  return { nodeId, message, severity: "error", kind: "invalid" };
}
```

Change the import to `import type { Condition, Issue, QueryNode } from "./types";` (already imports `Issue`). The pushes become:

```ts
  if (!c.fieldId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  const fieldDef = schema.fields.find((f) => f.label === c.fieldId);
  if (!fieldDef) {
    out.push(invalid(c.id, "Unknown field."));
    return;
  }
  if (!c.operatorId) {
    out.push(incomplete(c.id, "Choose an operator."));
    return;
  }
  const op = schema.operators.find((o) => o.label === c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!fieldDef.operatorIds.includes(c.operatorId)) {
    out.push(invalid(c.id, "That operator isn't available for this field."));
    return;
  }
  if (op.arity === "one" && isEmptyScalar(c.value)) {
    out.push(incomplete(c.id, "Enter a value."));
  }
  if (op.arity === "two") {
    const v = c.value;
    if (!Array.isArray(v) || v.length !== 2 || v.some(isEmptyScalar)) {
      out.push(incomplete(c.id, "Enter both values."));
    }
  }
  if (op.arity === "many") {
    const v = c.value;
    if (!Array.isArray(v) || v.length === 0) {
      out.push(incomplete(c.id, "Choose at least one value."));
    }
  }
```

and in `walk`:

```ts
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a condition to this group."));
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/query/types.ts src/query/validate.ts tests/query/validate.test.ts tests/state.test.ts
git add src/query/types.ts src/query/validate.ts tests/query/validate.test.ts tests/state.test.ts
git commit -m "feat(validate): tag issues as incomplete or invalid

Both kinds still block running; the kind only decides how the UI shows
them (quiet hint vs red label).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: New groups start with one empty condition

**Files:**
- Modify: `src/query/tree.ts:29-31`
- Test: `tests/query/tree.test.ts`, `tests/query/validate.test.ts`, `tests/query/summary.test.ts`

**Interfaces:**
- Produces: `newGroup(): Group` → `{ kind: "group", id, operator: "AND", children: [newCondition()] }`. A test that needs an empty group builds `{ ...newGroup(), children: [] }`.

- [ ] **Step 1: Write the failing test and fix the tests that assumed an empty group**

`tests/query/tree.test.ts` — add after the "newCondition starts with…" test:

```ts
  it("newGroup starts as an AND group holding one empty condition", () => {
    const g = newGroup();
    expect(g).toMatchObject({ kind: "group", operator: "AND" });
    expect(g.children).toHaveLength(1);
    expect(g.children[0]).toMatchObject({
      kind: "condition",
      individualId: null,
      fieldId: null,
      operatorId: null,
      value: null,
    });
  });
```

In the same file, "addChild can target a nested group" — the added condition is now the group's second child:

```ts
    const found = findNode(next, g.id) as import("../../src/query/types").Group;
    expect(found.children).toHaveLength(2);
    expect(found.children[1]).toBe(c);
```

and "countConditions counts leaves at any depth":

```ts
    // 1 at the root + g's own starter condition + 2 added to g
    expect(countConditions(t)).toBe(4);
```

`tests/query/validate.test.ts`, "a non-root empty group is an error" — build the empty group explicitly:

```ts
    const g = { ...newGroup(), children: [] };
```

`tests/query/summary.test.ts`, "enum value uses the option label; nested group gets parens" — same:

```ts
    const g = { ...newGroup(), children: [] };
```

(`tests/util/pendingQuery.test.ts` needs no change: it only round-trips whatever tree it builds.)

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run tests/query/tree.test.ts`
Expected: FAIL on "newGroup starts as an AND group holding one empty condition" (children length 0), plus the two adjusted expectations.

- [ ] **Step 3: Implement**

`src/query/tree.ts`:

```ts
/** A new AND group, pre-populated with one empty condition so it is usable
 *  straight away (the "+ Group" button). A group can still become empty when
 *  its last condition is removed — validate.ts reports that case. */
export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [newCondition()] };
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/query/tree.ts tests/query/tree.test.ts tests/query/validate.test.ts tests/query/summary.test.ts
git add src/query/tree.ts tests/query
git commit -m "feat(tree): new groups start with one empty condition

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Formatting helpers — labels, counts, dates

**Files:**
- Modify: `src/ui/format.ts`
- Test: `tests/ui/format.test.ts`

**Interfaces:**
- Produces:
  - `displayLabel(s: string): string` — underscores → spaces, casing untouched.
  - `countLabel(n: number, singular: string, plural?: string, locale?: string): string` — `"1 entryset"`, `"9 entrysets"`, `"12,345 entrysets"`; `plural` defaults to `singular + "s"`.
  - `formatWhen(iso: string | undefined, locale?: string, timeZone?: string): string` — `"7 Nov 2024, 08:15"` (en-GB, UTC); `"—"` for missing/empty; the raw string if unparseable.

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `tests/ui/format.test.ts` to:

```ts
import {
  barWidth,
  compact,
  countLabel,
  displayLabel,
  exact,
  formatWhen,
  matchRatio,
} from "../../src/ui/format";
```

Append:

```ts
describe("displayLabel", () => {
  it("shows underscores as spaces and keeps the backend's casing", () => {
    expect(displayLabel("battery_ev")).toBe("battery ev");
    expect(displayLabel("HVAC_Cabin")).toBe("HVAC Cabin");
    expect(displayLabel("brakes")).toBe("brakes");
  });
});

describe("countLabel", () => {
  it("singular for exactly one, plural otherwise, with digit grouping", () => {
    expect(countLabel(1, "entryset", undefined, L)).toBe("1 entryset");
    expect(countLabel(0, "entryset", undefined, L)).toBe("0 entrysets");
    expect(countLabel(9, "entryset", undefined, L)).toBe("9 entrysets");
    expect(countLabel(12345, "entryset", undefined, L)).toBe("12,345 entrysets");
    expect(countLabel(2, "match", "matches", L)).toBe("2 matches");
  });
});

describe("formatWhen", () => {
  it("medium date + short time, on one line", () => {
    expect(formatWhen("2024-11-07T08:15:00Z", "en-GB", "UTC")).toBe("7 Nov 2024, 08:15");
  });
  it("an em dash when missing, the raw string when unparseable", () => {
    expect(formatWhen(undefined)).toBe("—");
    expect(formatWhen("")).toBe("—");
    expect(formatWhen("not a date")).toBe("not a date");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/format.test.ts`
Expected: FAIL — `displayLabel is not a function` (etc.).

- [ ] **Step 3: Implement**

Replace the header comment of `src/ui/format.ts` with:

```ts
/**
 * Display formatting shared by the panels: numbers and proportions for the
 * statistics (a real backend can return counts from a handful to billions and
 * percentages down to ~1e-10), plus labels, counts and timestamps.
 *
 * `locale` is optional and defaults to the viewer's locale; tests pass an
 * explicit locale so assertions are deterministic.
 */
```

Append to the file:

```ts
/** A backend identifier shown as text (a group name, a tag): the backend's own
 *  casing, with underscores shown as spaces. "battery_ev" → "battery ev". */
export function displayLabel(s: string): string {
  return s.replace(/_/g, " ");
}

/** "1 entryset" / "9 entrysets" / "12,345 entrysets". */
export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}s`,
  locale?: string,
): string {
  return `${n.toLocaleString(locale)} ${n === 1 ? singular : plural}`;
}

/** A timestamp short enough to stay on one line: "7 Nov 2024, 08:15" (en-GB).
 *  Missing → "—"; unparseable → returned unchanged. */
export function formatWhen(iso: string | undefined, locale?: string, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/format.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/format.ts tests/ui/format.test.ts
git add src/ui/format.ts tests/ui/format.test.ts
git commit -m "feat(format): displayLabel, countLabel and formatWhen helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs filter matching

**Files:**
- Create: `src/ui/docsFilter.ts`
- Test: `tests/ui/docsFilter.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DocsMatch {
  items: Set<string>;          // Individual.label of every matching item
  groups: Map<string, number>; // Individual.group -> matching items in it (absent = 0)
}
export function matchDocs(individuals: Individual[], text: string): DocsMatch | null; // null = blank filter
```

A match is a case-insensitive substring of the item's `name`, or of any field's `label` or `name`.

- [ ] **Step 1: Write the failing test**

`tests/ui/docsFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Individual } from "../../src/api/types";
import { matchDocs } from "../../src/ui/docsFilter";

function ind(label: string, group: string, name: string, fields: string[]): Individual {
  return {
    label,
    group,
    name,
    tags: [],
    idNumber: 0,
    description: "",
    comment: "",
    totalCount: 0,
    fields: fields.map((f) => ({
      label: f,
      type: "DOUBLE",
      description: "",
      comment: "",
      cardinality: 0,
      values: [],
      format: "",
    })),
  };
}

const items = [
  ind("tire_pressure_front_left", "tires_wheels", "Tire pressure (front left)", [
    "pressure_psi",
    "tread_depth_mm",
  ]),
  ind("engine_oil_pressure", "engine", "Engine oil pressure", ["value_kpa"]),
  ind("engine_rpm", "engine", "Engine RPM", ["value_rpm", "redline_rpm"]),
  ind("brake_pressure", "brakes", "Brake pressure", ["value_kpa", "pedal_position_percentage"]),
];

describe("matchDocs", () => {
  it("returns null for a blank filter", () => {
    expect(matchDocs(items, "")).toBeNull();
    expect(matchDocs(items, "   ")).toBeNull();
  });

  it("matches item names case-insensitively and counts matches per group", () => {
    const m = matchDocs(items, "PRESSURE")!;
    expect([...m.items].sort()).toEqual([
      "brake_pressure",
      "engine_oil_pressure",
      "tire_pressure_front_left",
    ]);
    expect(m.groups).toEqual(
      new Map([
        ["tires_wheels", 1],
        ["engine", 1],
        ["brakes", 1],
      ]),
    );
  });

  it("matches field labels", () => {
    const m = matchDocs(items, "redline")!;
    expect([...m.items]).toEqual(["engine_rpm"]);
    expect(m.groups).toEqual(new Map([["engine", 1]]));
  });

  it("matches a field's display name when the backend supplies one", () => {
    const base = items[1]!;
    const named = { ...base, fields: [{ ...base.fields[0]!, name: "Oil pressure (kPa)" }] };
    expect([...matchDocs([named], "(kpa)")!.items]).toEqual(["engine_oil_pressure"]);
  });

  it("counts several matches in the same group", () => {
    const m = matchDocs(items, "engine")!;
    expect(m.groups.get("engine")).toBe(2);
  });

  it("returns empty sets when nothing matches", () => {
    const m = matchDocs(items, "zzz")!;
    expect(m.items.size).toBe(0);
    expect(m.groups.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/ui/docsFilter.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/docsFilter`.

- [ ] **Step 3: Implement**

`src/ui/docsFilter.ts`:

```ts
import type { Individual } from "../api/types";

/** What the data-dictionary filter matched. */
export interface DocsMatch {
  /** `Individual.label` of every matching item. */
  items: Set<string>;
  /** `Individual.group` → how many of its items match (groups with none are absent). */
  groups: Map<string, number>;
}

/**
 * Which data-dictionary entries match the filter text: a case-insensitive
 * substring of the item's name, or of any of its fields' label or name.
 * Returns null for a blank filter (nothing is being filtered).
 */
export function matchDocs(individuals: Individual[], text: string): DocsMatch | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const has = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);
  const items = new Set<string>();
  const groups = new Map<string, number>();
  for (const ind of individuals) {
    const hit = has(ind.name) || ind.fields.some((f) => has(f.label) || has(f.name));
    if (!hit) continue;
    items.add(ind.label);
    groups.set(ind.group, (groups.get(ind.group) ?? 0) + 1);
  }
  return { items, groups };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/docsFilter.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/docsFilter.ts tests/ui/docsFilter.test.ts
git add src/ui/docsFilter.ts tests/ui/docsFilter.test.ts
git commit -m "feat(docs): pure matchDocs() for the data-dictionary filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Theme tokens, new shell, docs rail, workflow steps

**Files:**
- Modify: `src/state.ts:57` (and its test `tests/state.test.ts`)
- Rewrite: `src/ui/layout.ts`
- Modify: `src/styles.css` (top part only)
- Create: `.superpowers/shoot-ui.mjs` (git-ignored — not committed)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 6–11):
  - Shell markup: `header.qb-topbar` containing `.qb-topbar-right`; `.qb-body` with `button.qb-docs-rail[data-menu="toggle-sidebar"]`, `aside.qb-col-docs[data-panel="docs"]`, `main.qb-col-main` holding `[data-panel="dbpicker"]`, `[data-panel="center"]`, `[data-panel="preview"]`, and `aside.qb-col-stats[data-panel="stats"]`.
  - `panelEls()` keys unchanged in this task: `docs, dbpicker, center, stats, preview, auth, compliance`.
  - Any element with `data-menu="toggle-sidebar"` (anywhere, now or repainted later) toggles the docs column — delegated listener.
  - Shared CSS classes: `.qb-card`, `.qb-card-title`, `.qb-card-count`, `.qb-placeholder`, `.qb-muted`, `.qb-spacer`, `.qb-tag`, `.qb-count`, `.qb-icon-btn`; tokens `--qb-*` (see CSS below).

- [ ] **Step 1: Failing test for the collapsed-by-default docs**

In `tests/state.test.ts`, test "initialState has an empty AND-group query and idle panels", add:

```ts
    expect(initialState.sidebarCollapsed).toBe(true);
```

Run: `npx vitest run tests/state.test.ts` → Expected: FAIL (`false`).

- [ ] **Step 2: Make it pass**

`src/state.ts`, in `initialState`:

```ts
  // The docs start folded into their rail so the query builder gets the width.
  sidebarCollapsed: true,
```

Run: `npx vitest run tests/state.test.ts` → Expected: PASS.

- [ ] **Step 3: Rewrite `src/ui/layout.ts`**

```ts
import type { ActiveView } from "../state";

const VIEWS: { id: ActiveView; label: string }[] = [
  { id: "filter", label: "Filter" },
  { id: "review", label: "Review" },
  { id: "approval", label: "Approval" },
  { id: "done", label: "Done" },
];

let els: {
  docs: HTMLElement;
  dbpicker: HTMLElement;
  center: HTMLElement;
  stats: HTMLElement;
  preview: HTMLElement;
  auth: HTMLElement;
  compliance: HTMLElement;
};
let bodyEl: HTMLElement;
let railEl: HTMLButtonElement;

/**
 * The page frame, rendered once: a top bar (app name, workflow steps, account
 * area), then a docs rail + three columns — the data dictionary (collapsible,
 * starts collapsed), the main column (databases, query, matching entrysets)
 * and the pinned statistics column. Panels paint into the data-panel slots.
 */
export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="qb-topbar">
      <span class="qb-brand">Query Builder</span>
      <nav class="qb-steps" data-menu="views" aria-label="Workflow">
        ${VIEWS.map(
          (v, i) =>
            `<a class="qb-step${v.id === "filter" ? " is-active" : ""}" href="#" data-view="${v.id}"${v.id === "filter" ? ' aria-current="step"' : ""}><span class="qb-step-num">${i + 1}</span>${v.label}</a>`,
        ).join("")}
      </nav>
      <div class="qb-topbar-right">
        <button class="ui primary button" data-menu="run" disabled>Run / Refresh</button>
        <div data-panel="auth"></div>
        <div data-panel="compliance"></div>
      </div>
    </header>
    <div class="qb-body qb-docs-collapsed">
      <button type="button" class="qb-docs-rail" data-menu="toggle-sidebar" aria-controls="qb-docs" aria-expanded="false" title="Show the data dictionary">
        <i class="book icon"></i><span>Docs</span>
      </button>
      <aside class="qb-col-docs" id="qb-docs" data-panel="docs"></aside>
      <main class="qb-col-main">
        <section data-panel="dbpicker"></section>
        <section data-panel="center"></section>
        <section data-panel="preview"></section>
      </main>
      <aside class="qb-col-stats" data-panel="stats"></aside>
    </div>
  `;
  bodyEl = root.querySelector<HTMLElement>(".qb-body")!;
  railEl = root.querySelector<HTMLButtonElement>(".qb-docs-rail")!;
  els = {
    docs: root.querySelector<HTMLElement>('[data-panel="docs"]')!,
    dbpicker: root.querySelector<HTMLElement>('[data-panel="dbpicker"]')!,
    center: root.querySelector<HTMLElement>('[data-panel="center"]')!,
    stats: root.querySelector<HTMLElement>('[data-panel="stats"]')!,
    preview: root.querySelector<HTMLElement>('[data-panel="preview"]')!,
    auth: root.querySelector<HTMLElement>('[data-panel="auth"]')!,
    compliance: root.querySelector<HTMLElement>('[data-panel="compliance"]')!,
  };
}

export function panelEls() {
  return els;
}

export function setActiveView(v: ActiveView): void {
  document.querySelectorAll<HTMLElement>('[data-menu="views"] [data-view]').forEach((a) => {
    const on = a.dataset.view === v;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "step");
    else a.removeAttribute("aria-current");
  });
  const filtering = v === "filter";
  bodyEl.hidden = !filtering;
  let placeholder = document.getElementById("qb-coming-soon");
  if (!filtering && !placeholder) {
    placeholder = document.createElement("div");
    placeholder.id = "qb-coming-soon";
    placeholder.className = "qb-card qb-coming-soon";
    placeholder.innerHTML = `<i class="clock outline icon"></i> Coming soon`;
    bodyEl.after(placeholder);
  }
  if (placeholder) placeholder.hidden = filtering;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  bodyEl.classList.toggle("qb-docs-collapsed", collapsed);
  railEl.setAttribute("aria-expanded", String(!collapsed));
  railEl.title = collapsed ? "Show the data dictionary" : "Hide the data dictionary";
}

/**
 * The step links carry `href="#"` only so they are keyboard-focusable (an `<a>`
 * without `href` is skipped by Tab and ignores Enter) — every handler below
 * calls preventDefault so the URL hash never changes.
 */
export function onMenu(handler: {
  view(v: ActiveView): void;
  toggleSidebar(): void;
  run(): void;
}): void {
  document.querySelector('[data-menu="views"]')!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!item) return;
    e.preventDefault();
    handler.view(item.dataset.view as ActiveView);
  });
  // Delegated: the rail AND the docs panel's own close button toggle the docs,
  // and the close button is repainted with its panel, so it can't be bound once.
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest('[data-menu="toggle-sidebar"]')) return;
    e.preventDefault();
    handler.toggleSidebar();
  });
  document.querySelector('[data-menu="run"]')!.addEventListener("click", () => handler.run());
}
```

- [ ] **Step 4: Replace the top of `src/styles.css`**

Replace everything from the start of the file **up to (not including)** the line `/* Database scope selector (src/ui/databasePicker.ts) */` with:

```css
/*
 * Theme layer on top of Fomantic UI (docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md).
 * Fomantic handles typography (it self-hosts Lato) and its widgets; this file
 * owns layout and colour. Colours and sizes live in the tokens below — change
 * them here, not in individual rules.
 */
:root {
  --qb-bg: #f3f5f8;
  --qb-surface: #ffffff;
  --qb-surface-2: #f7f9fb;
  --qb-border: #dde2e8;
  --qb-border-strong: #c8d0d9;
  --qb-text: #1f2933;
  --qb-muted: #5f6b7a;
  --qb-subtle: #8792a0;

  --qb-topbar: #1b2a3a;
  --qb-topbar-2: #2d4257;
  --qb-topbar-text: #dbe6f0;

  /* ALL / AND */
  --qb-and: #2185d0;
  --qb-and-soft: #9cc5e8;
  --qb-and-tint: rgba(33, 133, 208, 0.05);
  --qb-and-tint-strong: rgba(33, 133, 208, 0.11);
  /* ANY / OR */
  --qb-or: #e08a00;
  --qb-or-text: #a86400;
  --qb-or-soft: #f0c47a;
  --qb-or-tint: rgba(224, 138, 0, 0.07);
  --qb-or-tint-strong: rgba(224, 138, 0, 0.14);

  --qb-danger: #c0392b;
  --qb-warn: #a86400;

  --qb-radius: 6px;
  --qb-gap: 1rem;
  --qb-topbar-h: 48px;
  --qb-rail-w: 28px;
  --qb-docs-w: 20rem;
  --qb-stats-w: 15rem;
}

html,
body {
  height: 100%;
}
body {
  margin: 0;
  background: var(--qb-bg);
  color: var(--qb-text);
}
#app {
  min-height: 100%;
}
/* Fomantic sets display on many classes; `hidden` must always win. */
[hidden] {
  display: none !important;
}

/* ---- Top bar (src/ui/layout.ts) ---- */
.qb-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  height: var(--qb-topbar-h);
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0 1rem;
  background: var(--qb-topbar);
  color: #fff;
}
.qb-brand {
  font-weight: 700;
  font-size: 1.05rem;
  white-space: nowrap;
}
.qb-steps {
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
}
.qb-step {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  color: #9fb0c2;
  white-space: nowrap;
}
.qb-step:hover,
.qb-step:focus-visible {
  color: #fff;
}
.qb-step.is-active {
  background: var(--qb-topbar-2);
  color: #fff;
}
.qb-step-num {
  display: inline-grid;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 50%;
  border: 1px solid currentColor;
  font-size: 0.75rem;
}
.qb-topbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

/* ---- Body: docs rail | docs | main | stats ---- */
.qb-body {
  display: flex;
  align-items: flex-start;
  gap: var(--qb-gap);
  padding: 0 var(--qb-gap) var(--qb-gap) 0;
}
.qb-docs-rail {
  position: sticky;
  top: var(--qb-topbar-h);
  flex: 0 0 var(--qb-rail-w);
  height: calc(100vh - var(--qb-topbar-h));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0 0;
  border: none;
  border-right: 1px solid var(--qb-border);
  background: var(--qb-surface);
  color: var(--qb-and);
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}
.qb-docs-rail span {
  writing-mode: vertical-rl;
}
.qb-docs-rail .icon {
  margin: 0;
}
.qb-docs-rail:hover {
  background: var(--qb-surface-2);
}
.qb-docs-rail:focus-visible {
  outline: 2px solid var(--qb-and);
  outline-offset: -2px;
}
.qb-col-docs,
.qb-col-main,
.qb-col-stats {
  margin-top: var(--qb-gap);
}
.qb-col-docs {
  flex: 0 0 var(--qb-docs-w);
  position: sticky;
  top: calc(var(--qb-topbar-h) + var(--qb-gap));
  max-height: calc(100vh - var(--qb-topbar-h) - 2 * var(--qb-gap));
  overflow-y: auto;
}
.qb-body.qb-docs-collapsed .qb-col-docs {
  display: none;
}
.qb-col-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--qb-gap);
}
.qb-col-stats {
  flex: 0 0 var(--qb-stats-w);
  /* Always visible while a tall query scrolls past (users read the stats as
     they build); scrolls internally if the stats are taller than the screen. */
  position: sticky;
  top: calc(var(--qb-topbar-h) + var(--qb-gap));
  max-height: calc(100vh - var(--qb-topbar-h) - 2 * var(--qb-gap));
  overflow-y: auto;
  overflow-wrap: anywhere;
}
.qb-coming-soon {
  margin: 2rem;
  padding: 3rem;
  text-align: center;
  font-size: 1.2rem;
  color: var(--qb-muted);
}
/* Below the supported range (1024 px+) the stats drop under the main column. */
@media (max-width: 900px) {
  .qb-body {
    flex-wrap: wrap;
  }
  .qb-col-main {
    flex-basis: calc(100% - var(--qb-rail-w) - var(--qb-gap));
  }
  .qb-col-stats {
    position: static;
    flex: 1 1 100%;
    max-height: none;
    margin-left: calc(var(--qb-rail-w) + var(--qb-gap));
  }
}

/* ---- Shared building blocks ---- */
.qb-card {
  background: var(--qb-surface);
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
  padding: 0.75rem 1rem;
}
.qb-card-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.4;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--qb-muted);
}
.qb-card-count {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}
.qb-placeholder {
  margin: 0;
  padding: 0.75rem;
  text-align: center;
  color: var(--qb-muted);
  background: var(--qb-surface-2);
  border: 1px dashed var(--qb-border-strong);
  border-radius: var(--qb-radius);
}
.qb-muted {
  color: var(--qb-muted);
}
.qb-spacer {
  flex: 1 1 auto;
}
.qb-tag {
  display: inline-block;
  padding: 0 0.45rem;
  border-radius: 3px;
  background: #eef1f4;
  color: var(--qb-muted);
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: nowrap;
}
.qb-count {
  display: inline-block;
  padding: 0 0.5rem;
  border: 1px solid var(--qb-border);
  border-radius: 999px;
  background: var(--qb-surface);
  color: var(--qb-muted);
  font-size: 0.75rem;
  font-weight: 400;
  white-space: nowrap;
}
.qb-icon-btn {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--qb-subtle);
  cursor: pointer;
}
.qb-icon-btn .icon {
  margin: 0;
}
.qb-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--qb-text);
}
.qb-icon-btn:focus-visible {
  outline: 2px solid var(--qb-and);
}

```

(The old `.qb-body`, `.qb-col-*`, `.qb-preview` and `.qb-col-docs .ui.accordion` rules are gone with that block; the panel sections below it stay until their tasks replace them.)

- [ ] **Step 5: Create the screenshot driver `.superpowers/shoot-ui.mjs`**

```js
// Visual-check driver for the UI/UX refresh. Not part of the app — .superpowers/ is git-ignored.
// Usage: node .superpowers/shoot-ui.mjs <outDir> [baseUrl]
// Needs the mock API on :3001 and `npx vite --port 5199 --strictPort` running.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/home/annek/.npm/_npx/e41f203b7505f1fb/node_modules/");
const { chromium } = require("playwright");

const out = process.argv[2] ?? ".superpowers/shots";
const base = process.argv[3] ?? "http://localhost:5199";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  // 401/403 on POST /api/query are expected: they trigger the login/compliance redirects.
  if (m.type() === "error" && !/\b40[13]\b/.test(m.text())) errors.push(m.text());
});

const shot = async (name, fullPage = true) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  console.log("shot", name);
};

/** Choose `text` in the Fomantic dropdown wrapping select[data-part=part] in condition row n. */
async function pick(n, part, text) {
  const dd = page
    .locator(".qb-condition")
    .nth(n)
    .locator(`.ui.dropdown:has(select[data-part="${part}"])`)
    .first();
  await dd.click();
  const search = dd.locator("input.search");
  if (await search.count()) await search.fill(text);
  await dd.locator(".menu .item", { hasText: text }).first().click();
  await page.waitForTimeout(300);
}

async function typeValue(n, value) {
  const input = page.locator(".qb-condition").nth(n).locator('input[data-part="value"]').first();
  await input.fill(value);
  await input.press("Tab");
  await page.waitForTimeout(300);
}

async function openAccountMenu() {
  const chip = page.locator("details.qb-account:not([open]) > summary");
  if (await chip.count()) await chip.click();
}

await page.goto(base);
await page.waitForSelector(".qb-condition");
await shot("01-fresh");

await pick(0, "individual", "Engine RPM");
await pick(0, "field", "value_rpm");
await pick(0, "operator", "Greater than");
await typeValue(0, "3000");
await page.waitForTimeout(1200);
await shot("02-one-condition");

await page.locator('[data-action="add-group"]').first().click();
await page.waitForTimeout(400);
await shot("03-new-group");

await pick(1, "individual", "Brake temperature");
await pick(1, "field", "value_celsius");
await pick(1, "operator", "Greater than");
await typeValue(1, "400");
await page.locator('.qb-group .qb-group [data-action="set-or"]').first().click();
await page.waitForTimeout(300);
await page.locator('.qb-group .qb-group [data-action="add-group"]').first().click();
await page.waitForTimeout(300);
await pick(2, "individual", "Brake fluid level");
await pick(2, "field", "is_low");
await pick(2, "operator", "Equals");
await page.waitForTimeout(1500);
await shot("04-nested");

await page.locator(".qb-group .qb-group .qb-group .qb-group-head").first().hover();
await shot("05-hover-innermost", false);

// Log in through the mock IdP; ?resume=1 restores the query afterwards.
await page.locator('a:has-text("Log in")').first().click();
await page.locator('a:has-text("Log in as")').click();
await page.waitForSelector(".qb-condition");
await page.waitForTimeout(1200);
await openAccountMenu();
await shot("06-logged-in-menu", false);

// Compliance through the mock service.
const start = page.locator('a:has-text("Start compliance check")').first();
if (!(await start.isVisible())) await openAccountMenu();
await start.click();
await page.locator('input[name="reason"]').fill("Investigating over-rev events for fleet maintenance");
await page.locator('button[type="submit"], input[type="submit"], button').first().click();
await page.waitForSelector(".qb-condition");
await page.waitForTimeout(1500);
await openAccountMenu();
await shot("07-compliance-menu", false);
await page.keyboard.press("Escape");

await page.locator('[data-action="run"], [data-menu="run"]').first().click();
await page.waitForSelector(".qb-entryset-row, .qb-placeholder, .negative.message", {
  timeout: 15000,
});
await shot("08-results");
const row = page.locator(".qb-entryset-row summary").first();
if (await row.count()) {
  await row.click();
  await shot("09-row-expanded", false);
}

for (const w of [1280, 1024]) {
  await page.setViewportSize({ width: w, height: 900 });
  await shot(`10-width-${w}`);
}
await page.setViewportSize({ width: 1440, height: 900 });

await page.locator('[data-menu="toggle-sidebar"]').first().click();
await page.waitForTimeout(300);
const filter = page.locator("#qb-docs-filter");
if (await filter.count()) await filter.fill("pressure");
await shot("11-docs-filter", false);

console.log("page errors:", JSON.stringify(errors, null, 1));
await browser.close();
```

- [ ] **Step 6: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all pass.

Start the servers (see "Running the app for visual checks") and run `node .superpowers/shoot-ui.mjs .superpowers/shots/task5`. The old panels still render inside the new frame; later tasks restyle them. Check:
- `01-fresh.png`: dark top bar with "Query Builder", four numbered steps (Filter highlighted), Run/Refresh + Log in on the right; a slim "DOCS" rail at the left edge; databases + query + data preview stacked in the middle; statistics on the right. No data-dictionary column visible.
- `11-docs-filter.png`: the docs column is open between the rail and the main column.
- `page errors: []` printed at the end.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/state.ts src/ui/layout.ts src/styles.css tests/state.test.ts
git add src/state.ts src/ui/layout.ts src/styles.css tests/state.test.ts
git commit -m "feat(ui): new page frame — dark top bar with workflow steps, docs rail, pinned stats column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Account menu (login + compliance in one place)

**Files:**
- Create: `src/ui/accountMenu.ts`
- Delete: `src/ui/authStatus.ts`, `src/ui/complianceStatus.ts`
- Modify: `src/ui/layout.ts`, `src/main.ts`, `src/styles.css`
- Modify: `docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md` (record one deviation)

**Interfaces:**
- Consumes: `formatWhen` (Task 3); `LOGIN_URL`, `COMPLIANCE_START_URL` from `src/api/client.ts`.
- Produces: `renderAccountMenu(state: AppState): void`, `wireAccountMenu(container: HTMLElement, handlers: { onLogout(): void; onInvalidate(): void }): void`. `panelEls().account` replaces `panelEls().auth` and `panelEls().compliance`.

**Deviation from spec §3 (record it in the spec, Step 5):** the menu is a native `<details>` element, not a Fomantic dropdown. Fomantic's dropdown treats a clicked item as a *selection* and rewrites the trigger's text; this menu holds actions. `<details>` needs no jQuery and is keyboard-accessible.

- [ ] **Step 1: Create `src/ui/accountMenu.ts`**

```ts
import type { AppState } from "../state";
import { COMPLIANCE_START_URL, LOGIN_URL } from "../api/client";
import { formatWhen } from "./format";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/**
 * The top-bar account menu: login state and the compliance acknowledgment in
 * one place. Display-only, like the two widgets it replaced — Run is never
 * gated on it; main.ts reacts to POST /api/query's real 401/403 instead.
 *
 * A native <details> dropdown rather than a Fomantic one: Fomantic's dropdown
 * treats a clicked item as a selection and rewrites the trigger's text, and
 * this menu holds actions, not choices. It needs no jQuery.
 */
function badgeHtml(state: AppState): string {
  if (state.compliance.status === "acknowledged") {
    return `<span class="qb-badge qb-badge-ok"><i class="check icon"></i>Compliance</span>`;
  }
  if (state.compliance.status === "required") {
    return `<span class="qb-badge qb-badge-warn">Compliance needed</span>`;
  }
  return "";
}

function complianceHtml(state: AppState): string {
  const c = state.compliance;
  if (c.status === "loading") return `<p class="qb-account-meta">Checking…</p>`;
  if (c.status === "required") {
    return `<p class="qb-account-meta">Running a query needs a compliance reason for this session.</p>
      <a class="ui fluid small primary button" href="${escapeHtml(COMPLIANCE_START_URL)}" data-flow-link>Start compliance check</a>`;
  }
  return `<p class="qb-account-reason">“${escapeHtml(c.reason ?? "")}”</p>
    ${c.ackedAt ? `<p class="qb-account-meta">Given ${escapeHtml(formatWhen(c.ackedAt))}</p>` : ""}
    <button type="button" class="ui fluid small basic button" data-action="invalidate-compliance">Invalidate</button>`;
}

export function renderAccountMenu(state: AppState): void {
  const el = panelEls().account;
  if (state.auth.status === "loading") {
    paint(el, "");
    return;
  }
  if (state.auth.status === "anonymous") {
    paint(
      el,
      `<a href="${escapeHtml(LOGIN_URL)}" data-flow-link class="ui small primary button">Log in</a>`,
    );
    return;
  }
  paint(
    el,
    `<details class="qb-account">
       <summary class="qb-account-chip" aria-label="Account menu">
         <i class="user circle icon"></i>
         <span class="qb-account-name">${escapeHtml(state.auth.user!.name)}</span>
         ${badgeHtml(state)}
         <i class="dropdown icon"></i>
       </summary>
       <div class="qb-account-menu">
         <div class="qb-account-section">
           <div class="qb-account-label">Compliance</div>
           ${complianceHtml(state)}
         </div>
         <div class="qb-account-section">
           <button type="button" class="ui fluid small basic button" data-action="logout">Log out</button>
         </div>
       </div>
     </details>`,
  );
}

export function wireAccountMenu(
  container: HTMLElement,
  handlers: { onLogout(): void; onInvalidate(): void },
): void {
  if (container.dataset.accountWired === "1") return;
  container.dataset.accountWired = "1";
  container.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-action='logout']")) handlers.onLogout();
    else if (t.closest("[data-action='invalidate-compliance']")) handlers.onInvalidate();
  });
  // A <details> menu doesn't close itself on an outside click or on Escape.
  const close = () =>
    container.querySelector<HTMLDetailsElement>("details.qb-account[open]")?.removeAttribute("open");
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
```

- [ ] **Step 2: Swap the slots in `src/ui/layout.ts`**

In the `els` type, replace `auth: HTMLElement;` and `compliance: HTMLElement;` with `account: HTMLElement;`.

In the markup, replace

```html
        <div data-panel="auth"></div>
        <div data-panel="compliance"></div>
```

with

```html
        <div data-panel="account"></div>
```

In the `els = {...}` assignment, replace the `auth:` and `compliance:` lines with:

```ts
    account: root.querySelector<HTMLElement>('[data-panel="account"]')!,
```

- [ ] **Step 3: Wire it in `src/main.ts`**

Replace the two imports

```ts
import { renderAuthStatus, wireAuthStatus } from "./ui/authStatus";
import { renderComplianceStatus, wireComplianceStatus } from "./ui/complianceStatus";
```

with

```ts
import { renderAccountMenu, wireAccountMenu } from "./ui/accountMenu";
```

In `panelRenderers`, replace the `keys: ["auth"]` entry and the `keys: ["compliance", "auth"]` entry with one entry:

```ts
  {
    keys: ["auth", "compliance"],
    run: (s) => {
      renderAccountMenu(s);
      wireAccountMenu(panelEls().account, {
        onLogout,
        onInvalidate: onInvalidateCompliance,
      });
    },
  },
```

In the initial-render block, replace

```ts
renderAuthStatus(store.getState()); // "" while auth.status is "loading"
renderComplianceStatus(store.getState()); // "" while compliance.status is "loading"
```

with

```ts
renderAccountMenu(store.getState()); // "" while auth.status is "loading"
```

Delete the two old files:

```bash
git rm src/ui/authStatus.ts src/ui/complianceStatus.ts
```

- [ ] **Step 4: Styles — append to `src/styles.css`, after the shared building blocks section**

```css
/* ---- Account menu (src/ui/accountMenu.ts) ---- */
.qb-account {
  position: relative;
}
.qb-account-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: var(--qb-topbar-2);
  color: var(--qb-topbar-text);
  white-space: nowrap;
  cursor: pointer;
  list-style: none;
}
.qb-account-chip::-webkit-details-marker {
  display: none;
}
.qb-account-chip .icon {
  margin: 0;
}
.qb-account-chip:focus-visible {
  outline: 2px solid #fff;
}
.qb-account-name {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.qb-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}
.qb-badge .icon {
  margin: 0;
  font-size: 0.8em;
}
.qb-badge-ok {
  background: rgba(33, 186, 69, 0.2);
  color: #a7f0b8;
}
.qb-badge-warn {
  background: rgba(224, 138, 0, 0.25);
  color: #ffd08a;
}
.qb-account-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 30;
  width: 18rem;
  background: var(--qb-surface);
  color: var(--qb-text);
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
  box-shadow: 0 8px 24px rgba(15, 30, 45, 0.18);
}
.qb-account-section {
  padding: 0.75rem;
}
.qb-account-section + .qb-account-section {
  border-top: 1px solid var(--qb-border);
}
.qb-account-label {
  margin-bottom: 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--qb-muted);
}
.qb-account-reason {
  margin: 0 0 0.25rem;
  font-style: italic;
  overflow-wrap: anywhere;
}
.qb-account-meta {
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
}
```

- [ ] **Step 5: Record the deviation in the spec**

In `docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md` §3, replace `On the right one **account menu** (a
  Fomantic dropdown):` with `On the right one **account menu** — a native
  `<details>` dropdown (Fomantic's dropdown treats a clicked item as a
  selection and rewrites its trigger text; this menu holds actions):`. In §10
  replace `§3 (accordion leaves the airlock list; the account dropdown joins it)` with `§3 (the accordion leaves the airlock list)`.

- [ ] **Step 6: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → all pass.
Run the driver into `.superpowers/shots/task6`. Check:
- `01-fresh.png`: a blue "Log in" button at the top right.
- `06-logged-in-menu.png`: chip "demo.user · Compliance needed" (amber badge) with the open menu showing "Start compliance check" and "Log out".
- `07-compliance-menu.png`: chip shows a green "✓ Compliance" badge; the menu shows the quoted reason, "Given …" and "Invalidate". The top bar does not overflow.
- `page errors: []`.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/ui/accountMenu.ts src/ui/layout.ts src/main.ts src/styles.css docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git add -A src/ui src/main.ts src/styles.css docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git commit -m "feat(ui): account menu combines login and compliance in the top bar

Replaces authStatus.ts and complianceStatus.ts. Native <details> instead of a
Fomantic dropdown (spec updated): the menu holds actions, not choices.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Databases card with pill toggles

**Files:**
- Rewrite render: `src/ui/databasePicker.ts`
- Modify: `src/styles.css` (replace the "Database scope selector" section)

**Interfaces:**
- Consumes: `.qb-card`, `.qb-card-title`, `.qb-card-count`, `.qb-spacer` (Task 5).
- Produces: nothing new; `wireDatabasePicker(container, onChange)` keeps its signature.

- [ ] **Step 1: Replace `src/ui/databasePicker.ts`**

```ts
import type { AppState } from "../state";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/**
 * The database scope selector, above the query builder. Databases are
 * arbitrary partitions with no semantic tie to entryset content (returned by
 * GET /api/databases). Each one is a pill toggle — a real checkbox inside a
 * styled label, so it needs no plugin and works from the keyboard. Changing it
 * behaves like editing the query (see main.ts onDatabasesChange + §6).
 */
export function renderDatabasePicker(state: AppState): void {
  const el = panelEls().dbpicker;
  if (!state.databases) {
    paint(el, "");
    return;
  }
  const selected = new Set(state.selectedDatabaseIds);
  const pills = state.databases
    .map(
      (d) => `<label class="qb-db-pill" title="${escapeHtml(d.description)}">
        <input type="checkbox" data-db-id="${escapeHtml(d.label)}"${selected.has(d.label) ? " checked" : ""} />
        <span>${escapeHtml(d.name)}</span>
      </label>`,
    )
    .join("");
  const none = state.selectedDatabaseIds.length === 0;
  paint(
    el,
    `<div class="qb-card qb-dbpicker">
       <h2 class="qb-card-title">
         Databases
         <span class="qb-card-count">${selected.size} of ${state.databases.length} selected</span>
         <span class="qb-spacer"></span>
         <button type="button" class="ui mini basic button" data-db-all>All</button>
         <button type="button" class="ui mini basic button" data-db-none>None</button>
       </h2>
       <div class="qb-db-pills">${pills}</div>
       ${none ? `<p class="qb-db-warn"><i class="exclamation triangle icon"></i>Select at least one database.</p>` : ""}
     </div>`,
  );
}

export function wireDatabasePicker(
  container: HTMLElement,
  onChange: (nextSelectedIds: string[]) => void,
): void {
  if (container.dataset.dbWired === "1") return;
  container.dataset.dbWired = "1";

  const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>("input[data-db-id]"));

  container.addEventListener("change", (e) => {
    if (!(e.target as HTMLElement).matches("input[data-db-id]")) return;
    onChange(
      boxes()
        .filter((b) => b.checked)
        .map((b) => b.dataset.dbId!),
    );
  });

  container.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-db-all]")) onChange(boxes().map((b) => b.dataset.dbId!));
    else if (t.closest("[data-db-none]")) onChange([]);
  });
}
```

- [ ] **Step 2: Styles**

In `src/styles.css`, replace the whole section from `/* Database scope selector (src/ui/databasePicker.ts) */` through the `.qb-db-warn { … }` rule with:

```css
/* ---- Databases (src/ui/databasePicker.ts) ---- */
.qb-dbpicker .qb-card-title .ui.button {
  margin: 0;
}
.qb-db-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.qb-db-pill {
  position: relative;
  display: inline-flex;
  cursor: pointer;
}
.qb-db-pill input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.qb-db-pill span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.7rem;
  border: 1px solid var(--qb-border-strong);
  border-radius: 999px;
  background: var(--qb-surface);
  color: var(--qb-muted);
  font-size: 0.85rem;
  user-select: none;
}
.qb-db-pill span::before {
  content: "";
  width: 0.5rem;
  height: 0.5rem;
  border: 1px solid currentColor;
  border-radius: 50%;
}
.qb-db-pill input:checked + span {
  border-color: var(--qb-and-soft);
  background: #eaf4fc;
  color: #1f5f8f;
}
.qb-db-pill input:checked + span::before {
  border-color: var(--qb-and);
  background: var(--qb-and);
}
.qb-db-pill input:focus-visible + span {
  outline: 2px solid var(--qb-and);
  outline-offset: 2px;
}
.qb-db-warn {
  margin: 0.5rem 0 0;
  color: var(--qb-warn);
}
```

- [ ] **Step 3: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → pass.
Driver into `.superpowers/shots/task7`. Check `01-fresh.png`: a white "DATABASES 7 of 7 selected" card with All/None buttons on the right and seven blue pills. Then manually (or by editing a copy of the driver) click "None": all pills turn grey/outlined and an amber "Select at least one database." appears. `page errors: []`.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/ui/databasePicker.ts src/styles.css
git add src/ui/databasePicker.ts src/styles.css
git commit -m "feat(ui): databases as pill toggles with a selected count and All/None

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Query builder — brackets, joiners, soft hints, summary footer

**Files:**
- Rewrite render: `src/ui/queryBuilder.ts` (everything above `renderQueryBuilder`, and `renderQueryBuilder` itself; `_setBuilderRefs` and `wireQueryBuilder` stay unchanged)
- Modify: `src/ui/valueControl.ts` (inline styles → classes)
- Test: `tests/ui/valueControl.test.ts`
- Modify: `src/styles.css` (append a section)
- Modify: spec §4 wording for hint placement

**Interfaces:**
- Consumes: `Issue.kind` (Task 1), `newGroup()` (Task 2), `countLabel` (Task 3), `queryToText` (`src/query/summary.ts`), `countConditions` (`src/query/tree.ts`).
- Produces: markup contract used by the screenshot driver: `.qb-group`, `.qb-group-and`/`.qb-group-or`, `.qb-group-head`, `.qb-children`, `.qb-joiner`, `.qb-condition` > `.qb-cond-grid`, `.qb-hint`, `.qb-invalid`, `.qb-query-foot`. All existing `data-action` / `data-part` / `data-node-id` attributes keep their names and meaning, so `wireQueryBuilder` needs no change.

- [ ] **Step 1: Failing test — value controls carry no inline styles**

Append to the `renderValueControl` describe block in `tests/ui/valueControl.test.ts`:

```ts
  it("uses classes, not inline styles, for the range layout", () => {
    const num = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    const en = renderValueControl(enumField, op("two"), ["a", "b"]);
    for (const html of [num, en]) {
      expect(html).not.toContain("style=");
      expect(html).toContain('class="qb-range"');
      expect(html).toContain('class="qb-range-to"');
    }
  });
```

Run: `npx vitest run tests/ui/valueControl.test.ts` → Expected: FAIL (`style=` present).

- [ ] **Step 2: Fix `src/ui/valueControl.ts`**

In `renderValueControl`, replace the whole `if (operator.arity === "two") { … }` block with:

```ts
  if (operator.arity === "two") {
    if (field.valueType === "enum") {
      const from = Array.isArray(value) ? value[0] : undefined;
      const to = Array.isArray(value) ? value[1] : undefined;
      return `<div class="qb-range">${enumDropdown(field, from, false, 'data-range="from"')}<span class="qb-range-to">to</span>${enumDropdown(field, to, false, 'data-range="to"')}</div>`;
    }
    const from = Array.isArray(value) ? value[0] : "";
    const to = Array.isArray(value) ? value[1] : "";
    return `<div class="qb-range"><div class="ui input">${scalarInput(field, from, "value", 'data-range="from"')}</div><span class="qb-range-to">to</span><div class="ui input">${scalarInput(field, to, "value", 'data-range="to"')}</div></div>`;
  }
```

Run: `npx vitest run tests/ui/valueControl.test.ts` → Expected: PASS.

- [ ] **Step 3: Rewrite the render half of `src/ui/queryBuilder.ts`**

Replace the imports and everything from the top of the file down to (and including) `renderQueryBuilder` with the code below. Keep `let currentQuery…`, `let schemaRef…`, `_setBuilderRefs` and `wireQueryBuilder` exactly as they are.

```ts
import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { Individual } from "../api/types";
import type { CatalogField, CatalogOperator } from "../query/fieldCatalog";
import {
  addChild,
  countConditions,
  emptyQuery,
  findNode,
  newCondition,
  newGroup,
  removeNode,
  updateNode,
} from "../query/tree";
import { queryToText } from "../query/summary";
import { panelEls } from "./layout";
import { escapeHtml, optionsHtml, paint } from "./panel";
import { onDropdownChange } from "./fomantic";
import { countLabel } from "./format";
import { defaultValueFor, readValueControl, renderValueControl } from "./valueControl";

type FieldCatalog = { fields: CatalogField[]; operators: CatalogOperator[] };

/**
 * Unfinished parts are quiet grey hints — the user simply isn't done yet. Only
 * an invalid query is shown in red. Both kinds still block running (validate.ts).
 */
function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const text = (kind: Issue["kind"]) =>
    mine
      .filter((i) => i.kind === kind)
      .map((i) => escapeHtml(i.message))
      .join(" ");
  const incomplete = text("incomplete");
  const invalid = text("invalid");
  return (
    (incomplete ? `<div class="qb-hint">${incomplete}</div>` : "") +
    (invalid ? `<div class="qb-invalid"><i class="exclamation circle icon"></i>${invalid}</div>` : "")
  );
}

function iconButton(action: string, label: string, icon: string, extra = ""): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"${extra}><i class="${icon} icon"></i></button>`;
}

function individualDropdown(individuals: Individual[] | null, c: Condition): string {
  const opts = optionsHtml(
    individuals ?? [],
    (ind) => ind.label,
    (ind) => ind.name,
    (ind) => ind.label === c.individualId,
  );
  return `<select class="ui selection dropdown" data-part="individual"><option value="">Item…</option>${opts}</select>`;
}

function fieldDropdown(schema: FieldCatalog, c: Condition): string {
  const prefix = c.individualId ? `${c.individualId}.` : null;
  const opts = prefix
    ? optionsHtml(
        schema.fields.filter((f) => f.label.startsWith(prefix)),
        (f) => f.label,
        (f) => f.label.slice(prefix.length),
        (f) => f.label === c.fieldId,
      )
    : "";
  return `<select class="ui selection dropdown" data-part="field"${prefix ? "" : " disabled"}><option value="">Field…</option>${opts}</select>`;
}

function operatorDropdown(schema: FieldCatalog, c: Condition): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const ops = field
    ? field.operatorIds
        .map((label) => schema.operators.find((o) => o.label === label))
        .filter((o): o is CatalogOperator => o !== undefined)
    : [];
  const opts = optionsHtml(
    ops,
    (o) => o.label,
    (o) => o.name,
    (o) => o.label === c.operatorId,
  );
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}><option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  c: Condition,
  issues: Issue[],
): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const operator = schema.operators.find((o) => o.label === c.operatorId);
  return `<div class="qb-condition" data-node-id="${escapeHtml(c.id)}">
    <div class="qb-cond-grid">
      ${individualDropdown(individuals, c)}
      ${fieldDropdown(schema, c)}
      ${operatorDropdown(schema, c)}
      <div class="qb-value">${renderValueControl(field, operator, c.value)}</div>
      ${iconButton("remove-node", "Remove condition", "times")}
    </div>
    ${issuesHtml(c.id, issues)}
  </div>`;
}

function collapseButton(collapsed: boolean): string {
  return iconButton(
    "toggle-collapse",
    collapsed ? "Expand group" : "Collapse group",
    collapsed ? "caret right" : "caret down",
    ` aria-expanded="${!collapsed}"`,
  );
}

/**
 * A group is drawn as a coloured bracket with a faint tint (blue = ALL/AND,
 * amber = ANY/OR — see styles.css). Between its children sits a small AND/OR
 * "joiner" on the bracket line. A collapsed group folds to one line: its
 * plain-English summary and how many conditions it holds.
 */
function groupHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  g: Group,
  issues: Issue[],
  isRoot: boolean,
): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  if (g.collapsed) {
    const text = queryToText(g, schema);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head">
        ${collapseButton(true)}
        <span class="qb-op-badge">${matchWord}</span>
        <span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        <span class="qb-count">${countLabel(countConditions(g), "condition")}</span>
        ${remove}
      </div>
      ${issuesHtml(g.id, issues)}
    </div>`;
  }
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children
    .map((child) => nodeHtml(schema, individuals, child, issues, false))
    .join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${collapseButton(false)}
      <span class="qb-group-label">Match</span>
      <span class="qb-logic" role="group" aria-label="Combine conditions with">
        <button type="button" class="qb-logic-btn${g.operator === "AND" ? " is-on" : ""}" data-action="set-and" aria-pressed="${g.operator === "AND"}">ALL</button>
        <button type="button" class="qb-logic-btn${g.operator === "OR" ? " is-on" : ""}" data-action="set-or" aria-pressed="${g.operator === "OR"}">ANY</button>
      </span>
      <span class="qb-group-label">of the following</span>
      <span class="qb-spacer"></span>
      <button type="button" class="ui mini basic button" data-action="add-condition"><i class="plus icon"></i>Condition</button>
      <button type="button" class="ui mini basic button" data-action="add-group"><i class="plus icon"></i>Group</button>
      ${remove}
    </div>
    ${issuesHtml(g.id, issues)}
    <div class="qb-children">${children}</div>
  </div>`;
}

function nodeHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, individuals, node, issues, isRoot)
    : conditionHtml(schema, individuals, node, issues);
}

/** The query card's footer: the whole query in plain English once it is
 *  complete, otherwise how many parts still need attention. */
function footerHtml(state: AppState, schema: FieldCatalog): string {
  if (countConditions(state.query) === 0) {
    return `<span class="qb-muted">Add a condition to start building the query.</span>`;
  }
  const pending = new Set(state.issues.map((i) => i.nodeId)).size;
  if (pending > 0) {
    const what =
      pending === 1 ? "1 part of the query still needs" : `${pending} parts of the query still need`;
    return `<span class="qb-muted">${what} attention.</span>`;
  }
  const text = queryToText(state.query, schema);
  return `<span class="qb-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

export function renderQueryBuilder(state: AppState): void {
  const el = panelEls().center;
  if (!state.schema) {
    paint(el, `<div class="qb-card"><div class="ui active centered inline loader"></div></div>`);
    return;
  }
  paint(
    el,
    `<div class="qb-card qb-query">
       <h2 class="qb-card-title">Query</h2>
       ${nodeHtml(state.schema, state.individuals, state.query, state.issues, true)}
       <div class="qb-query-foot">${footerHtml(state, state.schema)}</div>
     </div>`,
  );
  // Keep the once-wired delegated handlers acting on the current tree/schema.
  _setBuilderRefs(state.query as Group, state.schema);
}
```

- [ ] **Step 4: Styles — append to `src/styles.css`**

```css
/* ---- Query builder (src/ui/queryBuilder.ts + valueControl.ts) ---- */
.qb-group {
  /* Operator colours; .qb-group-or overrides. Children read these through the
     cascade, so a joiner/toggle always takes its own group's colour. */
  --qb-c: var(--qb-and);
  --qb-c-soft: var(--qb-and-soft);
  --qb-c-text: var(--qb-and);
  --qb-tint: var(--qb-and-tint);
  --qb-tint-strong: var(--qb-and-tint-strong);
  position: relative;
  margin: 0.25rem 0;
  padding: 0.45rem 0.5rem 0.45rem 0.75rem;
  border-left: 3px solid var(--qb-c);
  border-radius: 0 var(--qb-radius) var(--qb-radius) 0;
  background: var(--qb-tint);
  outline: 1px solid transparent;
  transition:
    background-color 0.12s,
    outline-color 0.12s;
}
.qb-group-or {
  --qb-c: var(--qb-or);
  --qb-c-soft: var(--qb-or-soft);
  --qb-c-text: var(--qb-or-text);
  --qb-tint: var(--qb-or-tint);
  --qb-tint-strong: var(--qb-or-tint-strong);
}
/* The bracket's top and bottom arms: "[" */
.qb-group::before,
.qb-group::after {
  content: "";
  position: absolute;
  left: -3px;
  width: 16px;
  border-top: 2px solid var(--qb-c);
}
.qb-group::before {
  top: 0;
}
.qb-group::after {
  bottom: 0;
}
/* Hover lights up only the innermost group under the pointer. */
.qb-group:hover:not(:has(.qb-group:hover)) {
  background: var(--qb-tint-strong);
  outline-color: var(--qb-c-soft);
}
.qb-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.9rem;
}
.qb-group-head .ui.mini.button {
  margin: 0;
}
.qb-group-label {
  font-size: 0.85rem;
  color: var(--qb-muted);
}
.qb-logic {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--qb-border-strong);
  border-radius: 4px;
  background: var(--qb-surface);
}
.qb-logic-btn {
  padding: 0.15rem 0.55rem;
  border: 0;
  background: transparent;
  color: var(--qb-muted);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  cursor: pointer;
}
.qb-logic-btn.is-on {
  background: var(--qb-c);
  color: #fff;
}
.qb-logic-btn:focus-visible {
  outline: 2px solid var(--qb-c);
  outline-offset: -2px;
}
.qb-children {
  display: flex;
  flex-direction: column;
}
/* AND/OR between two children, sitting centred on the group's bracket line. */
.qb-joiner {
  position: relative;
  left: calc(-0.75rem - 1.5px);
  transform: translateX(-50%);
  align-self: flex-start;
  margin: 0.1rem 0;
  padding: 0 0.35rem;
  border: 1px solid var(--qb-c-soft);
  border-radius: 999px;
  background: var(--qb-surface);
  color: var(--qb-c-text);
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.5;
}
.qb-op-badge {
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  background: var(--qb-c);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
}
.qb-group-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  color: var(--qb-muted);
}
.is-collapsed > .qb-group-head {
  flex-wrap: nowrap;
}

/* One condition = one grid row. Container query: a row squeezed below ~640px
   (deep nesting on a small screen) moves its value + ✕ onto a second line. */
.qb-condition {
  container-type: inline-size;
  padding: 0.15rem 0;
}
.qb-cond-grid {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)
    minmax(0, 1.2fr) auto;
  gap: 0.4rem;
  align-items: center;
}
@container (max-width: 640px) {
  .qb-cond-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .qb-cond-grid > .qb-value {
    grid-column: 1 / 4;
    grid-row: 2;
  }
  .qb-cond-grid > .qb-icon-btn {
    grid-column: 4;
    grid-row: 2;
  }
}
/* Fomantic gives selection dropdowns a 14em min-width; the grid sizes them. */
.qb-cond-grid .ui.selection.dropdown {
  width: 100%;
  min-width: 0;
}
.qb-cond-grid .ui.selection.dropdown > .text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qb-value {
  min-width: 0;
}
.qb-value .ui.input {
  display: flex;
  width: 100%;
}
.qb-value .ui.input > input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
}
.qb-range {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.qb-range > * {
  flex: 1 1 0;
  min-width: 0;
}
.qb-range > .qb-range-to {
  flex: 0 0 auto;
  color: var(--qb-muted);
}
.qb-hint {
  margin: 0.2rem 0 0 0.1rem;
  font-size: 0.8rem;
  color: var(--qb-subtle);
}
.qb-invalid {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--qb-danger);
}
.qb-query-foot {
  margin: 0.75rem -1rem -0.75rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--qb-border);
  border-radius: 0 0 var(--qb-radius) var(--qb-radius);
  background: var(--qb-surface-2);
  font-size: 0.85rem;
}
.qb-summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}
```

- [ ] **Step 5: Spec wording**

In the spec §4 "Incomplete vs invalid", replace `rendered as a quiet grey hint at the end of the row / under the
    group header.` with `rendered as a quiet grey hint directly under the row / under the
    group header.`

- [ ] **Step 6: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → pass.
Driver into `.superpowers/shots/task8`. Check:
- `01-fresh.png`: a white "QUERY" card; the root group has a blue bracket with top/bottom arms and a faint blue tint; one row of three dropdowns + value slot + ✕ on **one line**; a grey "Choose a field." under it — **no red anywhere**; footer "1 part of the query still needs attention."
- `03-new-group.png`: the nested group already contains an empty condition row (grey hint, not red).
- `04-nested.png`: three levels — blue ALL › amber ANY › blue ALL — with `AND`/`OR` pills sitting on each bracket between rows; the footer shows the whole query in plain English.
- `05-hover-innermost.png`: only the innermost group is highlighted (stronger tint + outline).
- `10-width-1024.png`: rows still on one line at depth 1–2; deeper rows (if narrow) wrap the value onto a second line instead of squeezing the dropdowns.
- Collapse a group (click its caret, e.g. in a copy of the driver): it folds to "ANY  <summary…>  2 conditions ✕".
- `page errors: []`.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/ui/queryBuilder.ts src/ui/valueControl.ts src/styles.css tests/ui/valueControl.test.ts docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git add src/ui/queryBuilder.ts src/ui/valueControl.ts src/styles.css tests/ui/valueControl.test.ts docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git commit -m "feat(ui): query builder groups as coloured brackets with joiners, soft hints and a summary footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Statistics column

**Files:**
- Rewrite: `src/ui/statsPanel.ts`
- Test: `tests/ui/statsPanel.test.ts`
- Modify: `src/styles.css` (replace the stats sections)
- Modify: spec §5 (idle wording)

**Interfaces:**
- Consumes: `countLabel` (Task 3), `.qb-card*`, `.qb-placeholder` (Task 5).
- Produces: `headlineHtml(state)` still exported (tested); `renderStatsPanel(state)` unchanged signature.

**Note on the idle state:** `stats.status === "idle"` with a complete query only happens during the 400 ms debounce before a fetch starts, so the panel says "Counting matches…" there — "Finish the query" would be wrong for a finished query. Step 4 records this in the spec.

- [ ] **Step 1: Failing test — the headline says what it counts**

Add to `tests/ui/statsPanel.test.ts`:

```ts
  it("labels the headline number", () => {
    const html = headlineHtml(stateWith("ok", [{ label: "a", success: true, matchCount: 10 }]));
    expect(html).toContain("matching entrysets");
  });
```

Run: `npx vitest run tests/ui/statsPanel.test.ts` → Expected: FAIL.

- [ ] **Step 2: Replace `src/ui/statsPanel.ts`**

```ts
import type { AppState } from "../state";
import type { DatabasesResponse, StatsResponse } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, countLabel, exact, matchRatio } from "./format";

/** GET /api/databases is loaded once into AppState.databases; a stats line only
 * carries a `label`, so its display name and totalEntrysets are looked up here
 * rather than resent on every line. */
function databaseFor(
  databases: DatabasesResponse[] | null,
  label: string,
): DatabasesResponse | undefined {
  return databases?.find((d) => d.label === label);
}

function bar(match: number, total: number): string {
  return `<span class="qb-bar"><i style="width:${barWidth(match, total)}"></i></span>`;
}

function messagesHtml(list: string[] | undefined, cls: string): string {
  return list?.length ? `<span class="${cls}">${list.map(escapeHtml).join(" · ")}</span>` : "";
}

function successRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const total = db?.totalEntrysets ?? 0;
  const matchCount = line.matchCount ?? 0;
  return `<div class="qb-db-row" title="${escapeHtml(name)}: ${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${bar(matchCount, total)}
    <span class="qb-db-ratio">${escapeHtml(matchRatio(matchCount, total))}</span>
    ${messagesHtml(line.infoMessages, "qb-db-msg")}
  </div>`;
}

function failureRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const errors = line.errorMessages?.length
    ? messagesHtml(line.errorMessages, "qb-db-msg qb-db-error")
    : `<span class="qb-db-msg qb-db-error">Failed.</span>`;
  return `<div class="qb-db-row is-failed">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${errors}
    ${messagesHtml(line.infoMessages, "qb-db-msg")}
  </div>`;
}

/** One row per database that has reported so far — success (ratio + bar),
 * failure (errorMessages in red, infoMessages beneath) — as each streamed line
 * arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<h3 class="qb-stat-subtitle">By database</h3>
    <div class="qb-stat-perdb">
      ${lines
        .map((line) => {
          const db = databaseFor(state.databases, line.label);
          return line.success ? successRowHtml(line, db) : failureRowHtml(line, db);
        })
        .join("")}
    </div>`;
}

/**
 * The combined headline sums only the databases that succeeded. A failed
 * database has no count at all (StatsResponse.matchCount is deliberately
 * optional), so the headline must never present failures as "0 matched": with
 * no successes yet it shows no number, and when some failed it says the total
 * excludes them.
 */
export function headlineHtml(state: AppState): string {
  const { lines, status } = state.stats;
  const succeeded = lines.filter((l) => l.success);
  const failed = lines.length - succeeded.length;
  const failedNote =
    failed > 0
      ? `<div class="qb-stat-failed">Excludes ${failed} database${failed === 1 ? "" : "s"} that failed (see below).</div>`
      : "";
  if (succeeded.length === 0) {
    const text =
      status === "loading" ? "No results yet." : "No database returned a result for this query.";
    return `<div class="qb-stat-headline"><p class="qb-stat-sub">${text}</p></div>`;
  }
  const matchCount = succeeded.reduce((s, l) => s + (l.matchCount ?? 0), 0);
  const total = succeeded.reduce(
    (s, l) => s + (databaseFor(state.databases, l.label)?.totalEntrysets ?? 0),
    0,
  );
  return `<div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
    <div class="qb-stat-label">matching entrysets</div>
    <div class="qb-stat-sub">${escapeHtml(matchRatio(matchCount, total))} of ${escapeHtml(compact(total))}</div>
    ${bar(matchCount, total)}
    ${failedNote}
  </div>`;
}

/** While loading, how many selected databases haven't reported a line yet. */
function pendingHtml(state: AppState): string {
  if (state.stats.status !== "loading") return "";
  const remaining = state.selectedDatabaseIds.length - state.stats.lines.length;
  if (remaining <= 0) return "";
  return `<div class="qb-stat-pending"><span class="ui active mini inline loader"></span>Waiting on ${countLabel(remaining, "more database", "more databases")}…</div>`;
}

function card(state: AppState, body: string): string {
  const busy =
    state.stats.status === "loading"
      ? `<span class="ui active mini inline loader" aria-label="Updating"></span>`
      : "";
  return `<div class="qb-card qb-stats"><h2 class="qb-card-title">Statistics ${busy}</h2>${body}</div>`;
}

const placeholder = (text: string) => `<p class="qb-placeholder">${escapeHtml(text)}</p>`;

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(el, card(state, placeholder("Select at least one database to see statistics.")));
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, card(state, placeholder("Add a condition to see statistics.")));
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, card(state, placeholder("Finish the query to see statistics.")));
    return;
  }
  const { status, lines, error } = state.stats;
  if (status === "error") {
    paint(
      el,
      card(
        state,
        `<div class="ui small negative message"><div class="header">Statistics failed</div><p>${escapeHtml(error ?? "")}</p></div>`,
      ),
    );
    return;
  }
  // "idle" with a complete query = the debounce before the fetch starts.
  if (status === "idle" || (status === "loading" && lines.length === 0)) {
    paint(el, card(state, placeholder("Counting matches…")));
    return;
  }
  // The headline stays on top; the per-database list follows. The whole
  // column is sticky and scrolls internally (styles.css .qb-col-stats).
  paint(el, card(state, `${headlineHtml(state)}${perDatabaseHtml(state)}${pendingHtml(state)}`));
}
```

- [ ] **Step 3: Styles**

In `src/styles.css`, delete the section starting `/* Statistics panel (src/ui/statsPanel.ts + format.ts) …` through the `.qb-stat-perdb { … }` rule, **and** the trailing section `/* Stats headline caveat when some databases failed …*/` with its `.qb-stat-failed` rule. Append:

```css
/* ---- Statistics (src/ui/statsPanel.ts + format.ts) — must fit ~15rem ---- */
.qb-stats .qb-card-title .ui.loader {
  margin: 0;
}
.qb-stat-headline {
  margin-bottom: 0.75rem;
}
.qb-stat-big {
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1.1;
}
.qb-stat-label {
  font-weight: 600;
}
.qb-stat-sub {
  margin: 0;
  font-size: 0.85rem;
  color: var(--qb-muted);
}
.qb-stat-failed {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  color: var(--qb-danger);
}
.qb-bar {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: #e3e8ee;
}
.qb-bar > i {
  display: block;
  height: 100%;
  background: var(--qb-and);
}
.qb-stat-headline .qb-bar {
  margin-top: 0.4rem;
}
.qb-stat-subtitle {
  margin: 0.25rem 0 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--qb-muted);
}
.qb-db-row {
  display: grid;
  grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr) auto;
  gap: 0.1rem 0.5rem;
  align-items: center;
  padding: 0.2rem 0;
  font-size: 0.8rem;
}
.qb-db-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.qb-db-ratio {
  color: var(--qb-muted);
  white-space: nowrap;
}
.qb-db-msg {
  grid-column: 1 / -1;
  font-size: 0.75rem;
  color: var(--qb-muted);
}
.qb-db-error {
  color: var(--qb-danger);
}
.qb-stat-pending {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
}
.qb-stat-pending .ui.loader {
  margin: 0;
}
```

- [ ] **Step 4: Spec wording**

In spec §5, replace `- Empty states (no databases / no condition / query incomplete / idle) use a quiet
  grey placeholder instead of blue `ui info message` boxes, with the wording
  "Select at least one database…", "Add a condition…", "Finish the query to see
  statistics."` with `- Empty states use a quiet grey placeholder instead of blue `ui info message`
  boxes: "Select at least one database…", "Add a condition…", "Finish the query
  to see statistics." (incomplete), and "Counting matches…" while a complete
  query's first result is pending (idle = the 400 ms debounce, or loading with
  no line yet).` (keep the surrounding list formatting).

- [ ] **Step 5: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → pass.
Driver into `.superpowers/shots/task9`. Check:
- `01-fresh.png`: "STATISTICS" card with the grey placeholder "Finish the query to see statistics." — no blue box.
- `04-nested.png`: big number, "matching entrysets", "N% of …", a blue bar; "BY DATABASE" with one line per database (name · bar · %), all inside the 15rem column with no horizontal overflow.
- `08-results.png` (page scrolled): the stats column is still visible next to the results.
- `page errors: []`.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/ui/statsPanel.ts src/styles.css tests/ui/statsPanel.test.ts docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git add src/ui/statsPanel.ts src/styles.css tests/ui/statsPanel.test.ts docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git commit -m "feat(ui): slim statistics card with a labelled headline and compact per-database rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: "Matching entrysets" owns the Run button

**Files:**
- Rewrite: `src/ui/dataPreview.ts`
- Modify: `src/ui/layout.ts` (remove the top-bar Run button), `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `countLabel`, `displayLabel`, `formatWhen` (Task 3).
- Produces: `renderDataPreview(state: AppState): void` (unchanged signature) and new `wireDataPreview(container: HTMLElement, onRun: () => void): void`. The Run button is `button[data-action="run"]` inside `[data-panel="preview"]`. `onMenu` loses its `run` handler; `syncRunButton` is deleted.

- [ ] **Step 1: Replace `src/ui/dataPreview.ts`**

```ts
import type { AppState } from "../state";
import type { Entryset, Individual } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { countLabel, displayLabel, formatWhen } from "./format";

/** How many group tags to show inline before collapsing the rest into "+N". */
const MAX_GROUP_BADGES = 3;

function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals ?? []) map.set(item.label, item);
  return map;
}

function groupsBadgesHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const groups = [
    ...new Set(
      Object.keys(entryset.items)
        .map((slug) => byLabel.get(slug)?.group)
        .filter((g): g is string => Boolean(g) && g !== "metadata"),
    ),
  ].sort();
  const shown = groups.slice(0, MAX_GROUP_BADGES);
  const overflow = groups.length - shown.length;
  return (
    shown.map((g) => `<span class="qb-tag">${escapeHtml(displayLabel(g))}</span>`).join("") +
    (overflow > 0 ? `<span class="qb-er-more">+${overflow}</span>` : "")
  );
}

function entrysetRowHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const vehicle = entryset.items["vehicle_identity"]?.["vehicle_type"];
  const when = entryset.items["observation_window"]?.["from_timestamp"];
  return `
    <details class="qb-entryset-row">
      <summary>
        <span class="qb-er-id">#${escapeHtml(entryset.id)}</span>
        <span class="qb-er-when">${escapeHtml(formatWhen(typeof when === "string" ? when : undefined))}</span>
        <span class="qb-er-vehicle">${escapeHtml(typeof vehicle === "string" ? vehicle : "—")}</span>
        <span class="qb-er-groups">${groupsBadgesHtml(entryset, byLabel)}</span>
        <span class="qb-er-count">${countLabel(Object.keys(entryset.items).length, "item")}</span>
      </summary>
      <pre class="qb-er-json">${escapeHtml(JSON.stringify(entryset, null, 2))}</pre>
    </details>`;
}

function card(body: string, count?: number): string {
  const n = count === undefined ? "" : ` <span class="qb-card-count">· ${count.toLocaleString()}</span>`;
  return `<div class="qb-card qb-preview"><h2 class="qb-card-title">Matching entrysets${n}</h2>${body}</div>`;
}

/** The Run control — the only one in the app. Its enabled state is decided by
 *  the same checks renderDataPreview makes before calling it. */
function runBlock(message: string, enabled: boolean, note = "", label = "Run query"): string {
  return `<div class="qb-run">
    ${message ? `<p class="qb-run-msg">${escapeHtml(message)}</p>` : ""}
    <button type="button" class="ui primary button" data-action="run"${enabled ? "" : " disabled"}><i class="play icon"></i>${escapeHtml(label)}</button>
    ${note ? `<p class="qb-run-note">${escapeHtml(note)}</p>` : ""}
  </div>`;
}

/** Advisory only (§9): Run always attempts the request; main.ts reacts to the
 *  real 401/403 by redirecting into login/compliance and back. */
function runNote(state: AppState): string {
  if (state.auth.status === "anonymous") return "You'll be asked to log in first.";
  if (state.auth.status === "authenticated" && state.compliance.status === "required") {
    return "You'll be asked to confirm compliance first.";
  }
  return "";
}

export function renderDataPreview(state: AppState): void {
  const el = panelEls().preview;
  const p = state.preview;

  // §6: this panel never shows anything that does not belong to the query on
  // screen, and it says WHY it is empty. These checks mirror statsPanel.ts.
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(el, card(runBlock("Select at least one database, then run the query.", false)));
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, card(runBlock("Add a condition, then run the query.", false)));
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, card(runBlock("Finish the query to run it.", false)));
    return;
  }
  // onQueryChange/onDatabasesChange reset preview to "idle" in the same
  // setState that changes the query, so one run always belongs to one query.
  if (p.status === "idle") {
    paint(
      el,
      card(runBlock("Fetch a sample of the entrysets this query matches.", true, runNote(state))),
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      card(
        `<div class="qb-run"><div class="ui active inline loader"></div><p class="qb-run-msg">Fetching entrysets…</p></div>`,
      ),
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      card(
        `<div class="ui small negative message"><div class="header">Could not load entrysets</div><p>${escapeHtml(p.error)}</p></div>
         ${runBlock("", true, "", "Try again")}`,
      ),
    );
    return;
  }
  if (!p.data) {
    paint(el, "");
    return;
  }
  const { entrysets } = p.data;
  if (entrysets.length === 0) {
    paint(el, card(`<p class="qb-placeholder">No entrysets match this query.</p>`, 0));
    return;
  }
  const byLabel = individualsByLabel(state);
  paint(
    el,
    card(
      `<p class="qb-preview-note qb-muted">Showing ${countLabel(entrysets.length, "entryset")} — click a row to see its full JSON.</p>
       <div class="qb-entryset-list">${entrysets.map((e) => entrysetRowHtml(e, byLabel)).join("")}</div>`,
      entrysets.length,
    ),
  );
}

/** One delegated listener for the Run / Try again button (attached once). */
export function wireDataPreview(container: HTMLElement, onRun: () => void): void {
  if (container.dataset.previewWired === "1") return;
  container.dataset.previewWired = "1";
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action='run']");
    if (btn && !btn.disabled) onRun();
  });
}
```

- [ ] **Step 2: Remove the top-bar Run from `src/ui/layout.ts`**

Delete the line `<button class="ui primary button" data-menu="run" disabled>Run / Refresh</button>` from the markup. In `onMenu`, remove `run(): void;` from the handler type and delete the line `document.querySelector('[data-menu="run"]')!.addEventListener("click", () => handler.run());`.

- [ ] **Step 3: Update `src/main.ts`**

1. Change the preview import to `import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";`.
2. In the `onMenu({...})` call, delete the line `run: () => runPreview(),`. Directly after that call add:

   ```ts
   // Run lives in the "Matching entrysets" panel (the only Run control).
   wireDataPreview(panelEls().preview, () => runPreview());
   ```
3. Delete the whole `function syncRunButton(...) { … }`.
4. In `panelRenderers`, the preview entry's `run` becomes `run: (s) => renderDataPreview(s),` (keys unchanged).
5. In the initial-render block, delete `syncRunButton(); // top-menu Run starts disabled`.
6. In the startup `.then(...)`, update the comment `// it `issues` would stay [] and syncRunButton would enable Run on the empty` to say `the preview panel would enable Run on the empty` instead of `syncRunButton would enable Run on the empty`.

Run `grep -n "syncRunButton\|data-menu=\"run\"" src` → Expected: no output.

- [ ] **Step 4: Styles**

In `src/styles.css`, delete the section `/* Data preview (src/ui/dataPreview.ts): …` through the `.qb-er-json { … }` rule. Append:

```css
/* ---- Matching entrysets (src/ui/dataPreview.ts) ---- */
.qb-run {
  padding: 1.25rem 0.75rem;
  text-align: center;
  border: 1px dashed var(--qb-border-strong);
  border-radius: var(--qb-radius);
  background: var(--qb-surface-2);
}
.qb-run-msg {
  margin: 0 0 0.75rem;
  color: var(--qb-muted);
}
.qb-run .ui.button {
  margin: 0;
}
.qb-run .ui.loader {
  margin-bottom: 0.5rem;
}
.qb-run-note {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: var(--qb-subtle);
}
.qb-preview .ui.negative.message {
  margin: 0 0 0.75rem;
}
.qb-preview-note {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
}
.qb-entryset-list {
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
}
.qb-entryset-row {
  border-bottom: 1px solid var(--qb-border);
}
.qb-entryset-row:last-child {
  border-bottom: none;
}
.qb-entryset-row summary {
  display: grid;
  grid-template-columns: 3rem 10.5rem minmax(0, 9rem) minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  list-style: none;
}
.qb-entryset-row summary::-webkit-details-marker {
  display: none;
}
.qb-entryset-row summary:hover {
  background: var(--qb-surface-2);
}
.qb-entryset-row[open] summary {
  background: #eef4fa;
}
.qb-er-id {
  font-weight: 700;
}
.qb-er-when,
.qb-er-count {
  color: var(--qb-muted);
  white-space: nowrap;
}
.qb-er-vehicle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.qb-er-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-width: 0;
}
.qb-er-more {
  font-size: 0.8rem;
  color: var(--qb-subtle);
}
.qb-er-count {
  text-align: right;
}
.qb-er-json {
  max-height: 24rem;
  margin: 0;
  padding: 0.75rem;
  overflow: auto;
  border-top: 1px solid var(--qb-border);
  background: var(--qb-surface-2);
  font-size: 0.8em;
}
```

- [ ] **Step 5: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → pass.
Driver into `.superpowers/shots/task10`. Check:
- `01-fresh.png`: no Run button in the top bar; the "MATCHING ENTRYSETS" card under the query shows "Finish the query to run it." with a **disabled** "Run query".
- `02-one-condition.png` (anonymous): Run enabled, note "You'll be asked to log in first."
- `08-results.png`: header "MATCHING ENTRYSETS · N", "Showing N entrysets — click a row…", rows with dates on one line (e.g. "7 Nov 2024, 09:15"), vehicle, up to three tags with spaces instead of underscores (the vehicle type is a data value and stays as returned, e.g. `semi_truck`), "+N", "N items"; **no** Run/Refresh button in the results state.
- `09-row-expanded.png`: JSON block with its own scroll, capped height.
- Edit the query after results (in a copy of the driver): the card returns to the "ready" state with Run.
- `page errors: []`.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/ui/dataPreview.ts src/ui/layout.ts src/main.ts src/styles.css
git add src/ui/dataPreview.ts src/ui/layout.ts src/main.ts src/styles.css
git commit -m "feat(ui): Run query lives in the Matching entrysets card

Removes the top-bar Run / Refresh and syncRunButton; the preview panel renders
the button's state itself. Request handling (runPreview, 401/403 redirects,
stale guards) is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Data dictionary (docs panel)

**Files:**
- Rewrite: `src/ui/docsSidebar.ts`
- Modify: `src/ui/fomantic.ts` (drop the accordion), `src/styles.css`

**Interfaces:**
- Consumes: `matchDocs` (Task 4), `displayLabel`, `countLabel`, `compact`, `matchRatio` (format.ts), the delegated `data-menu="toggle-sidebar"` handler (Task 5).
- Produces: `renderDocsSidebar(state)` (unchanged signature). DOM hooks: `#qb-docs-filter`, `details.qb-doc-group[data-group][data-size]`, `[data-item-label]` (= `Individual.label`), `[data-group-count]`, `.qb-docs-empty`, `[data-action="clear-filter"]`.

- [ ] **Step 1: Replace `src/ui/docsSidebar.ts`**

```ts
import type { AppState } from "../state";
import type { DatabasesResponse, Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, countLabel, displayLabel, matchRatio } from "./format";
import { matchDocs } from "./docsFilter";

/** Total entrysets across every loaded database — the denominator for an
 * individual's percentage, since the backend no longer sends one directly
 * (Individual only carries totalCount, an absolute figure). */
function totalEntrysets(databases: DatabasesResponse[] | null): number {
  return databases?.reduce((s, d) => s + d.totalEntrysets, 0) ?? 0;
}

function itemHtml(item: Individual, total: number): string {
  const tags = item.tags.length
    ? `<div class="qb-doc-tags">${item.tags.map((t) => `<span class="qb-tag">${escapeHtml(displayLabel(t))}</span>`).join("")}</div>`
    : "";
  const fields = item.fields
    .map(
      (f) =>
        `<span class="qb-field-chip"><code>${escapeHtml(f.name || f.label)}</code><span class="qb-field-type">${escapeHtml(f.type || f.format)}</span></span>`,
    )
    .join("");
  return `<div class="qb-doc-item" data-item-label="${escapeHtml(item.label)}">
      <div class="qb-doc-name">${escapeHtml(item.name)}</div>
      ${tags}
      ${item.description ? `<p class="qb-doc-desc">${escapeHtml(item.description)}</p>` : ""}
      ${item.comment ? `<p class="qb-doc-comment">${escapeHtml(item.comment)}</p>` : ""}
      <p class="qb-doc-count" title="${escapeHtml(item.totalCount.toLocaleString())} of ${total.toLocaleString()} entrysets">
        In ${compact(item.totalCount)} entrysets (${matchRatio(item.totalCount, total)})
      </p>
      <div class="qb-doc-fields">${fields}</div>
    </div>`;
}

function groupHtml(group: string, items: Individual[], total: number): string {
  return `<details class="qb-doc-group" data-group="${escapeHtml(group)}" data-size="${items.length}">
      <summary>
        <span class="qb-doc-group-name">${escapeHtml(displayLabel(group))}</span>
        <span class="qb-count" data-group-count>${items.length}</span>
      </summary>
      <div class="qb-doc-items">${items.map((item) => itemHtml(item, total)).join("")}</div>
    </details>`;
}

/**
 * Show only what matches: hide non-matching items and groups, open the groups
 * that have a match, and swap each group's size for its match count. This
 * sets hidden/open on the painted DOM directly instead of repainting — the
 * filter text is local to this panel (not AppState), and a repaint on every
 * keystroke would throw away the input's focus and caret.
 */
function applyFilter(el: HTMLElement, individuals: Individual[], text: string): void {
  const match = matchDocs(individuals, text);
  el.querySelectorAll<HTMLElement>("[data-item-label]").forEach((node) => {
    node.hidden = match !== null && !match.items.has(node.dataset.itemLabel!);
  });
  el.querySelectorAll<HTMLDetailsElement>("details[data-group]").forEach((group) => {
    const count = group.querySelector<HTMLElement>("[data-group-count]")!;
    if (!match) {
      group.hidden = false;
      group.open = false;
      count.textContent = group.dataset.size!;
      return;
    }
    const n = match.groups.get(group.dataset.group!) ?? 0;
    group.hidden = n === 0;
    group.open = n > 0;
    count.textContent = countLabel(n, "match", "matches");
  });
  const empty = el.querySelector<HTMLElement>(".qb-docs-empty")!;
  empty.hidden = !match || match.items.size > 0;
  empty.textContent = `No items match “${text.trim()}”.`;
  el.querySelector<HTMLElement>("[data-action='clear-filter']")!.hidden = text === "";
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.individuals) {
    paint(
      el,
      `<div class="qb-card"><div class="ui active mini inline loader"></div> Loading the data dictionary…</div>`,
    );
    return;
  }
  const individuals = state.individuals;
  const total = totalEntrysets(state.databases);
  const groups = new Map<string, Individual[]>();
  for (const item of individuals) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }

  paint(
    el,
    `<div class="qb-card qb-docs">
       <h2 class="qb-card-title">
         Data dictionary
         <span class="qb-spacer"></span>
         <button type="button" class="qb-icon-btn" data-menu="toggle-sidebar" aria-label="Close the data dictionary" title="Close"><i class="times icon"></i></button>
       </h2>
       <div class="ui fluid small input qb-docs-search">
         <input type="text" id="qb-docs-filter" placeholder="Search items and fields…" aria-label="Search the data dictionary" autocomplete="off" />
         <button type="button" class="qb-icon-btn qb-docs-clear" data-action="clear-filter" aria-label="Clear search" hidden><i class="times icon"></i></button>
       </div>
       <p class="qb-docs-empty" hidden></p>
       <div class="qb-doc-groups">
         ${[...groups.entries()].map(([group, items]) => groupHtml(group, items, total)).join("")}
       </div>
     </div>`,
  );

  const input = el.querySelector<HTMLInputElement>("#qb-docs-filter")!;
  const clear = () => {
    input.value = "";
    applyFilter(el, individuals, "");
  };
  input.addEventListener("input", () => applyFilter(el, individuals, input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) clear();
  });
  el.querySelector("[data-action='clear-filter']")!.addEventListener("click", () => {
    clear();
    input.focus();
  });
}
```

- [ ] **Step 2: Drop the accordion from `src/ui/fomantic.ts`**

Delete `$(container).find(".ui.accordion").accordion();` from `activate()` and `$(container).find(".ui.accordion").accordion("destroy");` from `destroy()`.

Run `grep -rn "accordion" src` → Expected: no output.

- [ ] **Step 3: Styles — append to `src/styles.css`**

```css
/* ---- Data dictionary (src/ui/docsSidebar.ts + docsFilter.ts) ---- */
.qb-docs-search {
  position: relative;
  margin-bottom: 0.6rem;
}
.qb-docs-search > input {
  padding-right: 2rem !important;
}
.qb-docs-clear {
  position: absolute;
  top: 50%;
  right: 0.2rem;
  transform: translateY(-50%);
}
.qb-docs-empty {
  margin: 0.25rem 0 0.5rem;
  font-size: 0.85rem;
  color: var(--qb-muted);
}
.qb-doc-group {
  border-top: 1px solid var(--qb-border);
}
.qb-doc-group > summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.1rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.qb-doc-group > summary::-webkit-details-marker {
  display: none;
}
.qb-doc-group > summary::before {
  content: "▸";
  width: 0.8rem;
  color: var(--qb-subtle);
}
.qb-doc-group[open] > summary::before {
  content: "▾";
}
.qb-doc-group-name {
  flex: 1 1 auto;
}
.qb-doc-items {
  padding: 0 0 0.5rem 1.3rem;
}
.qb-doc-item {
  padding: 0.5rem 0;
  border-top: 1px dashed var(--qb-border);
}
.qb-doc-item:first-child {
  border-top: none;
}
.qb-doc-name {
  font-weight: 600;
}
.qb-doc-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin: 0.25rem 0;
}
.qb-doc-desc,
.qb-doc-comment,
.qb-doc-count {
  margin: 0.25rem 0;
  font-size: 0.85rem;
}
.qb-doc-comment {
  font-style: italic;
  color: var(--qb-muted);
}
.qb-doc-count {
  color: var(--qb-muted);
}
.qb-doc-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.qb-field-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.35rem;
  border: 1px solid var(--qb-border);
  border-radius: 4px;
  font-size: 0.78rem;
}
.qb-field-type {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--qb-subtle);
}
```

- [ ] **Step 4: Gates + visual check**

Run: `npm run typecheck && npm run lint && npx vitest run` → pass.
Driver into `.superpowers/shots/task11`. Check `11-docs-filter.png`: "DATA DICTIONARY" card with ✕, the search box showing "pressure" and a clear ✕; only groups containing matches are shown, each opened, each showing "N matches"; group names in backend casing with spaces (e.g. "tires wheels"); non-matching items hidden. Also check (copy of the driver or by hand): filter "zzz" shows "No items match “zzz”."; clearing restores all groups, collapsed, with their item counts; the ✕ in the card title closes the panel back to the rail. `page errors: []`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/docsSidebar.ts src/ui/fomantic.ts src/styles.css
git add src/ui/docsSidebar.ts src/ui/fomantic.ts src/styles.css
git commit -m "feat(ui): data dictionary with <details> groups and a filter that opens matching groups

Group names and tags keep the backend's casing (underscores shown as spaces).
The Fomantic accordion is no longer used.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Architecture doc, full verification, push

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: spec status line

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**

1. **Header "Last updated"** — replace the paragraph starting `Last updated: 2026-09-23 — Production-readiness hardening` with:

   ```
   Last updated: 2026-09-23 — UI/UX refresh: dark top bar with workflow steps
   and an account menu; docs folded into a rail; full-width query builder with
   coloured ALL/ANY brackets, joiners, soft hints for unfinished parts and a
   plain-English footer; a pinned slim statistics column; Run moved into the
   "Matching entrysets" card. Request handling is unchanged. See §13.
   ```

2. **§1 "Screen layout"** — replace the diagram and the bullet list under it (up to "### Non-goals") with:

   ````
   ```
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ top bar: Query Builder · ①Filter ②Review ③Approval ④Done · [account ▾]   │
   ├──┬──────────────────────────────────────────────────────┬────────────────┤
   │D │ databases (pill toggles · N of M selected · All/None) │ statistics     │
   │O │ query (recursive ALL/ANY groups as coloured brackets; │ (pinned: live  │
   │C │   plain-English summary in the footer)                │  headline +    │
   │S │ matching entrysets (the Run query button lives here)  │  per database) │
   │› │                                                       │                │
   └──┴──────────────────────────────────────────────────────┴────────────────┘
    ↑ docs rail — opens the data dictionary as a 20rem column (collapsed by default)
   ```

   - **Top bar** — app name, the workflow steps, and the account menu (login +
     compliance acknowledgment).
   - **Docs rail / data dictionary** — generated from `GET /api/individuals`.
     Collapsed to a 28 px rail by default; opens as a column; searchable by item
     and field name.
   - **Main column** — database scope, the query builder (nested ALL/ANY groups,
     any depth, collapsible), and **Matching entrysets**: a sample of matching
     entrysets, fetched only when the user presses **Run query** in that card.
   - **Statistics column** (right, ~15rem) — sticky, so it never scrolls out of
     view while the user builds; refetched live (debounced) whenever the query
     is complete.
   - **Workflow steps** — `Filter | Review | Approval | Done`. Only **Filter** is
     a real view today; the others show a "Coming soon" placeholder. Active step
     lives in `AppState.activeView`.
   ````

3. **§3** — in the `activate()` / `destroy()` code sample, delete the two `.ui.accordion` lines. After the sample add: `Native elements are preferred where they do the job without a plugin: the data dictionary's groups, the entryset rows and the account menu are \`<details>\` elements, and the database toggles are plain checkboxes.`

4. **§4 "Directory layout"**, `ui/` block:
   - `format.ts` → `compact() / exact() / matchRatio() / barWidth() for the stats (billion-row / 1e-10 % scale), plus displayLabel() (backend casing, underscores → spaces), countLabel() and formatWhen().`
   - `layout.ts` → `Renders the shell once (top bar with workflow steps + account slot, docs rail, docs / main / stats columns). Handles docs collapse + active step via classes/attributes, no repaint.`
   - Add `docsFilter.ts     matchDocs(individuals, text) — which data-dictionary items/groups match the filter (pure; unit-tested).`
   - `docsSidebar.ts` → `render for the data dictionary (docs column) — built from state.individuals, NOT state.schema. See §9.`
   - `statsPanel.ts` → `render for the pinned statistics column (data-driven from /api/stats).`
   - `dataPreview.ts` → `render + Run wiring for the "Matching entrysets" card (POST /api/query) — the only Run control. See §9.`
   - Replace the `authStatus.ts` and `complianceStatus.ts` entries with `accountMenu.ts     render + wiring for the top-bar account menu (login + compliance; data-panel="account"). See §9.`

5. **§5 "Who re-renders when"** table:
   - Row "User clicks **Run / Refresh**" → "User clicks **Run query** (in Matching entrysets)", and in its text replace "`dataPreview` repaints" with "`dataPreview` repaints (the card shows a loader instead of the button)" and replace "and scrolls internally" with "and flows with the page".
   - Row "User toggles docs sidebar" → "User opens/closes the docs (rail or ✕)"; text: "`setState({ sidebarCollapsed })` → `layout` toggles one CSS class and the rail's `aria-expanded`. No repaint."
   - Row "User clicks a secondary-menu tab" → "User clicks a workflow step".

6. **§9 Panels** — replace the two subsections "Top menu — `authStatus.ts`" and "Top menu — `complianceStatus.ts`" with:

   ```
   ### Top bar — `accountMenu.ts`

   Its own panel (`data-panel="account"`). Anonymous: a `Log in` button
   (`LOGIN_URL`, a real navigation, `data-flow-link` so the in-progress query is
   saved first). Authenticated: a chip with the user's name and a compliance
   badge (`✓ Compliance` or `Compliance needed`) that opens a native `<details>`
   menu: the compliance reason and when it was given + `Invalidate`, or
   `Start compliance check` (`COMPLIANCE_START_URL`, `data-flow-link`); then
   `Log out`. Outside clicks and Escape close it. **Display only:** Run is never
   gated on it — `main.ts` reacts to a `401`/`403` from `POST /api/query` (§7).
   If `GET /api/auth/me` fails (anything but `200`/`401`) the visitor is treated
   as anonymous and the error is logged.
   ```

   Replace the body of "Centre, above the builder — `databasePicker.ts`" with: `Its own panel (\`data-panel="dbpicker"\`). A card with one pill toggle per \`state.databases\` entry (a native checkbox inside a styled label — no plugin), "N of M selected", and **All** / **None** buttons. Toggling calls \`onDatabasesChange\` in \`main.ts\`, which treats it exactly like a query edit (§6). Zero selected → an amber "Select at least one database." note, and the statistics and Matching entrysets cards explain why they are empty.`

   Rename "Left — `docsSidebar.ts`" to "Left — `docsSidebar.ts` (data dictionary)" and replace its body with: `Built from \`state.individuals\` (GET /api/individuals) — not \`state.schema\`. Hidden behind the docs rail by default (\`sidebarCollapsed\` starts \`true\`); the rail and the card's ✕ both toggle it. One native \`<details>\` per \`group\`, each listing its items: name, tags, \`description\`, italic \`comment\`, "In N entrysets (x%)" (\`matchRatio\` against the sum of every database's \`totalEntrysets\`), and field chips (\`name\`, falling back to \`label\`, + type). Group names and tags are shown in the backend's casing with underscores as spaces (\`displayLabel\`). The search box filters with \`matchDocs\` (item name, field label or name; case-insensitive): matching groups open and show "N matches", other groups and items are hidden, and "No items match …" appears when nothing does. The filter sets \`hidden\`/\`open\` on the painted DOM instead of repainting, so typing keeps focus.`

   In "Centre — `queryBuilder.ts`", replace the "A group = a Fomantic `ui segment`…" bullet with: `A group = a coloured bracket (3 px left border with short top/bottom arms) over a faint tint — blue for ALL (AND), amber for ANY (OR); nested tints stack, and hovering highlights only the innermost group (pure CSS). Header: collapse caret · "Match [ALL | ANY] of the following" · **+ Condition** · **+ Group** · ✕ (not on the root). Between children a small AND/OR joiner sits on the bracket. A collapsed group folds to one line: its \`queryToText\` summary and "N conditions". **+ Group** inserts \`newGroup()\`, which already holds one empty condition.`; replace "Nodes in `state.issues` get a red `ui message` under the row." with `Issues show under their row/group header: \`kind: "incomplete"\` as a quiet grey hint, \`kind: "invalid"\` in red (§11). The card's footer shows the whole query in plain English (\`queryToText\`) once it is complete, otherwise how many parts still need attention. Condition rows are a CSS grid inside a size container: below ~640 px of row width the value and ✕ wrap to a second line.`

   In "Right — `statsPanel.ts`", replace the "Layout, top to bottom:" paragraph's first sentence with: `A ~15rem card, sticky beside the builder. Top to bottom: the headline (big compact sum of \`matchCount\` over the successful lines so far, labelled "matching entrysets", then "ratio of total" and a thin bar), then **By database** — one compact grid row per streamed line: name · bar · ratio (exact figures on hover), or for a failed database its \`errorMessages\` in red with \`infoMessages\` beneath — then, while loading, "Waiting on N more databases…".` and replace "`status` branches: `idle` → hint from §6" with "`status` branches: `idle` → "Counting matches…" (the debounce window)". Delete the sentences about the `.qb-stat-perdb` 45vh scroll region.

   Rename "Bottom — `dataPreview.ts`" to "Main column, under the query — `dataPreview.ts` (Matching entrysets)". Replace its first paragraph ("**Run / Refresh** button …") with: `Owns the app's only **Run query** button. States: query not runnable (no database / no condition / unfinished) → disabled button + the reason; ready (\`preview.status === "idle"\`) → enabled button + an advisory note for anonymous users or missing compliance; loading → loader; error → red message + **Try again**; ok → "Matching entrysets · N" and the list, with no Run button (the card resets to "ready" whenever the query or scope changes, §6, so there is one run per query). \`wireDataPreview\` attaches one delegated click listener that calls \`runPreview()\`.` In the rest of the section replace "(`.qb-entryset-list`, `max-height: 45vh`, same pattern as `.qb-stat-perdb`)" with "(`.qb-entryset-list`, flowing with the page)", and "locale-formatted" with "`formatWhen`, e.g. 7 Nov 2024, 09:15". Delete the sentence "`status: \"idle\"` → hint from §6 (an anonymous visitor sees a login prompt instead of the Run/Refresh hint)."

7. **§11 Error & loading model** — add a bullet: `- Query validation issues come in two kinds (\`Issue.kind\`): \`incomplete\` (something not filled in yet — a grey hint) and \`invalid\` (refers to something that cannot work — red). Both block running; only the display differs.`

8. **§12 Tests** — add bullets: `- \`tests/ui/docsFilter.test.ts\` — data-dictionary filter matching.` and `- \`tests/ui/format.test.ts\` / \`statsPanel.test.ts\` / \`valueControl.test.ts\` — formatting helpers and the few pure render helpers.`

9. **§13 Change log** — append a row:

   ```
   | 2026-09-23 | UI/UX refresh (`docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md`). Layout: dark top bar with workflow steps and an account menu (replaces `authStatus.ts` + `complianceStatus.ts` with `accountMenu.ts`, a native `<details>` menu); docs collapsed into a rail (`sidebarCollapsed` starts `true`); main column stacks databases (pill toggles), the query card and "Matching entrysets"; a pinned ~15rem statistics column. Query builder: ALL/ANY groups as coloured brackets with tint + hover highlight, AND/OR joiners between children, collapsed groups summarised with `queryToText`, a plain-English footer, CSS-grid condition rows with a container query. `Issue.kind` (`incomplete` → grey hint, `invalid` → red); `newGroup()` now holds one empty condition. Run moved from the top bar into the Matching entrysets card (`syncRunButton` removed; `wireDataPreview` added) — request handling unchanged. Data dictionary: `<details>` groups instead of the Fomantic accordion, a filter (`docsFilter.ts`) that opens matching groups, backend casing with underscores as spaces. `format.ts` gains `displayLabel` / `countLabel` / `formatWhen`. |
   ```

10. Finally run `grep -n "syncRunButton\|Run / Refresh\|authStatus\|complianceStatus\|ui accordion\|secondary menu\|secondary-menu" docs/ARCHITECTURE.md`. Every remaining hit must be either inside the §13 change log (history — leave it) or fixed to match the new UI.

- [ ] **Step 2: Mark the spec implemented**

In the spec, change `Status: approved in brainstorming, awaiting written-spec review.` to `Status: approved and implemented (plan: docs/superpowers/plans/2026-09-23-ui-ux-refresh.md).`

- [ ] **Step 3: Full gates**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: all pass; `build` ends with the offline check passing (no off-origin URLs in `dist/`).

- [ ] **Step 4: Final visual pass**

Run the driver into `.superpowers/shots/final` and review all 11+ screenshots against the spec (§3–§7). Confirm `page errors: []`.

- [ ] **Step 5: Commit, push, stop servers**

```bash
npx prettier --write docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git add docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md
git commit -m "docs: ARCHITECTURE.md for the UI/UX refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin claude/frontend-ui-ux-improvements-73afba
```

Stop only the servers this plan started (check each PID's command line points into this worktree before killing it):

```bash
for p in 5199 3001; do
  for pid in $(lsof -ti:$p -sTCP:LISTEN); do
    ps -o args= -p "$pid" | grep -q "frontend-ui-ux-improvements-73afba" && kill "$pid"
  done
done
```

Do **not** open a pull request.
