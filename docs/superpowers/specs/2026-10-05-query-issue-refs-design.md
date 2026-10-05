# Backend issues that point at parts of the query — design

Status: approved in chat on 2026-10-05, ready for implementation planning.

## 1. Problem

Some problems with a query can only be found by the backend: an operator a
database no longer supports, a value it can't accept (too long, out of range),
and so on. Today the backend can only report these as plain text in a `/stats`
line's `errorMessages`. The frontend shows that text in the database's row of
the statistics panel, but:

1. **The user can't tell which part of the query is wrong.** Every node in the
   request already carries the frontend's `id` ("Wire format of the query"),
   reserved for exactly this, but nothing in the contract uses it yet.
2. **Run stays enabled.** A query some database has rejected can still be run.
3. **Issues can be hidden.** The builder shows an `Issue` only on the node
   whose `id` it names. An issue on a node inside a collapsed group is never
   shown (a collapsed group only draws its own issues), and an issue naming an
   id the builder doesn't know would be counted by the footer ("N parts still
   need attention") but shown nowhere.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Issues travel per database, inside each `/stats` NDJSON line's `errorMessages`. `POST /query` is unchanged. |
| D2 | Every `errorMessages` item becomes an object `{ nodeId?, message, kind }`. This is a breaking change: a plain-text item is a contract error. |
| D3 | `kind` is the `Issue` kind: `"incomplete"` or `"invalid"`. An unknown kind reads as `"invalid"`. |
| D4 | The builder's server issues are **derived** from `stats.results` at render time, never stored. Any edit or database change already resets `stats`, so they disappear exactly when they stop being true. |
| D5 | Only errors with a `nodeId` become builder issues. Errors without one stay in the statistics panel only, as today. |
| D6 | The same `(nodeId, kind, message)` from several databases is shown once in the builder, without database names. The statistics panel says which databases rejected the query. |
| D7 | An issue is shown on the node it names if that node is visible; on the outermost collapsed group around it if it is hidden; on the root group if the id is unknown. This applies to local and server issues alike. |
| D8 | A server issue from **any** database blocks Run, until the query or the database selection changes. |
| D9 | A database row with at least one error that has a `nodeId` is labelled "Rejected the query". |

## 3. Contract (D1–D3)

`src/api/types.ts`:

```ts
export interface StatsResponse {
  // …unchanged…
  /** Problems with the query itself, e.g. an operator this database no
   *  longer supports, a value it can't accept. */
  errorMessages?: StatsErrorMessage[];
}

/** One problem with the query, found by the backend in one database. */
export interface StatsErrorMessage {
  /** The `id` of the group or condition from the request that the problem is
   *  in. Left out when the problem is not in one place. */
  nodeId?: string;
  message: string;
  /** "incomplete": something is missing. "invalid": something can't work. */
  kind: "incomplete" | "invalid";
}
```

`src/api/contract.ts` gets one new read, `optionalList<U>(key)`: like `list`,
but a missing (or `null`) key gives `[]`. A value that is there but isn't a
list of objects throws a `ContractError`, as `list` does. These items decide
whether Run is allowed, so they are not display-only: a plain-text item from
an old backend fails the stats line, with a message naming the field, rather
than being silently dropped.

Within an item:
- `message` is read with `text` (display-only, trimmed, blank with a warning).
  A blank message becomes "The server rejected this part of the query.", so
  an issue never shows up empty.
- `nodeId` is read with `optionalText`; blank or missing becomes `null`.
- `kind` is read with `text`; anything but `"incomplete"` is `"invalid"`
  (the safe default, as in `toCompliance`).

## 4. Frontend model

`src/model.ts`:

```ts
/** One problem a database found in the query. */
export interface DatabaseError {
  message: string;
  kind: "incomplete" | "invalid";
  /** The query node it is in (`QueryNode.id`), or null. */
  nodeId: string | null;
}
```

A `"failed"` `DatabaseResult` changes from `errors: string[]` to
`errors: DatabaseError[]`. `toDatabaseResult` (`src/api/response.ts`) maps
each `errorMessages` item into one. The frontend's own "The server sent no
count for this database." becomes `{ message, kind: "invalid", nodeId: null }`,
so it never blocks Run.

## 5. Server issues in the builder (D4–D7)

A new file, `src/query/issues.ts`, holds two pure functions.

**`serverIssues(stats: StatsState): Issue[]`**: every error with a `nodeId`
from the `"failed"` results, as an `Issue`, keeping the first of each
`(nodeId, kind, message)`. `[]` for a `stats` in `"error"` status.

**`placeIssues(query: Group, issues: Issue[]): Issue[]`**: each issue with its
`nodeId` moved to the node that shows it:
- a visible node: unchanged;
- a node inside one or more collapsed groups: the outermost collapsed group;
- an id not in `query`: the root group.

`renderQueryBuilder` builds its `BuilderCtx.issues` as
`placeIssues(query, [...state.issues, ...serverIssues(state.stats)])`, so
`issuesHtml` stays as it is. The footer counts the placed issues, so "N parts
still need attention" matches what is on screen, and it shows that count
instead of the query summary while there are server issues.

An unknown id can only come from a backend bug: results for an older query
are already thrown away (`requestSlot`), and collapsing a group doesn't change
ids.

## 6. Blocking Run (D8)

`runBlocker` (`src/state.ts`) gets a new last reason, `"rejected"`: some
database reported an error with a `nodeId`. `RunInputs` adds `stats`. It
uses `serverIssues(state.stats).length > 0`, so "blocked" and "shown in the
builder" can't disagree.

- **`dataPreview.ts`** disables Run with "A database found a problem in the
  query (shown above). Change the query to run it." This also replaces any
  preview already showing (Run clicked before the stats arrived), like every
  other blocker.
- **`app.ts`** `runPreview` already returns when `runBlocker` is set.
  `refreshStats` never sees `"rejected"`, because `changeScope` resets `stats`
  before every refetch.
- **`statsPanel.ts`** treats `"rejected"` as "not blocked": the results are
  what explain the block, so they stay on screen. Its `BLOCKED_MESSAGES` type
  excludes `"rejected"`.

## 7. Statistics panel (D9)

`failureRowHtml`:
- If any error has a `nodeId`: a "Rejected the query" label, then every
  error's `message`.
- Otherwise, as today: the messages, or "Failed." when there are none.

Notes are shown beneath in both cases. The headline's note becomes "Excludes N
database(s) that failed or rejected the query (see below)."

## 8. Mock server

- `DatabaseOutcome.fail.errorMessages` and `buildStatsLine` use
  `StatsErrorMessage[]`. The random failures (`MOCK_FAIL_RATE`) still send `[]`.
- A new, deterministic rule (in `mock-server/evaluate.ts`, called by
  `streamStats`): a condition with a text value, or a text item in a list,
  longer than 100 characters fails in **every** selected database with
  `{ nodeId: <condition id>, kind: "invalid", message: "Text is too long (at most 100 characters)." }`.
  So the feature can be tried with `npm run mock` by pasting a long value.

## 9. Testing

- `tests/api/contract.test.ts`: `optionalList` (missing, `null`, a list, not
  a list).
- `tests/api/response.test.ts`: `toDatabaseResult` reads `errorMessages` items
  (with and without `nodeId`, unknown `kind`, a plain-text item is a
  `ContractError`). The no-count case has `nodeId: null`.
- `tests/query/issues.test.ts`: `serverIssues` (no duplicates, errors without
  an id ignored, ok results ignored) and `placeIssues` (visible, nested
  collapsed, unknown → root).
- `tests/state.test.ts`: `"rejected"` comes after `"unfinished"`, and only
  for errors with a `nodeId`.
- `tests/ui/queryBuilder.test.ts`: a server issue shows on its node and on
  the root for an unknown id. The footer counts it.
- `tests/ui/statsPanel.test.ts`: the "Rejected the query" row and the headline
  note. The panel keeps showing results while `"rejected"`.
- `tests/mock-server/evaluate.test.ts` / `server.test.ts`: the too-long rule
  and the new line shape. `tests/api/mockContract.test.ts` still passes.

## 10. Docs

`docs/ARCHITECTURE.md`:
- "Wire format of the query": node ids are now quoted in `errorMessages`.
- "Statistics lines": the item shape, and "Rejected the query".
- "Correctness invariant" and "Error and loading model": the `"rejected"`
  blocker.
- Section 8 ("The query model") and "Centre — `queryBuilder.ts`": server
  issues and where issues are placed.
- "Mock server": the too-long rule.
- The directory layout: `src/query/issues.ts`.

Also a `docs/CHANGELOG.md` entry, and the earlier spec's "Per-condition error
responses" out-of-scope note is now done (no edit to that historical spec).

## 11. Out of scope

- Node references in `POST /query`'s error response (Run keeps
  `400 { "error": "…" }`).
- Showing which database reported a builder issue.
- Accepting the old plain-text `errorMessages`.
