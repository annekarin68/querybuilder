# API Types Refactoring Implementation Plan (Revision 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the already-merged Revision-1 contract (PR #12) in line with the real production backend contract: correct `StatsResponse`/`DatabasesResponse`/`IndividualField`/`Individual`'s actual shapes, remove the invented `GET /api/schema` endpoint entirely in favor of a client-side field-catalog derivation, and keep the frontend decoupled from backend implementation details (never branch on `cardinality`).

**Architecture:** This is a corrective pass over already-implemented code, not a greenfield build. Each task states the CURRENT content it's replacing (as of commit on this branch) so the diff is exact. Work proceeds bottom-up: the contract (`src/api/types.ts`) first, then the new client-side field catalog, then the mock server, then every frontend consumer, then the living architecture doc.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Node's built-in `http` module (mock server).

**Spec:** `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md` (Revision 2 — read the "Revision 2" note at the top; it explains exactly what changed from Revision 1).

## Global Constraints

- Node 20.19+ toolchain floor.
- `tsconfig.json` strict mode — every task leaves `npm run typecheck` cleaner than it found it; the final task leaves it at zero errors.
- No `jquery` import outside `src/ui/fomantic.ts`. `src/**` may not import `mock-server/*` (types-only imports from `mock-server` into `src` never happen either way — the coupling rule in this plan is the reverse: `mock-server` importing a type from `src/api/types.ts`, which is already established practice).
- **Frontend/backend decoupling (spec §1, hard constraint):** nothing in `src/**` may read `IndividualField.cardinality` for any control-flow decision. Enum detection is always `values.length > 0`.
- Vitest unit tests target pure modules only. `src/ui/*.ts` panel files and `mock-server/index.ts`'s route handlers have no dedicated tests, per established convention — verified by `npm run typecheck` and manual `npm run dev` smoke checks instead.
- `docs/ARCHITECTURE.md` is a living document — updated in the same overall change (Task 14).

---

## File Structure

**Contract:**
- Modify: `src/api/types.ts` — delete `SchemaResponse`/`IndividualsResponse`; replace `StatsResponse`/`DatabasesResponse`/`IndividualField`/`Individual` with the real shapes.

**New frontend module (replaces the deleted `GET /api/schema`):**
- Create: `src/query/fieldCatalog.ts` — `buildFieldCatalog`, `OPERATORS`, `CatalogField`, `CatalogOperator`.
- Create: `tests/query/fieldCatalog.test.ts`.

**Mock server:**
- Delete: `mock-server/schema.ts`.
- Modify: `mock-server/vehicleData.ts` — local `IndividualField`/`Individual` types match the real shape.
- Modify: `mock-server/databases.ts` — `DatabaseDef` gains `description`/`owner`/`percentageOfTotal`, `size`→`totalEntrysets`.
- Modify: `mock-server/evaluate.ts` — `buildStatsLine`/`DatabaseOutcome` drop `totalCount`, rename `validationErrors`→`errorMessages`, `matchCount` becomes optional.
- Modify: `mock-server/index.ts` — `/api/schema` route deleted; `/api/databases` returns a bare array with all fields; `/api/stats` adjusted.
- Modify: `mock-server/data/individual.json` — 157 entries migrated via a one-time script (`idNumber`, `totalCount`, realistic `type`/`format`/`cardinality`/`values`).

**Frontend consumers:**
- Modify: `src/api/client.ts` — `getSchema` deleted; `getDatabases`/`getIndividuals` return bare-array promises.
- Modify: `src/state.ts` — `AppState.schema`/`databases`/`individuals` retyped.
- Modify: `src/main.ts` — startup no longer fetches schema; calls `buildFieldCatalog` locally.
- Modify: `src/ui/queryBuilder.ts`, `src/ui/valueControl.ts` — `SchemaResponse` → `CatalogField`/`CatalogOperator`.
- Modify: `src/ui/docsSidebar.ts` — percentage computed client-side; bare `individuals` array.
- Modify: `src/ui/dataPreview.ts` — bare `individuals` array.
- Modify: `src/ui/statsPanel.ts` — new `StatsResponse` shape (no `totalCount`, optional `matchCount`, `errorMessages`).

**Tests:**
- Modify: `tests/api/client.test.ts`, `tests/state.test.ts`, `tests/mock-server/databaseCatalog.test.ts`, `tests/mock-server/stats.test.ts`, `tests/mock-server/entrysetsData.test.ts`, `tests/ui/valueControl.test.ts`.
- Delete: `tests/mock-server/schema.test.ts` (replaced by `tests/query/fieldCatalog.test.ts`).
- No changes needed: `tests/query/summary.test.ts`, `tests/query/validate.test.ts`, `tests/mock-server/databases.test.ts` (the `perDatabaseCounts`/`filterByDatabases`/`scaleCount` tests — unaffected), `tests/mock-server/rows.test.ts`, `tests/mock-server/evaluate.test.ts`, `tests/mock-server/query.test.ts`.

**Docs:**
- Modify: `docs/ARCHITECTURE.md`.

---

### Task 1: `src/api/types.ts` — the corrected contract

**Files:**
- Modify: `src/api/types.ts`

**Interfaces:**
- Produces: `StatsResponse { label, success, matchCount?, errorMessages?, infoMessages? }`, `DatabasesResponse { description, name, owner, totalEntrysets, percentageOfTotal, label }`, `IndividualField { label, type, description, comment, cardinality, values, format, name? }`, `Individual { label, group, tags, idNumber, name, description, comment, totalCount, fields }`. Removes: `SchemaResponse`, `IndividualsResponse`.

- [ ] **Step 1: Replace the file's contents**

The CURRENT file (for reference — you are replacing all of it):

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

export type StatsResponse =
  | { label: string; success: true; matchCount: number; totalCount: number; infoMessages: string[] }
  | { label: string; success: false; validationErrors: string[]; infoMessages: string[] };

export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  name?: string;
  values?: string[];
}

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

export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

export interface EntrysetsResponse {
  entrysets: Entryset[];
}

export interface DatabasesResponse {
  databases: { label: string; name: string }[];
}
```

Replace the ENTIRE file with:

```ts
/**
 * One database's result from the POST /api/stats stream. The endpoint's
 * response body is newline-delimited JSON today (the backend may change the
 * streaming format later): one of these per selected database, written as
 * soon as that database's result is ready — some databases are slower than
 * others, or can fail independently.
 */
export interface StatsResponse {
  /** Database ID — matches DatabasesResponse.label. */
  label: string;
  /** Whether the query to this specific database succeeded. There is no
   *  per-database HTTP status in an NDJSON stream, so this is how failure
   *  is signaled instead. */
  success: boolean;
  /** Individuals matched by this query in this database. Only meaningful
   *  when `success` is true — optional rather than a fabricated 0, so a
   *  failed database can never be misread as "zero rows matched." */
  matchCount?: number;
  /** Errors from the query itself — malformed dates, too-large numbers,
   *  too-long strings, etc. */
  errorMessages?: string[];
  /** Other information or error messages — a database timeout, an internal
   *  server error, or a non-blocking notice. */
  infoMessages?: string[];
}

/** The databases the query can be scoped to (GET /api/databases). Returns
 *  DatabasesResponse[] directly — no wrapper object. */
export interface DatabasesResponse {
  /** A short summary of what this database contains or what makes it unique. */
  description: string;
  /** User-friendly display name. */
  name: string;
  /** The title of this database's owner — the company that reported the data. */
  owner: string;
  /** Total entrysets in this database. */
  totalEntrysets: number;
  /** This database's share of the total data across all databases — sums
   *  to 100% across every database returned. */
  percentageOfTotal: number;
  /** API-friendly "ID", not meant to be displayed. */
  label: string;
}

/** One field an individual's telemetry item can report (GET /api/individuals). */
export interface IndividualField {
  /** This field's locally unique, API-friendly "ID" within this individual. */
  label: string;
  /** The field's actual type, defined by the backend (e.g. VARCHAR, BIGINT,
   *  TIMESTAMP). Takes precedence over `format` when both are present. */
  type: string;
  /** A third-party technical description. May contain errors — present it
   *  visually distinct from `comment`. */
  description: string;
  /** The backend's own, always-correct description — present it visually
   *  distinct from `description`. */
  comment: string;
  /** Distinct values for this field across all databases, as of right now.
   *  Can be 0 to several billion. Informational only — NEVER branch on this
   *  to decide whether a field is enum-like; check `values.length` instead. */
  cardinality: number;
  /** The field's actual distinct values, when the backend chooses to supply
   *  them. Empty when not supplied — that emptiness, not `cardinality`, is
   *  what determines whether a field is treated as an enum. */
  values: string[];
  /** A third-party type hint, used only when `type` is empty. */
  format: string;
  /** Reserved for a future human-readable name; not populated by the backend
   *  yet. Anywhere this is displayed, fall back to `label` when absent/empty. */
  name?: string;
}

/**
 * One item in the vehicle telemetry data model — a signal, sensor, or piece
 * of metadata that an entryset may hold a value for.
 */
export interface Individual {
  /** Unique "ID" for API requests — a permutation of `name` with special
   *  characters removed. */
  label: string;
  /** A third-party grouping tag. Less useful than our own `tags`. */
  group: string;
  /** Our own tags, from a limited reusable pool. More useful than `group`. */
  tags: string[];
  /** This individual's unique identification number. */
  idNumber: number;
  /** Descriptive name, shown to the user in place of `label`. */
  name: string;
  /** A third-party technical description — present distinct from `comment`. */
  description: string;
  /** The backend's own, always-correct description. */
  comment: string;
  /** How many times this individual appears across ALL databases. No
   *  percentage is supplied — the frontend derives one from
   *  DatabasesResponse[].totalEntrysets (see docsSidebar.ts). */
  totalCount: number;
  fields: IndividualField[];
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
```

- [ ] **Step 2: Confirm the expected fallout**

Run: `npm run typecheck`
Expected: many errors, across `mock-server/schema.ts`, `mock-server/vehicleData.ts`, `mock-server/index.ts`, `mock-server/evaluate.ts`, `src/api/client.ts`, `src/state.ts`, `src/main.ts`, `src/ui/queryBuilder.ts`, `src/ui/valueControl.ts`, `src/ui/docsSidebar.ts`, `src/ui/dataPreview.ts`, `src/ui/statsPanel.ts`, and several test files. Expected and correct — later tasks close each one off. Do not fix any of them in this task.

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "refactor(api): correct StatsResponse/DatabasesResponse/IndividualField/Individual against the real production contract

Revision 2: replaces Revision 1's guessed shapes. Removes SchemaResponse
and IndividualsResponse entirely — GET /api/schema doesn't exist in the
real API and GET /api/individuals returns a bare array."
```

---

### Task 2: `src/query/fieldCatalog.ts` — client-side field catalog (new)

**Files:**
- Create: `src/query/fieldCatalog.ts`
- Create: `tests/query/fieldCatalog.test.ts`

**Interfaces:**
- Consumes: `Individual` (Task 1).
- Produces: `CatalogField { label, name, valueType, description, options?, operatorIds }`, `CatalogOperator { label, name, description, arity }`, `OPERATORS: CatalogOperator[]`, `buildFieldCatalog(individuals: Individual[]): { fields: CatalogField[]; operators: CatalogOperator[] }` — consumed by Task 10 (`main.ts`), Task 11 (`queryBuilder.ts`/`valueControl.ts`).

This is a straight port of `mock-server/schema.ts`'s `buildFields`/`OPERATORS`, adjusted for the real `IndividualField` shape (§5a of the spec) — reproduced here so you don't need to read the mock file (it's deleted in Task 3 anyway).

- [ ] **Step 1: Write the failing tests**

Create `tests/query/fieldCatalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFieldCatalog, OPERATORS } from "../../src/query/fieldCatalog";
import type { Individual } from "../../src/api/types";

const individuals: Individual[] = [
  {
    label: "engine_rpm",
    group: "engine",
    tags: [],
    idNumber: 1,
    name: "Engine RPM",
    description: "Engine rotational speed.",
    comment: "",
    totalCount: 100,
    fields: [
      {
        label: "value_rpm",
        type: "BIGINT",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "redline_rpm",
        type: "BIGINT",
        description: "Redline for this engine.",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "is_over_rev",
        type: "BOOLEAN",
        description: "",
        comment: "",
        cardinality: 2,
        values: [],
        format: "",
      },
    ],
  },
  {
    label: "vehicle_identity",
    group: "metadata",
    tags: [],
    idNumber: 2,
    name: "Vehicle identity",
    description: "Identifying info for the vehicle.",
    comment: "",
    totalCount: 100,
    fields: [
      {
        label: "vin",
        type: "VARCHAR",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
      {
        label: "vehicle_type",
        type: "VARCHAR",
        description: "",
        comment: "",
        cardinality: 5000,
        values: [],
        format: "",
      },
    ],
  },
];

describe("buildFieldCatalog", () => {
  it("labels are dotted individualLabel.fieldLabel", () => {
    const { fields } = buildFieldCatalog(individuals);
    expect(fields.map((f) => f.label)).toEqual([
      "engine_rpm.value_rpm",
      "engine_rpm.redline_rpm",
      "engine_rpm.is_over_rev",
      "vehicle_identity.vin",
      "vehicle_identity.vehicle_type",
    ]);
  });

  it("maps backend type to valueType", () => {
    const { fields } = buildFieldCatalog(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.valueType).toBe("number");
    expect(fields.find((f) => f.label === "engine_rpm.is_over_rev")?.valueType).toBe("boolean");
    expect(fields.find((f) => f.label === "vehicle_identity.vin")?.valueType).toBe("string");
  });

  it("falls back to format when type is empty", () => {
    const withFallback: Individual[] = [
      {
        ...individuals[0]!,
        fields: [
          {
            label: "observed_at",
            type: "",
            description: "",
            comment: "",
            cardinality: 100_000,
            values: [],
            format: "TIMESTAMP",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(withFallback);
    expect(fields[0]?.valueType).toBe("date");
  });

  it("name combines the individual's name and the field's label", () => {
    const { fields } = buildFieldCatalog(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.name).toBe(
      "Engine RPM: value_rpm",
    );
  });

  it("description falls back to the individual's description when the field's is empty", () => {
    const { fields } = buildFieldCatalog(individuals);
    expect(fields.find((f) => f.label === "engine_rpm.value_rpm")?.description).toBe(
      "Engine rotational speed.",
    );
    expect(fields.find((f) => f.label === "engine_rpm.redline_rpm")?.description).toBe(
      "Redline for this engine.",
    );
  });

  it("assigns operatorIds per valueType, all of which are real operator labels", () => {
    const { fields } = buildFieldCatalog(individuals);
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

  it("a field with non-empty values becomes an enum field with matching options, regardless of cardinality", () => {
    const withValues: Individual[] = [
      {
        ...individuals[1]!,
        fields: [
          {
            label: "vehicle_type",
            type: "VARCHAR",
            description: "",
            comment: "",
            cardinality: 500, // deliberately high — must be ignored
            values: ["sedan", "van"],
            format: "",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(withValues);
    const field = fields.find((f) => f.label === "vehicle_identity.vehicle_type");
    expect(field?.valueType).toBe("enum");
    expect(field?.options).toEqual([
      { value: "sedan", label: "sedan" },
      { value: "van", label: "van" },
    ]);
    expect(field?.operatorIds).toEqual(["eq", "neq", "in", "isEmpty", "isNotEmpty"]);
  });

  it("a field with empty values is never valueType enum, no matter its cardinality", () => {
    const lowCardinalityNoValues: Individual[] = [
      {
        ...individuals[1]!,
        fields: [
          {
            label: "vehicle_type",
            type: "VARCHAR",
            description: "",
            comment: "",
            cardinality: 3, // deliberately low — must still be ignored
            values: [],
            format: "",
          },
        ],
      },
    ];
    const { fields } = buildFieldCatalog(lowCardinalityNoValues);
    expect(fields.every((f) => f.valueType !== "enum")).toBe(true);
  });
});

describe("OPERATORS", () => {
  it("arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query/fieldCatalog.test.ts`
Expected: FAIL — `src/query/fieldCatalog.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/query/fieldCatalog.ts`**

```ts
import type { Individual } from "../api/types";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface CatalogField {
  label: string;
  name: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface CatalogOperator {
  label: string;
  name: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: CatalogOperator[] = [
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

/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  enum: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
};

/**
 * Backend `type` (or, when `type` is empty, `format`) -> this catalog's
 * valueType. Never inferred from a field's name or its values.
 */
function valueTypeFor(field: { type: string; format: string }): ValueType {
  const declared = field.type || field.format;
  switch (declared) {
    case "BIGINT":
    case "DOUBLE":
      return "number";
    case "BOOLEAN":
      return "boolean";
    case "TIMESTAMP":
      return "date";
    default:
      return "string";
  }
}

/**
 * One queryable field per (individual, field) pair, derived purely from
 * already-fetched Individual[] data — the real API has no schema/operators
 * endpoint. Field label is the dotted "individualLabel.fieldLabel" path,
 * matching how an entryset nests its values, so it doubles as the flattened
 * lookup key.
 *
 * Enum detection is `values.length > 0` — deliberately NEVER `cardinality`.
 * The backend's own rule for when it populates `values` is an implementation
 * detail that can change at any time; this catalog only reacts to whether
 * `values` actually has entries.
 */
export function buildFieldCatalog(individuals: Individual[]): {
  fields: CatalogField[];
  operators: CatalogOperator[];
} {
  const fields: CatalogField[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const isEnum = f.values.length > 0;
      const valueType = isEnum ? "enum" : valueTypeFor(f);
      fields.push({
        label: `${ind.label}.${f.label}`,
        name: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        options: isEnum ? f.values.map((v) => ({ value: v, label: v })) : undefined,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return { fields, operators: OPERATORS };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/query/fieldCatalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/query/fieldCatalog.ts tests/query/fieldCatalog.test.ts
git commit -m "feat(query): add client-side field catalog, replacing the invented GET /api/schema

Enum detection is values.length > 0, never cardinality — the real
backend's threshold for populating values is an implementation detail
the frontend must not depend on."
```

---

### Task 3: Remove `GET /api/schema` (delete `mock-server/schema.ts`)

**Files:**
- Delete: `mock-server/schema.ts`
- Delete: `tests/mock-server/schema.test.ts` (superseded by Task 2's `tests/query/fieldCatalog.test.ts`)
- Modify: `mock-server/vehicleData.ts`
- Modify: `mock-server/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mock-server/vehicleData.ts`'s local `IndividualField`/`Individual` types now match the real shape (Task 7 populates real data against them). `mock-server/index.ts` no longer has a `/api/schema` route.

- [ ] **Step 1: Delete the files**

```bash
git rm mock-server/schema.ts tests/mock-server/schema.test.ts
```

- [ ] **Step 2: Update `mock-server/vehicleData.ts`'s local types**

Current:

```ts
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  name?: string;
  values?: string[];
}

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
```

Replace with:

```ts
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  cardinality: number;
  values: string[];
  format: string;
  name?: string;
}

export interface Individual {
  label: string;
  group: string;
  tags: string[];
  idNumber: number;
  name: string;
  description: string;
  comment: string;
  totalCount: number;
  fields: IndividualField[];
}
```

(The rest of the file — `loadIndividuals`, `loadEntrysets`, `Entryset`, the `INDIVIDUALS`/`ENTRYSETS` exports — is untouched.)

- [ ] **Step 3: Remove the `/api/schema` route from `mock-server/index.ts`**

Change the imports at the top:

```ts
import { buildFields, OPERATORS } from "./schema";
import { DATABASES } from "./databases";
```

to:

```ts
import { DATABASES } from "./databases";
```

Delete the `const FIELDS = buildFields(INDIVIDUALS);` line.

Delete the whole `/api/schema` route block:

```ts
    if (req.method === "GET" && url.pathname === "/api/schema") {
      sendJson(res, 200, { fields: FIELDS, operators: OPERATORS });
      return;
    }
```

- [ ] **Step 4: Confirm the expected fallout**

Run: `npx tsc --noEmit`
Expected: `mock-server/index.ts` itself should now be clean of `/api/schema`-related errors (the `/api/databases` and `/api/stats` routes still have errors from Task 1's rename — that's Task 6's job, not this one). `mock-server/vehicleData.ts` should be clean. Other files (`src/`, `mock-server/evaluate.ts`) still show unrelated pre-existing errors — expected.

- [ ] **Step 5: Commit**

```bash
git add -A mock-server/schema.ts tests/mock-server/schema.test.ts mock-server/vehicleData.ts mock-server/index.ts
git commit -m "refactor(mock): remove GET /api/schema — not part of the real API contract

Superseded by src/query/fieldCatalog.ts (Task 2), which derives the
same field catalog client-side from already-fetched Individual[] data."
```

---

### Task 4: `mock-server/databases.ts` — real `DatabaseDef` shape

**Files:**
- Modify: `mock-server/databases.ts`
- Test: `tests/mock-server/databaseCatalog.test.ts`

**Interfaces:**
- Produces: `DatabaseDef { description, name, owner, totalEntrysets, percentageOfTotal, label }` (matches `DatabasesResponse` exactly — the mock's own record IS now the wire shape, no per-field mapping needed at the route). `DATABASES: DatabaseDef[]`. `dbIndexForEntrysetId`/`databaseIdForEntrysetId` unchanged in signature.

- [ ] **Step 1: Update the test's fixture expectations**

In `tests/mock-server/databaseCatalog.test.ts`, the `"every database has a positive size..."` test reads `d.size`. Change it to `d.totalEntrysets`:

```ts
  it("every database has a positive totalEntrysets, spanning several orders of magnitude", () => {
    for (const d of DATABASES) expect(d.totalEntrysets).toBeGreaterThan(0);
    const sizes = DATABASES.map((d) => d.totalEntrysets);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1000);
  });
```

(The `name`/`label` test above it, and the `dbIndexForEntrysetId`/`databaseIdForEntrysetId` describe blocks below it, are unchanged.)

Add a new test for the new fields, appended to the `describe("DATABASES", ...)` block:

```ts
  it("percentageOfTotal is each database's share of totalEntrysets, summing to ~100", () => {
    const sum = DATABASES.reduce((s, d) => s + d.percentageOfTotal, 0);
    expect(sum).toBeCloseTo(100, 0);
    for (const d of DATABASES) {
      expect(d.percentageOfTotal).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.owner.length).toBeGreaterThan(0);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/databaseCatalog.test.ts`
Expected: FAIL — `d.totalEntrysets`/`d.percentageOfTotal`/`d.description`/`d.owner` are all `undefined` on the current `DatabaseDef` shape.

- [ ] **Step 3: Rewrite `mock-server/databases.ts`**

```ts
export interface DatabaseDef {
  /** A short summary of what this database contains or what makes it unique. */
  description: string;
  /** User-friendly display name. */
  name: string;
  /** The title of this database's owner — the company that reported the data. */
  owner: string;
  /** Mock-only pretend real size. Spans several orders of magnitude so the
   *  stats panel exercises billion-scale formatting. */
  totalEntrysets: number;
  /** This database's share of the combined totalEntrysets across all 7 —
   *  computed below so the set always sums to ~100%. */
  percentageOfTotal: number;
  /** API-friendly "ID", not meant to be displayed. */
  label: string;
}

interface DatabaseSeed {
  label: string;
  name: string;
  description: string;
  owner: string;
  totalEntrysets: number;
}

/**
 * Seven arbitrary, content-agnostic partitions — database identity carries
 * no meaning tied to entryset content (product decision: "the database
 * names do not really matter"). totalEntrysets values are hand-picked
 * constants spanning ~12K to ~5.6B, mirroring the old catalog's spread.
 */
const SEEDS: DatabaseSeed[] = [
  {
    label: "alpha",
    name: "ALPHA",
    description: "A small pilot fleet, recently onboarded.",
    owner: "Alpha Fleet Analytics",
    totalEntrysets: 12_345,
  },
  {
    label: "beta",
    name: "BETA",
    description: "Regional delivery and rideshare vehicles.",
    owner: "Beta Mobility Group",
    totalEntrysets: 88_000,
  },
  {
    label: "gamma",
    name: "GAMMA",
    description: "Municipal and emergency service vehicles.",
    owner: "Gamma Civic Systems",
    totalEntrysets: 4_600_000,
  },
  {
    label: "delta",
    name: "DELTA",
    description: "Long-haul freight and heavy trucking.",
    owner: "Delta Freight Networks",
    totalEntrysets: 41_000_000,
  },
  {
    label: "epsilon",
    name: "EPSILON",
    description: "National rental and leasing fleets.",
    owner: "Epsilon Rental Holdings",
    totalEntrysets: 892_000_000,
  },
  {
    label: "zeta",
    name: "ZETA",
    description: "Large-scale rideshare and taxi telemetry.",
    owner: "Zeta Rideshare Inc.",
    totalEntrysets: 1_234_000_000,
  },
  {
    label: "eta",
    name: "ETA",
    description: "The largest partner: nationwide logistics and transit.",
    owner: "Eta Logistics & Transit Co.",
    totalEntrysets: 5_600_000_000,
  },
];

const TOTAL_ENTRYSETS = SEEDS.reduce((s, d) => s + d.totalEntrysets, 0);

export const DATABASES: DatabaseDef[] = SEEDS.map((s) => ({
  ...s,
  percentageOfTotal: (s.totalEntrysets / TOTAL_ENTRYSETS) * 100,
}));

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
git commit -m "refactor(mock): DatabaseDef matches the real DatabasesResponse shape (description/owner/totalEntrysets/percentageOfTotal)"
```

---

### Task 5: `mock-server/evaluate.ts` — `buildStatsLine` matches the real `StatsResponse`

**Files:**
- Modify: `mock-server/evaluate.ts`
- Test: `tests/mock-server/stats.test.ts`

**Interfaces:**
- Consumes: `StatsResponse` (Task 1).
- Produces: `buildStatsLine(outcome: DatabaseOutcome): StatsResponse` — `DatabaseOutcome { label; matchCount?: number; infoMessages?: string[]; fail?: { errorMessages: string[]; infoMessages: string[] } }`. `perDatabaseCounts`, `matches`, `filterByDatabases`, `scaleCount` are unchanged (already tested by `tests/mock-server/databases.test.ts`, which needs no changes).

- [ ] **Step 1: Replace `tests/mock-server/stats.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildStatsLine } from "../../mock-server/evaluate";

describe("buildStatsLine", () => {
  it("builds a successful line with matchCount", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3 })).toEqual({
      label: "alpha",
      success: true,
      matchCount: 3,
    });
  });

  it("carries through infoMessages on a successful line", () => {
    expect(
      buildStatsLine({ label: "alpha", matchCount: 3, infoMessages: ["slow"] }),
    ).toEqual({ label: "alpha", success: true, matchCount: 3, infoMessages: ["slow"] });
  });

  it("builds a failure line when fail is given, omitting matchCount entirely", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999, // must be ignored/dropped
      fail: { errorMessages: ["bad field"], infoMessages: [] },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      errorMessages: ["bad field"],
      infoMessages: [],
    });
    expect(line).not.toHaveProperty("matchCount");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/stats.test.ts`
Expected: FAIL — `buildStatsLine` still requires `totalCount` and returns `validationErrors`, not `errorMessages`.

- [ ] **Step 3: Update `mock-server/evaluate.ts`**

Replace `DatabaseOutcome`/`buildStatsLine`:

```ts
export interface DatabaseOutcome {
  label: string;
  /** Present only on success. */
  matchCount?: number;
  infoMessages?: string[];
  /** When set, this database's line reports failure instead of a count. */
  fail?: { errorMessages: string[]; infoMessages: string[] };
}

/** Turns one database's raw outcome into the StatsResponse line /api/stats streams for it. */
export function buildStatsLine(outcome: DatabaseOutcome): StatsResponse {
  if (outcome.fail) {
    const line: StatsResponse = {
      label: outcome.label,
      success: false,
      errorMessages: outcome.fail.errorMessages,
      infoMessages: outcome.fail.infoMessages,
    };
    return line;
  }
  const line: StatsResponse = { label: outcome.label, success: true, matchCount: outcome.matchCount };
  if (outcome.infoMessages) line.infoMessages = outcome.infoMessages;
  return line;
}
```

(`matches`, `conditionMatches`, `cmp`, `filterByDatabases`, `perDatabaseCounts`, `scaleCount`, and the `Row`/`JsonCondition`/`JsonGroup`/`JsonNode` types are all untouched.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mock-server/evaluate.ts tests/mock-server/stats.test.ts
git commit -m "refactor(mock): buildStatsLine matches the real StatsResponse (no totalCount, optional matchCount, errorMessages)"
```

---

### Task 6: `mock-server/index.ts` — `/api/databases` bare array, `/api/stats` adjusted

**Files:**
- Modify: `mock-server/index.ts`

**Interfaces:**
- Consumes: `DATABASES` (Task 4), `perDatabaseCounts`/`buildStatsLine`/`scaleCount` (Task 5).
- No dedicated test (route handlers untested, per convention) — verified by a manual curl check (Step 3) and `npx vitest run tests/mock-server/` (Step 4).

- [ ] **Step 1: Update the `/api/databases` route**

Current:

```ts
    if (req.method === "GET" && url.pathname === "/api/databases") {
      // `size` is mock-internal (drives the reported magnitudes) — not part of the contract.
      sendJson(res, 200, { databases: DATABASES.map(({ label, name }) => ({ label, name })) });
      return;
    }
```

Replace with:

```ts
    if (req.method === "GET" && url.pathname === "/api/databases") {
      // Every field on DatabaseDef IS the wire contract now — send the array directly.
      sendJson(res, 200, DATABASES);
      return;
    }
```

- [ ] **Step 2: Update the `/api/stats` route's line-building**

Current (the loop body):

```ts
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
```

Replace with:

```ts
      for (const c of counts) {
        const db = DATABASES.find((d) => d.label === c.label);
        const totalEntrysets = db?.totalEntrysets ?? 0;
        // Dev-only: occasionally (~5%) simulate a database that can't answer, so
        // the UI's per-database failure path gets exercised without a real backend.
        const line = buildStatsLine(
          Math.random() < 0.05
            ? {
                label: c.label,
                fail: {
                  errorMessages: [],
                  infoMessages: ["This database could not be reached. Try again shortly."],
                },
              }
            : {
                label: c.label,
                // The sample drives match RATES; DATABASES[].totalEntrysets drives
                // the MAGNITUDE the API reports, so the UI sees realistic numbers.
                matchCount: scaleCount(c.matchCount, c.totalCount, totalEntrysets),
              },
        );
        res.write(JSON.stringify(line) + "\n");
        await delay(150 + Math.random() * 250); // visibly stream in dev, roughly 150-400ms
      }
```

- [ ] **Step 3: Manually verify the stream**

Run: `npm run mock` (one terminal), then in another:
```bash
curl -s http://localhost:3001/api/databases | head -c 400
```
Expected: a bare JSON array starting with `[{"description":...` — no `{"databases":[...]}` wrapper.

```bash
curl -N -X POST http://localhost:3001/api/stats \
  -H 'content-type: application/json' \
  -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha","beta"]}'
```
Expected: two lines, each either `{"label":"alpha","success":true,"matchCount":...}` (no `totalCount` key at all) or the `success:false` shape with `errorMessages`. Stop the mock server (Ctrl+C) when done.

- [ ] **Step 4: Run the full mock-server test suite**

Run: `npx vitest run tests/mock-server/`
Expected: PASS (all mock-server tests, confirming Tasks 3-5's changes compose correctly).

- [ ] **Step 5: Commit**

```bash
git add mock-server/index.ts
git commit -m "feat(mock): /api/databases returns a bare array; /api/stats lines match the real StatsResponse"
```

---

### Task 7: Migrate `mock-server/data/individual.json` (157 entries)

**Files:**
- Modify: `mock-server/data/individual.json`
- Modify: `tests/mock-server/entrysetsData.test.ts`

**Interfaces:**
- Produces: every individual's `id_number`→`idNumber`, `stats: {percentage,count}`→`totalCount`; every field gains `cardinality`/`values`/`format` and a realistic backend `type`.

This is a mechanical, scriptable transformation — too large to hand-edit 157 entries. Write and run a one-time Node script, then delete it (only the resulting data + test changes get committed).

- [ ] **Step 1: Write the failing test**

In `tests/mock-server/entrysetsData.test.ts`, update the local `IndividualField` interface (currently `{label, type, description, comment, values?: string[]}`) to the real shape:

```ts
interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  cardinality: number;
  values: string[];
  format: string;
}
```

Update `typeMatches` — currently:

```ts
function typeMatches(declared: string, value: unknown): boolean {
  if (declared === "str") return typeof value === "string";
  if (declared === "int" || declared === "float") return typeof value === "number";
  if (declared === "bool") return typeof value === "boolean";
  return false;
}
```

to take the field (so it can fall back to `format` when `type` is empty, matching the real precedence rule) and the new type vocabulary:

```ts
function typeMatches(field: IndividualField, value: unknown): boolean {
  const declared = field.type || field.format;
  if (declared === "VARCHAR" || declared === "TIMESTAMP") return typeof value === "string";
  if (declared === "BIGINT" || declared === "DOUBLE") return typeof value === "number";
  if (declared === "BOOLEAN") return typeof value === "boolean";
  return false;
}
```

Update its one call site:

```ts
          expect(typeMatches(fieldDef!.type, value)).toBe(true);
```

to:

```ts
          expect(typeMatches(fieldDef!, value)).toBe(true);
```

Add a new test to the `describe("entrysets.json sample data", ...)` block, verifying the migration landed:

```ts
  it("every field has cardinality, values, and format after migration", () => {
    for (const ind of individualsByLabel.values()) {
      for (const f of ind.fields) {
        expect(typeof f.cardinality).toBe("number");
        expect(Array.isArray(f.values)).toBe(true);
        expect(typeof f.format).toBe("string");
      }
    }
  });

  it("observation_window.from_timestamp exercises the type-empty/format-fallback path", () => {
    const observationWindow = individualsByLabel.get("observation_window")!;
    const fromTimestamp = observationWindow.fields.find((f) => f.label === "from_timestamp")!;
    expect(fromTimestamp.type).toBe("");
    expect(fromTimestamp.format).toBe("TIMESTAMP");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: FAIL — `individual.json` doesn't have `cardinality`/`values`/`format` yet, and `id_number`/`stats` are still the old shape (the `typeMatches` signature change alone would already fail to compile/match against `"str"`/`"int"` declared types in the unmigrated file).

- [ ] **Step 3: Write and run the migration script**

Create `mock-server/data/.migrate.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(dir, "individual.json");
const wrappers = JSON.parse(readFileSync(file, "utf8"));

const TYPE_MAP = { str: "VARCHAR", int: "BIGINT", float: "DOUBLE", bool: "BOOLEAN" };

function migrateField(wrapperKey, f) {
  // Only a field whose ORIGINAL declared type was "str" can be a real
  // timestamp (an ISO date string) — a numeric field matching /timestamp/i
  // in its label (e.g. "timestamp_offset_s") is a numeric offset, not a
  // date, regardless of its name.
  const isTimestamp = f.type === "str" && /timestamp/i.test(f.label);
  const backendType = isTimestamp ? "TIMESTAMP" : (TYPE_MAP[f.type] ?? "VARCHAR");
  const isVehicleType = wrapperKey === "vehicle_identity" && f.label === "vehicle_type";
  const isFallbackExample = wrapperKey === "observation_window" && f.label === "from_timestamp";
  const cardinality =
    f.type === "bool" ? 2 : isVehicleType ? (f.values ? f.values.length : 19) : 50_000_000;
  const values = isVehicleType && f.values ? f.values : [];
  return {
    label: f.label,
    type: isFallbackExample ? "" : backendType,
    description: f.description,
    comment: f.comment,
    cardinality,
    values,
    format: isFallbackExample ? backendType : "",
  };
}

const migrated = wrappers.map((wrapper) => {
  const wrapperKey = Object.keys(wrapper)[0];
  const ind = wrapper[wrapperKey];
  return {
    [wrapperKey]: {
      label: ind.label,
      group: ind.group,
      tags: ind.tags,
      idNumber: ind.id_number,
      name: ind.name,
      description: ind.description,
      comment: ind.comment,
      totalCount: ind.stats.count,
      fields: ind.fields.map((f) => migrateField(wrapperKey, f)),
    },
  };
});

writeFileSync(file, JSON.stringify(migrated, null, 2) + "\n");
console.log(`Migrated ${migrated.length} individuals.`);
```

Run: `node mock-server/data/.migrate.mjs`
Expected output: `Migrated 157 individuals.`

Then delete the script: `rm mock-server/data/.migrate.mjs` (it's a one-time migration — only the resulting `individual.json` diff gets committed).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/entrysetsData.test.ts`
Expected: PASS — including the pre-existing "vehicle_identity.vehicle_type declares values covering every value used in the sample data" test (the script preserves `vehicle_type`'s existing 19-value list verbatim, since `isVehicleType` reuses `f.values` when present).

- [ ] **Step 5: Run the full mock-server test suite**

Run: `npx vitest run tests/mock-server/`
Expected: PASS (confirms nothing else that reads `individual.json` broke — `mock-server/schema.ts` is already deleted per Task 3, so nothing there depends on the old field shape anymore).

- [ ] **Step 6: Commit**

```bash
git add mock-server/data/individual.json tests/mock-server/entrysetsData.test.ts
git commit -m "feat(mock): migrate individual.json to the real IndividualField/Individual shape

idNumber/totalCount renamed; every field gains cardinality/values/format
with realistic backend type strings (VARCHAR/BIGINT/DOUBLE/BOOLEAN/
TIMESTAMP); observation_window.from_timestamp exercises the type-empty/
format-fallback path. vehicle_identity.vehicle_type keeps its existing
19-value enum list."
```

---

### Task 8: `src/api/client.ts` — bare-array `getDatabases`/`getIndividuals`, `getSchema` deleted

**Files:**
- Modify: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `DatabasesResponse`, `Individual`, `StatsResponse` (Task 1).
- Produces: `getDatabases(): Promise<DatabasesResponse[]>`, `getIndividuals(): Promise<Individual[]>`. `getSchema` removed. `getStats`/`runQuery` unchanged in signature (their internals already stream/parse correctly — only the `StatsResponse` type they reference changed shape in Task 1, no logic change needed here).

- [ ] **Step 1: Update the tests**

Delete the `"getSchema GETs /api/schema..."` test and the `"falls back to status text..."` test's use of `getSchema` (switch it to `getDatabases`, which exercises the same `errorFromResponse` fallback path). Update the `"getDatabases GETs..."` test for the bare-array shape. Update the streaming test's fixture lines to the real `StatsResponse` shape (no `totalCount`, `errorMessages` not `validationErrors`).

Replace the whole file:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getDatabases, getStats, runQuery } from "../../src/api/client";
import { emptyQuery } from "../../src/query/tree";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "STATUS",
    json: async () => body,
  } as Response);
}

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

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("getDatabases GETs /api/databases and returns the parsed bare array", async () => {
    const f = mockFetchOnce(200, [
      { label: "fern", name: "Fern", description: "", owner: "", totalEntrysets: 1, percentageOfTotal: 100 },
    ]);
    vi.stubGlobal("fetch", f);
    const out = await getDatabases();
    expect(out).toEqual([
      { label: "fern", name: "Fern", description: "", owner: "", totalEntrysets: 1, percentageOfTotal: 100 },
    ]);
    expect(f).toHaveBeenCalledWith("/api/databases", undefined);
  });

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
      { label: "alpha", success: true, matchCount: 1 },
      { label: "beta", success: false, errorMessages: ["bad query"] },
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

  it("runQuery POSTs query + databases + paging", async () => {
    const f = mockFetchOnce(200, { entrysets: [] });
    vi.stubGlobal("fetch", f);
    await runQuery(emptyQuery(), ["rose"], 2, 25);
    const [, init] = f.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ databases: ["rose"], page: 2, pageSize: 25 });
  });

  it("falls back to status text when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getDatabases()).rejects.toThrow("500 STATUS");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `getSchema` is still imported/exported by `client.ts`, `getDatabases` still returns the wrapped shape.

- [ ] **Step 3: Update `src/api/client.ts`**

Change the type imports:

```ts
import type {
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./types";
```

to:

```ts
import type { DatabasesResponse, EntrysetsResponse, Individual, StatsResponse } from "./types";
```

Delete `getSchema`:

```ts
export function getSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/schema");
}
```

Change `getDatabases`/`getIndividuals`:

```ts
export function getDatabases(): Promise<DatabasesResponse> {
  return request<DatabasesResponse>("/databases");
}

export function getIndividuals(): Promise<IndividualsResponse> {
  return request<IndividualsResponse>("/individuals");
}
```

to:

```ts
export function getDatabases(): Promise<DatabasesResponse[]> {
  return request<DatabasesResponse[]>("/databases");
}

export function getIndividuals(): Promise<Individual[]> {
  return request<Individual[]>("/individuals");
}
```

(`errorFromResponse`, `request`, `getStats`, `runQuery` are unchanged — `getStats`'s NDJSON parsing loop already works generically over whatever `StatsResponse` shape the type declares.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts tests/api/client.test.ts
git commit -m "refactor(client): getSchema removed; getDatabases/getIndividuals return bare arrays"
```

---

### Task 9: `src/state.ts` — retyped `schema`/`databases`/`individuals`

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `buildFieldCatalog`'s return type (Task 2), `DatabasesResponse`, `Individual` (Task 1).
- Produces: `AppState.schema: ReturnType<typeof buildFieldCatalog> | null`, `AppState.databases: DatabasesResponse[] | null`, `AppState.individuals: Individual[] | null` — consumed by every remaining task.

- [ ] **Step 1: Update the test**

Change the `schema` fixture from a `SchemaResponse` literal to a `buildFieldCatalog`-shaped literal:

```ts
import type { SchemaResponse } from "../src/api/types";
...
  const schema: SchemaResponse = { fields: [], operators: [] };
```

to:

```ts
import { buildFieldCatalog } from "../src/query/fieldCatalog";
...
  const schema = buildFieldCatalog([]);
```

(The rest of `tests/state.test.ts` is unchanged — `canRunQuery`'s tests only check `!!state.schema`, never its internals.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `AppState.schema`'s type doesn't match `buildFieldCatalog([])`'s return type yet (still `SchemaResponse | null`).

- [ ] **Step 3: Update `src/state.ts`**

Change the imports:

```ts
import type {
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./api/types";
```

to:

```ts
import type { DatabasesResponse, EntrysetsResponse, Individual, StatsResponse } from "./api/types";
import { buildFieldCatalog } from "./query/fieldCatalog";
```

Change the `AppState` interface's top three fields:

```ts
export interface AppState {
  schema: SchemaResponse | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: DatabasesResponse["databases"] | null;
  /** The vehicle telemetry data model backing the docs sidebar (loaded once). */
  individuals: IndividualsResponse | null;
```

to:

```ts
export interface AppState {
  schema: ReturnType<typeof buildFieldCatalog> | null;
  /** The databases the query can be scoped to (loaded once). */
  databases: DatabasesResponse[] | null;
  /** The vehicle telemetry data model backing the docs sidebar (loaded once). */
  individuals: Individual[] | null;
```

(`initialState`, `canRunQuery`, `createStore`, the `Listener` type, and the `store` singleton are all unchanged — `initialState.schema`/`databases`/`individuals` are already `null`, which satisfies every new type.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "refactor(state): schema/databases/individuals retyped for the corrected contract"
```

---

### Task 10: `src/main.ts` — derive the catalog locally, drop `getSchema`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `buildFieldCatalog` (Task 2), `getDatabases`/`getIndividuals` (Task 8).
- No dedicated test (`main.ts` has none, per convention). Verified by `npx tsc --noEmit` and a manual `npm run dev` smoke check (folded into Task 15's final verification, since Tasks 11-13 also touch startup-adjacent rendering and a smoke test now would be premature).

- [ ] **Step 1: Update the import line**

Current:

```ts
import { getDatabases, getIndividuals, getSchema, getStats, runQuery } from "./api/client";
```

Change to:

```ts
import { getDatabases, getIndividuals, getStats, runQuery } from "./api/client";
import { buildFieldCatalog } from "./query/fieldCatalog";
```

- [ ] **Step 2: Update the startup `Promise.all` block**

Current:

```ts
Promise.all([getSchema(), getDatabases(), getIndividuals()])
  .then(([schema, dbResp, individuals]) => {
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases: dbResp.databases,
      individuals,
      selectedDatabaseIds: dbResp.databases.map((d) => d.label),
      query: seeded,
      issues,
    });
  })
  .catch((err) => {
```

Change to:

```ts
Promise.all([getDatabases(), getIndividuals()])
  .then(([databases, individuals]) => {
    const schema = buildFieldCatalog(individuals);
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases,
      individuals,
      selectedDatabaseIds: databases.map((d) => d.label),
      query: seeded,
      issues,
    });
  })
  .catch((err) => {
```

(Everything else — `requestKey`, `staleGuard`, `runGuarded`, `runPreview`, `refreshStats`, `onQueryChange`, `onDatabasesChange`, `panelRenderers`, the initial `render*(store.getState())` calls — is unchanged. `onQueryChange`'s `validateQuery(nextQuery, { fields: schema.fields, operators: schema.operators })` call site works unmodified: `buildFieldCatalog`'s return type is structurally identical to what `ValidationSchema` expects.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/main.ts` itself (other files — `src/ui/*.ts` — still show pre-existing errors from Task 1's rename; Tasks 11-13 close those).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): derive the field catalog locally via buildFieldCatalog instead of fetching GET /api/schema"
```

---

### Task 11: `src/ui/queryBuilder.ts` + `src/ui/valueControl.ts` — `CatalogField`/`CatalogOperator`

**Files:**
- Modify: `src/ui/queryBuilder.ts`
- Modify: `src/ui/valueControl.ts`
- Test: `tests/ui/valueControl.test.ts`

**Interfaces:**
- Consumes: `CatalogField`, `CatalogOperator` (Task 2), `Individual` (Task 1).
- No behavior change beyond the type swap and `individuals` losing its wrapper — verified by `npx tsc --noEmit` plus `tests/ui/valueControl.test.ts`.

- [ ] **Step 1: Fix `tests/ui/valueControl.test.ts`'s imports**

`renderValueControl`/`defaultValueFor` never reference `.label`/`.name` themselves (only `valueType`/`options`/`arity`), so only the import line and type aliases change. Current:

```ts
import type { SchemaResponse } from "../../src/api/types";
import { defaultValueFor, renderValueControl } from "../../src/ui/valueControl";

type Field = SchemaResponse["fields"][number];
type Operator = SchemaResponse["operators"][number];
```

Change to:

```ts
import type { CatalogField, CatalogOperator } from "../../src/query/fieldCatalog";
import { defaultValueFor, renderValueControl } from "../../src/ui/valueControl";

type Field = CatalogField;
type Operator = CatalogOperator;
```

(The `field()`/`op()` fixture builders and every test body are unchanged — `CatalogField`/`CatalogOperator` are field-for-field identical to the old `SchemaResponse["fields"][number]`/`["operators"][number]`.)

Run: `npx vitest run tests/ui/valueControl.test.ts`
Expected: still FAIL at this point (Step 2 below fixes the source file) — the test file alone doesn't make `src/ui/valueControl.ts` compile against the new types yet.

- [ ] **Step 2: Update `src/ui/valueControl.ts`**

Current:

```ts
import type { SchemaResponse } from "../api/types";
import { escapeHtml, optionsHtml } from "./panel";

type Field = SchemaResponse["fields"][number];
type Operator = SchemaResponse["operators"][number];
```

Change to:

```ts
import type { CatalogField, CatalogOperator } from "../query/fieldCatalog";
import { escapeHtml, optionsHtml } from "./panel";

type Field = CatalogField;
type Operator = CatalogOperator;
```

(Nothing else in the file changes — no logic reads `.label`/`.name` at all.)

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run tests/ui/valueControl.test.ts`
Expected: PASS

- [ ] **Step 4: Update `src/ui/queryBuilder.ts`**

Change the type imports:

```ts
import type { IndividualsResponse, SchemaResponse } from "../api/types";
```

to:

```ts
import type { Individual } from "../api/types";
import type { CatalogField, CatalogOperator } from "../query/fieldCatalog";
```

Then replace every `SchemaResponse` reference with a `{ fields: CatalogField[]; operators: CatalogOperator[] }` shape, and every `IndividualsResponse | null` with `Individual[] | null`. Concretely:

`individualDropdown` — current:

```ts
function individualDropdown(individuals: IndividualsResponse | null, c: Condition): string {
  const opts = optionsHtml(
    individuals?.individuals ?? [],
    (ind) => ind.label,
    (ind) => ind.name,
    (ind) => ind.label === c.individualId,
  );
```

to:

```ts
function individualDropdown(individuals: Individual[] | null, c: Condition): string {
  const opts = optionsHtml(
    individuals ?? [],
    (ind) => ind.label,
    (ind) => ind.name,
    (ind) => ind.label === c.individualId,
  );
```

`fieldDropdown`, `operatorDropdown`, `conditionHtml`, `groupHtml`, `nodeHtml` — every `schema: SchemaResponse` parameter becomes `schema: { fields: CatalogField[]; operators: CatalogOperator[] }`, and every `individuals: IndividualsResponse | null` parameter becomes `individuals: Individual[] | null`. Their bodies are otherwise unchanged (they already read `.label`/`.name`/`.operatorIds`/`.arity` — all field names carry over identically). `SchemaResponse["operators"][number]` (used once, in `operatorDropdown`'s filter predicate) becomes `CatalogOperator`.

`renderQueryBuilder`, `_setBuilderRefs`, `schemaRef` — `schema: SchemaResponse | null` becomes `schema: { fields: CatalogField[]; operators: CatalogOperator[] } | null` in both places.

`handleRowChange` inside `wireQueryBuilder` — unchanged: it reads `schemaRef?.fields.find(...)`/`schemaRef?.operators.find(...)`, which work identically against the new type.

Since this type shows up repeatedly, define it once near the top of the file instead of repeating the inline object type at every call site:

```ts
type FieldCatalog = { fields: CatalogField[]; operators: CatalogOperator[] };
```

and use `FieldCatalog` everywhere `SchemaResponse` used to appear in this file (in place of the inline shape above).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/queryBuilder.ts` or `src/ui/valueControl.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/queryBuilder.ts src/ui/valueControl.ts tests/ui/valueControl.test.ts
git commit -m "refactor(ui): queryBuilder/valueControl consume CatalogField/CatalogOperator and a bare individuals array"
```

---

### Task 12: `src/ui/docsSidebar.ts` percentage rework + `src/ui/dataPreview.ts` bare array

**Files:**
- Modify: `src/ui/docsSidebar.ts`
- Modify: `src/ui/dataPreview.ts`

**Interfaces:**
- Consumes: `Individual.totalCount` (Task 1), `AppState.databases: DatabasesResponse[]` (Task 9).
- No dedicated tests for either file (view layer, per convention) — verified by `npx tsc --noEmit` and the Task 15 manual smoke test.

- [ ] **Step 1: Rework `docsSidebar.ts`'s percentage calculation**

Current:

```ts
import type { AppState } from "../state";
import type { Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, matchRatio } from "./format";

/** The universe size implied by this item's own count/percentage — derived rather
 * than hardcoded, so this stays correct however large the real dataset is (the API
 * already tells us the ratio; we only need it back in absolute terms for display). */
function impliedTotal(stats: Individual["stats"]): number {
  return stats.percentage > 0 ? Math.round(stats.count / stats.percentage) : stats.count;
}

function groupLabel(group: string): string {
  return group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function itemHtml(item: Individual): string {
  const tags = item.tags.length
    ? `<div class="ui mini labels">${item.tags.map((t) => `<span class="ui mini label">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.name || f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type)}</span>`,
    )
    .join(" ");
  const total = impliedTotal(item.stats);
  const ratio = matchRatio(item.stats.count, total);
  return `
    <div class="item" data-item-label="${escapeHtml(item.name.toLowerCase())}">
      <div class="content">
        <div class="header">${escapeHtml(item.name)}</div>
        ${tags}
        <div class="description">${escapeHtml(item.description)}</div>
        ${item.comment ? `<p class="ui small text"><i>${escapeHtml(item.comment)}</i></p>` : ""}
        <p class="ui small text" title="${escapeHtml(item.stats.count.toLocaleString())} of ${total.toLocaleString()} entrysets">
          In ${compact(item.stats.count)} entrysets (${ratio})
        </p>
        <p class="ui small text">${fields}</p>
      </div>
    </div>`;
}
```

Replace with:

```ts
import type { AppState } from "../state";
import type { DatabasesResponse, Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, matchRatio } from "./format";

/** Total entrysets across every loaded database — the denominator for an
 * individual's percentage, since the backend no longer sends one directly
 * (Individual only carries totalCount, an absolute figure). */
function totalEntrysets(databases: DatabasesResponse[] | null): number {
  return databases?.reduce((s, d) => s + d.totalEntrysets, 0) ?? 0;
}

function groupLabel(group: string): string {
  return group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function itemHtml(item: Individual, total: number): string {
  const tags = item.tags.length
    ? `<div class="ui mini labels">${item.tags.map((t) => `<span class="ui mini label">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.name || f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type)}</span>`,
    )
    .join(" ");
  const ratio = matchRatio(item.totalCount, total);
  return `
    <div class="item" data-item-label="${escapeHtml(item.name.toLowerCase())}">
      <div class="content">
        <div class="header">${escapeHtml(item.name)}</div>
        ${tags}
        <div class="description">${escapeHtml(item.description)}</div>
        ${item.comment ? `<p class="ui small text"><i>${escapeHtml(item.comment)}</i></p>` : ""}
        <p class="ui small text" title="${escapeHtml(item.totalCount.toLocaleString())} of ${total.toLocaleString()} entrysets">
          In ${compact(item.totalCount)} entrysets (${ratio})
        </p>
        <p class="ui small text">${fields}</p>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Thread `total` through the group/render functions and fix the bare-array `individuals`**

Current:

```ts
function groupSectionHtml(group: string, items: Individual[]): string {
  return `
    <div class="title" data-group-label="${escapeHtml(group.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(groupLabel(group))}
      <span class="ui mini label">${items.length}</span>
    </div>
    <div class="content" data-group-content="${escapeHtml(group)}">
      <div class="ui relaxed list">
        ${items.map(itemHtml).join("")}
      </div>
    </div>`;
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.individuals) {
    paint(
      el,
      `<div class="ui segment"><div class="ui active inline loader"></div> Loading individuals…</div>`,
    );
    return;
  }
  const groups = new Map<string, Individual[]>();
  for (const item of state.individuals.individuals) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
```

Replace with:

```ts
function groupSectionHtml(group: string, items: Individual[], total: number): string {
  return `
    <div class="title" data-group-label="${escapeHtml(group.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(groupLabel(group))}
      <span class="ui mini label">${items.length}</span>
    </div>
    <div class="content" data-group-content="${escapeHtml(group)}">
      <div class="ui relaxed list">
        ${items.map((item) => itemHtml(item, total)).join("")}
      </div>
    </div>`;
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.individuals) {
    paint(
      el,
      `<div class="ui segment"><div class="ui active inline loader"></div> Loading individuals…</div>`,
    );
    return;
  }
  const total = totalEntrysets(state.databases);
  const groups = new Map<string, Individual[]>();
  for (const item of state.individuals) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
```

And update the render call further down:

```ts
     <div class="ui styled fluid accordion">
       ${[...groups.entries()].map(([group, items]) => groupSectionHtml(group, items)).join("")}
     </div>`,
```

to:

```ts
     <div class="ui styled fluid accordion">
       ${[...groups.entries()].map(([group, items]) => groupSectionHtml(group, items, total)).join("")}
     </div>`,
```

(The filter `<input>` wiring at the bottom of `renderDocsSidebar` is unchanged.)

- [ ] **Step 3: Fix `dataPreview.ts`'s bare-array `individuals`**

Current:

```ts
function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals?.individuals ?? []) map.set(item.label, item);
  return map;
}
```

Change to:

```ts
function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals ?? []) map.set(item.label, item);
  return map;
}
```

(Nothing else in `dataPreview.ts` references `individuals`, `stats`, or `id_number`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/docsSidebar.ts` or `src/ui/dataPreview.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/docsSidebar.ts src/ui/dataPreview.ts
git commit -m "feat(ui): docs sidebar derives percentage from DatabasesResponse totals; both panels consume the bare individuals array"
```

---

### Task 13: `src/ui/statsPanel.ts` — the real `StatsResponse` shape

**Files:**
- Modify: `src/ui/statsPanel.ts`

**Interfaces:**
- Consumes: `StatsResponse` (Task 1, now `{label, success, matchCount?, errorMessages?, infoMessages?}` — a plain interface, not a discriminated union), `DatabasesResponse` (Task 1, now with `totalEntrysets`).
- No dedicated test (panel files have none, per convention) — verified by `npx tsc --noEmit` and the Task 15 manual smoke test.

- [ ] **Step 1: Replace the whole file**

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
 * carries a `label`, so its display name and totalEntrysets are looked up here
 * rather than resent on every line. */
function databaseFor(databases: DatabasesResponse[] | null, label: string): DatabasesResponse | undefined {
  return databases?.find((d) => d.label === label);
}

function successRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const total = db?.totalEntrysets ?? 0;
  const matchCount = line.matchCount ?? 0;
  const info = line.infoMessages?.length
    ? `<div class="ui small text">${line.infoMessages.map(escapeHtml).join(" · ")}</div>`
    : "";
  return `<div class="item" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="qb-db-nums">${escapeHtml(compact(matchCount))} / ${escapeHtml(compact(total))} · ${escapeHtml(matchRatio(matchCount, total))}</div>
    <div class="ui tiny progress" style="margin:.1rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, total)}"></div>
    </div>
    ${info}
  </div>`;
}

function failureRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const messages = [...(line.errorMessages ?? []), ...(line.infoMessages ?? [])];
  return `<div class="item">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="ui negative small text">${messages.length ? messages.map(escapeHtml).join(" · ") : "Failed."}</div>
  </div>`;
}

/** One row per database that has reported so far — success (counts), failure
 * (errorMessages/infoMessages), shown as each streamed line arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<div class="ui segment">
    <h5 class="ui header">By database</h5>
    <div class="ui relaxed list qb-stat-perdb">
      ${lines
        .map((line) => {
          const db = databaseFor(state.databases, line.label);
          return line.success ? successRowHtml(line, db) : failureRowHtml(line, db);
        })
        .join("")}
    </div>
  </div>`;
}

function headlineHtml(state: AppState): string {
  const { lines } = state.stats;
  const matchCount = lines
    .filter((l) => l.success)
    .reduce((s, l) => s + (l.matchCount ?? 0), 0);
  const total = lines.reduce((s, l) => {
    const db = databaseFor(state.databases, l.label);
    return s + (l.success && db ? db.totalEntrysets : 0);
  }, 0);
  return `<div class="ui segment">
    <div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
      <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
      <span class="qb-stat-sub">of ${escapeHtml(compact(total))} · ${escapeHtml(matchRatio(matchCount, total))}</span>
    </div>
    <div class="ui tiny progress" style="margin:.35rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, total)}"></div>
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
  if (status === "loading" && lines.length === 0) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui segment"><div class="ui active inline loader"></div> Updating…</div>`,
    );
    return;
  }
  // Order matters: the combined headline stays pinned at the top; the
  // per-database list — the only dynamic content left once StatBlock is gone —
  // scrolls internally via .qb-stat-perdb. See src/styles.css.
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     ${headlineHtml(state)}
     ${perDatabaseHtml(state)}
     ${pendingHtml(state)}`,
  );
}
```

Note the headline's denominator changed from summing a `totalCount` sent on every successful line (Revision 1) to summing each successful line's matching `DatabasesResponse.totalEntrysets` (Revision 2) — `headlineHtml` now takes the whole `state` (needs `state.databases` for that lookup) instead of just `lines`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/statsPanel.ts`. This should also be the point where the WHOLE project typechecks cleanly — run the bare command with no path filter and confirm zero errors anywhere.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev` (start both the mock server and Vite dev server), reload, select a few databases, build a valid query.
Expected: headline and per-database list render and update live as the mock streams lines in; a simulated failure (`success:false`, roughly 1 in 20 — rerun the query a few times if none show up) renders the red message row correctly; no leftover references to `totalCount` visible anywhere in the rendered output or dev tools network tab (`/api/stats` lines should never contain a `totalCount` key).

- [ ] **Step 4: Commit**

```bash
git add src/ui/statsPanel.ts
git commit -m "feat(ui): statsPanel derives its per-database/headline denominator from DatabasesResponse.totalEntrysets, reads errorMessages/optional matchCount"
```

---

### Task 14: `docs/ARCHITECTURE.md` — sync with the corrected contract

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: §4 directory layout**

Find the `api/` subsection (currently lists `client.ts` and `types.ts` with a description mentioning the old contract) and the `mock-server/` subsection's `schema.ts` line. Update:
- Remove the `mock-server/schema.ts` bullet entirely (the file no longer exists).
- Add a `src/query/fieldCatalog.ts` bullet: `buildFieldCatalog(individuals) -> { fields, operators } — derives the query builder's field catalog client-side; the real API has no schema/operators endpoint.`
- Update the `mock-server/evaluate.ts` bullet to list its real current exports: `matches`, `filterByDatabases`, `perDatabaseCounts`, `scaleCount`, `buildStatsLine` (drop any mention of `computeBlocks`, already removed in an earlier change).

- [ ] **Step 2: §5 `AppState`**

Find the `AppState` code block. Update:
```ts
  schema: SchemaResponse | null;      // loaded once at startup
  databases: Array<{ id; label }> | null;   // loaded once (GET /api/databases)
  individuals: IndividualsResponse | null;  // loaded once (GET /api/individuals); drives docsSidebar and the query builder's Item dropdown
```
to:
```ts
  schema: ReturnType<typeof buildFieldCatalog> | null;  // derived client-side from `individuals` — no schema endpoint exists
  databases: DatabasesResponse[] | null;    // loaded once (GET /api/databases, a bare array)
  individuals: Individual[] | null;         // loaded once (GET /api/individuals, a bare array); drives docsSidebar and the query builder's Item dropdown
```
And the render-loop table's "App starts" row, which currently reads `getSchema() + getDatabases() + getIndividuals()` — update to `getDatabases() + getIndividuals(), then buildFieldCatalog(individuals) synchronously`.

- [ ] **Step 3: §7 API contract — client function list + all four type blocks**

Update the top-of-section function-signature list: remove `getSchema(): Promise<SchemaResponse>`; change `getDatabases(): Promise<DatabasesResponse>` to `getDatabases(): Promise<DatabasesResponse[]>`; change `getStats(query: QueryNode, databases: string[]): Promise<StatsResponse>` (if it's still shown with the pre-streaming signature anywhere) to the real streaming signature `getStats(query: QueryNode, databases: string[], onLine: (line: StatsResponse) => void): Promise<void>`.

Replace the `GET /api/schema` subsection entirely with a new subsection explaining there IS no schema endpoint — the field catalog is derived client-side by `src/query/fieldCatalog.ts`'s `buildFieldCatalog`, from `GET /api/individuals`'s data, with the exact same `CatalogField`/`CatalogOperator` shapes as in this plan's Task 2 (copy the type block from Task 2 Step 3 verbatim into the doc).

Replace the `GET /api/databases` subsection's example code block with the real `DatabasesResponse` shape (Task 1's type, copied verbatim) and the note that the endpoint returns a bare array.

Replace the `GET /api/individuals` subsection's example code block with the real `Individual`/`IndividualField` shapes (Task 1's types, copied verbatim), noting the endpoint returns a bare array.

Replace the `POST /api/stats` subsection's `StatsResponse` example with Task 1's real shape (no `totalCount`, optional `matchCount`, `errorMessages` not `validationErrors`), and update its prose to describe the per-database denominator now coming from `DatabasesResponse.totalEntrysets` rather than a `totalCount` sent on the line.

- [ ] **Step 4: §9 panel descriptions**

Update the `docsSidebar.ts` description: remove any mention of `stats.count`/`percentage`; describe the percentage as computed from `Individual.totalCount` divided by the sum of every loaded database's `totalEntrysets`.

Update the `statsPanel.ts` description: the per-database denominator note should say `DatabasesResponse.totalEntrysets`, not a resent `totalCount`; `errorMessages` not `validationErrors`.

- [ ] **Step 5: §13 changelog**

Add a new row:

```markdown
| 2026-09-22 | API contract correction (Revision 2): the initial rename (id/label -> label/name, streamed StatsResponse) guessed at shapes that didn't match the real production backend. Corrected against the actual contract: StatsResponse's identifier is `label` (not the guessed `database`), `matchCount` is optional (not a discriminated union), `errorMessages` (not `validationErrors`), and `totalCount` doesn't exist on the wire at all — the stats panel now derives its per-database denominator from `DatabasesResponse.totalEntrysets`. `DatabasesResponse` gained `description`/`owner`/`percentageOfTotal` and dropped its `{databases:[...]}` wrapper (GET /api/databases now returns a bare array, as does GET /api/individuals). `Individual.id_number`/`stats.{percentage,count}` became `idNumber`/`totalCount`; `IndividualField` gained `cardinality`/`values`/`format`. `GET /api/schema` was removed entirely — it was never part of the real API — and replaced by `src/query/fieldCatalog.ts`'s client-side `buildFieldCatalog`, which derives the same field catalog from `Individual[]` data already being fetched; enum detection is `values.length > 0`, deliberately never `cardinality`, per the frontend/backend decoupling requirement (the real backend's cardinality-20 threshold is an implementation detail the frontend must not depend on). Design: `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md` (Revision 2). |
```

- [ ] **Step 6: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: sync ARCHITECTURE.md with the corrected (Revision 2) API contract"
```

---

### Task 15: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites pass.

- [ ] **Step 3: Lint**

Run: `npx eslint .`
Expected: no errors — in particular, confirm the jQuery and `mock-server` import airlocks from `eslint.config.js` still pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (chains `tsc --noEmit`, `vite build`, `check:offline`).

- [ ] **Step 5: Full manual smoke test**

Run: `npm run dev`. Walk through:
1. Load the app — databases and individuals load (two requests, not three — confirm no `/api/schema` request appears in the network tab); the query builder seeds one empty condition.
2. Pick an Item → Field → Operator → value, using the enum `Vehicle identity: vehicle_type` field specifically — confirm its dropdown still lists real vehicle types (the enum path now runs through `values.length > 0` in `src/query/fieldCatalog.ts`, not the mock's `cardinality` — same visible behavior, different code path).
3. Watch the stats panel fill in per-database, live, one row at a time; confirm the "of N" denominator numbers look like real database sizes (not zero, not `undefined`).
4. Confirm a simulated per-database failure (rerun a few times if needed) renders its message via `errorMessages`/`infoMessages` correctly.
5. Confirm the docs sidebar's percentage-of-entrysets figure per individual still renders a sensible value (not `NaN`, not `Infinity`).
6. Press **Run / Refresh**, confirm the data preview still works (unaffected by this plan — its contract, `EntrysetsResponse`, was never touched).

Expected: no console errors; every behavior above matches the description.

- [ ] **Step 6: Final commit (only if any of the above required fixes)**

If Steps 1-5 required any fixups, stage and commit them now with a message describing what verification caught. If everything passed cleanly, there is nothing to commit for this task.
