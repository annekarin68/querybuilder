# Finalizing the Entrysets Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock backend's plant/species data model (which the query builder, database picker, and stats panel still run against) with the entryset/individual model (which already backs the docs sidebar), so every panel — query builder, database picker, stats, and data preview — runs against the same real entryset data, with real filtering everywhere.

**Architecture:** A generic field/operator catalog (`mock-server/schema.ts`) built purely from `individual.json`'s declared shape (never from specific item/field names or values); 7 arbitrary, content-agnostic "databases" (`mock-server/databases.ts`) that partition entrysets by a hash of their numeric id only; a flattening step (`mock-server/rows.ts`) that turns nested entrysets into the flat `Row` shape the existing (unchanged) matching engine already expects. `mock-server/index.ts` is rewired to use these three plus the existing `evaluate.ts` and `vehicleData.ts`; `mock-server/catalog.ts` and `mock-server/data.ts` (the plant model) are deleted. No changes to `src/` — it already consumes the API purely through its typed contract.

**Tech Stack:** TypeScript (strict), Vitest, plain Node `http` mock server (unchanged tooling from the existing project).

**Spec:** `docs/superpowers/specs/2026-09-16-entrysets-transition-design.md` — read it before starting Task 1. This plan implements it directly; where this plan gives a more specific implementation choice than the spec (e.g. Task 2's hardcoded database sizes instead of the spec's "hash-based" suggestion), that choice was verified during planning and takes precedence.

## Global Constraints

- **Decoupling (spec §1):** nothing in `schema.ts`, `databases.ts`, or `rows.ts` may hardcode a specific item name, field name, or field value found in `individual.json`/`entrysets.json`. Only the general shape (individuals have typed fields; entrysets hold values for a subset of those items) may be assumed.
- **Field id format:** `"${individualLabel}.${fieldLabel}"` (e.g. `"engine_rpm.value_rpm"`) — matches the entryset's own nesting so it doubles as the flattened `Row` lookup key.
- **valueType mapping** (declared `individual.json` field `type` → schema `valueType`): `str`→`string`, `int`/`float`→`number`, `bool`→`boolean`. Never inferred from a field's name or values.
- **operatorIds per valueType** (reusing the existing `OPERATORS` ids verbatim):
  - `string`: `eq, neq, contains, isEmpty, isNotEmpty`
  - `number`: `eq, neq, gt, gte, lt, lte, between, isEmpty, isNotEmpty`
  - `boolean`: `eq, neq`
  - `date` (unused by current data, kept for future-proofing): `eq, neq, before, after, between, isEmpty, isNotEmpty`
  - `enum` (unused by current data, kept for future-proofing): `eq, neq, in, isEmpty, isNotEmpty`
- **7 databases**, ids `alpha`..`eta`, labels `ALPHA`..`ETA` — names carry no meaning (per product decision).
- **Database assignment formula** (a pure function of the entryset's numeric id — never of its content): `dbIndexForEntrysetId(id) = Math.abs(Math.imul(id, 2654435761)) % 7`.
- **Sample data**: `entrysets.json` grows from 5 to 21 entrysets (ids 1-21, new ones are ids 6-21), each one coherent scenario with internally-consistent field values (spec §7) — not per-field random noise.
- **No changes to `src/`** — verified during design: `queryBuilder.ts`, `statsPanel.ts`, `databasePicker.ts`, `dataPreview.ts`, and the query/api layers all consume only the typed API contract (`SchemaResponse`/`DatabasesResponse`/`StatsResponse`/`EntrysetsResponse`), never a specific field or database id. The stray "species" comment in `src/ui/databasePicker.ts` is corrected as a doc-accuracy fix in Task 7 (a comment edit, not a behavior change).
- **`tests/query/*.test.ts` are out of scope** — verified during planning (`grep -rn species tests/query`): they use `"species"` only as an arbitrary example field-id string in tests of the pure, schema-agnostic `src/query/*` modules. Do not touch them.
- **Commit after every task** (and at each step marked "Commit"). Conventional Commit prefixes (`feat:`, `test:`, `refactor:`, `docs:`, `chore:`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `mock-server/schema.ts` | **New.** `FieldDef`/`OperatorDef`/`ValueType`/`Arity` types, `OPERATORS` (relocated verbatim from `catalog.ts`), `buildFields(individuals)` — the generic field catalog builder. |
| `mock-server/databases.ts` | **New.** `DatabaseDef` type, `DATABASES` (7 synthetic entries), `dbIndexForEntrysetId`, `databaseIdForEntrysetId`. |
| `mock-server/rows.ts` | **New.** `flattenEntryset(entryset): Row`, `ROWS` (every entryset flattened once at startup). Kept separate from `vehicleData.ts` so that file stays a pure loader. |
| `mock-server/evaluate.ts` | **Edited.** Exports `Row`. `computeBlocks` takes `fields: FieldDef[]` as an explicit parameter instead of importing a module-level catalog (removes the `./catalog` import entirely — this is what makes the matching engine fully data-agnostic). `filterByDatabases`/`perDatabaseCounts` read `row.__db` instead of `row.species`. |
| `mock-server/index.ts` | **Edited.** Rewired to `schema.ts` + `databases.ts` + `rows.ts`; `/api/query` filters for real. |
| `mock-server/catalog.ts`, `mock-server/data.ts` | **Deleted** (Task 5). |
| `mock-server/vehicleData.ts` | **Untouched.** |
| `mock-server/data/entrysets.json` | **Edited** (Task 6): 5 → 21 entrysets. |
| `tests/mock-server/schema.test.ts` | **New**, replaces `catalog.test.ts`. |
| `tests/mock-server/databaseCatalog.test.ts` | **New.** |
| `tests/mock-server/rows.test.ts` | **New.** |
| `tests/mock-server/evaluate.test.ts`, `tests/mock-server/stats.test.ts`, `tests/mock-server/databases.test.ts` | **Edited** (field ids / `row.__db` / `computeBlocks` signature). |
| `tests/mock-server/catalog.test.ts` | **Deleted** (Task 5). |
| `tests/mock-server/query.test.ts` | **Untouched** — verified: only tests `paginate()`, which doesn't change. |
| `tests/mock-server/entrysetsData.test.ts` | **New** (Task 6): structural validation of the expanded `entrysets.json`. |
| `docs/ARCHITECTURE.md` | **Edited** (Task 7). |
| `src/ui/databasePicker.ts` | **Edited** (Task 7, comment only). |

---

## Task 1: Field/operator schema catalog (`mock-server/schema.ts`)

**Files:**
- Create: `mock-server/schema.ts`
- Test: `tests/mock-server/schema.test.ts`

**Interfaces:**
- Consumes: `Individual`, `IndividualField` types from `mock-server/vehicleData.ts` (already exist — `Individual { label, group, tags, id_number, name, description, comment, stats, fields: IndividualField[] }`; `IndividualField { label, type, description, comment }`).
- Produces (used by Task 3 and Task 5): `type ValueType = "string" | "number" | "boolean" | "date" | "enum"`, `type Arity = "none" | "one" | "two" | "many"`, `interface FieldDef { id: string; label: string; valueType: ValueType; description: string; options?: { value: string; label: string }[]; operatorIds: string[] }`, `interface OperatorDef { id: string; label: string; description: string; arity: Arity }`, `export const OPERATORS: OperatorDef[]`, `export function buildFields(individuals: Individual[]): FieldDef[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mock-server/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFields, OPERATORS } from "../../mock-server/schema";
import type { Individual } from "../../mock-server/vehicleData";

const individuals: Individual[] = [
  {
    label: "engine_rpm",
    group: "engine",
    tags: [],
    id_number: 1,
    name: "Engine RPM",
    description: "Engine rotational speed.",
    comment: "",
    stats: { percentage: 0.9, count: 100 },
    fields: [
      { label: "value_rpm", type: "int", description: "", comment: "" },
      { label: "redline_rpm", type: "int", description: "Redline for this engine.", comment: "" },
      { label: "is_over_rev", type: "bool", description: "", comment: "" },
    ],
  },
  {
    label: "vehicle_identity",
    group: "metadata",
    tags: [],
    id_number: 2,
    name: "Vehicle identity",
    description: "Identifying info for the vehicle.",
    comment: "",
    stats: { percentage: 1, count: 100 },
    fields: [
      { label: "vin", type: "str", description: "", comment: "" },
      { label: "vehicle_type", type: "str", description: "", comment: "" },
    ],
  },
];

describe("buildFields", () => {
  it("ids are dotted individualLabel.fieldLabel", () => {
    const fields = buildFields(individuals);
    const ids = fields.map((f) => f.id);
    expect(ids).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps declared types to valueType", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.id === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.id === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("label combines the individual's name and the field's label", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.label).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("description falls back to the individual's description when the field's is empty", () => {
    const fields = buildFields(individuals);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.description).toBe(
      "Engine rotational speed.",
    );
    expect(fields.find((f) => f.id === "engine_rpm.redline_rpm")?.description).toBe(
      "Redline for this engine.",
    );
  });

  it("assigns operatorIds per valueType, all of which are real operator ids", () => {
    const fields = buildFields(individuals);
    const opIds = new Set(OPERATORS.map((o) => o.id));
    for (const f of fields) {
      expect(f.operatorIds.length).toBeGreaterThan(0);
      for (const id of f.operatorIds) expect(opIds.has(id)).toBe(true);
    }
    expect(fields.find((f) => f.id === "engine_rpm.is_over_rev")?.operatorIds).toEqual([
      "eq",
      "neq",
    ]);
    expect(fields.find((f) => f.id === "engine_rpm.value_rpm")?.operatorIds).toEqual([
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

  it("any field with valueType enum has options (future-proofing; none exist today)", () => {
    for (const f of buildFields(individuals)) {
      if (f.valueType === "enum") expect(f.options && f.options.length).toBeTruthy();
    }
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/schema.test.ts`
Expected: FAIL — `mock-server/schema.ts` does not exist yet.

- [ ] **Step 3: Implement `mock-server/schema.ts`**

```ts
import type { Individual } from "./vehicleData";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface FieldDef {
  id: string;
  label: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface OperatorDef {
  id: string;
  label: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: OperatorDef[] = [
  { id: "eq", label: "Equals", description: "The field exactly matches the value.", arity: "one" },
  {
    id: "neq",
    label: "Not equals",
    description: "The field is anything other than the value.",
    arity: "one",
  },
  {
    id: "gt",
    label: "Greater than",
    description: "The field is strictly greater than the value.",
    arity: "one",
  },
  {
    id: "gte",
    label: "Greater than or equal",
    description: "The field is at least the value.",
    arity: "one",
  },
  {
    id: "lt",
    label: "Less than",
    description: "The field is strictly less than the value.",
    arity: "one",
  },
  {
    id: "lte",
    label: "Less than or equal",
    description: "The field is at most the value.",
    arity: "one",
  },
  {
    id: "before",
    label: "Before",
    description: "The date is earlier than the value.",
    arity: "one",
  },
  { id: "after", label: "After", description: "The date is later than the value.", arity: "one" },
  { id: "contains", label: "Contains", description: "The text includes the value.", arity: "one" },
  {
    id: "between",
    label: "Between",
    description: "The field is within the inclusive range [from, to].",
    arity: "two",
  },
  {
    id: "in",
    label: "Is any of",
    description: "The field matches one of several values.",
    arity: "many",
  },
  { id: "isEmpty", label: "Is empty", description: "The field has no value.", arity: "none" },
  { id: "isNotEmpty", label: "Is not empty", description: "The field has a value.", arity: "none" },
];

/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is. This is what lets the catalog generalize to a
 * production individual.json with entirely different item/field names.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  enum: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
};

/** individual.json's declared field `type` -> the schema's valueType. Never
 * inferred from a field's name or its values. */
function valueTypeFor(declaredType: string): ValueType {
  switch (declaredType) {
    case "int":
    case "float":
      return "number";
    case "bool":
      return "boolean";
    default:
      return "string";
  }
}

/**
 * One queryable field per (individual, field) pair, derived purely from
 * individual.json's declared shape. Field id is the dotted
 * "individualLabel.fieldLabel" path, matching how an entryset nests its
 * values (see mock-server/rows.ts) so it doubles as the flattened lookup key.
 */
export function buildFields(individuals: Individual[]): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const valueType = valueTypeFor(f.type);
      fields.push({
        id: `${ind.label}.${f.label}`,
        label: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return fields;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/schema.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add mock-server/schema.ts tests/mock-server/schema.test.ts
git commit -m "feat: add entryset-driven field/operator schema catalog"
```

---

## Task 2: Synthetic database catalog (`mock-server/databases.ts`)

**Files:**
- Create: `mock-server/databases.ts`
- Test: `tests/mock-server/databaseCatalog.test.ts`

**Interfaces:**
- Consumes: nothing (pure, self-contained).
- Produces (used by Task 4 and Task 5): `interface DatabaseDef { id: string; label: string; size: number }`, `export const DATABASES: DatabaseDef[]` (7 entries), `export function dbIndexForEntrysetId(entrysetId: number): number`, `export function databaseIdForEntrysetId(entrysetId: number): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/mock-server/databaseCatalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DATABASES, dbIndexForEntrysetId, databaseIdForEntrysetId } from "../../mock-server/databases";

describe("DATABASES", () => {
  it("has exactly 7 entries named ALPHA..ETA", () => {
    expect(DATABASES.map((d) => d.label)).toEqual([
      "ALPHA",
      "BETA",
      "GAMMA",
      "DELTA",
      "EPSILON",
      "ZETA",
      "ETA",
    ]);
    expect(DATABASES.map((d) => d.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
    ]);
  });

  it("every database has a positive size, spanning several orders of magnitude", () => {
    for (const d of DATABASES) expect(d.size).toBeGreaterThan(0);
    const sizes = DATABASES.map((d) => d.size);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1000);
  });
});

describe("dbIndexForEntrysetId", () => {
  it("is deterministic and within range", () => {
    for (const id of [1, 2, 3, 100, 999]) {
      const idx = dbIndexForEntrysetId(id);
      expect(idx).toBe(dbIndexForEntrysetId(id));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });

  it("matches the precomputed table for entryset ids 1-21", () => {
    const expected: Record<number, number> = {
      1: 6,
      2: 6,
      3: 0,
      4: 5,
      5: 6,
      6: 0,
      7: 5,
      8: 1,
      9: 0,
      10: 5,
      11: 1,
      12: 4,
      13: 5,
      14: 1,
      15: 4,
      16: 2,
      17: 1,
      18: 4,
      19: 2,
      20: 3,
      21: 3,
    };
    for (const [id, idx] of Object.entries(expected)) {
      expect(dbIndexForEntrysetId(Number(id))).toBe(idx);
    }
  });
});

describe("databaseIdForEntrysetId", () => {
  it("returns the DATABASES id at dbIndexForEntrysetId's index", () => {
    expect(databaseIdForEntrysetId(3)).toBe("alpha"); // index 0
    expect(databaseIdForEntrysetId(1)).toBe("eta"); // index 6
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/databaseCatalog.test.ts`
Expected: FAIL — `mock-server/databases.ts` does not exist yet.

- [ ] **Step 3: Implement `mock-server/databases.ts`**

```ts
export interface DatabaseDef {
  id: string;
  label: string;
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
  { id: "alpha", label: "ALPHA", size: 12_345 },
  { id: "beta", label: "BETA", size: 88_000 },
  { id: "gamma", label: "GAMMA", size: 4_600_000 },
  { id: "delta", label: "DELTA", size: 41_000_000 },
  { id: "epsilon", label: "EPSILON", size: 892_000_000 },
  { id: "zeta", label: "ZETA", size: 1_234_000_000 },
  { id: "eta", label: "ETA", size: 5_600_000_000 },
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
  return DATABASES[dbIndexForEntrysetId(entrysetId)]!.id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/databaseCatalog.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add mock-server/databases.ts tests/mock-server/databaseCatalog.test.ts
git commit -m "feat: add 7 synthetic, content-agnostic mock databases"
```

---

## Task 3: Generalize the matching engine (`mock-server/evaluate.ts`)

**Files:**
- Modify: `mock-server/evaluate.ts`
- Modify: `tests/mock-server/evaluate.test.ts`
- Modify: `tests/mock-server/stats.test.ts`
- Modify: `tests/mock-server/databases.test.ts`

**Interfaces:**
- Consumes: `FieldDef` type from `mock-server/schema.ts` (Task 1, type-only import).
- Produces (used by Task 4 and Task 5): `export type Row = Record<string, string | number | boolean | null>`, `computeBlocks(query: JsonNode, rows: Row[], fields: FieldDef[], scale?): StatBlock[]` (signature changed — `fields` is now an explicit parameter), `filterByDatabases`/`perDatabaseCounts` now read `row.__db` instead of `row.species`. `matches`, `conditionMatches`, `cmp`, `scaleCount`, `referencedFieldIds` are unchanged.

This task edits three existing test files to match the new shapes — do these edits first (as failing tests), then edit `evaluate.ts` to make them pass.

- [ ] **Step 1: Update `tests/mock-server/evaluate.test.ts` — no field/id changes needed, but rows must carry `__db` instead of `species` isn't required here (this file never touches filterByDatabases). Verify it still compiles as-is.**

Run: `npx vitest run tests/mock-server/evaluate.test.ts`
Expected: PASS, unchanged — `matches`/`conditionMatches` don't change. No edit needed to this file; skip to Step 2.

- [ ] **Step 2: Update `tests/mock-server/databases.test.ts` to use `__db` instead of `species`**

Replace the file's row fixtures and descriptions:

```ts
import { describe, it, expect } from "vitest";
import {
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
  type Row,
} from "../../mock-server/evaluate";

const rows: Row[] = [
  { __db: "alpha", id: 1, branches: 5 },
  { __db: "beta", id: 2, branches: 20 },
  { __db: "alpha", id: 3, branches: 30 },
  { __db: "gamma", id: 4, branches: 1 },
];

const matchAll: JsonNode = { kind: "group", operator: "AND", children: [] };
const branchesGte10: JsonNode = {
  kind: "group",
  operator: "AND",
  children: [{ kind: "condition", fieldId: "branches", operatorId: "gte", value: 10 }],
};

describe("filterByDatabases", () => {
  it("keeps only rows whose __db is a selected database id", () => {
    expect(filterByDatabases(rows, ["alpha"]).map((r) => r.id)).toEqual([1, 3]);
    expect(filterByDatabases(rows, ["beta", "gamma"]).map((r) => r.id)).toEqual([2, 4]);
  });

  it("an empty id list keeps nothing", () => {
    expect(filterByDatabases(rows, [])).toEqual([]);
  });

  it("unknown ids are simply absent", () => {
    expect(filterByDatabases(rows, ["zeta", "alpha"]).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("perDatabaseCounts", () => {
  it("returns match/total per database in the given id order", () => {
    expect(perDatabaseCounts(matchAll, rows, ["beta", "alpha"])).toEqual([
      { id: "beta", matchCount: 1, totalCount: 1 },
      { id: "alpha", matchCount: 2, totalCount: 2 },
    ]);
  });

  it("matchCount reflects the query; totalCount is the whole database", () => {
    expect(perDatabaseCounts(branchesGte10, rows, ["alpha", "beta", "gamma"])).toEqual([
      { id: "alpha", matchCount: 1, totalCount: 2 }, // only branches:30
      { id: "beta", matchCount: 1, totalCount: 1 }, // branches:20
      { id: "gamma", matchCount: 0, totalCount: 1 }, // branches:1
    ]);
  });

  it("an unknown database id yields zero counts", () => {
    expect(perDatabaseCounts(matchAll, rows, ["zeta"])).toEqual([
      { id: "zeta", matchCount: 0, totalCount: 0 },
    ]);
  });
});

describe("scaleCount", () => {
  it("projects a sample part/whole onto a target size", () => {
    expect(scaleCount(1, 40, 1_234_000_000)).toBe(30_850_000); // 1/40 of 1.234B
    expect(scaleCount(40, 40, 5_600_000_000)).toBe(5_600_000_000); // all
    expect(scaleCount(0, 40, 1_234_000_000)).toBe(0);
  });
  it("zero whole → zero (unknown/empty database)", () => {
    expect(scaleCount(0, 0, 999)).toBe(0);
  });
});
```

- [ ] **Step 3: Update `tests/mock-server/stats.test.ts` to pass `fields` explicitly instead of relying on a catalog import**

Replace the file's contents:

```ts
import { describe, it, expect } from "vitest";
import { computeBlocks, type JsonNode } from "../../mock-server/evaluate";
import type { FieldDef } from "../../mock-server/schema";
import type { StatBlock } from "../../src/api/types";

const fields: FieldDef[] = [
  {
    id: "vehicle_identity.vehicle_type",
    label: "Vehicle identity: vehicle_type",
    valueType: "string",
    description: "",
    operatorIds: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  },
  {
    id: "engine_rpm.value_rpm",
    label: "Engine RPM: value_rpm",
    valueType: "number",
    description: "",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  },
  {
    id: "observation_window.from_timestamp",
    label: "Observation window: from_timestamp",
    valueType: "date",
    description: "",
    operatorIds: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  },
];

const rows = [
  {
    "vehicle_identity.vehicle_type": "delivery_van",
    "engine_rpm.value_rpm": 10,
    "observation_window.from_timestamp": "2015-01-01",
  },
  {
    "vehicle_identity.vehicle_type": "delivery_van",
    "engine_rpm.value_rpm": 20,
    "observation_window.from_timestamp": "2019-06-01",
  },
  {
    "vehicle_identity.vehicle_type": "semi_truck",
    "engine_rpm.value_rpm": null,
    "observation_window.from_timestamp": "2012-03-01",
  },
];

const cond = (fieldId: string, operatorId: string, value: unknown) => ({
  kind: "condition" as const,
  fieldId,
  operatorId,
  value,
});
const group = (operator: "AND" | "OR", ...children: JsonNode[]) => ({
  kind: "group" as const,
  operator,
  children,
});

describe("computeBlocks", () => {
  it("number field -> number-summary with nullCount", () => {
    const blocks = computeBlocks(cond("engine_rpm.value_rpm", "gte", 0), rows, fields);
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "number-summary",
        fieldLabel: "Engine RPM: value_rpm",
        min: 10,
        max: 20,
        nullCount: 1,
      }),
    );
  });

  it("string field -> distribution buckets over matching rows", () => {
    const blocks = computeBlocks(
      cond("vehicle_identity.vehicle_type", "in", ["delivery_van", "semi_truck"]),
      rows,
      fields,
    );
    const dist = blocks.find(
      (b): b is Extract<StatBlock, { kind: "distribution" }> =>
        b.kind === "distribution" && b.fieldLabel === "Vehicle identity: vehicle_type",
    );
    expect(dist?.buckets).toEqual(
      expect.arrayContaining([
        { label: "delivery_van", count: 2 },
        { label: "semi_truck", count: 1 },
      ]),
    );
  });

  it("date field -> date-range", () => {
    const blocks = computeBlocks(
      cond("observation_window.from_timestamp", "after", "2000-01-01"),
      rows,
      fields,
    );
    expect(blocks).toContainEqual(
      expect.objectContaining({
        kind: "date-range",
        fieldLabel: "Observation window: from_timestamp",
        earliest: "2012-03-01",
        latest: "2019-06-01",
      }),
    );
  });

  it("one block per referenced field, nested groups included", () => {
    const q = group(
      "AND",
      cond("vehicle_identity.vehicle_type", "eq", "delivery_van"),
      group(
        "OR",
        cond("engine_rpm.value_rpm", "gte", 5),
        cond("observation_window.from_timestamp", "before", "2099-01-01"),
      ),
    );
    const labels = computeBlocks(q, rows, fields)
      .map((b) => b.fieldLabel)
      .sort();
    expect(labels).toEqual([
      "Engine RPM: value_rpm",
      "Observation window: from_timestamp",
      "Vehicle identity: vehicle_type",
    ]);
  });

  it("scale multiplies count-shaped fields but not min/max/avg", () => {
    const [num] = computeBlocks(cond("engine_rpm.value_rpm", "gte", 0), rows, fields, {
      total: 1_000_000,
      match: 500_000,
    }) as [Extract<StatBlock, { kind: "number-summary" }>];
    expect(num.min).toBe(10); // value — unscaled
    expect(num.max).toBe(20);
    expect(num.nullCount).toBe(1_000_000); // 1 null row × total scale

    const dist = computeBlocks(
      cond("vehicle_identity.vehicle_type", "in", ["delivery_van", "semi_truck"]),
      rows,
      fields,
      { match: 1000 },
    ).find((b) => b.kind === "distribution") as Extract<StatBlock, { kind: "distribution" }>;
    expect(dist.buckets).toEqual(
      expect.arrayContaining([
        { label: "delivery_van", count: 2000 },
        { label: "semi_truck", count: 1000 },
      ]),
    );
  });
});
```

- [ ] **Step 4: Run all three test files to verify they fail against the current `evaluate.ts`**

Run: `npx vitest run tests/mock-server/evaluate.test.ts tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts`
Expected: `databases.test.ts` and `stats.test.ts` FAIL (old `evaluate.ts` reads `row.species` and imports `FIELDS` from `./catalog`); `evaluate.test.ts` still PASSes.

- [ ] **Step 5: Edit `mock-server/evaluate.ts`**

Change the top of the file: replace

```ts
import { FIELDS } from "./catalog";
import type { StatBlock } from "../src/api/types";

type Row = Record<string, string | number | boolean | null>;
```

with

```ts
import type { FieldDef } from "./schema";
import type { StatBlock } from "../src/api/types";

export type Row = Record<string, string | number | boolean | null>;
```

Replace the `filterByDatabases` function and its doc comment:

```ts
/**
 * Restrict rows to the selected databases. Rows are flattened entrysets
 * (see mock-server/rows.ts), each carrying a synthetic `__db` key assigned
 * purely from the entryset's numeric id (see mock-server/databases.ts) —
 * never from anything inside the entryset's own fields.
 */
export function filterByDatabases(rows: Row[], databaseIds: string[]): Row[] {
  const ids = new Set(databaseIds);
  return rows.filter((r) => ids.has(String(r.__db)));
}
```

In `perDatabaseCounts`, change the one line reading `r.species` to `r.__db`:

```ts
export function perDatabaseCounts(
  query: JsonNode,
  rows: Row[],
  databaseIds: string[],
): { id: string; matchCount: number; totalCount: number }[] {
  return databaseIds.map((id) => {
    const inDb = rows.filter((r) => String(r.__db) === id);
    return {
      id,
      totalCount: inDb.length,
      matchCount: inDb.filter((r) => matches(query, r)).length,
    };
  });
}
```

Change `computeBlocks`'s signature to take `fields` explicitly, and use it instead of the removed `FIELDS` import (the function body is otherwise unchanged — only the `FIELDS.find(...)` line becomes `fields.find(...)`):

```ts
export function computeBlocks(
  query: JsonNode,
  rows: Row[],
  fields: FieldDef[],
  scale: { total?: number; match?: number } = {},
): StatBlock[] {
  const totalScale = scale.total ?? 1;
  const matchScale = scale.match ?? 1;
  const matching = rows.filter((r) => matches(query, r));
  const blocks: StatBlock[] = [];

  for (const fieldId of referencedFieldIds(query)) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) continue;
    const matchingValues = matching.map((r) => r[fieldId]);
    const present = matchingValues.filter((v) => v !== null && v !== undefined && v !== "");

    const allValues = rows.map((r) => r[fieldId]);
    const allPresent = allValues.filter((v) => v !== null && v !== undefined && v !== "");
    const nullCount = Math.round((allValues.length - allPresent.length) * totalScale);

    if (field.valueType === "number") {
      const nums = present.map(Number);
      blocks.push({
        kind: "number-summary",
        fieldLabel: field.label,
        min: nums.length ? Math.min(...nums) : 0,
        max: nums.length ? Math.max(...nums) : 0,
        avg: nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : 0,
        nullCount,
      });
    } else if (field.valueType === "date") {
      const dates = present.map(String).sort();
      blocks.push({
        kind: "date-range",
        fieldLabel: field.label,
        earliest: dates[0] ?? "",
        latest: dates[dates.length - 1] ?? "",
        nullCount,
      });
    } else {
      const counts = new Map<string, number>();
      for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      let buckets = [...counts.entries()]
        .map(([label, count]) => ({ label, count: Math.round(count * matchScale) }))
        .sort((a, b) => b.count - a.count);
      if (field.valueType === "string") buckets = buckets.slice(0, 10);
      blocks.push({ kind: "distribution", fieldLabel: field.label, buckets, nullCount });
    }
  }
  return blocks;
}
```

Everything else in the file (`JsonCondition`, `JsonGroup`, `JsonNode`, `cmp`, `conditionMatches`, `matches`, `referencedFieldIds`, `scaleCount`) is unchanged.

- [ ] **Step 6: Run the three test files to verify they pass**

Run: `npx vitest run tests/mock-server/evaluate.test.ts tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts`
Expected: all PASS. (`mock-server/index.ts` will fail to typecheck at this point — it still imports the old `catalog`/`data` and calls `computeBlocks` with the old 3-arg signature. That's expected; Task 5 fixes it. Do not run `npm run typecheck` yet.)

- [ ] **Step 7: Commit**

```bash
git add mock-server/evaluate.ts tests/mock-server/evaluate.test.ts tests/mock-server/databases.test.ts tests/mock-server/stats.test.ts
git commit -m "refactor: generalize evaluate.ts off the plant catalog"
```

---

## Task 4: Flatten entrysets into matchable rows (`mock-server/rows.ts`)

**Files:**
- Create: `mock-server/rows.ts`
- Test: `tests/mock-server/rows.test.ts`

**Interfaces:**
- Consumes: `Entryset` type from `mock-server/vehicleData.ts` (existing: `{ id: number; items: Record<string, Record<string, string | number | boolean>> }`); `databaseIdForEntrysetId` from `mock-server/databases.ts` (Task 2); `Row` type from `mock-server/evaluate.ts` (Task 3).
- Produces (used by Task 5): `export function flattenEntryset(entryset: Entryset): Row`, `export const ROWS: Row[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/mock-server/rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { flattenEntryset } from "../../mock-server/rows";
import { databaseIdForEntrysetId } from "../../mock-server/databases";
import type { Entryset } from "../../mock-server/vehicleData";

describe("flattenEntryset", () => {
  it("turns nested items into dotted keys", () => {
    const entryset: Entryset = {
      id: 3,
      items: {
        vehicle_identity: { vin: "ABC123", vehicle_type: "sedan" },
        engine_rpm: { value_rpm: 750 },
      },
    };
    const row = flattenEntryset(entryset);
    expect(row["vehicle_identity.vin"]).toBe("ABC123");
    expect(row["vehicle_identity.vehicle_type"]).toBe("sedan");
    expect(row["engine_rpm.value_rpm"]).toBe(750);
  });

  it("keeps the entryset's id", () => {
    const entryset: Entryset = { id: 7, items: {} };
    expect(flattenEntryset(entryset).id).toBe(7);
  });

  it("attaches __db from databaseIdForEntrysetId(id)", () => {
    const entryset: Entryset = { id: 3, items: {} };
    expect(flattenEntryset(entryset).__db).toBe(databaseIdForEntrysetId(3));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/rows.test.ts`
Expected: FAIL — `mock-server/rows.ts` does not exist yet.

- [ ] **Step 3: Implement `mock-server/rows.ts`**

```ts
import { ENTRYSETS, type Entryset } from "./vehicleData";
import { databaseIdForEntrysetId } from "./databases";
import type { Row } from "./evaluate";

/**
 * Flattens one entryset's nested `items[individualLabel][fieldLabel]` shape
 * into the flat `"individualLabel.fieldLabel"` keys the schema's field ids
 * use (see mock-server/schema.ts), plus a synthetic `__db` key (see
 * mock-server/databases.ts) used only for database scoping.
 */
export function flattenEntryset(entryset: Entryset): Row {
  const row: Row = { id: entryset.id, __db: databaseIdForEntrysetId(entryset.id) };
  for (const [individualLabel, fields] of Object.entries(entryset.items)) {
    for (const [fieldLabel, value] of Object.entries(fields)) {
      row[`${individualLabel}.${fieldLabel}`] = value;
    }
  }
  return row;
}

/** Every entryset the mock server has, flattened once at startup. */
export const ROWS: Row[] = Object.values(ENTRYSETS).map(flattenEntryset);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/rows.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mock-server/rows.ts tests/mock-server/rows.test.ts
git commit -m "feat: flatten entrysets into matchable rows"
```

---

## Task 5: Rewire the mock server, delete the plant model

**Files:**
- Modify: `mock-server/index.ts`
- Delete: `mock-server/catalog.ts`, `mock-server/data.ts`, `tests/mock-server/catalog.test.ts`

**Interfaces:**
- Consumes: `buildFields`, `OPERATORS` (Task 1); `DATABASES` (Task 2); `Row`, `matches`, `computeBlocks`, `filterByDatabases`, `perDatabaseCounts`, `scaleCount` (Task 3); `ROWS` (Task 4); `ENTRYSETS`, `INDIVIDUALS`, `Entryset` (existing `vehicleData.ts`).
- Produces: the running `/api/schema`, `/api/databases`, `/api/individuals`, `/api/stats`, `/api/query` endpoints — no new exports beyond the existing `server`, `readJson`, `sendJson`, `paginate`.

- [ ] **Step 1: Edit the imports at the top of `mock-server/index.ts`**

Replace:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
import { DATABASES, FIELDS, OPERATORS } from "./catalog";
import { RECORDS } from "./data";
import {
  matches,
  computeBlocks,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
} from "./evaluate";
import { ENTRYSETS, INDIVIDUALS } from "./vehicleData";
```

with:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
import { buildFields, OPERATORS } from "./schema";
import { DATABASES } from "./databases";
import {
  matches,
  computeBlocks,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
} from "./evaluate";
import { ENTRYSETS, INDIVIDUALS, type Entryset } from "./vehicleData";
import { ROWS } from "./rows";

const FIELDS = buildFields(INDIVIDUALS);
```

- [ ] **Step 2: Replace the `POST /api/stats` handler's body**

Find the block starting `if (req.method === "POST" && url.pathname === "/api/stats") {` and replace everything from `const perDatabase = perDatabaseCounts(...)` down to the `sendJson(res, 200, { matchCount, totalCount, blocks, perDatabase });` line with:

```ts
      const perDatabase = perDatabaseCounts(query, ROWS, ids).map((c) => {
        const size = DATABASES.find((d) => d.id === c.id)?.size ?? 0;
        return {
          id: c.id,
          label: DATABASES.find((d) => d.id === c.id)?.label ?? c.id,
          totalCount: size,
          matchCount: scaleCount(c.matchCount, c.totalCount, size),
        };
      });
      const totalCount = perDatabase.reduce((s, d) => s + d.totalCount, 0);
      const matchCount = perDatabase.reduce((s, d) => s + d.matchCount, 0);

      const scoped = filterByDatabases(ROWS, ids);
      const sampleMatch = scoped.filter((r) => matches(query, r)).length;
      const blocks = computeBlocks(query, scoped, FIELDS, {
        total: scoped.length ? totalCount / scoped.length : 1,
        match: sampleMatch ? matchCount / sampleMatch : 1,
      });

      sendJson(res, 200, { matchCount, totalCount, blocks, perDatabase });
```

(Only `RECORDS` → `ROWS` and the added `FIELDS` argument to `computeBlocks` change; the rest of the block, and the `badQuery`/`badDatabases` checks above it, are untouched.)

- [ ] **Step 3: Replace the `POST /api/query` handler's body to filter for real**

Find the block starting `if (req.method === "POST" && url.pathname === "/api/query") {` and replace its body (after the existing `badQuery`/`badDatabases` checks) with:

```ts
      const query = body.query as JsonNode;
      const ids = body.databases as string[];

      const scoped = filterByDatabases(ROWS, ids);
      const matchingIds = scoped.filter((r) => matches(query, r)).map((r) => r.id);
      const entrysets = matchingIds
        .map((id) => ENTRYSETS[String(id)])
        .filter((e): e is Entryset => e !== undefined)
        .slice(0, 25);
      sendJson(res, 200, { entrysets });
```

Remove the old "Transitional: the query/databases are validated..." comment above this block — it's no longer transitional.

- [ ] **Step 4: Delete the plant model**

```bash
git rm mock-server/catalog.ts mock-server/data.ts tests/mock-server/catalog.test.ts
```

- [ ] **Step 5: Typecheck, then run the full test suite**

Run: `npm run typecheck`
Expected: no errors. (This is the first point since Task 3 where the whole project typechecks again — `index.ts` no longer references the deleted modules or the old `computeBlocks` signature.)

Run: `npx vitest run`
Expected: all tests PASS, including `tests/mock-server/query.test.ts` (unaffected — still just `paginate()`).

- [ ] **Step 6: Manual smoke test against the running mock server**

Run: `npm run mock` (in one terminal), then in another:

```bash
curl -s http://localhost:3001/api/databases | head -c 400
curl -s http://localhost:3001/api/schema | head -c 400
curl -s -X POST http://localhost:3001/api/query -H 'content-type: application/json' \
  -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha","beta","gamma","delta","epsilon","zeta","eta"]}'
```

Expected: `/api/databases` returns 7 entries labeled ALPHA..ETA (no `size` field); `/api/schema` returns fields with dotted ids like `"vehicle_identity.vin"`; the `/api/query` call (empty query = match everything, all 7 databases selected) returns every entryset currently in `entrysets.json` (5, until Task 6 adds more). Stop the mock server after checking (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add mock-server/index.ts
git commit -m "feat: rewire mock server onto the entryset model, delete the plant catalog"
```

---

## Task 6: Expand sample data to 21 entrysets across all 7 databases

**Files:**
- Modify: `mock-server/data/entrysets.json`
- Test: `tests/mock-server/entrysetsData.test.ts`

**Interfaces:**
- Consumes: `dbIndexForEntrysetId` from `mock-server/databases.ts` (Task 2); the existing `individual.json` (read-only, for choosing valid item/field labels).
- Produces: nothing new — this task only grows the JSON sample data and adds a structural-validation test for it.

Before writing content, read `mock-server/data/individual.json` (157 items across the groups: `metadata`, `engine`, `powertrain_transmission`, `fuel_system`, `exhaust_emissions`, `cooling_system`, `electrical_system`, `battery_ev`, `tires_wheels`, `brakes`, `suspension`, `steering`, `body_chassis`, `lighting`, `hvac_cabin`, `infotainment_telematics`, `adas_safety`, `radar_lidar_sensors`, `diagnostics_control_units`, `driver_behavior`, `environment_context`) and the existing 5 entrysets in `mock-server/data/entrysets.json` — they set the pattern to follow: each entryset is one coherent real-world scenario, and every field value in it is consistent with every other (a parked vehicle has `speed_kmh: 0`, parking brake engaged, no active trip; a moving vehicle has nonzero speed, a running engine consistent with its gear, fuel/battery trending appropriately, and a populated `trip_context`).

- [ ] **Step 1: Write the failing structural-validation test**

Create `tests/mock-server/entrysetsData.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbIndexForEntrysetId } from "../../mock-server/databases";

interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
}
interface Individual {
  label: string;
  fields: IndividualField[];
  [key: string]: unknown;
}
interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

const dataDir = path.join(__dirname, "../../mock-server/data");

const individualsRaw = JSON.parse(
  readFileSync(path.join(dataDir, "individual.json"), "utf8"),
) as Record<string, Individual>[];
const individualsByLabel = new Map(
  individualsRaw.map((wrapper) => {
    const ind = Object.values(wrapper)[0]!;
    return [ind.label, ind] as const;
  }),
);

const entrysets = JSON.parse(
  readFileSync(path.join(dataDir, "entrysets.json"), "utf8"),
) as Record<string, Entryset>;

const EXPECTED_DB_INDEX: Record<number, number> = {
  1: 6,
  2: 6,
  3: 0,
  4: 5,
  5: 6,
  6: 0,
  7: 5,
  8: 1,
  9: 0,
  10: 5,
  11: 1,
  12: 4,
  13: 5,
  14: 1,
  15: 4,
  16: 2,
  17: 1,
  18: 4,
  19: 2,
  20: 3,
  21: 3,
};

function typeMatches(declared: string, value: unknown): boolean {
  if (declared === "str") return typeof value === "string";
  if (declared === "int" || declared === "float") return typeof value === "number";
  if (declared === "bool") return typeof value === "boolean";
  return false;
}

describe("entrysets.json sample data", () => {
  it("has ids 1 through 21, each present exactly once", () => {
    const ids = Object.values(entrysets)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("every item label used is a real individual.json item", () => {
    for (const entryset of Object.values(entrysets)) {
      for (const individualLabel of Object.keys(entryset.items)) {
        expect(individualsByLabel.has(individualLabel)).toBe(true);
      }
    }
  });

  it("every field used is a real field of its individual, with a matching type", () => {
    for (const entryset of Object.values(entrysets)) {
      for (const [individualLabel, fields] of Object.entries(entryset.items)) {
        const individual = individualsByLabel.get(individualLabel)!;
        const fieldsByLabel = new Map(individual.fields.map((f) => [f.label, f]));
        for (const [fieldLabel, value] of Object.entries(fields)) {
          const fieldDef = fieldsByLabel.get(fieldLabel);
          expect(fieldDef, `${individualLabel}.${fieldLabel} is not a declared field`).toBeTruthy();
          expect(typeMatches(fieldDef!.type, value)).toBe(true);
        }
      }
    }
  });

  it("every entryset has observation_window and a vehicle_identity.vehicle_type", () => {
    for (const entryset of Object.values(entrysets)) {
      expect(entryset.items.observation_window).toBeTruthy();
      expect(entryset.items.vehicle_identity?.vehicle_type).toBeTruthy();
    }
  });

  it("entrysets 1-21 distribute across databases per the precomputed hash table", () => {
    for (const [idStr, expectedIdx] of Object.entries(EXPECTED_DB_INDEX)) {
      const id = Number(idStr);
      expect(dbIndexForEntrysetId(id)).toBe(expectedIdx);
      expect(entrysets[idStr]?.id).toBe(id);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: FAIL — only 5 entrysets exist so far (the "ids 1 through 21" and "distribute across databases" checks fail).

- [ ] **Step 3: Add 16 new entrysets (ids 6-21) to `mock-server/data/entrysets.json`**

Add one entry per id below, each a distinct, internally-consistent scenario (exact field values are yours to choose realistically within each item's declared fields — cross-check every value against `individual.json` and sanity-check consistency within each entryset before moving to the next):

| id | database (verified via `dbIndexForEntrysetId`) | scenario |
|---|---|---|
| 6 | alpha | Bus on a fixed route, mid-route with passengers |
| 7 | zeta | Tow truck en route to a call, empty flatbed |
| 8 | beta | Taxi idling at a stand, engine on, no passenger/trip yet |
| 9 | alpha | Garbage truck on a collection route, frequent stop-start |
| 10 | zeta | Rideshare car mid-trip with a passenger |
| 11 | beta | Light truck idling at a warehouse loading dock, stationary |
| 12 | epsilon | Police cruiser on patrol, moderate speed |
| 13 | zeta | Ambulance en route with lights/sirens active |
| 14 | beta | Farm tractor working a field, low speed, high load |
| 15 | epsilon | EV charging at a station, stationary, high battery draw/charging fields active, ignition likely off |
| 16 | gamma | Motorcycle courier en route in city traffic |
| 17 | beta | Box truck stopped in heavy traffic, engine idling |
| 18 | epsilon | School bus stopped for a passenger pickup, hazard lights on |
| 19 | gamma | Long-haul semi parked at a highway rest stop, engine idling for HVAC |
| 20 | delta | Delivery van backing into a loading dock, very low speed |
| 21 | delta | Rental car idling in a parking lot waiting for pickup, parking brake engaged |

For each: pick items appropriate to the scenario (always include `observation_window` and `vehicle_identity` with a `vehicle_type`; include `trip_context` only when there's an active trip; include `gps_position` for any vehicle that isn't indoors; choose engine/powertrain/battery items matching whether the vehicle is a combustion, EV, or hybrid vehicle_type; include domain-relevant items — e.g. `hazard_light_status` for the school bus and ambulance, `battery_ev`-group items for the EV, brake/suspension items for the tow truck and dump-truck-style vehicles). Vary total item count per entryset (roughly 10-40, matching the existing spread) rather than making every entryset the same size.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: PASS (all 5 checks). If the "distribute across databases" check fails, you used the wrong id for a scenario — match ids to the table above exactly (id is what determines the database, not the scenario content).

- [ ] **Step 5: Run the full test suite once more**

Run: `npx vitest run`
Expected: all PASS — in particular, `/api/query`'s manual smoke test from Task 5 Step 6 (optional to re-run) now returns up to 25 of the 21 entrysets when all 7 databases are selected.

- [ ] **Step 6: Commit**

```bash
git add mock-server/data/entrysets.json tests/mock-server/entrysetsData.test.ts
git commit -m "feat: expand sample entrysets to 21, covering all 7 databases"
```

---

## Task 7: Documentation cleanup

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `src/ui/databasePicker.ts` (comment only)

**Interfaces:** none — documentation only, no code behavior changes.

- [ ] **Step 1: Fix the stale comment in `src/ui/databasePicker.ts`**

Replace the file's top doc comment:

```ts
/**
 * The database scope selector, above the query builder. "Each kind of plant has
 * its own database" — so this is a checkbox per database (species). Changing it
 * behaves like editing the query (see main.ts onDatabasesChange + §6).
 */
```

with:

```ts
/**
 * The database scope selector, above the query builder. Databases are 7
 * arbitrary partitions with no semantic tie to entryset content (see
 * mock-server/databases.ts) — this is a checkbox per database. Changing it
 * behaves like editing the query (see main.ts onDatabasesChange + §6).
 */
```

- [ ] **Step 2: Rewrite `docs/ARCHITECTURE.md` §4 (directory layout) mock-server rows**

Replace the `mock-server/` block in §4's directory tree (currently listing `index.ts`, `catalog.ts`, `data.ts`, `evaluate.ts`, `vehicleData.ts`, `data/`) with:

```
mock-server/
  index.ts             Dev-only. Plain Node http: routing + JSON I/O + paginate().
                       Starts only when run as the entrypoint.
  schema.ts            FieldDef/OperatorDef/ValueType/Arity types, OPERATORS,
                       and buildFields(individuals) — the generic field
                       catalog, derived purely from individual.json's
                       declared item/field shape (never from specific
                       item/field names or values).
  databases.ts         DatabaseDef type, DATABASES (7 synthetic, arbitrarily
                       named ALPHA..ETA partitions with mock-only sizes),
                       dbIndexForEntrysetId(id) / databaseIdForEntrysetId(id)
                       — a pure function of an entryset's numeric id, never
                       of its content.
  rows.ts              flattenEntryset(entryset) -> Row (nested items ->
                       dotted "individualLabel.fieldLabel" keys + a
                       synthetic __db key) and ROWS, every entryset
                       flattened once at startup.
  evaluate.ts          matches(node, row) recursive evaluator + computeBlocks(query, rows, fields)
                       + filterByDatabases(rows, ids) / perDatabaseCounts(query, rows, ids)
                       (keyed on row.__db). Fully generic: takes FieldDef[]
                       as a parameter rather than importing a data-specific
                       catalog.
  vehicleData.ts       Loads data/individual.json + data/entrysets.json via
                       fs.readFileSync -> INDIVIDUALS, ENTRYSETS.
  data/
    individual.json    The vehicle/fleet telemetry data model: ~157 items (4 metadata
                       + ~153 content items across 18 subsystem groups: engine,
                       powertrain, fuel, emissions, cooling, electrical, EV battery,
                       tires/wheels, brakes, suspension, steering, body/chassis,
                       lighting, HVAC, infotainment, ADAS, radar/lidar, diagnostics,
                       driver behavior, environment context), each with
                       label/group/tags/id_number/name/description/comment/stats/
                       fields. stats.count/percentage is that item's share of a mock
                       6-billion-entryset universe, tiered by real-world commonality
                       (near-universal/common/uncommon/rare) so it agrees with the
                       item's own description.
    entrysets.json     Actual telemetry records referencing individual.json's items,
                       keyed by entryset id (string): `{ [id]: { id, items: {
                       [individualLabel]: { [fieldLabel]: value } } } }`. 21 example
                       entrysets (ids 1-21), each a distinct, internally-consistent
                       vehicle/event scenario, spread across all 7 mock databases via
                       dbIndexForEntrysetId(id).
```

- [ ] **Step 3: Rewrite §7's `GET /api/databases` and `POST /api/query` sections**

Replace:

```
### `GET /api/databases`

The databases the query can be scoped to. "Each kind of plant has its own
database", so the mock derives these from its species list.
```

with:

```
### `GET /api/databases`

The databases the query can be scoped to: 7 arbitrary, content-agnostic
partitions (`mock-server/databases.ts`). An entryset's database is a pure
function of its own numeric id (`dbIndexForEntrysetId`) — never of anything
inside it — which is what keeps this mock decoupled from the concrete shape
of `entrysets.json`'s content.
```

Replace the `POST /api/query` section's body (the paragraph starting "Body: ... — **transitional** — the query and databases are otherwise ignored...") with:

```
Body: `{ "query": <QueryNode tree>, "databases": string[], "page": number, "pageSize": number }`.
Called only on **Run / Refresh**. Same `400` validation as `/api/stats`. The
mock scopes `ROWS` (every entryset, flattened) to the selected databases,
evaluates the query against them, and maps matching rows back to their
source entrysets, capped at 25. `page`/`pageSize` are accepted but unused —
there is no pagination (§9); the whole capped result comes back in one
response.
```

- [ ] **Step 4: Rewrite §10 (Mock server) to describe the single, unified model**

Replace the entire §10 section body (from "Dev-only. `npm run mock`..." through the "Bad query, or missing / empty `databases` → `400 { error }`." line) with:

```
Dev-only. `npm run mock` starts it; Vite proxies `/api/*` to it. Plain Node
`http`, no Express, heavily commented top to bottom.

- `mock-server/schema.ts` builds the field/operator catalog purely from
  `individual.json`'s declared item/field shape: one field per
  (individual, field) pair, id `"individualLabel.fieldLabel"`, `valueType`
  mapped from the declared `str`/`int`/`float`/`bool` type, and
  `operatorIds` assigned by a generic per-valueType profile (never per
  specific field). `GET /api/schema` returns this catalog.
- `mock-server/databases.ts` defines 7 synthetic databases (`ALPHA`..`ETA`),
  each with a mock-only `size` spanning several orders of magnitude, and
  `dbIndexForEntrysetId(id)` — a hash of the entryset's own numeric id that
  assigns it to exactly one database, independent of its content.
  `GET /api/databases` returns these **without** `size` (it isn't part of
  the contract).
- `mock-server/rows.ts` flattens every entryset in `ENTRYSETS`
  (`mock-server/vehicleData.ts`) into a flat `Row` — dotted
  `"individualLabel.fieldLabel"` keys matching the schema's field ids, plus
  a synthetic `__db` key from `databaseIdForEntrysetId` — once at startup
  (`ROWS`).
- `POST /api/stats` scopes `ROWS` to the selected databases
  (`filterByDatabases`, keyed on `row.__db`), evaluates the query
  (`matches`), and scales the sample's match rate onto each database's
  `size` (`scaleCount`) so the UI sees realistic large numbers exactly as
  before — only the underlying data changed, not the scaling technique.
- `POST /api/query` scopes and evaluates the same way, then maps matching
  rows back to their source `Entryset` objects via `ENTRYSETS[id]`, capped
  at 25.
- Bad query, or missing / empty `databases` → `400 { error }`.

Shares **no code** with `src/`. It stands in for "a real backend in any
language"; the frontend knows it only through `src/api/types.ts`.
```

- [ ] **Step 5: Append a changelog entry to §13**

Add a new row at the end of the changelog table:

```
| 2026-09-16 | Finalized the entrysets transition: the query builder, database picker, and stats panel now run against the entryset/individual model (previously only the docs sidebar and preview did). Replaced the plant/species mock (`catalog.ts`, `data.ts`) with `schema.ts` (field catalog built purely from `individual.json`'s declared shape), `databases.ts` (7 arbitrary, content-agnostic databases partitioned by a hash of each entryset's id), and `rows.ts` (flattens entrysets into the flat rows the existing matching engine expects). `POST /api/query` now filters for real instead of always returning every entryset. `evaluate.ts`'s `computeBlocks` takes `fields` as an explicit parameter instead of importing a data-specific catalog. Sample data grew from 5 to 21 entrysets so every database has real sample data. No changes to `src/` — it already consumed the API purely through its typed contract. |
```

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md src/ui/databasePicker.ts
git commit -m "docs: rewrite ARCHITECTURE.md for the finalized entrysets model"
```
