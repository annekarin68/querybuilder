# Query Builder Frontend — Architecture & Design

> **Living document.** This file is the single source of truth for the frontend's
> vision and structure. Update it in the same change as any code that alters the
> architecture, the API contract, the state shape, or a panel's behaviour. If the
> code and this file disagree, that is a bug in one of them.

Last updated: 2026-09-01 — initial design + offline-first constraint. No code written yet.

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
3. **Fonts are self-hosted.** Fomantic's prebuilt `semantic.min.css` contains an
   `@import url(https://fonts.googleapis.com/...)` for Lato. That import is
   **stripped at build time** (a small commented step in `vite.config.ts` that
   removes any `@import` / `url()` pointing off-origin from bundled CSS). Lato
   itself is installed via the `@fontsource/lato` npm package and imported in
   `src/main.ts`, so the look is preserved without the network. Fomantic's icon
   font already ships as local `.woff2` files inside `fomantic-ui-css` and is
   bundled normally.
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

Fomantic's JS expects a global jQuery. `src/main.ts` sets
`window.jQuery = window.$ = $` **before** importing `fomantic-ui-css/semantic.min.js`.
This is one commented block and the only place global assignment happens.

---

## 4. Directory layout

```
src/
  main.ts              Bootstrap: set window.jQuery; render layout shell; load schema; wire subscriptions.
  state.ts             AppState type + a ~15-line store (getState / setState / subscribe).
  api/
    client.ts          The ONLY file that calls fetch(). One function per endpoint.
    types.ts           Request/response types. This IS the API contract.
  query/
    types.ts           Condition, Group, QueryNode.
    tree.ts            Pure tree helpers: emptyQuery, newCondition, newGroup, addChild, updateNode, removeNode, findNode.
    validate.ts        validateQuery(tree, schema) -> Issue[].
    summary.ts         queryToText(tree, schema) -> human-readable string (display only).
  ui/
    fomantic.ts        The jQuery airlock (activate / destroy).
    panel.ts           paint() helper.
    layout.ts          Renders the shell once (top menu, secondary menu, grid columns). Handles sidebar collapse + active view via CSS class, no repaint.
    queryBuilder.ts    render + delegated event wiring for the centre panel (recursive).
    docsSidebar.ts     render for the left panel (built from schema).
    statsPanel.ts      render for the right panel (data-driven from /api/stats).
    dataPreview.ts     render for the bottom panel (paged table).
mock-server/
  index.ts             Dev-only. Plain Node http. Implements the three endpoints over ~200 in-memory records. Shares no code with src/.
tests/                 Vitest specs for src/query/* (pure, no DOM).
docs/
  ARCHITECTURE.md      This file.
index.html
```

---

## 5. State & the render loop

### `src/state.ts`

```ts
export interface AppState {
  schema: SchemaResponse | null;      // loaded once at startup
  activeView: "filter" | "review" | "approval" | "done";  // secondary menu; default "filter"

  query: QueryNode;                   // the tree (root Group, operator "AND")
  issues: Issue[];                    // validateQuery(query, schema); recomputed on every query change

  stats: {
    status: "idle" | "loading" | "ok" | "error";
    data: StatsResponse | null;
    error: string | null;
  };
  preview: {
    status: "idle" | "loading" | "ok" | "error";
    data: QueryResponse | null;
    error: string | null;
    page: number;
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
| App starts | `getSchema()` → `setState({ schema })` → every panel renders once. Schema load failure is fatal (full-page error + Reload). |
| User edits the query | handler calls a `tree.ts` fn → `setState({ query, issues, stats: <reset to idle/null>, preview: <reset to idle/null, page 1> })` → **only** `queryBuilder` repaints. Then, if `issues` has no errors, a **debounced** (400 ms) `getStats()` is scheduled. |
| `getStats()` resolves/rejects | stale-response guard (below); if current, `setState({ stats })` → **only** `statsPanel` repaints. |
| User clicks **Run / Refresh** | `setState({ preview: { status: "loading", page: 1, data: null } })` → `dataPreview` repaints → `runQuery()` → guard → `setState({ preview })` → repaint. |
| User clicks **Prev / Next** | as Run, with `page ± 1`. |
| User toggles docs sidebar | `setState({ sidebarCollapsed })` → `layout` toggles one CSS class. No repaint. |
| User clicks a secondary-menu tab | `setState({ activeView })` → `layout` swaps the main area. Filter view repaints from existing state; nothing refetches. |

Each panel subscribes narrowly:

```ts
subscribe((state, changed) => {
  if (changed.has("query") || changed.has("issues")) queryBuilder.render(state);
  if (changed.has("stats"))   statsPanel.render(state);
  if (changed.has("preview")) dataPreview.render(state);
  if (changed.has("schema"))  docsSidebar.render(state);
});
```

`debounce(fn, ms)` is one named helper used in exactly one place (the stats trigger).

---

## 6. Correctness invariant — stats & preview always match the on-screen query

**The statistics panel and the data-preview table only ever show values computed
from the exact query tree currently in `AppState`. In every other situation they
are empty (placeholder or error) — never stale.**

Concretely:

- **On any query edit**, the same `setState` that writes `query` also resets
  `stats` to `{ status: "idle", data: null }` and `preview` to
  `{ status: "idle", data: null, page: 1 }`. Old numbers and rows disappear the
  instant the query changes on screen — before any new request goes out.
  - Preview then shows: *"Query changed — press Run to refresh."*
- **If `issues` has errors:**
  - No `/api/stats` request fires. Stats shows a neutral hint:
    *"Fix the errors in your query to see statistics."*
  - **Run** is disabled. Preview shows the same hint, no rows.
- **If the query is valid:** debounced `getStats()` fires; while in flight the
  panel shows a loader with nothing behind it.
- **If the backend returns an error** (either endpoint): that panel goes to
  `{ status: "error", data: null, error }` and shows a `ui negative message` with
  the text. No numbers, no rows.
- **Stale-response guard:** each `getStats()` / `runQuery()` call captures a
  snapshot (deep copy or stable stringify) of the query it was made for. When it
  resolves, if `getState().query` no longer equals that snapshot, the response is
  discarded. A slow earlier request can never overwrite results for a newer query.

---

## 7. API contract (`src/api/types.ts`)

`src/api/client.ts` is the only file that calls `fetch()`. Three functions, each
typed, each throwing a plain `Error` (message unwrapped from `{ error }`) on any
non-2xx response.

```ts
getSchema(): Promise<SchemaResponse>
getStats(query: QueryNode): Promise<StatsResponse>
runQuery(query: QueryNode, page: number, pageSize: number): Promise<QueryResponse>
```

### `GET /api/schema`

```ts
interface SchemaResponse {
  fields: Array<{
    id: string;
    label: string;
    valueType: "string" | "number" | "boolean" | "date" | "enum";
    description: string;                                   // shown in docs sidebar
    options?: Array<{ value: string; label: string }>;     // enum only
    operatorIds: string[];                                 // operators this field allows
  }>;
  operators: Array<{
    id: string;                                            // "eq", "gte", "between", "in", "isEmpty", ...
    label: string;
    description: string;                                   // shown in docs sidebar
    arity: "none" | "one" | "two" | "many";                // how many values the UI collects
  }>;
}
```

### `POST /api/stats`

Body: `{ "query": <QueryNode tree> }`. Called live (debounced ~400 ms) only when
the query is valid.

```ts
interface StatsResponse {
  matchCount: number;
  totalCount: number;
  blocks: StatBlock[];
}

type StatBlock =
  | { kind: "number-summary"; fieldLabel: string; min: number; max: number; avg: number; nullCount: number }
  | { kind: "distribution";   fieldLabel: string; buckets: Array<{ label: string; count: number }>; nullCount: number }
  | { kind: "date-range";     fieldLabel: string; earliest: string; latest: string; nullCount: number };
```

`statsPanel.ts` has one render function per `kind` plus a `switch`. A new block
type later = one new case, nothing else.

### `POST /api/query`

Body: `{ "query": <QueryNode tree>, "page": number, "pageSize": number }`. Called
only on **Run / Refresh** and **Prev / Next**.

```ts
interface QueryResponse {
  columns: Array<{ key: string; label: string }>;         // backend decides which columns
  rows: Array<Record<string, string | number | boolean | null>>;
  page: number;
  pageSize: number;
  totalRows: number;                                       // for "Showing 26–50 of 1,240"
}
```

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

---

## 9. Panels

### Left — `docsSidebar.ts`

Built entirely from `state.schema`. A Fomantic `ui accordion`: one section per
field (label, type badge, `description`, nested list of its allowed operators with
each operator's `description`). A plain `ui input` at the top filters sections by
field label (`String.includes`, no plugin). Collapse is a CSS class toggled in
`layout.ts` (`sidebarCollapsed`) — sets the left column to `display:none` and
widens the centre; no repaint.

### Centre — `queryBuilder.ts`

One recursive `renderGroup(group, schema, depth): string`.

- A group = a Fomantic `ui segment` with an **AND / OR** `ui buttons` toggle,
  **+ Condition** and **+ Group** buttons, and (if not the root) **Remove group**.
- A condition = one row: **field** `ui dropdown` (searchable), **operator**
  `ui dropdown` (options from the selected field's `operatorIds`), and a **value**
  control chosen by the operator's `arity` × the field's `valueType`:
  - `none` → no control
  - `one` → single `ui input` / enum `ui dropdown` / boolean `ui checkbox` / date input
  - `two` → two inputs (from / to)
  - `many` → multiple `ui dropdown` (chips)
- Nodes in `state.issues` get a red `ui message` under the row.

**Event wiring:** one delegated listener on the panel container, reading
`data-node-id` and `data-action` attributes. The recursive HTML stays a pure
string with no baked-in closures. Fomantic dropdowns' `onChange` is bound inside
`activate()` and dispatches into the same `data-action` flow.

### Right — `statsPanel.ts`

Top: `matchCount / totalCount` as a `ui statistic` + `ui progress` bar. Below: the
`blocks[]` list, one small render function per `kind`. `status: "loading"` → a
`ui loader` (nothing behind it). `status: "error"` → `ui negative message`, no
data. `status: "idle"` → the appropriate hint from §6.

### Bottom — `dataPreview.ts`

Summary line (`queryToText(...)` + "Showing 26–50 of 1,240"), **Run / Refresh**
button (disabled while `issues` has errors or while loading), a Fomantic
`ui celled table` from `columns` + `rows`, **Prev / Next** gated on
`page` / `totalRows`. Empty result → `ui message`. `status: "idle"` → hint from §6.

---

## 10. Mock server (`mock-server/index.ts`)

Dev-only. `npm run mock` starts it; Vite proxies `/api/*` to it. Plain Node
`http`, no Express, heavily commented top to bottom.

- ~200 fake in-memory records; a hand-written `FIELDS` / `OPERATORS` catalog.
- `GET /api/schema` → the catalog.
- `POST /api/stats` → recursive `matches(node, record)` evaluator over the array,
  then computes `blocks[]` for each field used in the query.
- `POST /api/query` → same evaluator, then slices `page` / `pageSize`, returns a
  fixed `columns` set.
- Bad query → `400 { error }`.

Shares **no code** with `src/`. It stands in for "a real backend in any language";
the frontend knows it only through `src/api/types.ts`.

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
  `src/ui/fomantic.ts`**.

---

## 13. Change log

| Date | Change |
|---|---|
| 2026-09-01 | Initial design captured. No code yet. Next step: implementation plan. |
| 2026-09-01 | Added §2 "Offline-first" hard constraint: LAN-only, all assets bundled, fonts self-hosted, `npm run check:offline` guard. |
