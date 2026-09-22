# API Types Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the `id`/`label` convention to `label`/`name` across the API contract, delete `StatBlock`, add `IndividualField.name`/`values`, and turn `POST /api/stats` into a streamed, per-database NDJSON response — end to end, frontend and mock backend both.

**Architecture:** `src/api/types.ts` is the single source of truth for the wire contract; every other change in this plan is a mechanical consequence of it. Work proceeds bottom-up: the contract first, then the mock server that implements it, then the frontend consumers, then the orchestration/rendering code that has to become stream-aware, then the living architecture doc.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Node's built-in `http` module (mock server), no framework.

**Spec:** `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md`

## Global Constraints

- Node 20.19+ toolchain floor; do not introduce anything that needs less.
- `tsconfig.json` strict mode — every task must leave `npm run typecheck` cleaner than it found it, and the final task must leave it at zero errors.
- No `jquery` import outside `src/ui/fomantic.ts` (plus the one-line bootstrap in `src/main.ts`).
- `src/**` may not import `mock-server/*`. `mock-server/*` importing a **type only** from `src/api/types.ts` is allowed and already used (e.g. `evaluate.ts`'s old `StatBlock` import) — this plan continues that pattern for `StatsResponse`.
- Vitest unit tests target pure modules only (`src/query/*`, `src/api/*`, `src/state`, `src/util/*`, `mock-server/evaluate` + `index`). Panel/view files (`src/ui/queryBuilder.ts`, `databasePicker.ts`, `docsSidebar.ts`, `statsPanel.ts`, `main.ts`) have no dedicated tests today — this plan does not add any, to stay consistent with the codebase's stated "the view layer is deliberately too thin to be worth DOM testing" position. Those tasks are verified by `npm run typecheck` and a manual `npm run dev` smoke check instead.
- `docs/ARCHITECTURE.md` is a living document — it must be updated in the same overall change as the code (Task 13), per its own header rule.

---

## File Structure

**Contract:**
- Modify: `src/api/types.ts` — the rename, `StatBlock` deletion, `IndividualField.name`/`values`, streamed `StatsResponse`.

**Mock server (implements the contract for `npm run dev`):**
- Modify: `mock-server/vehicleData.ts` — local `IndividualField` gains `name?`/`values?`.
- Modify: `mock-server/schema.ts` — `FieldDef`/`OperatorDef` renamed; `buildFields` gains enum/`values` wiring.
- Modify: `mock-server/databases.ts` — `DatabaseDef` renamed.
- Modify: `mock-server/evaluate.ts` — `StatBlock`/`computeBlocks` deleted; `perDatabaseCounts` renamed; new pure `buildStatsLine`.
- Modify: `mock-server/index.ts` — `/api/schema`, `/api/databases` responses renamed; `/api/stats` becomes an NDJSON stream.
- Modify: `mock-server/data/individual.json` — `vehicle_identity.vehicle_type` gains a `values` array.

**Frontend consumers:**
- Modify: `src/query/summary.ts`, `src/query/validate.ts` — their local schema-shaped types follow the rename.
- Modify: `src/ui/queryBuilder.ts`, `src/ui/databasePicker.ts` — mechanical rename.
- Modify: `src/ui/docsSidebar.ts` — `field.name || field.label` fallback.
- Modify: `src/state.ts` — `AppState.stats` becomes `{ status, lines: StatsResponse[], error }`.
- Modify: `src/api/client.ts` — `getStats` becomes a streaming consumer.
- Modify: `src/main.ts` — stats orchestration becomes stream-aware; `dbResp.databases` rename.
- Modify: `src/ui/statsPanel.ts`, `src/styles.css` — drop `StatBlock` rendering, add per-database success/failure/pending rendering.

**Tests:**
- Modify: `tests/mock-server/schema.test.ts`, `tests/mock-server/databaseCatalog.test.ts`, `tests/mock-server/databases.test.ts`, `tests/mock-server/entrysetsData.test.ts`, `tests/query/summary.test.ts`, `tests/query/validate.test.ts`, `tests/ui/valueControl.test.ts`, `tests/api/client.test.ts`, `tests/state.test.ts`.
- Replace contents of: `tests/mock-server/stats.test.ts` (was `computeBlocks`, becomes `buildStatsLine`).

**Docs:**
- Modify: `docs/ARCHITECTURE.md` — §5, §6, §7, §9, §10, §13.

---

### Task 1: `src/api/types.ts` — the contract

**Files:**
- Modify: `src/api/types.ts`

**Interfaces:**
- Produces: every type every later task depends on — `SchemaResponse` (`fields[].label/name`, `operators[].label/name`), `DatabasesResponse` (`databases[].label/name`), `IndividualField` (`+name?`, `+values?`), `StatsResponse` (discriminated union, one per streamed line), `StatBlock` removed.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/api/types.ts` with:

```ts
export interface SchemaResponse {
  fields: {
    label: string;
    name: string;
    valueType: "string" | "number" | "boolean" | "date" | "enum";
    description: string;
    options?: { value: string; label: string }[];
    operatorIds: string[];
  }[];
  operators: {
    label: string;
    name: string;
    description: string;
    arity: "none" | "one" | "two" | "many";
  }[];
}

/**
 * One database's result from the POST /api/stats stream. The endpoint's
 * response body is newline-delimited JSON: one of these per selected
 * database, written as soon as that database's result is ready — some
 * databases are slower than others, or can fail independently — never one
 * combined response after every database finishes.
 *
 * There is no `name` field: it was already returned once by
 * GET /api/databases and is loaded into AppState.databases at startup, so
 * repeating it on every line would be redundant network traffic — look it up
 * by `label` instead.
 *
 * Discriminated on `success` rather than a `matchCount: 0` sentinel, so a
 * database that couldn't be queried can never be silently misread as "zero
 * rows matched."
 */
export type StatsResponse =
  | {
      label: string; // matches DatabasesResponse.databases[].label
      success: true;
      matchCount: number;
      /** Entrysets in THIS database, regardless of the query. A real per-database
       *  row count — NOT derived from Individual.stats.count, which is a different,
       *  coarser thing: how many entrysets across the WHOLE dataset contain a value
       *  for one particular Individual (item) at all. That says nothing about a
       *  single database's row count, and nothing about a specific IndividualField. */
      totalCount: number;
      /** Non-blocking notices, e.g. "this database is running slower than usual". */
      infoMessages: string[];
    }
  | {
      label: string;
      success: false;
      /** Why the query couldn't be evaluated for this database — a malformed query. */
      validationErrors: string[];
      /** Why the database itself couldn't be reached/handle the request. */
      infoMessages: string[];
    };

/** One field an individual's telemetry item can report (GET /api/individuals). */
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  /** Reserved for a future human-readable name; not populated by the backend
   *  yet. Anywhere this is displayed, fall back to `label` when absent/empty
   *  so the UI already works once the backend starts sending real values. */
  name?: string;
  /** The field's valid values, when it has a fixed domain. Absent = not an enum. */
  values?: string[];
}

/**
 * One item in the vehicle telemetry data model — a signal, sensor, or piece of
 * metadata that an entryset may hold a value for. `stats` is aggregated across
 * the full dataset the server tracks, not just the entrysets it actually
 * returns for browsing/preview.
 */
export interface Individual {
  label: string;
  group: string;
  tags: string[];
  id_number: number;
  name: string;
  description: string;
  comment: string;
  stats: { percentage: number; count: number };
  fields: IndividualField[];
}

export interface IndividualsResponse {
  individuals: Individual[];
}

/**
 * A telemetry entryset: a snapshot of one vehicle event, holding actual values
 * for a subset of the items returned by GET /api/individuals. `items` is keyed
 * by an Individual's `label`; each item's value object is keyed by one of
 * that item's field labels — see docs/ARCHITECTURE.md for the full shape.
 */
export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

/**
 * The entrysets matching the current query, scoped to the selected
 * databases, capped at 25. No pagination.
 */
export interface EntrysetsResponse {
  entrysets: Entryset[];
}

/** The databases the query can be scoped to (GET /api/databases). */
export interface DatabasesResponse {
  databases: { label: string; name: string }[];
}
```

- [ ] **Step 2: Confirm the expected fallout**

Run: `npm run typecheck`
Expected: many errors, across `mock-server/evaluate.ts` (missing `StatBlock`), `src/query/summary.ts`, `src/query/validate.ts`, `src/ui/queryBuilder.ts`, `src/ui/databasePicker.ts`, `src/state.ts`, `src/api/client.ts`, `src/main.ts`, `src/ui/statsPanel.ts`, and several test files. This is the expected starting point — every following task closes off one slice of this list. Do not attempt to fix any of them in this task.

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "refactor(api): rename id/label to label/name, drop StatBlock, stream StatsResponse

BREAKING: src/api/types.ts is the contract; every consumer is fixed up
in the tasks that follow this one."
```

---

### Task 2: Mock schema catalog (`mock-server/vehicleData.ts`, `mock-server/schema.ts`)

**Files:**
- Modify: `mock-server/vehicleData.ts`
- Modify: `mock-server/schema.ts`
- Test: `tests/mock-server/schema.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (this file's local `Individual`/`IndividualField` types are intentionally separate from `src/api/types.ts`, per the frontend/backend decoupling rule).
- Produces: `FieldDef { label, name, valueType, description, options?, operatorIds }`, `OperatorDef { label, name, description, arity }`, `OPERATORS: OperatorDef[]`, `buildFields(individuals): FieldDef[]` — consumed by Task 5 (`index.ts`) and tested in Task 2.

- [ ] **Step 1: Add `name`/`values` to the mock's local `IndividualField`**

In `mock-server/vehicleData.ts`, change:

```ts
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
}
```

to:

```ts
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  name?: string;
  values?: string[];
}
```

- [ ] **Step 2: Write the failing test for enum wiring**

Add to `tests/mock-server/schema.test.ts`, inside the existing `describe("buildFields", ...)` block (after the last `it(...)`, before its closing `});`):

```ts
  it("a field with declared values becomes an enum field with matching options", () => {
    const withValues: Individual[] = [
      {
        ...individuals[1]!,
        fields: [
          { label: "vehicle_type", type: "str", description: "", comment: "", values: ["sedan", "van"] },
        ],
      },
    ];
    const fields = buildFields(withValues);
    const field = fields.find((f) => f.label === "vehicle_identity.vehicle_type");
    expect(field?.valueType).toBe("enum");
    expect(field?.options).toEqual([
      { value: "sedan", label: "sedan" },
      { value: "van", label: "van" },
    ]);
    expect(field?.operatorIds).toEqual(["eq", "neq", "in", "isEmpty", "isNotEmpty"]);
  });

  it("a field with no declared values is never valueType enum", () => {
    const fields = buildFields(individuals);
    expect(fields.every((f) => f.valueType !== "enum")).toBe(true);
  });
```

Also update every existing assertion in that file from `.id`/`.label` (FieldDef's identifier/display fields) to `.label`/`.name`, and from `OPERATORS.map((o) => o.id)` to `.map((o) => o.label)`:

```ts
describe("buildFields", () => {
  it("labels are dotted individualLabel.fieldLabel", () => {
    const fields = buildFields(individuals);
    const labels = fields.map((f) => f.label);
    expect(labels).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps declared types to valueType", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.label === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("name combines the individual's name and the field's label", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.name).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("description falls back to the individual's description when the field's is empty", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.description).toBe(
      "Engine rotational speed.",
    );
    expect(fields.find((f) => f.label === "engine_rpm.redline_rpm")?.description).toBe(
      "Redline for this engine.",
    );
  });

  it("assigns operatorIds per valueType, all of which are real operator labels", () => {
    const fields = buildFields(individuals);
    const opLabels = new Set(OPERATORS.map((o) => o.label));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const label of f.operatorIds) expect(opLabels.has(label)).toBe(true);
    }
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.operatorIds).toEqual([
      "eq",
      "neq",
    ]);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.operatorIds).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
  });
```

Delete the now-redundant `it("any field with valueType enum has options (future-proofing; none exist today)", ...)` test — the two new tests above cover this concretely.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/schema.test.ts`
Expected: FAIL — `buildFields` still returns `id`/`label` (not `label`/`name`), and never produces `valueType: "enum"`.

- [ ] **Step 4: Rewrite `mock-server/schema.ts`**

Replace the `FieldDef`/`OperatorDef` interfaces, the `OPERATORS` array, and `buildFields`:

```ts
export interface FieldDef {
  label: string;
  name: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface OperatorDef {
  label: string;
  name: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: OperatorDef[] = [
  { label: "eq", name: "Equals", description: "The field exactly matches the value.", arity: "one" },
  {
    label: "neq",
    name: "Not equals",
    description: "The field is anything other than the value.",
    arity: "one",
  },
  {
    label: "gt",
    name: "Greater than",
    description: "The field is strictly greater than the value.",
    arity: "one",
  },
  {
    label: "gte",
    name: "Greater than or equal",
    description: "The field is at least the value.",
    arity: "one",
  },
  {
    label: "lt",
    name: "Less than",
    description: "The field is strictly less than the value.",
    arity: "one",
  },
  {
    label: "lte",
    name: "Less than or equal",
    description: "The field is at most the value.",
    arity: "one",
  },
  {
    label: "before",
    name: "Before",
    description: "The date is earlier than the value.",
    arity: "one",
  },
  { label: "after", name: "After", description: "The date is later than the value.", arity: "one" },
  { label: "contains", name: "Contains", description: "The text includes the value.", arity: "one" },
  {
    label: "between",
    name: "Between",
    description: "The field is within the inclusive range [from, to].",
    arity: "two",
  },
  {
    label: "in",
    name: "Is any of",
    description: "The field matches one of several values.",
    arity: "many",
  },
  { label: "isEmpty", name: "Is empty", description: "The field has no value.", arity: "none" },
  { label: "isNotEmpty", name: "Is not empty", description: "The field has a value.", arity: "none" },
];
```

Leave `ValueType`, `Arity`, `OPERATOR_PROFILE`, and `valueTypeFor` untouched — they don't reference `id`/`label`.

Then replace `buildFields`:

```ts
/**
 * One queryable field per (individual, field) pair, derived purely from
 * individual.json's declared shape. Field label is the dotted
 * "individualLabel.fieldLabel" path, matching how an entryset nests its
 * values (see mock-server/rows.ts) so it doubles as the flattened lookup key.
 * A field with a declared `values` list becomes an enum field, with options
 * built directly from that list.
 */
export function buildFields(individuals: Individual[]): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const isEnum = !!f.values && f.values.length > 0;
      const valueType = isEnum ? "enum" : valueTypeFor(f.type);
      fields.push({
        label: `${ind.label}.${f.label}`,
        name: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        options: isEnum ? f.values!.map((v) => ({ value: v, label: v })) : undefined,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return fields;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mock-server/vehicleData.ts mock-server/schema.ts tests/mock-server/schema.test.ts
git commit -m "refactor(mock): rename FieldDef/OperatorDef to label/name, wire enum values"
```

---

### Task 3: Mock database catalog (`mock-server/databases.ts`)

**Files:**
- Modify: `mock-server/databases.ts`
- Test: `tests/mock-server/databaseCatalog.test.ts`

**Interfaces:**
- Produces: `DatabaseDef { label, name, size }`, `DATABASES: DatabaseDef[]`, `dbIndexForEntrysetId(id): number` (unchanged signature), `databaseIdForEntrysetId(id): string` (now returns a database's `label`, same values as before — `"alpha"`, `"beta"`, etc. — only the source field's name changed).

- [ ] **Step 1: Update the test's fixtures and assertions**

In `tests/mock-server/databaseCatalog.test.ts`, change the first test:

```ts
  it("has exactly 7 entries named ALPHA..ETA", () => {
    expect(DATABASES.map((d) => d.name)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
      "DELTA",
      "EPSILON",
      "ZETA",
      "ETA",
    ]);
    expect(DATABASES.map((d) => d.label)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ]);
  });
```

The rest of the file (`dbIndexForEntrysetId`, `databaseIdForEntrysetId` describe blocks) needs no changes — they only assert on the return values of those two functions, which are unchanged strings/indices.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/databaseCatalog.test.ts`
Expected: FAIL — `d.name` is `undefined` on the current `DatabaseDef` shape.

- [ ] **Step 3: Rewrite `mock-server/databases.ts`**

```ts
export interface DatabaseDef {
  label: string;
  name: string;
  /**
   * Mock-only: the pretend real size of this database. Spans several orders
   * of magnitude so the stats panel exercises billion-scale formatting, the
   * same way the old plant-species catalog's sizes did. Not sent on
   * GET /api/databases.
   */
  size: number;
}

/**
 * Seven arbitrary, content-agnostic partitions — database identity carries
 * no meaning tied to entryset content (product decision: "the database
 * names do not really matter"). Sizes are hand-picked constants spanning
 * ~12K to ~5.6B, mirroring the old catalog's spread.
 */
export const DATABASES: DatabaseDef[] = [
  { label: "alpha", name: "ALPHA", size: 12_345 },
  { label: "beta", name: "BETA", size: 88_000 },
  { label: "gamma", name: "GAMMA", size: 4_600_000 },
  { label: "delta", name: "DELTA", size: 41_000_000 },
  { label: "epsilon", name: "EPSILON", size: 892_000_000 },
  { label: "zeta", name: "ZETA", size: 1_234_000_000 },
  { label: "eta", name: "ETA", size: 5_600_000_000 },
];

/**
 * Deterministic partition of an entryset into one of the 7 databases, keyed
 * ONLY by its numeric id — never by anything inside its `items`. This is
 * the decoupling move: a production entryset of the same general shape but
 * completely different field content still partitions correctly, because
 * nothing here looks inside the entryset at all.
 */
export function dbIndexForEntrysetId(entrysetId: number): number {
  return Math.abs(Math.imul(entrysetId, 2654435761)) % DATABASES.length;
}

export function databaseIdForEntrysetId(entrysetId: number): string {
  return DATABASES[dbIndexForEntrysetId(entrysetId)]!.label;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/databaseCatalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mock-server/databases.ts tests/mock-server/databaseCatalog.test.ts
git commit -m "refactor(mock): rename DatabaseDef id/label to label/name"
```

---

### Task 4: `mock-server/evaluate.ts` — drop `StatBlock`, rename `perDatabaseCounts`, add `buildStatsLine`

**Files:**
- Modify: `mock-server/evaluate.ts`
- Test: `tests/mock-server/databases.test.ts` (the `perDatabaseCounts` fixtures — despite its filename, this file tests `evaluate.ts`)
- Test: `tests/mock-server/stats.test.ts` (full replacement — was `computeBlocks`, becomes `buildStatsLine`)

**Interfaces:**
- Consumes: `StatsResponse` from `../src/api/types` (Task 1).
- Produces: `perDatabaseCounts(query, rows, databaseIds): { label: string; matchCount: number; totalCount: number }[]` (renamed field), `buildStatsLine(outcome: DatabaseOutcome): StatsResponse` (new) — consumed by Task 5 (`index.ts`). `matches`, `filterByDatabases`, `scaleCount` are unchanged. `computeBlocks` and the `StatBlock` import are deleted.

- [ ] **Step 1: Update `perDatabaseCounts`'s test fixtures**

In `tests/mock-server/databases.test.ts`, change every `{ id: ... }` in the `perDatabaseCounts` assertions to `{ label: ... }`:

```ts
describe("perDatabaseCounts", () => {
  it("returns match/total per database in the given id order", () => {
    expect(perDatabaseCounts(matchAll, rows, ["beta", "alpha"])).toEqual([
      { label: "beta", matchCount: 1, totalCount: 1 },
      { label: "alpha", matchCount: 2, totalCount: 2 },
    ]);
  });

  it("matchCount reflects the query; totalCount is the whole database", () => {
    expect(perDatabaseCounts(branchesGte10, rows, ["alpha", "beta", "gamma"])).toEqual([
      { label: "alpha", matchCount: 1, totalCount: 2 }, // only branches:30
      { label: "beta", matchCount: 1, totalCount: 1 }, // branches:20
      { label: "gamma", matchCount: 0, totalCount: 1 }, // branches:1
    ]);
  });

  it("an unknown database id yields zero counts", () => {
    expect(perDatabaseCounts(matchAll, rows, ["zeta"])).toEqual([
      { label: "zeta", matchCount: 0, totalCount: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Replace `tests/mock-server/stats.test.ts` entirely**

```ts
import { describe, it, expect } from "vitest";
import { buildStatsLine } from "../../mock-server/evaluate";

describe("buildStatsLine", () => {
  it("builds a successful line from match/total counts", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3, totalCount: 10 })).toEqual({
      label: "alpha",
      success: true,
      matchCount: 3,
      totalCount: 10,
      infoMessages: [],
    });
  });

  it("carries through infoMessages on a successful line", () => {
    expect(
      buildStatsLine({ label: "alpha", matchCount: 3, totalCount: 10, infoMessages: ["slow"] }),
    ).toMatchObject({ success: true, infoMessages: ["slow"] });
  });

  it("builds a failure line when fail is given, ignoring matchCount/totalCount", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999,
      totalCount: 999,
      fail: { validationErrors: ["bad field"], infoMessages: [] },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      validationErrors: ["bad field"],
      infoMessages: [],
    });
  });
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts`
Expected: FAIL — `perDatabaseCounts` still returns `id`; `buildStatsLine` doesn't exist yet.

- [ ] **Step 4: Update `mock-server/evaluate.ts`**

Remove the `StatBlock` import (line 2: `import type { StatBlock } from "../src/api/types";`) and replace it with:

```ts
import type { StatsResponse } from "../src/api/types";
```

Replace `perDatabaseCounts`:

```ts
/**
 * Per-database match / total counts, in the given id order. Counts only — a real
 * backend does this as `COUNT(*) ... GROUP BY database`, cheap at any scale.
 */
export function perDatabaseCounts(
  query: JsonNode,
  rows: Row[],
  databaseIds: string[],
): { label: string; matchCount: number; totalCount: number }[] {
  return databaseIds.map((label) => {
    const inDb = rows.filter((r) => String(r.__db) === label);
    return {
      label,
      totalCount: inDb.length,
      matchCount: inDb.filter((r) => matches(query, r)).length,
    };
  });
}
```

Delete `referencedFieldIds` and `computeBlocks` entirely (nothing else in this file uses `referencedFieldIds`), and add `buildStatsLine` in their place:

```ts
export interface DatabaseOutcome {
  label: string;
  matchCount: number;
  totalCount: number;
  infoMessages?: string[];
  /** When set, this database's line reports failure instead of counts. */
  fail?: { validationErrors: string[]; infoMessages: string[] };
}

/** Turns one database's raw outcome into the StatsResponse line /api/stats streams for it. */
export function buildStatsLine(outcome: DatabaseOutcome): StatsResponse {
  if (outcome.fail) {
    return {
      label: outcome.label,
      success: false,
      validationErrors: outcome.fail.validationErrors,
      infoMessages: outcome.fail.infoMessages,
    };
  }
  return {
    label: outcome.label,
    success: true,
    matchCount: outcome.matchCount,
    totalCount: outcome.totalCount,
    infoMessages: outcome.infoMessages ?? [],
  };
}
```

Leave `matches`, `conditionMatches`, `cmp`, `filterByDatabases`, `scaleCount`, and the `Row`/`JsonCondition`/`JsonGroup`/`JsonNode` types untouched. Also remove the now-unused `import type { FieldDef } from "./schema";` at the top of the file (it was only used by `computeBlocks`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add mock-server/evaluate.ts tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts
git commit -m "refactor(mock): drop StatBlock/computeBlocks, rename perDatabaseCounts, add buildStatsLine"
```

---

### Task 5: `mock-server/index.ts` — renamed responses, streaming `/api/stats`

**Files:**
- Modify: `mock-server/index.ts`

**Interfaces:**
- Consumes: `FIELDS`/`OPERATORS` (Task 2), `DATABASES` (Task 3), `perDatabaseCounts`/`buildStatsLine`/`scaleCount` (Task 4).
- No dedicated test — `mock-server/index.ts`'s route handlers are not unit-tested today (only `paginate` is, in `tests/mock-server/query.test.ts`, which needs no changes). Verified by running the server manually (Step 3) and by the full-suite/typecheck checks in Task 14.

- [ ] **Step 1: Update `/api/schema` and `/api/databases`**

In the `GET /api/databases` handler, change:

```ts
      // `size` is mock-internal (drives the reported magnitudes) — not part of the contract.
      sendJson(res, 200, { databases: DATABASES.map(({ id, label }) => ({ id, label })) });
```

to:

```ts
      // `size` is mock-internal (drives the reported magnitudes) — not part of the contract.
      sendJson(res, 200, { databases: DATABASES.map(({ label, name }) => ({ label, name })) });
```

`GET /api/schema`'s `sendJson(res, 200, { fields: FIELDS, operators: OPERATORS });` needs no change — `FIELDS`/`OPERATORS` already carry the new shape from Task 2.

- [ ] **Step 2: Rewrite the `/api/stats` handler to stream NDJSON**

Replace the whole `if (req.method === "POST" && url.pathname === "/api/stats") { ... }` block with:

```ts
    if (req.method === "POST" && url.pathname === "/api/stats") {
      const body = (await readJson(req)) as { query?: JsonNode; databases?: string[] };
      if (badQuery(body)) {
        sendJson(res, 400, { error: "Body must include a `query` tree." });
        return;
      }
      if (badDatabases(body)) {
        sendJson(res, 400, { error: "Select at least one database." });
        return;
      }
      const query = body.query as JsonNode;
      const ids = body.databases as string[];

      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
      const counts = perDatabaseCounts(query, ROWS, ids);
      for (const c of counts) {
        const db = DATABASES.find((d) => d.label === c.label);
        const size = db?.size ?? 0;
        // Dev-only: occasionally simulate a database that can't answer, so the
        // UI's per-database failure path gets exercised without a real backend.
        const line = buildStatsLine(
          Math.random() < 0.05
            ? {
                label: c.label,
                matchCount: 0,
                totalCount: 0,
                fail: {
                  validationErrors: [],
                  infoMessages: ["This database could not be reached. Try again shortly."],
                },
              }
            : {
                label: c.label,
                // The sample drives match RATES; DATABASES[].size drives the
                // MAGNITUDE the API reports, so the UI sees realistic large numbers.
                matchCount: scaleCount(c.matchCount, c.totalCount, size),
                totalCount: size,
              },
        );
        res.write(JSON.stringify(line) + "\n");
        await delay(150 + Math.random() * 250); // visibly stream in dev
      }
      res.end();
      return;
    }
```

Add the small local delay helper near the top of the file (after the `PORT` constant is fine):

```ts
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Update the imports at the top of the file: remove `computeBlocks` from the `./evaluate` import and add `buildStatsLine`:

```ts
import {
  matches,
  buildStatsLine,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
} from "./evaluate";
```

- [ ] **Step 3: Manually verify the stream**

Run: `npm run mock` (in one terminal), then in another:
```bash
curl -N -X POST http://localhost:3001/api/stats \
  -H 'content-type: application/json' \
  -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha","beta"]}'
```
Expected: two JSON lines print one at a time (not all at once), each matching the `StatsResponse` shape from Task 1 — either `{"label":"alpha","success":true,"matchCount":...,"totalCount":...,"infoMessages":[]}` or the `success:false` shape, roughly 5% of the time. Stop the mock server (Ctrl+C) when done.

- [ ] **Step 4: Run the full test suite to confirm nothing else broke**

Run: `npx vitest run tests/mock-server/`
Expected: PASS (all mock-server tests, including the untouched `query.test.ts`, `rows.test.ts`, `evaluate.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add mock-server/index.ts
git commit -m "feat(mock): stream /api/stats as NDJSON, rename schema/databases fields"
```

---

### Task 6: Sample data — `vehicle_type` becomes a declared enum

**Files:**
- Modify: `mock-server/data/individual.json`
- Test: `tests/mock-server/entrysetsData.test.ts`

**Interfaces:**
- Produces: `individual.json`'s `vehicle_identity.vehicle_type` field gains a `values` array, which Task 2's `buildFields` (already implemented) turns into an enum field with real dropdown options in the running app.

- [ ] **Step 1: Write the failing test**

Add to `tests/mock-server/entrysetsData.test.ts`, inside the `describe("entrysets.json sample data", ...)` block:

```ts
  it("vehicle_identity.vehicle_type declares values covering every value used in the sample data", () => {
    const vehicleIdentity = individualsByLabel.get("vehicle_identity")!;
    const vehicleType = vehicleIdentity.fields.find((f) => f.label === "vehicle_type") as
      | { values?: string[] }
      | undefined;
    expect(vehicleType?.values?.length).toBeGreaterThan(0);
    const declared = new Set(vehicleType!.values);
    const used = new Set(
      Object.values(entrysets)
        .map((e) => e.items.vehicle_identity?.vehicle_type)
        .filter((v): v is string => typeof v === "string"),
    );
    for (const v of used) expect(declared.has(v)).toBe(true);
  });
```

Also add `values?: string[]` to the file's local `IndividualField` interface so the cast at the top of the test compiles:

```ts
interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  values?: string[];
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: FAIL — `vehicleType?.values` is `undefined`.

- [ ] **Step 3: Add `values` to the data file**

In `mock-server/data/individual.json`, find the `vehicle_identity` wrapper's `fields` array and change the `vehicle_type` entry from:

```json
      {
        "label": "vehicle_type",
        "type": "str",
        "description": "",
        "comment": ""
      }
```

to:

```json
      {
        "label": "vehicle_type",
        "type": "str",
        "description": "",
        "comment": "",
        "values": [
          "sedan",
          "electric_sedan",
          "delivery_van",
          "semi_truck",
          "box_truck",
          "light_truck",
          "dump_truck",
          "garbage_truck",
          "tow_truck",
          "motorcycle",
          "transit_bus",
          "school_bus",
          "farm_tractor",
          "ambulance",
          "police_cruiser",
          "taxi",
          "rideshare_sedan",
          "rideshare_ev",
          "rental_car"
        ]
      }
```

(This is exactly the set of `vehicle_type` values already used across the 21 sample entrysets — found by inspecting `entrysets.json`; the test above locks that invariant in.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mock-server/data/individual.json tests/mock-server/entrysetsData.test.ts
git commit -m "feat(mock): declare vehicle_type's values, exercising the new enum-field path"
```

---

### Task 7: `src/query/summary.ts` + `src/query/validate.ts` — schema-shape rename

**Files:**
- Modify: `src/query/summary.ts`
- Modify: `src/query/validate.ts`
- Test: `tests/query/summary.test.ts`
- Test: `tests/query/validate.test.ts`

**Interfaces:**
- Consumes: `SchemaResponse.fields`/`operators` (Task 1) — `main.ts` passes these directly into `validateQuery`/`queryToText`, so `SummarySchema`/`ValidationSchema` must structurally match the new shape.
- Produces: `queryToText(tree, schema): string` (unchanged signature; internals now read `.label`/`.name`), `validateQuery(tree, schema): Issue[]` (unchanged signature; internals now read `.label`).

- [ ] **Step 1: Update the tests' fixtures**

In `tests/query/validate.test.ts`, change the `schema` fixture's `id` keys to `label`:

```ts
const schema = {
  fields: [
    { label: "species", valueType: "enum", operatorIds: ["eq", "in", "isEmpty"] },
    { label: "branches", valueType: "number", operatorIds: ["eq", "between", "isEmpty"] },
  ],
  operators: [
    { label: "eq", arity: "one" as const },
    { label: "between", arity: "two" as const },
    { label: "in", arity: "many" as const },
    { label: "isEmpty", arity: "none" as const },
  ],
};
```

(The rest of the file references `fieldId`/`operatorId` values like `"species"`/`"eq"` on conditions, which are unaffected — only the schema-side key changed.)

In `tests/query/summary.test.ts`, change the `schema` fixture's `id`/`label` to `label`/`name`:

```ts
const schema = {
  fields: [
    { label: "heightCm", name: "Height (cm)" },
    { label: "foliage", name: "Has foliage" },
    {
      label: "species",
      name: "Species",
      options: [
        { value: "oak", label: "Oak" },
        { value: "fern", label: "Fern" },
      ],
    },
  ],
  operators: [
    { label: "gte", name: "≥", arity: "one" as const },
    { label: "eq", name: "is", arity: "one" as const },
    { label: "in", name: "is any of", arity: "many" as const },
    { label: "isEmpty", name: "is empty", arity: "none" as const },
  ],
};
```

Note `options`' `{ value, label }` pairs are untouched — that shape didn't change (Task 1, §2 of the spec).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query/summary.test.ts tests/query/validate.test.ts`
Expected: FAIL — `validate.ts`/`summary.ts` still look for `.id`, which the fixtures no longer have.

- [ ] **Step 3: Update `src/query/validate.ts`**

Change `ValidationSchema` and the one lookup that uses it:

```ts
export interface ValidationSchema {
  fields: { label: string; valueType: string; operatorIds: string[] }[];
  operators: { label: string; arity: "none" | "one" | "two" | "many" }[];
}
```

```ts
  const fieldDef = schema.fields.find((f) => f.label === c.fieldId);
```

```ts
  const op = schema.operators.find((o) => o.label === c.operatorId);
```

- [ ] **Step 4: Update `src/query/summary.ts`**

```ts
export interface SummarySchema {
  fields: { label: string; name: string; options?: { value: string; label: string }[] }[];
  operators: { label: string; name: string; arity: "none" | "one" | "two" | "many" }[];
}

function optionLabel(schema: SummarySchema, fieldId: string | null, raw: unknown): string {
  const field = schema.fields.find((f) => f.label === fieldId);
  const opt = field?.options?.find((o) => o.value === raw);
  if (opt) return opt.label;
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}
```

```ts
function conditionText(schema: SummarySchema, c: Condition): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const op = schema.operators.find((o) => o.label === c.operatorId);
  const parts = [field?.name ?? "(field?)", op?.name ?? "(operator?)"];
  const val = op ? formatValue(schema, c, op.arity) : "";
  if (val) parts.push(val);
  return parts.join(" ");
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/query/summary.test.ts tests/query/validate.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/query/summary.ts src/query/validate.ts tests/query/summary.test.ts tests/query/validate.test.ts
git commit -m "refactor(query): follow the id/label -> label/name rename in schema-shaped types"
```

---

### Task 8: Frontend UI rename sweep (`queryBuilder.ts`, `databasePicker.ts`, `docsSidebar.ts`)

**Files:**
- Modify: `src/ui/queryBuilder.ts`
- Modify: `src/ui/databasePicker.ts`
- Modify: `src/ui/docsSidebar.ts`
- Test: `tests/ui/valueControl.test.ts` (fixture only — `valueControl.ts` itself needs no source change)

**Interfaces:**
- Consumes: `SchemaResponse`/`DatabasesResponse`/`IndividualField` (Task 1).
- No behavior change intended beyond the rename and the `IndividualField.name` fallback — verified by `npm run typecheck` (no dedicated test files for these three panels, per the Global Constraints note) plus a manual `npm run dev` smoke check.

- [ ] **Step 1: Fix `tests/ui/valueControl.test.ts`'s fixtures**

`renderValueControl`/`defaultValueFor` themselves never reference `.id`/`.label` (only `valueType`/`options`/`arity`), so only the test's local `field()`/`op()` builders need updating:

```ts
function field(overrides: Partial<Field> = {}): Field {
  return {
    label: "f",
    name: "F",
    valueType: "string",
    description: "",
    operatorIds: [],
    ...overrides,
  };
}

function op(arity: Operator["arity"]): Operator {
  return { label: "o", name: "O", description: "", arity };
}
```

Run: `npx vitest run tests/ui/valueControl.test.ts`
Expected: PASS (this file alone was already broken by Task 1's typecheck fallout, not by any logic change — confirm it's clean before moving on).

- [ ] **Step 2: Rewrite `src/ui/queryBuilder.ts`'s field/operator lookups**

In `fieldDropdown`:

```ts
function fieldDropdown(schema: SchemaResponse, c: Condition): string {
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
```

In `operatorDropdown`:

```ts
function operatorDropdown(schema: SchemaResponse, c: Condition): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const ops = field
    ? field.operatorIds
        .map((label) => schema.operators.find((o) => o.label === label))
        .filter((o): o is SchemaResponse["operators"][number] => o !== undefined)
    : [];
  const opts = optionsHtml(
    ops,
    (o) => o.label,
    (o) => o.name,
    (o) => o.label === c.operatorId,
  );
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}>
    <option value="">Operator…</option>${opts}</select>`;
}
```

In `conditionHtml`:

```ts
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const operator = schema.operators.find((o) => o.label === c.operatorId);
```

In `handleRowChange`:

```ts
    const field = schemaRef?.fields.find((f) => f.label === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.label === newOperatorId);
    const oldOperator = schemaRef?.operators.find((o) => o.label === cond.operatorId);
```

(`individualDropdown` already uses `ind.label`/`ind.name` — that's `Individual`, untouched by this rename, no change needed there.)

- [ ] **Step 3: Rewrite `src/ui/databasePicker.ts`'s field references**

```ts
  const boxes = state.databases
    .map(
      (d) => `<div class="inline field" style="margin:0 1rem .25rem 0">
        <div class="ui checkbox">
          <input type="checkbox" data-db-id="${escapeHtml(d.label)}"${selected.has(d.label) ? " checked" : ""} />
          <label>${escapeHtml(d.name)}</label>
        </div>
      </div>`,
    )
    .join("");
```

- [ ] **Step 4: Add the `name || label` fallback to `src/ui/docsSidebar.ts`**

In `itemHtml`, change:

```ts
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type)}</span>`,
    )
    .join(" ");
```

to:

```ts
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.name || f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type)}</span>`,
    )
    .join(" ");
```

- [ ] **Step 5: Typecheck the three files**

Run: `npx tsc --noEmit`
Expected: no more errors reported against `src/ui/queryBuilder.ts`, `src/ui/databasePicker.ts`, or `src/ui/docsSidebar.ts`. (Other files still error out — that's fine, later tasks close those.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/queryBuilder.ts src/ui/databasePicker.ts src/ui/docsSidebar.ts tests/ui/valueControl.test.ts
git commit -m "refactor(ui): follow the id/label -> label/name rename; docs sidebar falls back to field.label"
```

---

### Task 9: `src/state.ts` — `AppState.stats` becomes a streamed-lines accumulator

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `StatsResponse` (Task 1).
- Produces: `AppState.stats: { status: AsyncStatus; lines: StatsResponse[]; error: string | null }` — consumed by Task 11 (`main.ts`) and Task 12 (`statsPanel.ts`).

- [ ] **Step 1: Check the existing test still describes the shape correctly**

`tests/state.test.ts` only asserts `initialState.stats.status === "idle"` — it never touches `.data`/`.lines`, so no test edits are needed here. Run it now to see the current (passing, pre-change) baseline:

Run: `npx vitest run tests/state.test.ts`
Expected: PASS (this confirms the test doesn't need modification; the shape change is exercised indirectly through `initialState`)

- [ ] **Step 2: Update `src/state.ts`**

```ts
  stats: { status: AsyncStatus; lines: StatsResponse[]; error: string | null };
```

```ts
  stats: { status: "idle", lines: [], error: null },
```

- [ ] **Step 3: Run the test to confirm it still passes**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/state.ts
git commit -m "refactor(state): AppState.stats holds accumulated streamed StatsResponse lines"
```

---

### Task 10: `src/api/client.ts` — streaming `getStats`

**Files:**
- Modify: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `StatsResponse` (Task 1).
- Produces: `getStats(query: QueryNode, databases: string[], onLine: (line: StatsResponse) => void): Promise<void>` — the `Promise` resolves once the stream ends, rejects on a non-2xx response (before any line is read). Consumed by Task 11 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Replace the existing `getStats` test and add streaming coverage in `tests/api/client.test.ts`. First, add a stream-mocking helper next to `mockFetchOnce`:

```ts
function mockStreamFetch(status: number, chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "STATUS",
    body,
    json: async () => ({}),
  } as unknown as Response);
}
```

Replace the existing `it("getStats POSTs the query tree + selected databases as JSON", ...)` test with:

```ts
  it("getStats POSTs the query tree + selected databases as JSON", async () => {
    const f = mockStreamFetch(200, [""]);
    vi.stubGlobal("fetch", f);
    const q = emptyQuery();
    await getStats(q, ["fern", "oak"], () => {});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      query: JSON.parse(JSON.stringify(q)),
      databases: ["fern", "oak"],
    });
  });

  it("getStats streams NDJSON lines, calling onLine once per line, even split across chunks", async () => {
    const lines = [
      { label: "alpha", success: true, matchCount: 1, totalCount: 2, infoMessages: [] },
      { label: "beta", success: false, validationErrors: ["bad query"], infoMessages: [] },
    ];
    const ndjson = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const splitAt = ndjson.indexOf("\n") + 3; // cut mid-way into the second line
    const f = mockStreamFetch(200, [ndjson.slice(0, splitAt), ndjson.slice(splitAt)]);
    vi.stubGlobal("fetch", f);
    const received: unknown[] = [];
    await getStats(emptyQuery(), ["alpha", "beta"], (line) => received.push(line));
    expect(received).toEqual(lines);
  });

  it("getStats throws the server's error message on non-2xx and never calls onLine", async () => {
    const f = mockFetchOnce(400, { error: "bad query tree" });
    vi.stubGlobal("fetch", f);
    const onLine = vi.fn();
    await expect(getStats(emptyQuery(), ["fern"], onLine)).rejects.toThrow("bad query tree");
    expect(onLine).not.toHaveBeenCalled();
  });
```

Delete the old `it("throws the server's error message on non-2xx", ...)` test that called `getStats` with the pre-streaming signature (the new test above replaces it with the same assertion under the new signature) — leave the `getSchema`-based one (`falls back to status text when there is no error field`) alone, it's unaffected.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `getStats` still takes 2 arguments and returns `Promise<StatsResponse>`.

- [ ] **Step 3: Rewrite `src/api/client.ts`**

```ts
import type { QueryNode } from "../query/types";
import type {
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function errorFromResponse(res: Response): Promise<Error> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* keep the status-line message */
  }
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

export function getSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/schema");
}

export function getDatabases(): Promise<DatabasesResponse> {
  return request<DatabasesResponse>("/databases");
}

export function getIndividuals(): Promise<IndividualsResponse> {
  return request<IndividualsResponse>("/individuals");
}

/**
 * POST /api/stats streams newline-delimited JSON: one StatsResponse per
 * selected database, as soon as that database's result is ready. `onLine` is
 * called once per line, in arrival order; the returned promise resolves when
 * the stream ends, or rejects (before any line is read) on a non-2xx response.
 */
export async function getStats(
  query: QueryNode,
  databases: string[],
  onLine: (line: StatsResponse) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/stats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, databases }),
  });
  if (!res.ok) throw await errorFromResponse(res);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onLine(JSON.parse(line) as StatsResponse);
    }
  }
  const rest = buffer.trim();
  if (rest) onLine(JSON.parse(rest) as StatsResponse);
}

export function runQuery(
  query: QueryNode,
  databases: string[],
  page: number,
  pageSize: number,
): Promise<EntrysetsResponse> {
  return request<EntrysetsResponse>("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, databases, page, pageSize }),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts tests/api/client.test.ts
git commit -m "feat(client): getStats consumes the NDJSON stats stream via an onLine callback"
```

---

### Task 11: `src/main.ts` — stream-aware stats orchestration

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `getStats(query, databases, onLine)` (Task 10), `AppState.stats` (Task 9), `DatabasesResponse.databases[].label` (Task 1).
- No dedicated test (`main.ts` has none today). Verified by `npm run typecheck` and a manual `npm run dev` smoke check (Step 4).

- [ ] **Step 1: Factor out the shared stale-guard check**

Add this helper right after `requestKey`'s definition:

```ts
/** A closure over the query/scope a request was made for — call it after the
 * request settles (or after each streamed line) to check whether the user has
 * since changed the query/scope, per §6's stale-response guard. */
function staleGuard(query: QueryNode, databases: string[]): () => boolean {
  const key = requestKey(query, databases);
  return () => key !== requestKey(store.getState().query, store.getState().selectedDatabaseIds);
}
```

- [ ] **Step 2: Rewrite `runGuarded` to use it**

```ts
function runGuarded<T>(
  fetcher: (query: QueryNode, databases: string[]) => Promise<T>,
  onLoading: () => void,
  onSuccess: (data: T) => void,
  onError: (message: string) => void,
): void {
  const state = store.getState();
  if (!canRunQuery(state)) return;
  const { query, selectedDatabaseIds } = state;
  const isStale = staleGuard(query, selectedDatabaseIds);
  onLoading();
  fetcher(query, selectedDatabaseIds)
    .then((data) => {
      if (!isStale()) onSuccess(data);
    })
    .catch((err) => {
      if (!isStale()) onError(errorMessage(err));
    });
}
```

- [ ] **Step 3: Rewrite `refreshStats` to accumulate streamed lines**

```ts
const refreshStats = debounce(() => {
  const state = store.getState();
  if (!canRunQuery(state)) return;
  const { query, selectedDatabaseIds } = state;
  const isStale = staleGuard(query, selectedDatabaseIds);
  store.setState({ stats: { status: "loading", lines: [], error: null } });
  getStats(query, selectedDatabaseIds, (line) => {
    if (isStale()) return;
    store.setState({
      stats: { status: "loading", lines: [...store.getState().stats.lines, line], error: null },
    });
  })
    .then(() => {
      if (isStale()) return;
      store.setState({ stats: { status: "ok", lines: store.getState().stats.lines, error: null } });
    })
    .catch((err) => {
      if (isStale()) return;
      store.setState({ stats: { status: "error", lines: [], error: errorMessage(err) } });
    });
}, 400);
```

- [ ] **Step 4: Update the two `stats` reset sites and the databases-load mapping**

In `onQueryChange`:

```ts
  store.setState({
    query: nextQuery,
    issues,
    stats: { status: "idle", lines: [], error: null },
    preview: { status: "idle", data: null, error: null },
  });
```

In `onDatabasesChange`:

```ts
  store.setState({
    selectedDatabaseIds: nextIds,
    stats: { status: "idle", lines: [], error: null },
    preview: { status: "idle", data: null, error: null },
  });
```

In the startup `Promise.all([...]).then(([schema, dbResp, individuals]) => { ... })` block, change:

```ts
      selectedDatabaseIds: dbResp.databases.map((d) => d.id),
```

to:

```ts
      selectedDatabaseIds: dbResp.databases.map((d) => d.label),
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open the app, select a couple of databases, build a valid query with at least one condition.
Expected: the stats panel's headline and "By database" rows fill in progressively (not all at once) as the mock server's artificial per-database delay elapses; editing the query or toggling a database mid-stream clears the panel back to idle/loading rather than showing a mix of old and new lines.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/main.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): accumulate streamed stats lines with the existing stale-response guard"
```

---

### Task 12: `src/ui/statsPanel.ts` + `src/styles.css` — render the stream

**Files:**
- Modify: `src/ui/statsPanel.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `AppState.stats.lines: StatsResponse[]` (Task 9), `AppState.databases: DatabasesResponse["databases"]` (Task 1, for the `label` → `name` lookup).
- No dedicated test (no panel files have one today, per Global Constraints). Verified by `npm run typecheck` plus the manual `npm run dev` check in Step 3 (which now also covers this task's rendering, on top of Task 11's orchestration).

- [ ] **Step 1: Rewrite `src/ui/statsPanel.ts`**

Replace the entire file:

```ts
import type { AppState } from "../state";
import type { DatabasesResponse, StatsResponse } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, exact, matchRatio } from "./format";

function hint(text: string): string {
  return `<div class="ui info message">${escapeHtml(text)}</div>`;
}

/** GET /api/databases is loaded once into AppState.databases; a stats line only
 * carries a `label`, so its display name is looked up here rather than resent
 * on every line (see StatsResponse's docstring in src/api/types.ts). */
function nameFor(databases: DatabasesResponse["databases"] | null, label: string): string {
  return databases?.find((d) => d.label === label)?.name ?? label;
}

function successRowHtml(line: Extract<StatsResponse, { success: true }>, name: string): string {
  const info = line.infoMessages.length
    ? `<div class="ui small text">${line.infoMessages.map(escapeHtml).join(" · ")}</div>`
    : "";
  return `<div class="item" title="${escapeHtml(exact(line.matchCount))} of ${escapeHtml(exact(line.totalCount))}">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="qb-db-nums">${escapeHtml(compact(line.matchCount))} / ${escapeHtml(compact(line.totalCount))} · ${escapeHtml(matchRatio(line.matchCount, line.totalCount))}</div>
    <div class="ui tiny progress" style="margin:.1rem 0 0">
      <div class="bar" style="width:${barWidth(line.matchCount, line.totalCount)}"></div>
    </div>
    ${info}
  </div>`;
}

function failureRowHtml(line: Extract<StatsResponse, { success: false }>, name: string): string {
  const messages = [...line.validationErrors, ...line.infoMessages];
  return `<div class="item">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="ui negative small text">${messages.length ? messages.map(escapeHtml).join(" · ") : "Failed."}</div>
  </div>`;
}

/** One row per database that has reported so far — success (counts), failure
 * (validationErrors/infoMessages), shown as each streamed line arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<div class="ui segment">
    <h5 class="ui header">By database</h5>
    <div class="ui relaxed list qb-stat-perdb">
      ${lines
        .map((line) => {
          const name = nameFor(state.databases, line.label);
          return line.success ? successRowHtml(line, name) : failureRowHtml(line, name);
        })
        .join("")}
    </div>
  </div>`;
}

function headlineHtml(lines: StatsResponse[]): string {
  const successes = lines.filter(
    (l): l is Extract<StatsResponse, { success: true }> => l.success,
  );
  const matchCount = successes.reduce((s, l) => s + l.matchCount, 0);
  const totalCount = successes.reduce((s, l) => s + l.totalCount, 0);
  return `<div class="ui segment">
    <div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(totalCount))}">
      <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
      <span class="qb-stat-sub">of ${escapeHtml(compact(totalCount))} · ${escapeHtml(matchRatio(matchCount, totalCount))}</span>
    </div>
    <div class="ui tiny progress" style="margin:.35rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, totalCount)}"></div>
    </div>
  </div>`;
}

/** While loading, how many selected databases haven't reported a line yet. */
function pendingHtml(state: AppState): string {
  if (state.stats.status !== "loading") return "";
  const remaining = state.selectedDatabaseIds.length - state.stats.lines.length;
  if (remaining <= 0) return "";
  return `<div class="ui segment"><div class="ui active inline loader tiny"></div> Waiting on ${remaining} more database${remaining === 1 ? "" : "s"}…</div>`;
}

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Select at least one database to see statistics.")}`,
    );
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, `<h4 class="ui header">Statistics</h4>${hint("Add a condition to see statistics.")}`);
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Fix the errors in your query to see statistics.")}`,
    );
    return;
  }
  const { status, lines, error } = state.stats;
  if (status === "idle") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Finish the query to see statistics.")}`,
    );
    return;
  }
  if (status === "error") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui negative message"><div class="header">Statistics failed</div><p>${escapeHtml(error ?? "")}</p></div>`,
    );
    return;
  }
  // Order matters: the combined headline stays pinned at the top; the
  // per-database list — the only dynamic content left once StatBlock is gone —
  // scrolls internally via .qb-stat-perdb. See src/styles.css.
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     ${headlineHtml(lines)}
     ${perDatabaseHtml(state)}
     ${pendingHtml(state)}`,
  );
}
```

Note the behavior change from before: the "By database" segment is no longer skipped for a single selected database — with streaming, even one database's line can carry a failure or an info message the headline can't express, so it's always worth showing once at least one line has arrived.

- [ ] **Step 2: Update `src/styles.css`**

Replace:

```css
/* Per-field blocks grow with the query; keep them from pushing "By database"
   off screen by giving the list its own scroll region. */
.qb-stat-blocks {
  max-height: 45vh;
  overflow-y: auto;
}
```

with:

```css
/* The per-database list is the stats panel's only dynamic content now that
   StatBlock is gone; give it its own scroll region the same way the entryset
   list below has one. */
.qb-stat-perdb {
  max-height: 45vh;
  overflow-y: auto;
}
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` (if not already running from Task 11), reload, build a valid query with 3+ selected databases.
Expected: headline + per-database list render and update live; a database that streams back `success: false` (roughly 1 in 20, per Task 5's simulated failure rate — rerun the query a few times if none show up) renders a red message instead of counts, without breaking the other rows; no `.qb-stat-blocks` element exists anymore (check via browser dev tools if unsure).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/statsPanel.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/statsPanel.ts src/styles.css
git commit -m "feat(ui): render streamed per-database stats with success/failure/pending states"
```

---

### Task 13: `docs/ARCHITECTURE.md` — bring the living doc current

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: §5 — `AppState.stats` type and the render-loop table**

Change:

```ts
  stats: {
    status: "idle" | "loading" | "ok" | "error";
    data: StatsResponse | null;
    error: string | null;
  };
```

to:

```ts
  stats: {
    status: "idle" | "loading" | "ok" | "error";
    lines: StatsResponse[];   // one entry per database that has reported so far (streamed)
    error: string | null;
  };
```

Change the render-loop table row:

```
| `getStats()` resolves/rejects | stale-response guard (below); if current, `setState({ stats })` → **only** `statsPanel` repaints. |
```

to:

```
| `getStats()` reports a streamed line | stale-response guard (below); if current, appended to `stats.lines` via `setState` → **only** `statsPanel` repaints, showing partial results while more lines are still arriving. When the stream ends, `status` becomes `ok`; a non-2xx response instead sets `status: "error"`. |
```

- [ ] **Step 2: §6 — correctness invariant, note that partial-but-current is not stale**

After the existing "Stale-response guard" bullet, add:

> **Streaming and "never stale" are compatible.** While `stats.status` is `"loading"`, `stats.lines` legitimately holds fewer entries than `selectedDatabaseIds` — that's a query result still arriving, not a stale one. The invariant this section protects is that every line in `stats.lines` belongs to the `(query, selectedDatabaseIds)` pair currently on screen; the stale-response guard is checked once per streamed line (not just once per request), so a line that arrives after the user has changed the query/scope is discarded before it reaches `AppState`.

- [ ] **Step 3: §7 — the `/api/stats` contract section**

Replace the whole `### POST /api/stats` section (from its heading through the `StatBlock` type block and the paragraph after it) with:

```markdown
### `POST /api/stats`

Body: `{ "query": <QueryNode tree>, "databases": string[] }`. Called live
(debounced ~400 ms) only when the query is valid **and at least one database is
selected**. The response is **newline-delimited JSON**: one `StatsResponse`
per selected database, written as soon as that database's result is ready —
some databases are slower than others, or can fail independently — rather
than one combined response after every database finishes.

```ts
type StatsResponse =
  | {
      label: string;          // matches DatabasesResponse.databases[].label
      success: true;
      matchCount: number;     // rows in this database matching the query
      totalCount: number;     // rows in this database, regardless of the query
      infoMessages: string[]; // non-blocking notices, e.g. "running slower than usual"
    }
  | {
      label: string;
      success: false;
      validationErrors: string[]; // the query was malformed for this database
      infoMessages: string[];     // the database itself couldn't handle the request
    };
```

There is no combined-totals line and no `name` field on each line: the frontend
derives the headline by summing `matchCount`/`totalCount` across the successful
lines received so far, and looks up each line's display name from
`AppState.databases` (loaded once from `GET /api/databases`) by `label` —
resending the name on every line would be redundant network traffic. A missing
/ empty `databases` array → `400 { error: "Select at least one database." }`.

`statsPanel.ts` renders a running headline, a per-database list (success:
counts + bar; failure: `validationErrors`/`infoMessages`), and a "waiting on N
more" indicator while `status` is `"loading"`.
```

Also, in the `GET /api/individuals` section's `IndividualField` type block, add the two new fields:

```ts
    fields: Array<{
      label: string;
      type: string;
      description: string;
      comment: string;
      name?: string;    // reserved for a future human-readable name; not populated yet — UI falls back to `label`
      values?: string[]; // the field's valid values, when it has a fixed domain; drives an enum SchemaResponse field
    }>;
```

- [ ] **Step 4: §9 — `statsPanel.ts` panel description**

Replace the `### Right — statsPanel.ts` section's body with:

```markdown
Every number in this panel goes through `src/ui/format.ts` so it stays inside a
~20 rem column when a real backend returns billions:

- **`compact(n)`** — `1.2B` / `988M` / `12,345`; the exact value is in a `title=`
  tooltip.
- **`matchRatio(match, total)`** — `62%` / `6.2%` / `0.34%`, and for sub-0.05 %
  (e.g. `3.46e-7 %`) **`1 in 289.3M`** instead of a misleading `0%`. `none` / `all`
  at the extremes; `>99.9%` rather than a rounded-up `100%`.
- **`barWidth(match, total)`** — a CSS `max(…%, 2px)`, so any nonzero match shows a
  2 px sliver, visibly distinct from zero.

Layout, top to bottom: a compact headline (sum of `matchCount`/`totalCount`
across the successful lines received so far, big + `of … · matchRatio` small)
and a thin bar; the **By database** segment — one row per streamed line so
far, success (`compact(match) / compact(total) · matchRatio`, thin bar, exact
figures on hover, any `infoMessages`) or failure (`validationErrors` +
`infoMessages` as a red message) — inside a `.qb-stat-perdb` scroll region
(`max-height: 45vh`, replacing the old per-field-block scroll region now that
there are no field blocks); then, while `status` is `"loading"`, a "Waiting on
N more database(s)…" line. The whole stats column is `position: sticky` so it
tracks the viewport while a tall query builder scrolls past. `status`
branches: `idle` → hint from §6; `error` → `ui negative message`, no data.
There is no longer a per-field-block list — the real backend can currently
only return counts, not aggregated min/max/avg/buckets/earliest/latest.
```

- [ ] **Step 5: §10 — mock server section**

Replace the `POST /api/stats scopes...` bullet with:

```markdown
- `POST /api/stats` scopes `ROWS` to the selected databases
  (`filterByDatabases`) and computes each database's match/total counts
  (`perDatabaseCounts`), scaling the sample's match rate onto that database's
  `size` (`scaleCount`, unchanged). Rather than returning one combined
  response, it writes one `StatsResponse` line per database
  (`buildStatsLine`) as newline-delimited JSON, with a small artificial delay
  between lines so the streaming is visible in `npm run dev`, and — dev-only —
  occasionally (~5%) simulates a database that couldn't be reached, to
  exercise the UI's per-database failure path without a real backend.
```

- [ ] **Step 6: §13 — changelog**

Add a new row at the end of the table:

```markdown
| 2026-09-22 | API contract rename + streaming stats: `id`/`label` renamed to `label`/`name` across `SchemaResponse`, `DatabasesResponse`, and the (now per-database) `StatsResponse`, matching the convention `Individual`/`IndividualField` already used. `StatBlock` removed — the real backend can currently only return counts, not aggregated min/max/avg/buckets/earliest/latest. `IndividualField` gained `name` (reserved, unpopulated; UI falls back to `label`) and `values` (a field's declared domain, wired into `buildFields` as an enum `SchemaResponse` field with real `options` — exercised end to end via `vehicle_identity.vehicle_type`). `POST /api/stats` now streams newline-delimited JSON, one `StatsResponse` per selected database as it finishes, instead of waiting for every database and returning one combined response; the frontend derives the combined headline by summing the lines received so far, and reports per-database success/failure/info independently (§6, §7, §9, §10). Design: `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md`. |
```

- [ ] **Step 7: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md for the api-types refactoring and stats streaming"
```

---

### Task 14: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites pass.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: no errors (in particular, confirm the jQuery and `mock-server` import airlocks from `eslint.config.js` still pass — this plan touched neither rule's boundary, but Task 8's `queryBuilder.ts`/`databasePicker.ts` edits are worth double-checking against them).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (this also re-runs `tsc --noEmit` and `check:offline` per the existing `npm run build` chain — confirm no off-origin URLs were introduced).

- [ ] **Step 5: Full manual smoke test**

Run: `npm run dev`. Walk through:
1. Load the app — schema, databases, and individuals all load; the query builder seeds one empty condition.
2. Pick an Item → Field → Operator → value (try the now-enum `Vehicle identity: vehicle_type` field specifically, to exercise Task 6's `values` wiring — confirm its dropdown lists real vehicle types, not a blank/broken control).
3. Watch the stats panel fill in per-database, live, one row at a time (not all at once).
4. Edit the query mid-stream (e.g. change the value) and confirm the panel resets to loading/idle immediately rather than showing a mix of old and new results.
5. Press **Run / Refresh** and confirm the data preview still works unchanged (this plan did not touch `/api/query`).
6. Toggle a database off, confirm stats/preview reset and re-run correctly.

Expected: no console errors; every behavior above matches the description; the docs sidebar's field listing still renders correctly (falling back to `label` since `name` is never populated).

- [ ] **Step 6: Final commit (only if any of the above required fixes)**

If Steps 1–5 required any fixups, stage and commit them now with a message describing what verification caught. If everything passed cleanly with no changes needed, there is nothing to commit for this task.
