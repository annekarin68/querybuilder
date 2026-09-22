# API types refactoring — design

Status: approved, ready for implementation planning.

> **Revision 2.** Revision 1 (implemented, merged into this branch, PR #12)
> guessed at the real contract shapes and got several wrong — most
> importantly, it invented `id`→`label`/`label`→`name` renames, a
> `StatsResponse.totalCount` field, and a discriminated-union shape for
> `StatsResponse`, none of which match the real production backend. The
> user then supplied the actual, authoritative production contract for
> `StatsResponse`, `DatabasesResponse`, `IndividualField`, and `Individual`.
> This revision replaces §2, §4, §5 below with the real shapes and adds §5a
> (client-side field-catalog derivation, replacing `GET /api/schema`
> entirely). §1 (streaming), §3 (`StatBlock` removal) are unaffected and
> carry over unchanged. Everything downstream (§6 consumer impact) is
> rewritten to match.

## 1. Problem

`src/api/types.ts` is the frontend/backend contract (`docs/ARCHITECTURE.md`
§7). The backend team supplied the actual production shape for four of its
models, and asked for `POST /api/stats` to stream:

1. **Streaming stats.** `POST /api/stats` currently waits for every selected
   database before responding. Some databases are slower (or can fail) than
   others; the backend streams a result per database as soon as it's
   available (NDJSON today — the docstring explicitly notes this format
   could change), rather than blocking the whole response on the slowest
   one, and reports per-database success/failure instead of an
   all-or-nothing response.
2. **`StatBlock` removed.** The real backend can currently only return
   `matchCount`, not aggregated `min`/`max`/`avg`/`buckets`/`earliest`/
   `latest`. The type — and everything that renders it — goes away.
3. **Real contract shapes**, given verbatim by the backend team (§2, §4, §5)
   — several fields the frontend needs (`totalCount`, `percentage`, a
   schema/operators catalog) simply don't exist on the wire and must be
   either dropped or derived client-side from what *is* there.

**Non-goal:** `POST /api/query` (`EntrysetsResponse`) is not part of this
change — its shape was not supplied, and it stays as-is.

**Hard constraint (frontend/backend decoupling):** the mock backend
(`mock-server/`) is discarded entirely in production — it exists only to
develop against. The frontend must depend on nothing except the field
names and types actually specified in this document. In particular, the
mock's own implementation choices (e.g. *how* it decides to populate
`IndividualField.values`) must never leak into frontend logic — the
frontend reacts to the data it receives, never to a rule about how that
data was produced.

## 2. Entity naming — `label` is the identifier everywhere

Every identifier field across the whole contract is called `label`; every
display-name field is called `name` (already true for `Individual`, and now
true for `StatsResponse` and `DatabasesResponse` too — see §4/§5 for their
exact shapes). Nothing else about this convention changes from Revision 1.

## 3. `StatBlock` removed

Unchanged from Revision 1: `StatBlock` and the `blocks: StatBlock[]` field
are deleted outright.

- `statsPanel.ts` loses `numberSummary()`, `distribution()`, `dateRange()`,
  `blockHtml()`, and the `.qb-stat-blocks` scroll region entirely. The panel
  becomes: headline + per-database list — no per-field blocks.
- mock-server's block computation (`evaluate.ts`'s `computeBlocks` and
  whatever calls it) is deleted; nothing needs it once `StatBlock` is gone.
- `docs/ARCHITECTURE.md` loses the `StatBlock` description and the
  "`statsPanel.ts` has one render function per `kind`" note.

## 4. `IndividualField` and `Individual` — real shapes

```ts
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
   *  Can be 0 to several billion. Informational only — see §5a: the frontend
   *  must never branch on this value. */
  cardinality: number;
  /** The field's actual distinct values, when the backend chooses to supply
   *  them (today: only when cardinality is low, but the frontend must not
   *  encode that rule — see §5a). Empty when not supplied. */
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
   *  percentage is supplied — see §5b for how the frontend derives one. */
  totalCount: number;
  fields: IndividualField[];
}
```

Changes from Revision 1's guess: `id_number` → `idNumber` (camelCase, not
part of the label/name convention — just a plain rename); `stats: {
percentage, count }` → `totalCount: number` (percentage is gone from the
wire entirely); `IndividualField` gains `cardinality`, `values` (now
required, not optional — empty array when not supplied), and `format`;
`name` is unchanged from Revision 1 (kept, reserved, unpopulated — the user
confirmed keeping it despite it not being in the real contract, for forward
compatibility).

**`GET /api/individuals`'s response shape**: confirmed — a bare
`Individual[]`, not `{ individuals: [...] }`, matching `DatabasesResponse`
and the stats stream both being unwrapped (§5).

## 5. `StatsResponse` and `DatabasesResponse` — real shapes

```ts
/**
 * One database's result from the POST /api/stats stream. The endpoint's
 * response body is newline-delimited JSON today (the backend may change
 * the streaming format later): one of these per selected database, written
 * as soon as that database's result is ready.
 */
export interface StatsResponse {
  /** Database ID — matches DatabasesResponse.label. */
  label: string;
  /** Whether the query to this specific database succeeded. There is no
   *  per-database HTTP status in an NDJSON stream, so this is how failure
   *  is signaled instead. */
  success: boolean;
  /** Individuals matched by this query in this database. Only meaningful
   *  when `success` is true — see §5c for why it's optional rather than a
   *  fabricated 0. */
  matchCount?: number;
  /** Errors from the query itself — malformed dates, too-large numbers,
   *  too-long strings, etc. */
  errorMessages?: string[];
  /** Other information or error messages — a database timeout, an internal
   *  server error, or a non-blocking notice. */
  infoMessages?: string[];
}

/** The databases the query can be scoped to (GET /api/databases). */
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
```

`GET /api/databases` returns `DatabasesResponse[]` directly — **no
`{ databases: [...] }` wrapper.**

Changes from Revision 1's guess: the identifier field is `label`, not
`database` — the user asked for this specifically, matching
`DatabasesResponse.label`. There is no `totalCount` on `StatsResponse` at
all (§5a below covers what replaces it). `matchCount` is optional, not a
discriminated-union member. `validationErrors` is renamed `errorMessages`.
`success` is a plain `boolean`, not a type discriminant — `errorMessages`/
`infoMessages` can both be present (or absent) regardless of its value.

### 5a. No `GET /api/schema` — the field catalog is derived client-side

The real contract has no `fields`/`operators` endpoint at all.
`GET /api/schema` was always our own invention (`mock-server/schema.ts`'s
`buildFields`, mock-only, discarded in production along with the rest of
`mock-server/`) — keeping it would mean inventing a NEW requirement on the
real backend team for a feature that exists only to build the query
builder's UI. Per the decoupling constraint in §1, this is removed:

- The query builder's field catalog (per-field `valueType`, enum `options`,
  available `operatorIds`) is now computed **in `src/`**, as a pure function
  over the already-fetched `Individual[]` — no new network request, and one
  fewer round trip than Revision 1's design (which fetched schema and
  individuals separately even though the mock derived one from the other).
- **Operators become static frontend data.** They were never backend data —
  a fixed catalog of comparison operations (`eq`, `between`, `in`, ...) is a
  UI capability list, not something the given contract has any concept of.
  They move from `mock-server/schema.ts`'s `OPERATORS` constant to a new
  frontend module, verbatim.
- **Enum detection is `values.length > 0` — never `cardinality`.** This is
  the decoupling requirement from §1 made concrete: today's real backend
  happens to only populate `values` when `cardinality < 20`, but that
  threshold is a backend implementation detail that can change at any time
  without notice. The frontend's own logic must never branch on
  `cardinality` — it reacts only to whether `values` actually contains
  anything. (The mock, standing in for the real backend, is free to
  replicate the `cardinality < 20` rule when generating its own fake data —
  that's backend-side realism, not frontend coupling.)
- **`type`/`format` → `valueType` mapping** moves into this same module,
  reading `field.type` first and falling back to `field.format` only when
  `type` is empty — matching the docstring's stated precedence exactly.

This is a genuinely new frontend module (not previously in the file
structure): `src/query/fieldCatalog.ts`, sitting alongside `tree.ts`/
`validate.ts`/`summary.ts`/`types.ts` in the query domain, since it's the
query builder's own derived concept now, not an API response type.

```ts
// src/query/fieldCatalog.ts
export interface CatalogField {
  label: string;
  name: string;
  valueType: "string" | "number" | "boolean" | "date" | "enum";
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}
export interface CatalogOperator {
  label: string;
  name: string;
  description: string;
  arity: "none" | "one" | "two" | "many";
}
export const OPERATORS: CatalogOperator[]; // moved verbatim from mock-server/schema.ts
export function buildFieldCatalog(
  individuals: Individual[],
): { fields: CatalogField[]; operators: CatalogOperator[] };
```

`SchemaResponse` is deleted from `src/api/types.ts` — it's not a wire type
anymore. `AppState.schema` keeps its name but its type becomes the return
type of `buildFieldCatalog` instead. `src/query/validate.ts`'s
`ValidationSchema` and `src/query/summary.ts`'s `SummarySchema` (already
locally-declared structural types, not importing `SchemaResponse`) need no
changes — `CatalogField`/`CatalogOperator` are structurally identical to
what they already expect.

**Production note for commit messages / code comments:** this module
exists so the frontend never needs a schema endpoint. If a future backend
team wants to move this derivation server-side for performance or
consistency reasons, that's a new endpoint the frontend would need to be
told about — nothing here assumes one exists today.

`mock-server/schema.ts` is deleted entirely (its only consumer,
`GET /api/schema`, is gone; `FieldDef`/`OperatorDef` had no other use).
`buildFieldCatalog`'s logic (type mapping, operator profile, enum
detection) is a straight port of `buildFields`'s, adjusted for the real
`IndividualField` shape and the `values.length > 0` decoupling rule above.

### 5b. Docs sidebar percentage — computed client-side

`Individual.totalCount` has no accompanying percentage. The docs sidebar
computes one itself: `individual.totalCount / sum(state.databases.map(d =>
d.totalEntrysets))` — the denominator is available once `GET /api/databases`
has loaded, without any new request.

### 5c. Stats denominator and `matchCount` optionality

`StatsResponse` has no `totalCount`; the per-database denominator for the
stats panel's match-ratio bar comes from the matching `DatabasesResponse`
row's `totalEntrysets` (looked up by `label`, exactly like the display
`name` already is).

`matchCount` is optional rather than a fabricated `0` on failure: a
required field would force the mock (and, implicitly, teach frontend code)
to treat "the query failed for this database" and "zero rows matched" as
the same wire value. Optional means the type system requires a check before
reading it — `statsPanel.ts` still branches on `success` to decide whether
to render counts or the error/info messages, just as a plain `if` instead
of a discriminated union.

## 6. Consumer impact (for the implementation plan)

- **`src/api/types.ts`** — `SchemaResponse` deleted; `StatsResponse`,
  `DatabasesResponse`, `IndividualField`, `Individual` replaced with the
  real shapes (§4, §5); `StatBlock` deleted (§3).
- **`src/query/fieldCatalog.ts`** (new) — `buildFieldCatalog` + `OPERATORS`,
  ported from `mock-server/schema.ts` per §5a.
- **`src/api/client.ts`** — `getSchema()` deleted. `getDatabases()` returns
  `Promise<DatabasesResponse[]>` (no wrapper). `getStats`'s streamed-line
  type follows the new `StatsResponse` shape (parsing logic itself is
  unchanged — still NDJSON, still one object per line).
- **`src/state.ts`** — `AppState.schema`'s type becomes
  `ReturnType<typeof buildFieldCatalog> | null` (or an equivalent named
  type); `AppState.databases: DatabasesResponse[] | null` (was
  `DatabasesResponse["databases"]`); `stats.lines: StatsResponse[]` keeps
  its Revision-1 shape (an array of streamed lines), just typed against the
  new `StatsResponse`.
- **`src/main.ts`** — startup no longer calls `getSchema()`; instead calls
  `buildFieldCatalog(individuals)` synchronously once `individuals` has
  loaded. `selectedDatabaseIds` seeds from the bare array directly (no
  `.databases`).
- **`src/ui/statsPanel.ts`** — per-line rendering keys off `line.success`
  (plain boolean) and reads `line.matchCount`/`line.errorMessages` (renamed
  from `validationErrors`)/`line.infoMessages`, all now optional (`?? []`/
  guarded reads instead of always-present arrays). Denominator per §5c.
- **`src/ui/docsSidebar.ts`** — percentage computed per §5b instead of read
  from `Individual.stats.percentage`. Field name fallback (`name || label`)
  unchanged from Revision 1.
- **`src/ui/databasePicker.ts`** — iterates the bare `DatabasesResponse[]`
  directly.
- **`src/ui/queryBuilder.ts`**, **`src/ui/valueControl.ts`** — `Field`/
  `Operator` types become `CatalogField`/`CatalogOperator` (from
  `src/query/fieldCatalog.ts`) instead of `SchemaResponse["fields"][number]`/
  `["operators"][number]`. No logic changes — same field names (`label`,
  `name`, `valueType`, `options`, `operatorIds`, `arity`).
- **`mock-server/schema.ts`** — deleted.
- **`mock-server/vehicleData.ts`** — local `IndividualField`/`Individual`
  types updated to the real shape (§4); `individual.json`'s 157 entries get
  `id_number`→`idNumber` and `stats: {percentage,count}`→`totalCount`
  mechanically renamed, plus realistic `type`/`format`/`cardinality`
  values and at least one field exercising the `type`-empty/`format`-fallback
  path.
- **`mock-server/databases.ts`** — `DatabaseDef` gains `description`,
  `owner`, `percentageOfTotal` (computed from each database's share of
  total `size`); `size` renamed `totalEntrysets` to match the wire field
  it now directly produces (no more separate `label`/`name` translation at
  the route — the mock's own record IS the wire shape).
- **`mock-server/evaluate.ts`** — `perDatabaseCounts` and `buildStatsLine`
  adjusted: `label` field name (already right, no change), `buildStatsLine`
  drops `totalCount` from its output and makes `matchCount` conditional on
  success, renames `validationErrors`→`errorMessages`.
- **`mock-server/index.ts`** — `/api/schema` route deleted.
  `/api/databases` returns `DATABASES` directly (mapped to the wire shape,
  no wrapper). `/api/stats` builds lines via the adjusted `buildStatsLine`.
- **`docs/ARCHITECTURE.md`** — full re-sync: the API contract section (all
  four types), the "no schema endpoint" architecture note (new), the
  per-database denominator/percentage derivation notes, directory layout
  (`fieldCatalog.ts` added, `mock-server/schema.ts` removed), changelog.

## 7. Out of scope

- `POST /api/query` / `EntrysetsResponse` — shape not supplied, untouched.
- Any change to `src/query/types.ts` or the query-tree model.
- Populating `IndividualField.name` — stays reserved/unpopulated.
- Any new UI surface for `DatabasesResponse.description`/`owner`/
  `percentageOfTotal` — typed and plumbed through, `percentageOfTotal` used
  internally for §5b, but none of the three are rendered anywhere yet.
