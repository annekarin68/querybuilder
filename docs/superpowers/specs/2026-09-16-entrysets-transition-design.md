# Finalizing the entrysets transition — design

Status: approved, ready for implementation planning.

## 1. Problem

The mock backend currently has two parallel, unconnected data models:

- The **original plant/species model** (`mock-server/catalog.ts` + `data.ts`):
  drives `GET /api/schema`, `GET /api/databases`, `POST /api/stats`, and (for
  validation only) `POST /api/query`. This is what the query builder, database
  picker, and stats panel actually run against today.
- The **newer entryset/individual model** (`mock-server/vehicleData.ts`,
  loading `data/individual.json` + `data/entrysets.json`): drives
  `GET /api/individuals` (the docs sidebar) and the entryset list returned by
  `POST /api/query` (the data preview) — but that endpoint currently ignores
  the query/databases entirely and always returns every entryset it has.

This is a known, documented inconsistency (`docs/ARCHITECTURE.md` §10, dated
2026-09-16): "a species query has no effect on what the preview shows."

**Goal:** make the query builder, the stats panel, the database picker, *and*
the data preview all run against the entryset/individual model, with real
filtering everywhere, and remove the plant/species model entirely. The
frontend (`src/`) already consumes the API purely through its typed contract
(`SchemaResponse`, `DatabasesResponse`, `StatsResponse`, `EntrysetsResponse`)
and is not expected to need source changes — this is a mock-backend /
data-model refactor.

**Decoupling constraint:** the mock's production counterpart uses different
concrete data (different item/field names, different field values) with "the
general structure... the same." So nothing in the schema-building, matching,
or database-partitioning logic may hardcode a specific item name, field name,
or field value found in `individual.json` / `entrysets.json`. Only the
*shape* (individuals have items with typed fields; entrysets hold values for a
subset of those items) may be assumed.

## 2. Field schema (`GET /api/schema`)

One queryable field per `(individual, field)` pair from `individual.json`.

- **id**: `"${individualLabel}.${fieldLabel}"` — a dotted path that matches
  the nesting of an entryset's `items[individualLabel][fieldLabel]`, so it
  doubles as the lookup key once an entryset is flattened (§4).
- **label**: `"${individual.name}: ${field.label}"`.
- **description**: the field's own `description` if non-empty, else the
  individual's `description`.
- **valueType**: from a small generic table keyed by the field's declared
  `type` in `individual.json` — never inferred from the field's name or its
  values:
  | declared `type` | `valueType` |
  |---|---|
  | `str` | `string` |
  | `int`, `float` | `number` |
  | `bool` | `boolean` |

  `valueType` also keeps `"date"` and `"enum"` as defined possibilities (the
  type already used by `queryBuilder.ts`/`valueControl.ts`) for a future
  dataset that declares them, but the current `individual.json` never produces
  either — no heuristic ("this string looks like a timestamp") is used to
  invent one.
- **operatorIds**: from a second generic table keyed by `valueType` (not by
  which field it is), reusing the existing `OPERATORS` definitions verbatim:
  | valueType | operatorIds |
  |---|---|
  | `string` | `eq, neq, contains, isEmpty, isNotEmpty` |
  | `number` | `eq, neq, gt, gte, lt, lte, between, isEmpty, isNotEmpty` |
  | `boolean` | `eq, neq` |
  | `date` (unused today) | `eq, neq, before, after, between, isEmpty, isNotEmpty` |
  | `enum` (unused today) | `eq, neq, in, isEmpty, isNotEmpty` |

This is the same per-type operator sets the old plant catalog used per field,
just generalized so any individual/field pair gets a sensible one automatically.

`options` (enum choices) has no source in the current data (no field has an
`enum`-shaped declaration) and is simply omitted; the mapping table above
already accounts for this by never producing `valueType: "enum"` today.

## 3. Databases — 7 synthetic partitions, decoupled from content

Per your decision: database identity is arbitrary and carries no semantic
meaning tied to the data. Seven databases, ids `alpha`..`eta`, labels
`ALPHA`..`ETA`.

- **Size** (mock-only, drives display magnitude exactly like the old
  species `size` did): a deterministic pseudo-random value per database
  index, reusing the existing seeded-RNG approach from (soon-removed)
  `data.ts`, spread across roughly the same range the old catalog used
  (~10K–6B) so `format.ts`'s compact/billion-scale formatting still gets
  exercised. No attempt is made to make the seven sizes sum to exactly
  6,000,000,000 (the "mock universe" size implied by `individual.json`'s
  per-item `stats.count`) — that would be a cosmetic alignment with no
  functional benefit, so it's skipped (YAGNI).
- **Assignment**: each entryset is assigned to exactly one database by a pure
  function of its `id` — **not** of anything inside its `items`:
  ```
  dbIndex(entrysetId) = Math.abs(Math.imul(entrysetId, 2654435761)) % 7
  ```
  This is the key decoupling move: a production entryset of the same general
  shape but totally different field content still partitions correctly,
  because the partition never looks inside `items`.

## 4. Matching engine (`mock-server/evaluate.ts`)

Add one new step; change nothing else in the pure matching logic.

- **`flattenEntryset(entryset): Row`** — new. Turns
  `{ items: { individual: { field: value } } }` into a flat
  `Record<"individual.field", value>` (same dotted ids as §2), plus a
  synthetic `__db` key holding the database id from §3's `dbIndex`.
- `matches`, `computeBlocks`, `conditionMatches`, `cmp`, `scaleCount`: **no
  changes** — they already operate on a flat `Row` + the schema's
  `FieldDef[]`, which is exactly why this engine was written
  data-shape-agnostic in the first place.
- `filterByDatabases` / `perDatabaseCounts`: change their one data-specific
  line from reading `row.species` to reading `row.__db`.

## 5. Endpoint wiring (`mock-server/index.ts`)

- `GET /api/schema` → built from `INDIVIDUALS` per §2 (replaces `catalog.ts`'s
  `FIELDS`/`OPERATORS`, though the `OPERATORS` definitions themselves are
  reused verbatim, just relocated).
- `GET /api/databases` → the 7 synthetic databases from §3, `size` stripped
  (same as today).
- `POST /api/stats` → runs against `ENTRYSETS` flattened via
  `flattenEntryset`, using `DATABASES[].size` to scale sample counts to
  display magnitude exactly like the old species-scaled stats did. Same
  response shape (`StatsResponse`), same `perDatabase` breakdown.
- `POST /api/query` → **starts filtering for real**: flatten `ENTRYSETS`,
  apply `filterByDatabases` then `matches`, map matched rows back to their
  source `Entryset` objects, cap at 25 (same defensive cap as today, no
  pagination metadata added — `dataPreview.ts`'s no-Prev/Next design is
  unaffected). `page`/`pageSize` in the request body remain accepted-but-
  unused, same as their current status.

## 6. Files removed / added / edited

- **Removed**: `mock-server/catalog.ts` (plant `FIELDS`/`DATABASES`),
  `mock-server/data.ts` (plant `RECORDS`).
- **Added**: `mock-server/schema.ts` (§2's field/operator builder — including
  the relocated, unchanged `OPERATORS` array), `mock-server/databases.ts`
  (§3's 7 synthetic databases + `dbIndex`).
- **Edited**: `mock-server/vehicleData.ts` (adds `flattenEntryset`),
  `mock-server/evaluate.ts` (§4), `mock-server/index.ts` (§5).
- **Untouched**: everything under `src/` (frontend consumes only the typed
  API contract, per §1).

## 7. Sample data — expand `entrysets.json` to ~21 entrysets

Every new entryset must read as **one coherent scenario** — the way the
existing 5 do (delivery van mid-route, semi truck, rideshare EV, parked
sedan, construction dump truck) — not independently-randomized field values.
Within one entryset, field values must be mutually consistent: a parked
vehicle has `speed_kmh: 0`, parking brake engaged, and no active
`trip_context` (or one describing a just-finished trip); a vehicle mid-drive
has nonzero speed, a running engine (rpm > idle, consistent with the gear
implied), fuel/battery trending appropriately, and a populated
`trip_context`. Whoever implements this should sanity-check each new
entryset's items against each other before moving on, the same way the
original 5 were evidently built.

16 new scenarios (ids 6–21), one each — suggested set (implementer may swap
individual scenarios for equally distinct ones, but should keep them varied
in vehicle kind, activity, and item coverage the way the original 5 are):
bus on a fixed route, tow truck responding to a call, taxi idling at a stand,
garbage truck on a collection route, rideshare car mid-trip, light truck
idling at a warehouse loading dock, police cruiser on patrol, ambulance en
route (lights/sirens active), farm tractor working a field, EV charging at a
station (stationary, charging-specific fields active), motorcycle courier
en route, box truck stuck in traffic, school bus stopped for pickup,
long-haul semi at a highway rest stop (parked, engine idling for HVAC),
delivery van backing into a loading dock, and a rental car idling in a
parking lot waiting for pickup.

**Database distribution**: choose the 16 new ids (6–21, or renumber if
convenient) so that `dbIndex(id)` (§3's formula) spreads entrysets roughly
evenly across the 7 databases (target: ~2–4 sample entrysets per database
across all 21 total) — not necessarily perfectly even, just no database left
at 0.

## 8. Tests

Existing `tests/mock-server/{catalog,databases,evaluate,query,stats}.test.ts`
get rewritten against the new schema/database/matching model — same coverage
intent (schema shape, database listing, matching correctness, endpoint
validation, stats scaling), new fixtures built from the entryset/individual
shape instead of plant rows. `tests/mock-server/catalog.test.ts` likely
renames to `schema.test.ts` to match the new module.

## 9. Documentation

`docs/ARCHITECTURE.md` gets a real rewrite, not just a changelog append: §4
(directory layout), §7 (API contract — `/api/databases` description no
longer says "each plant species"), and §10 (mock server) all currently
describe the plant/species model as authoritative and must be corrected to
describe the entryset/individual model as the *only* model, with the
transitional dual-model language removed.

## 10. Out of scope

- No changes to `src/` — confirmed not needed per §1/§6.
- No pagination added to `/api/query` beyond what exists today.
- No attempt to align the 7 databases' total mock size with
  `individual.json`'s implied 6B-entryset universe (§3).
- The Review / Approval / Done tabs, auth, persistence — unrelated, already
  out of scope per `ARCHITECTURE.md` §1.
