# API types refactoring — design

Status: approved, ready for implementation planning.

## 1. Problem

`src/api/types.ts` is the frontend/backend contract (`docs/ARCHITECTURE.md`
§7). It needs three related changes, driven by the backend team:

1. **Naming convention.** Across the backend's services, the field commonly
   called `id` in this contract is really always an opaque identifier that
   happens to double as a label — so it's being renamed `label` everywhere,
   and the old human-readable `label` field is being renamed `name`. The
   `Individual`/`IndividualField` types (added later, from the vehicle
   telemetry work) already use this convention; the older `SchemaResponse` /
   `DatabasesResponse` / stats types don't yet.
2. **`StatBlock` removed.** The real backend can currently only return counts
   (`matchCount`/`totalCount`), not the aggregated `min`/`max`/`avg`/
   `buckets`/`earliest`/`latest` the mock has been faking. The type — and
   everything that renders it — goes away until the backend can support it.
3. **Streaming stats.** `POST /api/stats` currently waits for every selected
   database before responding. Some databases are slower (or can fail) than
   others; the backend wants to stream a result per database as soon as it's
   available (NDJSON), rather than block the whole response on the slowest
   one, and to report per-database success/failure instead of an
   all-or-nothing response.

**Non-goal:** `POST /api/query` (`EntrysetsResponse`) is not part of this
change — the backend only asked for `/api/stats` to stream.

## 2. Entity naming (`id` → `label`, `label` → `name`)

Applied to every entity-identifying pair in the contract, to match
`Individual`'s existing `{ label, name }` shape:

- `SchemaResponse.fields[]`: `id` → `label`, `label` → `name`.
- `SchemaResponse.operators[]`: `id` → `label`, `label` → `name`.
- `DatabasesResponse.databases[]`: `id` → `label`, `label` → `name`.

**Not renamed:**

- `SchemaResponse.fields[].options[]` (`{ value, label }`) — this is an enum
  *value*/display-label pair, not an entity id/name pair, so it keeps its
  current shape. See §4 for how it gets populated.
- `IndividualField` — stays `label`-only. No `name` field; there's no plan to
  add one.
- `src/query/types.ts` (`Condition.fieldId`, `Condition.id`, etc.) — these are
  internal frontend query-tree concepts, not part of the wire contract, and
  are out of scope.

## 3. `StatBlock` removed

`StatBlock` and the `blocks: StatBlock[]` field are deleted outright.
Consequences:

- `statsPanel.ts` loses `numberSummary()`, `distribution()`, `dateRange()`,
  `blockHtml()`, and the `.qb-stat-blocks` scroll region entirely. The panel
  becomes: headline (§5) + per-database list (§5) — no per-field blocks.
- mock-server's block computation (`evaluate.ts`'s `computeBlocks` and
  whatever calls it) is deleted; nothing needs it once `StatBlock` is gone.
- `docs/ARCHITECTURE.md` §7/§9 lose the `StatBlock` description and the
  "`statsPanel.ts` has one render function per `kind`" note.

## 4. `IndividualField.values` and `options`

`IndividualField` gains an optional field:

```ts
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  /** The field's valid values, when it has a fixed domain. Absent = not an enum. */
  values?: string[];
}
```

`SchemaResponse.fields[].options` is unchanged in shape
(`{ value: string; label: string }[]`) but is now actually populated: when a
field's `IndividualField.values` is present, the mock's `buildFields` sets
`valueType: "enum"` and `options: values.map(v => ({ value: v, label: v }))`
— `value` and `label` are identical because the source is a flat value list,
not a richer id/display pair. When `values` is absent, `options` stays
omitted and `valueType` is decided the same way as today (never inferred from
the field's name or its values).

This also means `mock-server/data/individual.json` needs at least one field
with a `values` array added, to exercise the new enum path end to end (dev
data only — not part of the contract itself).

## 5. `StatsResponse` becomes the streamed per-database line

`POST /api/stats` streams newline-delimited JSON: one `StatsResponse` object
per selected database, emitted as soon as that database's result is ready,
rather than one combined JSON object after every database finishes.

```ts
export type StatsResponse =
  | {
      label: string; // matches DatabasesResponse.databases[].label
      success: true;
      matchCount: number;
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
```

Design notes:

- **No `name` field.** The database's display name was already returned by
  `GET /api/databases` and is loaded once into `AppState.databases` at
  startup — repeating it on every stats line would be redundant network
  traffic. The frontend looks up the name by `label`.
- **Discriminated on `success`**, not a `matchCount: 0` sentinel. This
  matches the existing `StatBlock`/`status` discriminated-union style already
  in this codebase, and — critically — the compiler forces every read site to
  check `success` before touching `matchCount`/`totalCount`, so a junior
  developer can't accidentally treat "the query failed for this database" as
  "zero rows matched."
- **No combined-totals line.** The old top-level `{ matchCount, totalCount,
  blocks, perDatabase }` wrapper no longer exists on the wire. The frontend
  derives the combined headline by summing `matchCount`/`totalCount` across
  the successful lines received so far — trivial arithmetic, and it avoids
  the backend computing and sending a redundant aggregate.
- **`validationErrors` vs `infoMessages`.** Both are plain `string[]` — no
  shared type with `src/query/types.ts`'s `Issue` (`{ nodeId, message,
  severity }`). A per-database validation failure isn't reliably traceable to
  one condition row (the same tree is sent to every database, and different
  databases can reject it for different reasons), so there's no `nodeId` to
  attach. The two arrays are conceptually aligned with `Issue`'s severity
  split — `validationErrors` is the blocking case, `infoMessages` is
  advisory — but that's a naming/documentation alignment only, not a shared
  type.

## 6. Consumer impact (for the implementation plan)

These are downstream of the type changes above; captured here so nothing
gets missed when planning, not part of the type design itself:

- **`src/api/client.ts`** — `getStats` changes from returning
  `Promise<StatsResponse>` to consuming a streaming NDJSON response body
  (e.g. reading the `ReadableStream`, splitting on newlines, `JSON.parse`
  per line) and reporting each line as it arrives — most likely via a
  callback parameter, since a single `Promise<T>` can't represent multiple
  incremental values.
- **`src/state.ts`** — `AppState.stats.data` can no longer be a single
  `StatsResponse` object; it needs to hold the accumulating set of
  per-database lines received so far (e.g. keyed by `label`), so the panel
  can render partial results while more lines are still arriving.
- **`src/main.ts`** — the stats orchestration (currently one `await
  getStats()` → one `setState`) becomes a callback that calls `setState`
  once per line, merging into the existing accumulated set. The stale-response
  guard (§6 of `ARCHITECTURE.md`) needs to keep working per-stream, not just
  per-request.
- **`src/ui/statsPanel.ts`** — renders a running headline (sum of successful
  lines so far), a per-database list where each row shows success (counts),
  failure (`validationErrors`), or info notices, plus some indication that
  more databases are still pending until the stream ends. Loses the
  `StatBlock` rendering per §3.
- **`mock-server/`** — `/api/stats`'s handler switches from a single JSON
  response to writing NDJSON lines, one per selected database, with an
  artificial per-database delay (so the UI visibly streams in dev) and an
  occasional simulated `validationErrors`/`infoMessages` failure to exercise
  the new UI paths. `mock-server/schema.ts` gains the `values`-driven enum
  support from §4. `mock-server/evaluate.ts` loses block computation (§3).
- **`docs/ARCHITECTURE.md`** — §5 (render loop table), §6 (correctness
  invariant — needs to describe partial/streaming state, not just
  idle/loading/ok/error), §7 (API contract — new `StatsResponse` shape,
  `IndividualField.values`), §9 (`statsPanel.ts` description), §10 (mock
  server streaming), and §13 (changelog entry) all need updates in the same
  change, per this repo's living-document rule.

## 7. Out of scope

- `POST /api/query` / `EntrysetsResponse` streaming — not requested.
- Any change to `src/query/types.ts` or the query-tree model.
- Adding a `name` field to `IndividualField`.
