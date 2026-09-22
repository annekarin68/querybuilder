# Query Builder Frontend — Architecture & Design

> **Living document.** This file is the single source of truth for the frontend's
> vision and structure. Update it in the same change as any code that alters the
> architecture, the API contract, the state shape, or a panel's behaviour. If the
> code and this file disagree, that is a bug in one of them.

Last updated: 2026-09-16 — Data preview redesigned as a multi-entryset summary
list (`POST /api/query` now returns `{ entrysets: [...] }`), with 5 varied
example entrysets to exercise it.

---

## 1. What we are building

A single-page frontend application that lets a user build a database query by
clicking through fields, operators, and values, and shows — live — how many
records match and what a sample of them looks like. Almost all data comes from a
backend API; this repo focuses on the frontend and ships a small mock server so
the app runs end to end during development.

### Screen layout

```
┌───────────────────────────────────────────────────────────────┐
│  top ui menu: app title ······················ [☰ Docs]  [Run] │
├───────────────────────────────────────────────────────────────┤
│  secondary pointing ui menu:  Filter | Review | Approval | Done│
├────────────┬────────────────────────────────────┬──────────────┤
│ docs       │        query builder (centre)      │  statistics  │
│ sidebar    │        recursive AND/OR tree       │  (right)     │
│ (left,     │                                    │  live, rich  │
│ collapsible│                                    │  dashboard   │
├────────────┴────────────────────────────────────┴──────────────┤
│  data preview (bottom): summary line + paged table + Prev/Next │
└───────────────────────────────────────────────────────────────┘
```

- **Left** — documentation sidebar, generated entirely from the schema. Collapsible. Scrollable. Expandable items.
- **Centre** — the query builder: nested AND/OR groups, any depth. Collapsible groups.
- **Right** — statistics for the current query, refetched live (debounced) as the
  user builds, as long as the query is valid.
- **Bottom** — a sample of matching rows, refetched only when the user presses
  **Run / Refresh**.
- **Secondary menu** — `Filter | Review | Approval | Done`. Only **Filter** is a
  real view today; the other three are selectable tabs showing a "Coming soon"
  placeholder. Active tab lives in `AppState.activeView`.

### Non-goals (for now)

- The Review / Approval / Done views. Tabs exist; content does not.
- Any real backend. The mock server stands in and shares no code with `src/`.
- Saving / sharing / restoring queries (URL state, persistence).
- Authentication.

---

## 2. Technology choices and why

| Choice | Why |
|---|---|
| **Vite + TypeScript** | Fast dev server with hot reload and readable error overlays; types give junior maintainers autocomplete and catch typos before runtime; the most transferable skill set. |
| **Fomantic UI (CSS + JS) + jQuery** | Consistent good-looking components with little custom CSS. We use the **jQuery components** (searchable dropdowns, chips, accordion) — this is a deliberate choice; see §3 for how we keep it safe. |
| **No framework (no React/Vue)** | One less thing to learn. State is one plain object; the view is functions that turn state into HTML strings. |
| **Small mock server** | `npm run dev` gives a working app end to end. It is dev-only and shares no code with `src/`. |
| **Vitest, unit tests on pure modules only** | The valuable logic (query tree, validation) is pure and easy to test. The view layer is deliberately too thin to be worth DOM testing. |

**Toolchain floor: Node 20.19+.** Vite 8 / Vitest 4 / ESLint 9 (flat config,
`eslint.config.js`). These majors clear the dev-tooling CVEs the Vite 5 / Vitest 2
line carried; `npm audit` is clean. Don't downgrade below Node 20 — the build
tools won't install.

### The audience constraint

**Junior developers maintain this code.** Every structural decision below is made
to keep the mental model small: one state object, one render function per panel,
one file that is allowed to touch jQuery, one pattern for async/error states.
When two designs are equally capable, we pick the one that is easier to read and
debug.

### Offline-first: the app must run with only LAN access

**Hard constraint.** The deployed app runs in an environment that can reach *our
own API and nothing else* — no internet. If any asset or request targets an
external host, the app may hang or fail when taken offline. Therefore:

1. **No external hosts, ever.** The only network calls the app makes are to our
   own API, under a configurable base path (`VITE_API_BASE`, default `/api`, same
   origin). No CDNs, no Google Fonts, no analytics, no external error tracking, no
   remote favicon, no `<script src="https://...">`.
2. **All third-party code is installed from npm and bundled by Vite** into
   `dist/` — jQuery, Fomantic UI CSS/JS, fonts, icons. `dist/` is fully
   self-contained and can be served by any static file server on the LAN.
3. **Fonts are self-hosted — by the dependency itself.** `fomantic-ui-css@2.9.x`
   ships **Lato self-hosted**: its `semantic.min.css` declares local `@font-face`
   rules pointing at `themes/default/assets/fonts/Lato*.woff2` inside the package,
   and contains **zero** `fonts.googleapis.com` references. (Verify with
   `grep -c fonts.googleapis node_modules/fomantic-ui-css/semantic.min.css` → `0`.)
   Vite bundles those `.woff2` files into `dist/assets/` like any other asset. The
   same is true of Fomantic's icon font. **No separate font package is needed**, so
   we deliberately do not depend on `@fontsource/lato` — it would ship a second,
   redundant ~2 MB copy of the same typeface.

   What `vite.config.ts` actually does is different and narrower. Its two
   `stripRemoteCss` / `stripRemoteJs` plugins neutralise **off-origin URLs that
   appear in comments, banners, and developer-facing strings** — text that is never
   dereferenced by the browser but that the `check:offline` grep (rule 4) cannot
   tell apart from a real fetch:
   - CSS: `cdn.jsdelivr.net` twemoji references sitting in commented-out emoji rules.
   - JS: jQuery's `/*! ... */` licence banner (`jquery.com`, `jquery.org/license`)
     and Fomantic's `error:` message strings that cite the `unorm` polyfill and the
     `jquery-address` library.

   `stripRemoteCss` also still removes off-origin `@import url(...)` from bundled
   CSS. Nothing we depend on today has one; it is kept as a guard so a future CSS
   dependency that reintroduces a Google Fonts import fails safe instead of
   silently going online.
4. **Guard script.** `npm run check:offline` scans the built `dist/` for any
   `http://` or `https://` URL that is not our own API and exits non-zero if it
   finds one. Run in CI and before any release. This is the automated backstop for
   rules 1–3.
5. **Reproducible installs.** `package-lock.json` is committed; use `npm ci`. The
   machine that builds `dist/` needs internet for `npm ci` once; the machine that
   *serves* `dist/` never does.

Any new dependency or asset must be checked against rules 1–4 before it lands.

---

## 3. The Fomantic discipline (the one dangerous thing, isolated)

We use Fomantic's jQuery components with **full re-render** — when a panel's data
changes we rebuild that panel's HTML from scratch. jQuery plugins attach state
and event handlers to DOM nodes, so blindly replacing `innerHTML` would leak
handlers and lose plugin state. We contain that hazard in **one file** and **one
helper**.

### `src/ui/fomantic.ts` — the only file allowed to import jQuery

```ts
export function activate(container: HTMLElement): void {
  // Turn plain markup into interactive Fomantic components.
  $(container).find('.ui.dropdown').dropdown();
  $(container).find('.ui.checkbox').checkbox();
  $(container).find('.ui.accordion').accordion();
}

export function destroy(container: HTMLElement): void {
  // Tear down plugin instances BEFORE the old markup is thrown away.
  $(container).find('.ui.dropdown').dropdown('destroy');
  $(container).find('.ui.checkbox').checkbox('destroy');
  $(container).find('.ui.accordion').accordion('destroy');
}
```

### `src/ui/panel.ts` — the only way a panel updates its DOM

```ts
export function paint(container: HTMLElement, html: string): void {
  destroy(container);          // 1. tear down old plugins
  container.innerHTML = html;  // 2. swap markup
  activate(container);         // 3. init new plugins
}
```

### The rules a maintainer learns on day one

1. **Never write `$(...)` outside `src/ui/fomantic.ts`.** (Enforced by an ESLint
   note / review checklist: no `jquery` import elsewhere.)
2. **To make new markup interactive**, add its selector to `activate()` and the
   matching teardown to `destroy()`.
3. **To update a panel**, build an HTML string from state and call `paint()`.
4. **Panels are independent.** A change in one panel never repaints another (see
   §5). This keeps plugin churn contained to the panel that actually changed.

### The bootstrap wrinkle

Fomantic's `semantic.min.js` is an IIFE that ends `}(jQuery, window, document)` — it
reads the **global** `jQuery` the instant it is evaluated. ES `import`s are hoisted:
every imported module runs to completion before the importing module's body. So
setting `window.jQuery` in `main.ts`'s body is too late — `semantic.min.js` has
already evaluated (and thrown `undefined.fn`) by then, and the app renders blank.

The fix: `src/setup-jquery.ts` does `import $ from "jquery"; window.jQuery = window.$ = $;`
and nothing else, and `main.ts`'s **first** import is `import "./setup-jquery";`,
before the `fomantic-ui-css/semantic.min.js` import. Module evaluation order is
import order, so the global is set first. `setup-jquery.ts` and `src/ui/fomantic.ts`
are the only two files that may import jquery (ESLint enforces it).

---

## 4. Directory layout

```
src/
  setup-jquery.ts      Imported first by main.ts: publishes window.jQuery before Fomantic's JS evaluates (see §3, "the bootstrap wrinkle"). One of only two files allowed to import jquery.
  main.ts              Bootstrap: import setup-jquery + Fomantic; render layout shell; load schema; wire subscriptions; hold the refreshStats / runPreview orchestrators.
  state.ts             AppState type + a ~15-line store (getState / setState / subscribe) + module singleton `store`.
  util/
    debounce.ts        debounce(fn, ms) — the one named debounce helper (used for the stats trigger).
  api/
    client.ts          The ONLY file that calls fetch(). One function per endpoint.
    types.ts           Request/response types. This IS the API contract.
  query/
    types.ts           Condition, Group, QueryNode, Issue.
    tree.ts            Pure tree helpers: emptyQuery, newCondition, newGroup, addChild, updateNode, removeNode, findNode, countConditions.
    validate.ts        validateQuery(tree, schema) -> Issue[]; hasBlockingErrors(issues).
    summary.ts         queryToText(tree, schema) -> human-readable string (display only).
    fieldCatalog.ts    buildFieldCatalog(individuals) -> { fields, operators } — derives the query builder's field catalog client-side; the real API has no schema/operators endpoint.
  ui/
    fomantic.ts        The jQuery airlock (activate / destroy / onDropdownChange).
    panel.ts           paint() helper + escapeHtml().
    format.ts          compact() / exact() / matchRatio() / barWidth() — number & proportion formatting for the stats panel at billion-row / 1e-10 % scale.
    layout.ts          Renders the shell once (top menu, secondary menu, grid columns). Handles sidebar collapse + active view via CSS class, no repaint.
    valueControl.ts    renderValueControl(field, operator, value) + readValueControl(row, arity, valueType) — the value input(s) for a condition row, chosen by operator arity × field valueType.
    databasePicker.ts  render + wiring for the database-scope checkboxes above the query builder (its own panel, data-panel="dbpicker").
    queryBuilder.ts    render + delegated event wiring for the centre panel (recursive).
    docsSidebar.ts     render for the left panel — built from state.individuals
                       (GET /api/individuals), NOT state.schema. See §9.
    statsPanel.ts      render for the right panel (data-driven from /api/stats).
    dataPreview.ts     render for the bottom panel — a summary list of
                       entrysets (POST /api/query), NOT a paged row table.
                       See §9.
mock-server/
  index.ts             Dev-only. Plain Node http: routing + JSON I/O + paginate().
                       Starts only when run as the entrypoint.
  databases.ts         DatabaseDef type, DATABASES (7 synthetic, arbitrarily
                       named ALPHA..ETA partitions with mock-only sizes),
                       dbIndexForEntrysetId(id) / databaseIdForEntrysetId(id)
                       — a pure function of an entryset's numeric id, never
                       of its content.
  rows.ts              flattenEntryset(entryset) -> Row (nested items ->
                       dotted "individualLabel.fieldLabel" keys + a
                       synthetic __db key) and ROWS, every entryset
                       flattened once at startup.
  evaluate.ts          matches(node, row) recursive evaluator + filterByDatabases(rows, ids) /
                       perDatabaseCounts(query, rows, ids) (keyed on row.__db) +
                       scaleCount(part, whole, target) + buildStatsLine(outcome) — turns one
                       database's raw outcome into the StatsResponse line /api/stats streams
                       for it.
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
tests/                 Vitest specs for src/query/*, src/api/*, src/state, src/util/*, mock-server/evaluate + index (pure, no DOM).
docs/
  ARCHITECTURE.md      This file.
index.html
```

---

## 5. State & the render loop

### `src/state.ts`

```ts
export interface AppState {
  schema: ReturnType<typeof buildFieldCatalog> | null;  // derived client-side from `individuals` — no schema endpoint exists
  databases: DatabasesResponse[] | null;    // loaded once (GET /api/databases, a bare array)
  individuals: Individual[] | null;         // loaded once (GET /api/individuals, a bare array); drives docsSidebar and the query builder's Item dropdown
  selectedDatabaseIds: string[];      // which databases the query runs against; [] = nothing runs
  activeView: "filter" | "review" | "approval" | "done";  // secondary menu; default "filter"

  query: QueryNode;                   // the tree (root Group, operator "AND")
  issues: Issue[];                    // validateQuery(query, schema); recomputed on every query change

  stats: {
    status: "idle" | "loading" | "ok" | "error";
    lines: StatsResponse[];   // one entry per database that has reported so far (streamed)
    error: string | null;
  };
  preview: {
    status: "idle" | "loading" | "ok" | "error";
    data: EntrysetsResponse | null;   // the entrysets matching the current query — see §7/§9/§10
    error: string | null;
  };

  sidebarCollapsed: boolean;
}
```

The store is ~15 lines: `getState()`, `setState(patch)` (shallow merge, then
notify), `subscribe(listener)`. `setState` passes listeners a `Set<keyof AppState>`
of the keys that changed.

### Who re-renders when

| Trigger | Effect |
|---|---|
| App starts | `getDatabases()` + `getIndividuals()`, then `buildFieldCatalog(individuals)` synchronously → `setState({ schema, databases, individuals, ... })` → every panel renders once. Individuals/databases load failure is fatal (full-page error + Reload). |
| User edits the query | handler calls a `tree.ts` fn → `setState({ query, issues, stats: <reset to idle/null>, preview: <reset to idle/null> })` → **only** `queryBuilder` repaints. Then, if `issues` has no errors, a **debounced** (400 ms) `getStats()` is scheduled. |
| `getStats()` reports a streamed line | stale-response guard (below); if current, appended to `stats.lines` via `setState` → **only** `statsPanel` repaints, showing partial results while more lines are still arriving. When the stream ends, `status` becomes `ok`; a non-2xx response instead sets `status: "error"`. |
| User clicks **Run / Refresh** | `setState({ preview: { status: "loading", data: null } })` → `dataPreview` repaints → `runQuery()` → guard → `setState({ preview })` → repaint. The mock server filters by `query`/`databases` for real — see §7/§10. There is no Prev/Next; the whole (short) list of matches comes back in one response and scrolls internally. |
| User toggles docs sidebar | `setState({ sidebarCollapsed })` → `layout` toggles one CSS class. No repaint. |
| User clicks a secondary-menu tab | `setState({ activeView })` → `layout` swaps the main area. Filter view repaints from existing state; nothing refetches. |

Each panel subscribes narrowly:

```ts
subscribe((state, changed) => {
  if (changed.has("query") || changed.has("issues") || changed.has("individuals"))
    queryBuilder.render(state);
  if (changed.has("stats"))   statsPanel.render(state);
  if (changed.has("preview") || changed.has("individuals")) dataPreview.render(state);
  if (changed.has("individuals")) docsSidebar.render(state);
});
```

`debounce(fn, ms)` is one named helper used in exactly one place (the stats trigger).

---

## 6. Correctness invariant — stats & preview always match the on-screen query

**The statistics panel and the data-preview table only ever show values computed
from the exact query tree currently in `AppState`. In every other situation they
are empty (placeholder or error) — never stale.**

"The exact query" includes the **selected databases** — a stats/preview response
belongs to a `(query, selectedDatabaseIds)` pair, and the stale-guard key
(`requestKey` in `main.ts`) is `JSON.stringify({ query, databases: sorted })`.

Concretely:

- **On any query edit _or database-selection change_**, the same `setState` that
  writes `query` / `selectedDatabaseIds` also resets `stats` to
  `{ status: "idle", data: null }` and `preview` to
  `{ status: "idle", data: null, page: 1 }`. Old numbers and rows disappear the
  instant the scope changes on screen — before any new request goes out.
  - Preview then shows: *"Press Run / Refresh to load matching rows."*
- **If no database is selected:** no request fires; both panels show
  *"Select at least one database…"* and **Run** is disabled.
- **If `issues` has errors:**
  - No `/api/stats` request fires. Stats shows a neutral hint:
    *"Fix the errors in your query to see statistics."*
  - **Run** is disabled. Preview shows the same hint, no rows.
- **If the query is valid:** debounced `getStats()` fires; while in flight the
  panel shows partial results as each database's line streams in (headline +
  per-database list so far), plus a "Waiting on N more" indicator for the
  databases that haven't reported yet — see §9. Before the first line arrives,
  it shows a plain loader instead.
- **If the backend returns an error:** stats goes to
  `{ status: "error", lines: [], error }`; preview goes to
  `{ status: "error", data: null, error }`. Both show a `ui negative message`
  with the text. No numbers, no rows.
- **Stale-response guard:** each `getStats()` / `runQuery()` call captures a
  snapshot (deep copy or stable stringify) of the query it was made for. When it
  resolves, if `getState().query` no longer equals that snapshot, the response is
  discarded. A slow earlier request can never overwrite results for a newer query.

> **Streaming and "never stale" are compatible.** While `stats.status` is `"loading"`, `stats.lines` legitimately holds fewer entries than `selectedDatabaseIds` — that's a query result still arriving, not a stale one. The invariant this section protects is that every line in `stats.lines` belongs to the `(query, selectedDatabaseIds)` pair currently on screen; the stale-response guard is checked once per streamed line (not just once per request), so a line that arrives after the user has changed the query/scope is discarded before it reaches `AppState`.

---

## 7. API contract (`src/api/types.ts`)

`src/api/client.ts` is the only file that calls `fetch()`. Each function is typed
and throws a plain `Error` (message unwrapped from `{ error }`) on any non-2xx
response.

```ts
getDatabases(): Promise<DatabasesResponse[]>
getIndividuals(): Promise<Individual[]>
getStats(query: QueryNode, databases: string[], onLine: (line: StatsResponse) => void): Promise<void>
runQuery(query: QueryNode, databases: string[], page: number, pageSize: number): Promise<EntrysetsResponse>
```

### There is no schema/operators endpoint

The real backend has no `GET /api/schema` and never did — an earlier revision
of this document guessed at one that doesn't exist in the actual API (see §13,
2026-09-22 Revision 2). The query builder's field catalog is instead derived
**client-side**, synchronously at startup, by `src/query/fieldCatalog.ts`'s
`buildFieldCatalog(individuals)` from the `Individual[]` data already fetched
via `GET /api/individuals` — one `CatalogField` per (individual, field) pair,
label `"individualLabel.fieldLabel"`, plus a fixed, hardcoded `CatalogOperator[]`
(`OPERATORS`) that never varies. `AppState.schema` holds this derived value
(`ReturnType<typeof buildFieldCatalog>`), not a fetched response.

```ts
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
```

`valueType` is mapped from each `IndividualField.type` (falling back to
`format`); **enum detection is `values.length > 0`, deliberately never
`cardinality`** — `cardinality` is informational-only telemetry from the real
backend, and branching the frontend on it would couple the UI to a backend
implementation detail (the frontend/backend decoupling rule; see §13).
`operatorIds` come from a fixed per-`valueType` profile (`OPERATOR_PROFILE`),
never from a specific field.

### `GET /api/databases`

The databases the query can be scoped to. Returns a **bare array**, no
wrapper object.

```ts
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
```

### `GET /api/individuals`

The vehicle/fleet telemetry data model — every "individual" (signal, sensor, or
piece of event metadata) an entryset may hold a value for. Loaded once at
startup, alongside databases; drives the **left** docs sidebar (§9) and, via
`buildFieldCatalog`, the query builder's field catalog. Returns a **bare
array**, no wrapper object.

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
```

The 4 `group: "metadata"` items (`observation_window`, `vehicle_identity`,
`trip_context`, `gps_position`) are always fully populated in any entryset —
they carry the time/identity/position every entryset needs and are used for
indexing. There is no field marking an item as metadata vs. content; it's
tracked only by convention (see git history for the design discussion).

### `POST /api/stats`

Body: `{ "query": <QueryNode tree>, "databases": string[] }`. Called live
(debounced ~400 ms) only when the query is valid **and at least one database is
selected**. The response is **newline-delimited JSON**: one `StatsResponse`
per selected database, written as soon as that database's result is ready —
some databases are slower than others, or can fail independently — rather
than one combined response after every database finishes.

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
```

There is no `totalCount` on the wire at all, and no `name` field on each line:
the frontend derives the headline by summing `matchCount` across the
successful lines received so far, and derives each line's **denominator**
from `DatabasesResponse.totalEntrysets` — looked up in `AppState.databases`
(loaded once from `GET /api/databases`) by `label`. `success: false` lines
carry `errorMessages`/`infoMessages` instead of a count. A missing / empty
`databases` array → `400 { error: "Select at least one database." }`.

`statsPanel.ts` renders a running headline, a per-database list (success:
`matchCount` against that database's `totalEntrysets` + bar; failure:
`errorMessages`/`infoMessages`), and a "waiting on N more" indicator while
`status` is `"loading"`.

### `POST /api/query`

Body: `{ "query": <QueryNode tree>, "databases": string[], "page": number, "pageSize": number }`.
Called only on **Run / Refresh**. Same `400` validation as `/api/stats`. The
mock scopes `ROWS` (every entryset, flattened) to the selected databases,
evaluates the query against them, and maps matching rows back to their
source entrysets, capped at 25. `page`/`pageSize` are accepted but unused —
there is no pagination (§9); the whole capped result comes back in one
response.

```ts
interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>; // keyed by Individual.label, then field label
}
interface EntrysetsResponse {
  entrysets: Entryset[];
}
```

Drives the **bottom** data preview (§9): a compact summary row per entryset,
not a full item-by-item view — see §9 for why (design rationale: a full
comparison grid doesn't scale past a handful of entrysets in either
orientation; a summary list does). There is no pagination — the whole list is
returned in one response and scrolls internally.

### Errors

Every endpoint, on 4xx/5xx: `{ "error": "human readable message" }`. `client.ts`
unwraps it into the thrown `Error`.

---

## 8. The query model (`src/query/`)

```ts
// types.ts
export type LogicalOperator = "AND" | "OR";

export interface Condition {
  kind: "condition";
  id: string;                 // stable id; used as the key when re-rendering
  individualId: string | null; // UI staging only — which individual.json item is picked in the
                                // builder's Item dropdown, ahead of a field being chosen. Never
                                // read by validate.ts/summary.ts/the mock backend; fieldId (below)
                                // stays the sole authoritative target.
  fieldId: string | null;     // null = not chosen yet
  operatorId: string | null;
  value: unknown;             // shape depends on operator arity; validate.ts checks it
}

export interface Group {
  kind: "group";
  id: string;
  operator: LogicalOperator;
  children: Array<Group | Condition>;
}

export type QueryNode = Group | Condition;
```

### `tree.ts` — pure, immutable, no DOM, no state

`emptyQuery()`, `newCondition()`, `newGroup()`, `addChild(tree, parentId, node)`,
`updateNode(tree, nodeId, patch)`, `removeNode(tree, nodeId)`, `findNode(tree, nodeId)`.

Every query edit is: read `state.query` → call one `tree.ts` function → write the
result back with `setState`. These functions return **new** trees; the input is
never mutated.

### `validate.ts`

`validateQuery(tree, schema): Issue[]` where
`Issue = { nodeId: string; message: string; severity: "error" | "warning" }`.
Reports: condition with no field / no operator / a value that does not fit the
operator's arity; empty groups. The Run button and the live stats fetch are gated
on there being **no `error`-severity issues**.

### `summary.ts`

`queryToText(tree, schema): string` → e.g.
`(Height ≥ 20 AND Has foliage is true) OR Species is any of Fern, Oak`.
Display only; has no bearing on what is sent to the API.

### Wire format

The tree is sent as-is, `JSON.stringify(query)`. No custom DSL string on the wire.
Since `Condition` gained `individualId`, the tree can now carry that one UI-only
key on the wire too — the backend simply ignores it, same as any other field it
doesn't recognize.

---

## 9. Panels

### Centre, above the builder — `databasePicker.ts`

Its own panel (`data-panel="dbpicker"`, painted independently of the query
builder). A Fomantic `ui checkbox` per `state.databases` entry, plus
**Select all** / **Select none** shortcuts. Toggling calls `onDatabasesChange`
in `main.ts`, which treats it exactly like a query edit (§6): same-`setState`
clear of stats/preview, debounced `refreshStats()`. Zero selected → the panels
show a "Select at least one database" hint and **Run** is disabled.

### Left — `docsSidebar.ts`

Built entirely from `state.individuals` (GET /api/individuals) — **not**
`state.schema`; both now describe the same vehicle-telemetry entryset/individual
model (see §7, §10), just via two separate API responses/state slices, so the
docs sidebar renders independently of the query builder's field catalog. A
Fomantic `ui accordion`: one section per `group` (18 subsystem groups, e.g.
`engine`, `tires_wheels`, `metadata`), each listing its items — name, tags,
`description`/`comment`, and a percentage computed client-side (`matchRatio()`
from `format.ts`) as `Individual.totalCount` divided by the sum of every
loaded database's `DatabasesResponse.totalEntrysets` — the backend supplies no
percentage directly, only the raw `totalCount` — and its `fields` (`name`,
falling back to `label`, + `type`). A plain `ui input` at the top filters items
by name (`String.includes`, no plugin) — matching items stay visible, others
get `display:none`; empty
group sections are not hidden. Collapse is a CSS class toggled in `layout.ts`
(`sidebarCollapsed`) — sets the left column to `display:none` and widens the
centre; no repaint.

### Centre — `queryBuilder.ts`

Three mutually-recursive functions build the tree's HTML: `nodeHtml` dispatches
on node kind, `groupHtml` renders a group and recurses into its children via
`nodeHtml`, and `conditionHtml` renders one condition row (no function called
`renderGroup` exists).

- A group = a Fomantic `ui segment` with an **AND / OR** `ui buttons` toggle,
  **+ Condition** and **+ Group** buttons, and (if not the root) **Remove group**.
- A condition = three cascading dropdowns followed by a value control:
  1. **Item** `ui dropdown` (searchable) — built from `state.individuals`; picking
     one stages `individualId` on the condition.
  2. **Field** `ui dropdown` — filtered to the chosen item's fields (matched by
     `fieldId` prefix), shown by their short slug rather than repeating the
     item's name; disabled and empty until an item is chosen.
  3. **Operator** `ui dropdown` (unchanged) — options from the selected field's
     `operatorIds`.
  4. A **value** control chosen by the operator's `arity` × the field's
     `valueType`:
     - `none` → no control
     - `one` → single `ui input` / enum `ui dropdown` / boolean `ui checkbox` / date input
     - `two` → two inputs (from / to)
     - `many` → multiple `ui dropdown` (chips)

  Changing the Item resets Field, Operator, and the value to empty/null — the
  same cascade-reset pattern that changing Field already applies one level
  down to Operator/value.
- Nodes in `state.issues` get a red `ui message` under the row.

**Event wiring:** one delegated listener on the panel container, reading
`data-node-id` and `data-action` attributes. The recursive HTML stays a pure
string with no baked-in closures. Fomantic dropdowns' `onChange` is bound inside
`activate()` and dispatches into the same `data-action` flow.

### Right — `statsPanel.ts`

Every number in this panel goes through `src/ui/format.ts` so it stays inside a
~20 rem column when a real backend returns billions:

- **`compact(n)`** — `1.2B` / `988M` / `12,345`; the exact value is in a `title=`
  tooltip.
- **`matchRatio(match, total)`** — `62%` / `6.2%` / `0.34%`, and for sub-0.05 %
  (e.g. `3.46e-7 %`) **`1 in 289.3M`** instead of a misleading `0%`. `none` / `all`
  at the extremes; `>99.9%` rather than a rounded-up `100%`.
- **`barWidth(match, total)`** — a CSS `max(…%, 2px)`, so any nonzero match shows a
  2 px sliver, visibly distinct from zero.

Layout, top to bottom: a compact headline (sum of `matchCount` across the
successful lines received so far against a denominator summed from those
lines' `DatabasesResponse.totalEntrysets`, big + `of … · matchRatio` small)
and a thin bar; the **By database** segment — one row per streamed line so
far, success (`compact(matchCount) / compact(totalEntrysets) · matchRatio`,
thin bar, exact figures on hover, any `infoMessages`) or failure
(`errorMessages` + `infoMessages` as a red message) — inside a
`.qb-stat-perdb` scroll region
(`max-height: 45vh`, replacing the old per-field-block scroll region now that
there are no field blocks); then, while `status` is `"loading"`, a "Waiting on
N more database(s)…" line. The whole stats column is `position: sticky` so it
tracks the viewport while a tall query builder scrolls past. `status`
branches: `idle` → hint from §6; `error` → `ui negative message`, no data.
There is no longer a per-field-block list — the real backend can currently
only return counts, not aggregated min/max/avg/buckets/earliest/latest.

### Bottom — `dataPreview.ts`

**Run / Refresh** button (disabled while `issues` has errors or while
loading — same gating as before). On success: a **summary index list**, one
compact row per entryset in `EntrysetsResponse.entrysets` — not a full
item-by-item grid. Design rationale: entrysets are heterogeneous (each is a
different event, most likely holding a different subset of `individual.json`'s
items), so a grid needs either items-as-rows (fine for a handful of
entrysets-as-columns, but entrysets don't scale past ~5-6 columns on screen)
or entrysets-as-rows (scales entrysets fine, but then *items* become columns
and the union across many varied entrysets can easily reach 60-100+, needing
horizontal scroll — worse UX than vertical). A summary list sidesteps the
problem entirely: no per-item columns, so it scales to 20+ entrysets just by
scrolling vertically (`.qb-entryset-list`, `max-height: 45vh`, same pattern as
`.qb-stat-perdb`).

Each row is a native `<details>/<summary>` element (no JS wiring needed for
expand/collapse):

- **Summary line**: entryset id, "When" (`observation_window.from_timestamp`,
  locale-formatted), "Vehicle" (`vehicle_identity.vehicle_type`, both falling
  back to `—` if that metadata item is absent), the distinct non-`metadata`
  `group`s present as badges (first 3, `+N` overflow — computed by
  cross-referencing `state.individuals`), and the total item count.
- **Expanded content**: the entryset's full `{ id, items }` as pretty-printed
  JSON (`JSON.stringify(entryset, null, 2)` in a `<pre>`) — a throwaway stand-in
  for the dedicated pretty-JSON entryset viewer planned as a follow-up; expect
  this to be replaced by a link/route into that viewer once it exists.

`/api/query` filters for real (§7, §10), so this list changes with the query
and selected databases. No pagination (§7). `status: "idle"` → hint from §6.

---

## 10. Mock server (`mock-server/index.ts`)

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
  `"individualLabel.fieldLabel"` keys matching the schema's field labels, plus
  a synthetic `__db` key from `databaseIdForEntrysetId` — once at startup
  (`ROWS`).
- `POST /api/stats` computes each database's match/total counts via
  `perDatabaseCounts` (which scopes `ROWS` to each database inline via
  `rows.filter((r) => String(r.__db) === label)`), scaling the sample's match
  rate onto that database's `size` (`scaleCount`, unchanged). Rather than
  returning one combined response, it writes one `StatsResponse` line per
  database (`buildStatsLine`) as newline-delimited JSON, with a small
  artificial delay between lines so the streaming is visible in `npm run dev`,
  and — dev-only — occasionally (~5%) simulates a database that couldn't be
  reached, to exercise the UI's per-database failure path without a real backend.
- `POST /api/query` scopes and evaluates the same way, then maps matching
  rows back to their source `Entryset` objects via `ENTRYSETS[id]`, capped
  at 25.
- Bad query, or missing / empty `databases` → `400 { error }`.

Shares **no code** with `src/`. It stands in for "a real backend in any
language"; the frontend knows it only through `src/api/types.ts`.

---

## 11. Error & loading model

One pattern everywhere (`idle` / `loading` / `ok` / `error`):

- `client.ts` throws a plain `Error` with a readable message on any non-2xx.
- Async panels catch it, write `{ status: "error", data: null, error }`, render a
  `ui negative message`. Per §6, data is nulled — never left stale.
- Schema load failure at startup is fatal: replace `#app` with a full-page
  `ui negative message` + Reload button.
- No retries, no error-boundary machinery — just visible messages.

---

## 12. Testing & tooling

### Tests (Vitest, unit only, all on `src/query/`)

- `tree.test.ts` — add/update/remove/find return correct new trees; inputs unmutated.
- `validate.test.ts` — each issue type is reported; a complete query yields `[]`.
- `summary.test.ts` — representative trees produce the expected text.
- Fixture request/response objects double as contract examples.
- No component tests — the view layer is deliberately too thin (state → string).

### Scripts

```
npm run dev           Vite dev server + mock server (concurrently)
npm run mock          just the mock server
npm run build         tsc --noEmit + vite build -> dist/
npm run preview       vite preview on the built output
npm run test          vitest run
npm run test:watch    vitest
npm run typecheck     tsc --noEmit
npm run check:offline scan dist/ for off-origin http(s) URLs; non-zero if any found
```

### Config

- `tsconfig.json` in `strict` mode.
- Prettier + minimal ESLint (`eslint:recommended` + `@typescript-eslint/recommended`).
- README note / review checklist item: **no `jquery` import outside
  `src/ui/fomantic.ts` (plus the one-line `window.jQuery` bootstrap in
  `src/main.ts`)**.

---

## 13. Change log

| Date | Change |
|---|---|
| 2026-09-01 | Initial design captured. No code yet. Next step: implementation plan. |
| 2026-09-01 | Added §2 "Offline-first" hard constraint: LAN-only, all assets bundled, fonts self-hosted, `npm run check:offline` guard. |
| 2026-09-01 | Implementation plan written (`docs/superpowers/plans/2026-09-01-query-builder-frontend.md`). §4 expanded: added `src/util/debounce.ts`, `src/ui/valueControl.ts`, and split `mock-server/` into `index/catalog/data/evaluate`. |
| 2026-09-01 | Frontend implemented per plan 2026-09-01-query-builder-frontend.md (Tasks 1–17). `npm run build` now chains `npm run check:offline`; README rewritten; `THIRD-PARTY-NOTICES.txt` added at repo root (bundled deps are MIT; Lato font files are OFL-1.1; TypeScript build tooling is Apache-2.0). |
| 2026-09-01 | Plan-defect rulings applied during build: `updateNode`'s patch parameter is typed `NodePatch` (`src/query/tree.ts`); `npm run typecheck` added as a standing gate alongside lint/test/build; `wireQueryBuilder` / `wireDataPreview` attach their delegated listeners once per container (not per render); the stats panel treats `idle` as distinct from `loading` (idle shows the §6 hint, loading shows a bare loader). Mock server `POST /api/stats` and `POST /api/query` now also 400 on a JSON-array `query` body (previously fell through to a 500). |
| 2026-09-01 | Blank-page fix: the jQuery global must be published from a module (`src/setup-jquery.ts`) imported *before* `fomantic-ui-css/semantic.min.js`, not from `main.ts`'s body — ES import hoisting made the old approach evaluate Fomantic's JS while `window.jQuery` was still undefined. §3 rewritten. |
| 2026-09-01 | Toolchain bump (needs Node 20.19+): Vite 5→8, Vitest 2→4, ESLint 8→9 (`.eslintrc.cjs` → flat `eslint.config.js`, via `typescript-eslint`). `npm audit` now clean (was 1 critical / 1 high / 3 moderate, all in the old Vite/Vitest chain). Vite 8's minifier no longer keeps vendor licence banners in the bundle, so attribution rests entirely on `THIRD-PARTY-NOTICES.txt`, which must ship next to `dist/` (README updated). |
| 2026-09-01 | Database scope feature: `GET /api/databases`; `databases: string[]` added to the `/api/stats` and `/api/query` bodies (400 if missing/empty); mock scopes rows via `filterByDatabases` (a database == a species). New `AppState.databases` / `selectedDatabaseIds`, `src/ui/databasePicker.ts` panel above the builder, empty-selection hints in stats/preview, `syncRunButton` gated on it, stale-guard key widened to `{query, databases}`. |
| 2026-09-01 | Per-database stats: `StatsResponse.perDatabase` (`{id,label,matchCount,totalCount}[]`, counts only) from `perDatabaseCounts()` in the mock; `statsPanel.ts` renders a "By database" segment below the combined view. |
| 2026-09-01 | Stats panel formatting for large-scale data: new `src/ui/format.ts` (`compact` / `exact` / `matchRatio` / `barWidth`). All panel numbers are compacted (`1.2B`), tiny proportions render as `1 in 289.3M` not `0%`, nonzero bars keep a 2 px floor, exact values move to `title=` tooltips. `overflow-wrap: anywhere` + `.bar { min-width: 0 }` on the stats column. |
| 2026-09-01 | Mock now reports counts at real scale: `DATABASES[].size` (mock-only, 12 K–5.6 B); `/api/stats` projects the 200-row sample's match rates onto those sizes (`scaleCount`), and `computeBlocks` takes an optional `{ total, match }` scale for `nullCount` / bucket counts. `/api/databases` strips `size`. Preview (`/api/query`) stays a literal sample. |
| 2026-09-01 | Stats panel: headline + "By database" pinned; field blocks moved into a `.qb-stat-blocks` (`max-height: 45vh`) scroll region; stats column `position: sticky`. Per-database stats stay visible for any query size. |
| 2026-09-16 | New mock dataset added: `mock-server/data/individual.json` (a vehicle/fleet telemetry data model: ~157 items across 18 subsystem groups + metadata) and `mock-server/data/entrysets.json` (actual telemetry records referencing those items; one example entryset so far). Not yet wired into the app. |
| 2026-09-16 | Docs sidebar and data preview repointed at the new dataset: `mock-server/vehicleData.ts` loads it; new `GET /api/individuals` endpoint + `IndividualsResponse`/`Individual`/`IndividualField` types; `POST /api/query`'s response type becomes `EntrysetResponse` (`{ id, items }`, replacing the old `columns`/`rows`/pagination shape) and — transitionally — always returns the mock server's one entryset regardless of the query/databases sent. `AppState` gains `individuals`; `preview` drops `page` (no pagination for a single entryset, so Prev/Next is removed from `dataPreview.ts`). `docsSidebar.ts` now renders `state.individuals` grouped by subsystem instead of `state.schema`'s fields/operators. The query builder, stats panel, and database picker are untouched and still run against the original plant/species mock data — a known, temporary inconsistency (see §10). |
| 2026-09-16 | Data preview redesigned as a multi-entryset summary list (a single-entryset item table doesn't scale to a real ~6B-entryset dataset). Added 4 more example entrysets to `data/entrysets.json` (ids 2-5: semi truck, rideshare EV, parked sedan, construction dump truck — 11-39 items each, deliberately varied) alongside the original delivery van. `POST /api/query` now returns `{ entrysets: Entryset[] }` (every entryset the mock has, capped at 25) instead of one `Entryset`; `EntrysetResponse` renamed to `Entryset` + new `EntrysetsResponse` wrapper. `dataPreview.ts` renders one native `<details>/<summary>` row per entryset (id, formatted time, vehicle type, subsystem-group badges, item count; no JS wiring needed for expand/collapse) inside a `.qb-entryset-list` scroll region (`max-height: 45vh`, same pattern as `.qb-stat-blocks`); expanding a row shows that entryset's full `{ id, items }` as pretty-printed JSON — a throwaway stand-in for the dedicated pretty-JSON entryset viewer planned as a follow-up task. Rejected an items×entrysets comparison grid in either orientation: entrysets-as-columns tops out around 5-6 on screen, and entrysets-as-rows just moves the same explosion onto item columns (60-100+ for a varied 20-entryset sample) — worse than the vertical scroll a summary list needs instead. |
| 2026-09-16 | Finalized the entrysets transition: the query builder, database picker, and stats panel now run against the entryset/individual model (previously only the docs sidebar and preview did). Replaced the plant/species mock (`catalog.ts`, `data.ts`) with `schema.ts` (field catalog built purely from `individual.json`'s declared shape), `databases.ts` (7 arbitrary, content-agnostic databases partitioned by a hash of each entryset's id), and `rows.ts` (flattens entrysets into the flat rows the existing matching engine expects). `POST /api/query` now filters for real instead of always returning every entryset. `evaluate.ts`'s `computeBlocks` takes `fields` as an explicit parameter instead of importing a data-specific catalog. Sample data grew from 5 to 21 entrysets so every database has real sample data. No changes to `src/` — it already consumed the API purely through its typed contract. |
| 2026-09-16 | Query builder's condition row now cascades **Item → Field → Operator** (previously just Field → Operator): the user first picks an individual from `state.individuals`, which filters the Field dropdown to that item's fields, shown by short slug. `Condition` gained `individualId: string | null` (UI-staging only; `fieldId` remains the sole authoritative target, so `validate.ts`, `summary.ts`, and the mock backend needed no changes). Changing Item resets Field/Operator/value, mirroring the existing Field→Operator reset. No backend or schema-contract changes. |
| 2026-09-16 | Frontend/backend separation audit: `src/` had no runtime coupling to `mock-server/` (no imports; the contract already ran entirely through `src/api/types.ts` + `src/api/client.ts`), but several comments named mock-server internals directly (`mock-server/databases.ts`, `individual.json`, "the mock server does not paginate", a hardcoded "7 databases" / "(mock) 6-billion-entryset" fact) — these would go stale or mislead once swapped for a real backend. Reworded them to describe only the API contract (`GET /api/databases`, `GET /api/individuals`, `EntrysetsResponse`). Added a second ESLint airlock (`eslint.config.js`, alongside the existing jQuery one, §3): `src/**` may not import `mock-server/*` at all — must go through `src/api/*`. |
| 2026-09-22 | API contract rename + streaming stats: `id`/`label` renamed to `label`/`name` across `SchemaResponse`, `DatabasesResponse`, and the (now per-database) `StatsResponse`, matching the convention `Individual`/`IndividualField` already used. `StatBlock` removed — the real backend can currently only return counts, not aggregated min/max/avg/buckets/earliest/latest. `IndividualField` gained `name` (reserved, unpopulated; UI falls back to `label`) and `values` (a field's declared domain, wired into `buildFields` as an enum `SchemaResponse` field with real `options` — exercised end to end via `vehicle_identity.vehicle_type`). `POST /api/stats` now streams newline-delimited JSON, one `StatsResponse` per selected database as it finishes, instead of waiting for every database and returning one combined response; the frontend derives the combined headline by summing the lines received so far, and reports per-database success/failure/info independently (§6, §7, §9, §10). Design: `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md`. |
| 2026-09-22 | API contract correction (Revision 2): the initial rename (id/label -> label/name, streamed StatsResponse) guessed at shapes that didn't match the real production backend. Corrected against the actual contract: StatsResponse's identifier is `label` (not the guessed `database`), `matchCount` is optional (not a discriminated union), `errorMessages` (not `validationErrors`), and `totalCount` doesn't exist on the wire at all — the stats panel now derives its per-database denominator from `DatabasesResponse.totalEntrysets`. `DatabasesResponse` gained `description`/`owner`/`percentageOfTotal` and dropped its `{databases:[...]}` wrapper (GET /api/databases now returns a bare array, as does GET /api/individuals). `Individual.id_number`/`stats.{percentage,count}` became `idNumber`/`totalCount`; `IndividualField` gained `cardinality`/`values`/`format`. `GET /api/schema` was removed entirely — it was never part of the real API — and replaced by `src/query/fieldCatalog.ts`'s client-side `buildFieldCatalog`, which derives the same field catalog from `Individual[]` data already being fetched; enum detection is `values.length > 0`, deliberately never `cardinality`, per the frontend/backend decoupling requirement (the real backend's cardinality-20 threshold is an implementation detail the frontend must not depend on). Design: `docs/superpowers/specs/2026-09-22-api-types-refactoring-design.md` (Revision 2). |
