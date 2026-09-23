# Query Builder Frontend — Architecture & Design

> **Living document.** This file is the single source of truth for the frontend's
> vision and structure. Update it in the same change as any code that alters the
> architecture, the API contract, the state shape, or a panel's behaviour. If the
> code and this file disagree, that is a bug in one of them.

Last updated: 2026-09-23 — UI/UX refresh: dark top bar with workflow steps
and an account menu; docs folded into a rail; full-width query builder with
coloured ALL/ANY brackets, joiners, soft hints for unfinished parts and a
plain-English footer; a pinned slim statistics column; Run moved into the
"Matching entrysets" card. Request handling is unchanged. See §13.

---

## 1. What we are building

A single-page frontend application that lets a user build a database query by
clicking through fields, operators, and values, and shows — live — how many
records match and what a sample of them looks like. Almost all data comes from a
backend API; this repo focuses on the frontend and ships a small mock server so
the app runs end to end during development.

### Screen layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ top bar: Query Builder · ①Filter ②Review ③Approval ④Done · [account ▾]   │
├──┬──────────────────────────────────────────────────────┬────────────────┤
│D │ databases (pill toggles · N of M selected · All/None) │ statistics     │
│O │ query (recursive ALL/ANY groups as coloured brackets; │ (pinned: live  │
│C │   plain-English summary in the footer)                │  headline +    │
│S │ matching entrysets (the Run query button lives here)  │  per database) │
│› │                                                        │                │
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

### Non-goals (for now)

- The Review / Approval / Done views. Tabs exist; content does not.
- Any real backend. The mock server stands in and shares no code with `src/`.
- Saving / sharing / restoring queries (URL state, persistence) — the
  `?resume=1` sessionStorage handoff in `main.ts` is a narrow exception,
  scoped only to surviving the login/compliance redirect round trip; it is
  not general query persistence.

---

## 2. Technology choices and why

| Choice | Why |
|---|---|
| **Vite + TypeScript** | Fast dev server with hot reload and readable error overlays; types give junior maintainers autocomplete and catch typos before runtime; the most transferable skill set. |
| **Fomantic UI (CSS + JS) + jQuery** | Consistent good-looking components with little custom CSS. We use the **jQuery components** (searchable dropdowns, chip-style multi-selects) — this is a deliberate choice; see §3 for how we keep it safe. Native elements (`<details>`, checkboxes) are preferred where they do the job without a plugin — see §3. |
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
   rules 1–3. Exactly one file is exempt: `dist/THIRD-PARTY-NOTICES.txt`, which
   `vite.config.ts` (`emitLicenseNotices`) copies from the repo root on every
   build. It quotes licence URLs as document text and is never loaded by the app.
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
}

export function destroy(container: HTMLElement): void {
  // Tear down plugin instances BEFORE the old markup is thrown away.
  $(container).find('.ui.dropdown').dropdown('destroy');
  $(container).find('.ui.checkbox').checkbox('destroy');
}
```

Native elements are preferred where they do the job without a plugin: the
data dictionary's groups, the entryset rows and the account menu are
`<details>` elements, and the database toggles are plain checkboxes.

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
  main.ts              Bootstrap: import setup-jquery + Fomantic; render layout shell; load schema/databases/individuals/auth/compliance; wire subscriptions; hold the refreshStats / runPreview orchestrators; reacts to 401/403 generically to trigger the login/compliance redirects.
  state.ts             AppState type + a ~15-line store (getState / setState / subscribe) + module singleton `store`.
  util/
    debounce.ts        debounce(fn, ms) — the one named debounce helper (used for the stats trigger).
    pendingQuery.ts    Save/restore the in-progress query across the login or
                       compliance redirect (sessionStorage only). See §2 and
                       §5 of the compliance-logging design spec.
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
    format.ts          compact() / exact() / matchRatio() / barWidth() for the stats (billion-row / 1e-10 % scale), plus displayLabel() (backend casing, underscores → spaces), countLabel() and formatWhen().
    layout.ts          Renders the shell once (top bar with workflow steps + account slot, docs rail, docs / main / stats columns). Handles docs collapse + active step via classes/attributes, no repaint.
    valueControl.ts    renderValueControl(field, operator, value) + readValueControl(row, arity, valueType) — the value input(s) for a condition row, chosen by operator arity × field valueType.
    databasePicker.ts  render + wiring for the database-scope checkboxes above the query builder (its own panel, data-panel="dbpicker").
    queryBuilder.ts    render + delegated event wiring for the centre panel (recursive).
    docsFilter.ts      tagsOf / groupByTag (the data dictionary's per-tag sections, untagged last) + matchDocs(individuals, text) — which items/sections match the filter (pure; unit-tested).
    docsSidebar.ts     render for the data dictionary (docs column) — built
                       from state.individuals, NOT state.schema. See §9.
    statsPanel.ts      render for the pinned statistics column (data-driven from /api/stats).
    dataPreview.ts     render + Run wiring for the "Matching entrysets" card
                       (POST /api/query) — the only Run control. See §9.
    accountMenu.ts     render + wiring for the top-bar account menu (login +
                       compliance; data-panel="account"). See §9.
mock-server/
  index.ts             Dev-only. Plain Node http: routing + JSON I/O + paginate().
                       Starts only when run as the entrypoint.
  auth.ts              Session/state/code logic for the fake-IdP login round
                       trip: startLogin/issueFakeCode/exchangeCodeForSession
                       (in-memory, dev-only) + cookie helpers. See §7, §10.
  audit.ts             Per-query audit-forwarding stand-in: an in-memory list
                       appended to on every successful POST /api/query. Dev-only
                       — production needs a real network call to a real audit
                       service. See §10.
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
                       label/group/tags/idNumber/name/description/comment/
                       totalCount/fields. totalCount is that item's count within a mock
                       6-billion-entryset universe, tiered by real-world commonality
                       (near-universal/common/uncommon/rare) so it agrees with the
                       item's own description.
    entrysets.json     Actual telemetry records referencing individual.json's items,
                       keyed by entryset id (string): `{ [id]: { id, items: {
                       [individualLabel]: { [fieldLabel]: value } } } }`. 21 example
                       entrysets (ids 1-21), each a distinct, internally-consistent
                       vehicle/event scenario, spread across all 7 mock databases via
                       dbIndexForEntrysetId(id).
tests/                 Vitest specs for src/query/*, src/api/*, src/state, src/util/*, src/ui/* (pure helpers only), mock-server/evaluate + index (pure, no DOM).
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
  /** Who's logged in, if anyone — populated once at startup via GET /api/auth/me. */
  auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
  /** Compliance acknowledgment for this session, if any — populated once at
   *  startup via GET /api/compliance/status. Display-only, same as `auth`. */
  compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null };
  selectedDatabaseIds: string[];      // which databases the query runs against; [] = nothing runs
  activeView: "filter" | "review" | "approval" | "done";  // workflow steps; default "filter"

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
| User clicks **Run query** (in Matching entrysets) | `setState({ preview: { status: "loading", data: null } })` → `dataPreview` repaints (the card shows a loader instead of the button) → `runQuery()` → guard → `setState({ preview })` → repaint. The mock server filters by `query`/`databases` for real — see §7/§10. There is no Prev/Next; the whole (short) list of matches comes back in one response and flows with the page. |
| User opens/closes the docs (rail or ✕) | `setState({ sidebarCollapsed })` → `layout` toggles one CSS class and the rail's `aria-expanded`. No repaint. |
| User clicks a workflow step | `setState({ activeView })` → `layout` swaps the main area. Filter view repaints from existing state; nothing refetches. |

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
  - The Matching entrysets card then shows its ready state: an enabled **Run
    query** button and, for an anonymous visitor or one missing compliance,
    an advisory note ("You'll be asked to log in first." / "…confirm
    compliance first.") — §9.
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
  The snapshot is paired with **request identity**: `main.ts` keeps one
  `requestSlot()` per kind (stats, preview), and a response only counts if its
  request is still the slot's current one — an edit-and-undo can make an old
  request's key equal the new one's, so the key alone isn't enough.
- **Superseded requests are aborted, not just ignored.** Every query edit,
  database-selection change, and logout calls `cancelInFlight()`, and starting a
  new request aborts the previous one of the same kind (`AbortController`,
  passed through `client.ts`). Without this, each edit would leave an
  `/api/stats` stream running against every selected database on the backend.

> **Streaming and "never stale" are compatible.** While `stats.status` is `"loading"`, `stats.lines` legitimately holds fewer entries than `selectedDatabaseIds` — that's a query result still arriving, not a stale one. The invariant this section protects is that every line in `stats.lines` belongs to the `(query, selectedDatabaseIds)` pair currently on screen; the stale-response guard is checked once per streamed line (not just once per request), so a line that arrives after the user has changed the query/scope is discarded before it reaches `AppState`.

---

## 7. API contract (`src/api/types.ts`)

`src/api/client.ts` is the only file that calls `fetch()`. Each function is typed
and throws an `ApiError` (extends `Error`, carries the response's HTTP `status`;
message unwrapped from `{ error }`) on any non-2xx response.

```ts
getDatabases(): Promise<DatabasesResponse[]>
getIndividuals(): Promise<Individual[]>
getStats(query: QueryNode, databases: string[], onLine: (line: StatsResponse) => void, signal?: AbortSignal): Promise<void>
runQuery(query: QueryNode, databases: string[], page: number, pageSize: number, signal?: AbortSignal): Promise<EntrysetsResponse>
getMe(): Promise<AuthUser | null>
logout(): Promise<void>
getComplianceStatus(): Promise<ComplianceStatus>
invalidateCompliance(): Promise<void>

LOGIN_URL             // `${VITE_API_BASE}/auth/login` — navigation target, not a fetch
COMPLIANCE_START_URL  // `${VITE_API_BASE}/compliance/start`
```

Every request carries a **timeout** (`REQUEST_TIMEOUT_MS`, 60 s): if the server
sends nothing for that long the request is aborted and rejects with a
`TimeoutError` ("The server took too long to respond…"). For the streamed
`/stats` body the clock restarts on every chunk, so a slow stream that is still
making progress is never cut off. An optional `signal` lets the caller abort
(see §6); the promise then rejects with the abort reason.

The login/compliance entry points are exported as URLs built from the same
`VITE_API_BASE` as every fetch, so no other file hardcodes `/api/...`. Links
into those flows carry a `data-flow-link` attribute, which is how `main.ts`
spots them to save the in-progress query first (§9).

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
`format`) by `valueTypeFor()`. The mapping is case-insensitive, ignores
size/precision parameters (`DECIMAL(10,2)`, `VARCHAR(255)`), treats any
`TIMESTAMP …` variant as a date, and covers the common SQL spellings
(`INT`/`INTEGER`/`SMALLINT`/`BIGINT`/`REAL`/`FLOAT`/`DOUBLE`/`DECIMAL`/
`NUMERIC`, `BOOL`/`BOOLEAN`, `DATE`/`DATETIME`/`TIMESTAMP`) rather than only
the four the mock data happens to use. A type it doesn't recognise becomes
`"string"`, which silently loses the comparison operators, so when the real
backend's type list is known, check it against `TYPE_NAMES`. **Enum detection is `values.length > 0`, deliberately never
`cardinality`** — `cardinality` is informational-only telemetry from the real
backend, and branching the frontend on it would couple the UI to a backend
implementation detail (the frontend/backend decoupling rule; see §13).
`operatorIds` come from a fixed per-`valueType` profile (`OPERATOR_PROFILE`),
never from a specific field.

#### Should `GET /api/schema` come back? (re-examined 2026-09-23 — no)

Keep deriving the catalog client-side. The reasons:

- **Nothing to fetch it from.** The real backend has no schema endpoint.
  Adding one to the mock would bring back exactly the mistake Revision 2
  corrected: a guessed contract that the frontend then depends on.
- **It would duplicate data we already load.** Every field in the catalog is
  one (individual, field) pair from `GET /api/individuals`, which the sidebar
  and the Item dropdown need anyway. A second endpoint would mean a second
  request at startup and two sources that can disagree.
- **The client-side part is small and stable.** `OPERATORS` and
  `OPERATOR_PROFILE` are UI decisions (which operators to offer for a number,
  say). They don't depend on the backend, so they belong in the frontend.

The one real argument for a server-side schema is type mapping. The backend
knows its own type names, and the frontend can only guess at them
(`valueTypeFor` above). The fix for that is narrower than a new endpoint: if
the mapping ever becomes a problem, ask the backend to add one normalised
field to `IndividualField` (e.g. `valueType: "string" | "number" | "boolean" |
"date"`) and prefer it over `type`/`format` in `valueTypeFor`. That keeps a
single source of truth, one request, and the UI-side operator rules in the UI.

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
Called only when the user clicks **Run query** (§9). Same `400` validation as `/api/stats`. The
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

### Auth (`GET /api/auth/login`, `GET /api/auth/callback`, `GET /api/auth/me`, `POST /api/auth/logout`)

OAuth2 authorization-code login against an internal, LAN-reachable identity
provider (never a public one — see §2's offline-first constraint). The
IdP's redirect URI points at the backend, not the SPA, so the frontend
never handles the auth code, CSRF `state`, or tokens.

```ts
interface AuthUser {
  name: string;
}
```

- `GET /api/auth/login` — starts the flow, redirects to the IdP.
- `GET /api/auth/callback?code=&state=` — exchanges the code server-to-server
  (client secret never leaves the backend), sets a `qb_session` `HttpOnly`/
  `SameSite=Lax` cookie (`Secure` too, in production — see §10), redirects
  to `/?resume=1` (so a restored, saved query — see §5 — can be picked back
  up after login).
- `GET /api/auth/me` — `200 AuthUser` with a valid session cookie, `401`
  otherwise.
- `POST /api/auth/logout` — clears the session, `204`.

`POST /api/query` requires both a session (`401 { error }` without one) and
a compliance acknowledgment (`403 { error }` without one) — everything else
(`schema`, `databases`, `individuals`, `stats`) stays anonymous-accessible.
`canRunQuery` is NOT auth- or compliance-aware, and neither is `dataPreview.ts`'s
enabling of the Run button — Run always genuinely attempts the request, and
`main.ts` reacts to whatever status code comes back (§5, §9). A `401` always redirects into login. A
`403` only means "authenticated, but some requirement is unmet", and
compliance may not be the only such requirement (a real backend may also
refuse a user access to a database). So on a `403`, `main.ts` first asks
`GET /api/compliance/status`. It redirects into compliance only if that says
`"required"`; otherwise it shows the `403`'s own error message. Redirecting on
every `403` would send such a user round the compliance flow forever with no
explanation. This pattern would generalize to a future
protected endpoint returning the same `401`/`403` conditions — but only from
a call site triggered by an explicit user gesture, same as `runPreview`'s own
Run-click origin. It must never wrap an automatically-fired request (e.g. the
debounced `refreshStats`), which would redirect the browser without a click
and break the "never redirects itself" loop-safety this feature depends on.

### Compliance (`GET /api/compliance/start`, `GET /api/compliance/callback`, `GET /api/compliance/status`, `POST /api/compliance/invalidate`)

A second redirect flow, structurally identical to Auth above, gating data
extraction on a user-provided reason: the compliance service's redirect URI
also points at the backend, so the frontend never handles its `state` or
token either. The acknowledgment piggybacks on the *same* session as
Auth — no second session-identifying cookie.

```ts
interface ComplianceStatus {
  status: "required" | "acknowledged";
  reason?: string;
  ackedAt?: string;
}
```

- `GET /api/compliance/start` — requires a session (`401` without one);
  starts the flow, redirects to the compliance service.
- `GET /api/compliance/callback?token=&state=` — exchanges the token
  server-to-server, attaches `{ reason, ackedAt }` to the current session,
  redirects to `/?resume=1`.
- `GET /api/compliance/status` — never errors: `{ status: "required" }` with
  no session or no acknowledgment yet, `{ status: "acknowledged", reason,
  ackedAt }` otherwise.
- `POST /api/compliance/invalidate` — clears just the compliance field off
  the session (stays logged in), `204`.

Every successful `POST /api/query` also appends `{ name, reason, timestamp
}` to an in-memory audit list (`mock-server/audit.ts`) — a dev-only stand-in
for forwarding to a real audit service (§10).

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

### Centre, above the builder — `databasePicker.ts`

Its own panel (`data-panel="dbpicker"`). A card with one pill toggle per
`state.databases` entry (a native checkbox inside a styled label — no
plugin; its hover `title` is `databaseTitle`: "owner: description", or
whichever is non-blank, or no `title` at all), "N of M selected", and **All** / **None** buttons. Toggling calls
`onDatabasesChange` in `main.ts`, which treats it exactly like a query edit
(§6). Zero selected → an amber "Select at least one database." note, and the
statistics and Matching entrysets cards explain why they are empty.

### Left — `docsSidebar.ts` (data dictionary)

Built from `state.individuals` (GET /api/individuals) — not `state.schema`.
Hidden behind the docs rail by default (`sidebarCollapsed` starts `true`);
the rail and the card's ✕ both toggle it. Sections are built from our own
`tags`, not the third-party `group` (`groupByTag` in `docsFilter.ts`): one
native `<details>` per tag, sorted alphabetically, listing every item carrying
it — so an item with several tags appears in several sections. Tags are
trimmed and blank/duplicate tags dropped (`tagsOf`); items left with no tags
go in a final italic **Untagged** section (key `UNTAGGED`, the empty string —
never a real tag). Each item shows: name, tag chips, a small "Group: …" line
with the third-party `group` (omitted when blank — the backend may send `""`),
`description`, italic `comment`, "In N entrysets (x%)" (`matchRatio` against
the sum of every database's `totalEntrysets`), and field chips (`name`,
falling back to `label`, + type) whose hover `title` is `fieldTitle`: the
field's `comment`, then "Third-party: `description`". The backend sends `""`
for missing text, so every `description`/`comment`/`group`/`owner` goes
through `text()` (trim) and a blank value's element or `title` is omitted
rather than rendered empty. Tags and group names are shown in the backend's
casing with underscores as spaces (`displayLabel`). The search box filters
with `matchDocs` (item name, field label or name; case-insensitive): matching
sections open and show "N matches", other sections and items are hidden, and
"No items match …" appears when nothing does. The filter sets `hidden`/`open` on the painted DOM instead
of repainting, so typing keeps focus.

### Centre — `queryBuilder.ts`

Three mutually-recursive functions build the tree's HTML: `nodeHtml` dispatches
on node kind, `groupHtml` renders a group and recurses into its children via
`nodeHtml`, and `conditionHtml` renders one condition row (no function called
`renderGroup` exists).

- A group = a coloured bracket (3 px left border with short top/bottom arms)
  over a faint tint — blue for ALL (AND), amber for ANY (OR); nested tints
  stack, and hovering highlights only the innermost group (pure CSS).
  Header: collapse caret · "Match [ALL | ANY] of the following" · **+
  Condition** · **+ Group** · ✕ (not on the root). Between children a small
  AND/OR joiner sits on the bracket. A collapsed group folds to one line: its
  `queryToText` summary and "N conditions". **+ Group** inserts `newGroup()`,
  which already holds one empty condition.
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
- Issues show under their row/group header: `kind: "incomplete"` as a quiet
  grey hint, `kind: "invalid"` in red (§11). The card's footer shows the
  whole query in plain English (`queryToText`) once it is complete,
  otherwise how many parts still need attention. Condition rows are a CSS
  grid inside a size container: below ~640 px of row width the value and ✕
  wrap to a second line.

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

A ~15rem card, sticky beside the builder. Top to bottom: the headline (big
compact sum of `matchCount` over the successful lines so far, labelled
"matching entrysets", then "ratio of total" and a thin bar), then **By
database** — one compact grid row per streamed line: name · bar · ratio
(exact figures on hover), or for a failed database its `errorMessages` in
red with `infoMessages` beneath — then, while loading, "Waiting on N more
databases…". The headline never shows a failed database as zero. With no
successful line yet it shows no number at all ("No results yet." while
loading, "No database returned a result…" once done). When some lines
failed, it adds "Excludes N database(s) that failed". The whole stats column
is `position: sticky` so it tracks the viewport while a tall query builder
scrolls past. `status` branches: `idle` → "Counting matches…" (the debounce
window); `error` → `ui negative message`, no data. There is no per-field-block
list — the real backend can currently only return counts, not aggregated
min/max/avg/buckets/earliest/latest.

### Main column, under the query — `dataPreview.ts` (Matching entrysets)

Owns the app's only **Run query** button. States: query not runnable (no
database / no condition / unfinished) → disabled button + the reason; ready
(`preview.status === "idle"`) → enabled button + an advisory note for
anonymous users or missing compliance; loading → loader; error → red message
+ **Try again**; ok → "Matching entrysets · N" and the list, with no Run
button (the card resets to "ready" whenever the query or scope changes, §6,
so there is one run per query). `wireDataPreview` attaches one delegated
click listener that calls `runPreview()`.

On success: a **summary index list**, one compact row per entryset in
`EntrysetsResponse.entrysets` — not a full item-by-item grid. Design
rationale: entrysets are heterogeneous (each is a different event, most
likely holding a different subset of `individual.json`'s items), so a grid
needs either items-as-rows (fine for a handful of entrysets-as-columns, but
entrysets don't scale past ~5-6 columns on screen) or entrysets-as-rows
(scales entrysets fine, but then *items* become columns and the union across
many varied entrysets can easily reach 60-100+, needing horizontal scroll —
worse UX than vertical). A summary list sidesteps the problem entirely: no
per-item columns, so it scales to 20+ entrysets just by scrolling vertically
(`.qb-entryset-list`, flowing with the page).

Each row is a native `<details>/<summary>` element (no JS wiring needed for
expand/collapse):

- **Summary line**: entryset id, "When" (`observation_window.from_timestamp`,
  `formatWhen`, e.g. 7 Nov 2024, 09:15), "Vehicle" (`vehicle_identity.vehicle_type`, both falling
  back to `—` if that metadata item is absent), the distinct non-`metadata`
  `group`s present as badges (first 3, `+N` overflow — computed by
  cross-referencing `state.individuals`), and the total item count.
- **Expanded content**: the entryset's full `{ id, items }` as pretty-printed
  JSON (`JSON.stringify(entryset, null, 2)` in a `<pre>`) — a throwaway stand-in
  for the dedicated pretty-JSON entryset viewer planned as a follow-up; expect
  this to be replaced by a link/route into that viewer once it exists.

`/api/query` filters for real (§7, §10), so this list changes with the query
and selected databases. No pagination (§7).

---

## 10. Mock server (`mock-server/index.ts`)

Dev-only. `npm run mock` starts it; Vite proxies `/api/*`, `/mock-idp/*`, and
`/mock-compliance/*` to it (the latter two because their respective
`GET .../login` / `GET .../start` redirects are real browser navigations,
not fetches — proxying only `/api` would leave those hops unreachable under
`npm run dev`). Plain Node `http`, no Express, heavily commented top to
bottom.

- There is no `/api/schema` route — it was removed entirely, since the real
  API never had one (see §7). `mock-server/vehicleData.ts` declares its own
  local `IndividualField`/`Individual` types — field-identical to
  `src/api/types.ts`'s `IndividualField`/`Individual` (`mock-server/` shares
  no code with `src/`, so the shapes are duplicated, not imported) — and
  `individual.json`'s data conforms to them, matching the real contract.
- `mock-server/databases.ts` defines 7 synthetic databases (`ALPHA`..`ETA`)
  as `DatabaseDef` objects (`description`/`name`/`owner`/`totalEntrysets`/
  `percentageOfTotal`/`label`, each `totalEntrysets` spanning several orders
  of magnitude), and `dbIndexForEntrysetId(id)` — a hash of the entryset's
  own numeric id that assigns it to exactly one database, independent of its
  content. `DatabaseDef` is field-identical to the wire `DatabasesResponse`
  shape, so `GET /api/databases` sends `DATABASES` directly with no filtering
  step — every field, including `totalEntrysets`/`percentageOfTotal`, is part
  of the real contract.
- `mock-server/rows.ts` flattens every entryset in `ENTRYSETS`
  (`mock-server/vehicleData.ts`) into a flat `Row` — dotted
  `"individualLabel.fieldLabel"` keys matching the schema's field labels, plus
  a synthetic `__db` key from `databaseIdForEntrysetId` — once at startup
  (`ROWS`).
- `mock-server/auth.ts` simulates the entire OAuth round trip in-process:
  `/api/auth/login` redirects to a tiny server-rendered "Mock IdP" page
  (`/mock-idp/authorize`, never bundled by Vite) that hands back a fake
  code via `/mock-idp/authorize/confirm`, which `/api/auth/callback`
  "exchanges" (no real network call) for an in-memory session. **None of
  this is reusable in production** — a real backend needs a real IdP
  integration, real client-secret handling, the CSRF `state` bound to a
  production session mechanism (the mock does this too — see below),
  session storage that survives process restarts, and a `Secure` cookie
  flag (the mock omits it since local dev runs over plain `http`). Whether
  to add PKCE on top remains an open production decision (spec §2) — the
  mock's absence of PKCE is not a recommendation either way.
- `/api/auth/login` also sets a short-lived `qb_login_state` cookie
  binding the CSRF `state` to the browser that started the login;
  `/api/auth/callback` rejects the exchange unless the cookie's value
  matches the callback's `state` param, closing a login-CSRF gap that the
  single global set of pending `state` values alone doesn't cover (a
  leaked/guessed callback URL could otherwise log a different browser into
  the state-issuing browser's session). See the design spec's §7.
- `mock-server/auth.ts` also carries the compliance flow's session/token
  logic (`startCompliance`, `issueFakeComplianceToken`,
  `exchangeComplianceToken`, `complianceStatusFor`, `clearCompliance`) and a
  `qb_compliance_state` binding cookie identical in shape to the login one
  — the binding-cookie construction is now a shared, parameterized internal
  helper rather than two copies. Compliance is stored as an optional field
  on the *same* session record as `user`, not a second session.
- `mock-server/audit.ts` stands in for forwarding a per-extraction audit
  entry to a real audit/compliance service: an in-memory array, appended to
  on every successful `POST /api/query`. **Not reusable in production** — a
  real backend needs a real, durable audit store and a real network call.
- `POST /api/stats` computes each database's match/total counts via
  `perDatabaseCounts` (which scopes `ROWS` to each database inline via
  `rows.filter((r) => String(r.__db) === label)`), scaling the sample's match
  rate onto that database's `totalEntrysets` (`scaleCount`, unchanged). Rather than
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

- `client.ts` throws an `ApiError` (carries the response's HTTP `status`) with a readable message on any non-2xx,
  and a `TimeoutError` when the server goes silent for `REQUEST_TIMEOUT_MS` (§7) —
  so no panel can sit on "Loading" forever with Run disabled.
- Async panels catch it, write `{ status: "error", data: null, error }`, render a
  `ui negative message`. Per §6, data is nulled — never left stale. Errors from a
  request that was aborted because it was superseded never reach a panel (the
  §6 identity guard drops them).
- A failure loading databases/individuals at startup is fatal: replace `#app`
  with a full-page `ui negative message` + Reload button. The message is
  HTML-escaped like every other server-supplied string (it can come from an
  `{ error }` body), and the button is wired with `addEventListener` rather than
  an inline `onclick`, so the page works under a strict Content-Security-Policy.
  `GET /api/auth/me` failing is *not* fatal — see §9.
- No retries, no error-boundary machinery — just visible messages.
- Query validation issues come in two kinds (`Issue.kind`): `incomplete`
  (something not filled in yet — a grey hint) and `invalid` (refers to
  something that cannot work — red). Both block running; only the display
  differs.

---

## 12. Testing & tooling

### Tests (Vitest, unit only, on pure modules)

- `tree.test.ts` — add/update/remove/find return correct new trees; inputs unmutated.
- `validate.test.ts` — each issue type is reported; a complete query yields `[]`.
- `summary.test.ts` — representative trees produce the expected text.
- `tests/ui/docsFilter.test.ts` — data-dictionary filter matching.
- `tests/ui/format.test.ts` / `statsPanel.test.ts` / `valueControl.test.ts` — formatting helpers and the few pure render helpers.
- Fixture request/response objects double as contract examples.
- No DOM/component tests — the view layer is deliberately too thin to be worth it (repo rule).

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
| 2026-09-23 | OAuth2 authorization-code login: only `POST /api/query` is gated (`401` without a session) — schema/databases/individuals/stats stay anonymous-accessible. The IdP's redirect URI points at the backend (`GET /api/auth/callback`), not the SPA, so the frontend never handles the auth code/state/tokens — it only reads `GET /api/auth/me`'s result via a new `AppState.auth`. `canRunQuery` deliberately stays auth-unaware (shared with `refreshStats`); the auth requirement is layered on separately at `syncRunButton`/`runPreview`. New top-menu widget (`src/ui/authStatus.ts`) for login/logout. Mock server (`mock-server/auth.ts` + new routes in `index.ts`) simulates the whole IdP round trip in-process to stay offline-first — none of it is reusable in production (see the design spec's §7 for the full list of new real backend requirements). Rebased onto the API-contract-rename work above (bare-array `getDatabases`/`getIndividuals`, streaming `getStats`, client-side `buildFieldCatalog`, no `GET /api/schema`) — `client.ts`'s `ApiError` class (added for this feature) is preserved through that rebase and is now the type every client function throws. Design: `docs/superpowers/specs/2026-09-22-oauth2-login-design.md`. |
| 2026-09-23 | Compliance-logging redirect gate: `POST /api/query` now also requires a compliance acknowledgment (`403` without one), gated the same way login is (`401`) — via a second mock-service redirect flow (`mock-server/auth.ts`'s compliance session/token logic + `mock-server/index.ts`'s `/api/compliance/*` and `/mock-compliance/*` routes), the reason attached to the *same* session record rather than a second cookie. The frontend no longer pre-checks `auth`/`compliance` status before allowing Run — `syncRunButton` reverted to its pre-OAuth shape, and `main.ts` reacts generically to a `401`/`403` on the actual request, which will cover any future protected endpoint for free. The in-progress query survives both redirects via a new `src/util/pendingQuery.ts` (`sessionStorage`, restored on a `?resume=1` return-hop) — deliberately with no automatic retry or chaining, so the mechanism can never redirect-loop: the user always clicks Run again to retry. New top-menu widget (`src/ui/complianceStatus.ts`). Every successful extraction is also logged to a dev-only in-memory audit list (`mock-server/audit.ts`) standing in for a real audit-service call. Also rebased, alongside the OAuth2 row above, onto the API-contract-rename work — `getStats`'s streaming NDJSON shape and `buildFieldCatalog` were unaffected by this feature, so `refreshStats` kept its post-rename implementation untouched through both rebases. Design: `docs/superpowers/specs/2026-09-23-compliance-logging-design.md`. |
| 2026-09-23 | Production-readiness hardening (review before first production deploy). **Requests:** `client.ts` gains a shared 60 s timeout (`TimeoutError`; for the `/stats` stream it is an idle timeout that restarts on each chunk) and optional `AbortSignal`s on `getStats`/`runQuery`; `main.ts` replaces the `statsRun` counter with a `requestSlot()` per request kind that aborts superseded requests and supplies the identity half of the stale guard, and `cancelInFlight()` runs on every query/scope edit and on logout (§6). **Auth/compliance:** a `403` from `/api/query` only redirects into compliance if `GET /api/compliance/status` says `"required"`, otherwise the error is shown (a non-compliance `403` used to redirect in an endless circle); a non-401 failure of `GET /api/auth/me` no longer fails startup; `LOGIN_URL`/`COMPLIANCE_START_URL` are exported from `client.ts` and follow `VITE_API_BASE` (previously hardcoded `/api/...` in five places), and flow links are marked `data-flow-link`. **Correctness/UI:** `valueTypeFor` accepts common SQL type spellings case-insensitively (previously only the mock's four); the stats headline never presents failed databases as zero and notes how many it excludes; a restored pending query is structurally validated and its database ids filtered to ones that still exist; the startup error page escapes the server's message and drops its inline `onclick`; node ids and entryset ids are escaped in markup; menu tabs, the Docs toggle and Select all/none are keyboard-focusable (`href="#"` + `preventDefault`). **Build:** `THIRD-PARTY-NOTICES.txt` is emitted into `dist/` by a Vite plugin (exempted by exact path in `check:offline`), removing the manual copy step. **Decision:** re-examined bringing back `GET /api/schema` and kept the client-side catalog (§7). |
| 2026-09-23 | UI/UX refresh (`docs/superpowers/specs/2026-09-23-ui-ux-refresh-design.md`). Layout: dark top bar with workflow steps and an account menu (replaces `authStatus.ts` + `complianceStatus.ts` with `accountMenu.ts`, a native `<details>` menu); docs collapsed into a rail (`sidebarCollapsed` starts `true`); main column stacks databases (pill toggles), the query card and "Matching entrysets"; a pinned ~15rem statistics column. Query builder: ALL/ANY groups as coloured brackets with tint + hover highlight, AND/OR joiners between children, collapsed groups summarised with `queryToText`, a plain-English footer, CSS-grid condition rows with a container query. `Issue.kind` (`incomplete` → grey hint, `invalid` → red); `newGroup()` now holds one empty condition. Run moved from the top bar into the Matching entrysets card (`syncRunButton` removed; `wireDataPreview` added) — request handling unchanged. Data dictionary: `<details>` groups instead of the Fomantic accordion, a filter (`docsFilter.ts`) that opens matching groups, backend casing with underscores as spaces. `format.ts` gains `displayLabel` / `countLabel` / `formatWhen`. |
| 2026-09-23 | Data dictionary sectioned by our own `tags` instead of the third-party `group` (`docsFilter.ts` `tagsOf`/`groupByTag`; `matchDocs` counts per tag): alphabetical tag sections, multi-tag items listed under each, untagged items in a final **Untagged** section; `group` is now a small "Group: …" line, omitted when blank (the backend may send `""`). Blank-safe text everywhere via `format.ts` `text()`: database pills' hover is `databaseTitle` ("owner: description", either, or none); field chips gain a hover `fieldTitle` (comment, then "Third-party: description"); blank item `description`/`comment` are omitted. Mock: `speeding_event` has a blank `group`/`description` and one field `comment`, to exercise these paths. |
