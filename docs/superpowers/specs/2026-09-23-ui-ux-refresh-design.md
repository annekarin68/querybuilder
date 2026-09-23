# UI/UX refresh — design

> **Historical design record.** This describes the design as approved at the time;
> the code has moved on since. For current behaviour see `docs/ARCHITECTURE.md`.

Status: approved and implemented.

Branch: `claude/frontend-ui-ux-improvements-73afba` (from `main` @ `68d7fe7`).

## 1. Problem

A UX review of the running app (screenshots at 1440 / 1024 / 800 px, anonymous
and logged-in + compliance, before and after Run) found:

1. **A fresh page opens in an error state.** The seeded empty condition shows a
   red "Choose a field." and both side panels say "Fix the errors in your
   query". `+ Group` does the same ("Add a condition to this group.").
2. **Results are far from the work.** The data preview sits below all three
   columns, so its position depends on the tall docs sidebar. At 1440×900 it is
   below the fold with a large blank area under the builder. Run / Refresh sits
   in the top bar, away from both the query and the results.
3. **Queries are hard to read.** A condition doesn't fit on one line even at
   1440 px (value + delete wrap). Nested groups look identical to the root. AND/OR
   is only in the group header, never between the rows it joins.
   `src/query/summary.ts` (`queryToText`) exists and is tested, but no UI uses it.
4. **It breaks below ~1000 px.** The top bar overflows (the full compliance reason
   is dumped into it as text); the builder is squeezed to ~180 px and its buttons
   are clipped.
5. **The docs filter looks broken.** It hides items inside accordion sections,
   which start collapsed, so typing has no visible effect. Group names are
   title-cased by the frontend ("Battery Ev", "Hvac Cabin").
6. **Polish.** The stats headline ("5B of 7.8B · 64%") has no label; bars are
   grey; Select all / none are tiny links; preview dates wrap; "9 entryset(s)";
   everything is flat white with no hierarchy.

**Users build complex queries with several levels of nested groups, and read
the live statistics while they build.** Both drive the layout below.

**Screens:** designed for 1280–1920 px, verified at 1024 px. Below 1024 px the
app must stay usable but needn't look designed.

## 2. Approach

A **theme layer on top of Fomantic**: keep Fomantic's components (dropdowns,
checkboxes, dropdown menu), add CSS custom properties and named classes in
`src/styles.css`, replace inline `style="…"` attributes with those classes, and
rebuild the shell in `src/ui/layout.ts`. All existing maintainer rules stay:
offline-only, jQuery only in `src/ui/fomantic.ts`, panels update via `paint()`,
one state object.

Rejected: rebuilding Fomantic's LESS theme (needs Fomantic's source build
toolchain for a colour change); replacing Fomantic with hand-written components
(throws away working accessible widgets and the §3 airlock).

## 3. Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Query Builder   ① Filter  ② Review  ③ Approval  ④ Done     [demo.user · ✓ Compliance ▾] │
├──┬───────────────────────────────────────────────────────────┬─────────────┤
│D │ Databases  7 of 7  (ALPHA)(BETA)(GAMMA)…   [All] [None]   │ Statistics ◌│
│O │ ┌ Query ────────────────────────────────────────────────┐ │ 312M        │
│C │ │ ▾ Match [ALL|ANY] of the following   +Condition +Group│ │ matching    │
│S │ │ [Item][Field][Operator][Value] ✕                      │ │ entrysets   │
│  │ │ AND                                                   │ │ 4.0% of 7.8B│
│› │ │ ┃ ▾ Match ANY …                                       │ │ ▬▬──────    │
│  │ │ ┃ …                                                   │ │ ALPHA ▬─ 3% │
│  │ │ plain-English summary of the query                    │ │ BETA  ▬─ 5% │
│  │ └───────────────────────────────────────────────────────┘ │ …           │
│  │ ┌ Matching entrysets ───────────────────────────────────┐ │  (pinned)   │
│  │ │          [ ▶ Run query ]                              │ │             │
│  │ └───────────────────────────────────────────────────────┘ │             │
└──┴───────────────────────────────────────────────────────────┴─────────────┘
```

- **Top bar** — dark navy. App name; the `Filter | Review | Approval | Done`
  views drawn as numbered steps (same `activeView` state; non-Filter steps still
  show the "Coming soon" placeholder). On the right one **account menu** — a
  native `<details>` dropdown (Fomantic's dropdown treats a clicked item as a
  selection and rewrites its trigger text; this menu holds actions):
  - anonymous → a `Log in` button (`LOGIN_URL`, `data-flow-link`);
  - authenticated → a chip `‹name› · ✓ Compliance` (or `· Compliance needed`,
    amber). The menu holds the compliance reason + acknowledged-at time, then
    `Start compliance check` (`COMPLIANCE_START_URL`, `data-flow-link`) or
    `Invalidate`, then `Log out`.
  - The top-bar **Run / Refresh button is removed.**
- **Docs rail** (left) — 28 px vertical "DOCS" button, collapsed by default.
  Opening it shows the docs panel as a ~20rem column that pushes the main column
  (existing `sidebarCollapsed` state; its initial value becomes `true`).
- **Main column** — Databases card, Query card, Matching entrysets card, stacked.
- **Stats column** (right) — ~15rem, `position: sticky`, always visible while the
  page scrolls; scrolls internally if taller than the viewport.
- **Page** — light grey background, white cards, one spacing scale and one
  palette via CSS custom properties: primary / ALL = Fomantic blue `#2185d0`,
  ANY = amber `#e08a00`, invalid = red, incomplete hints = grey.
- **Narrow widths** — the docs column starts collapsed at every width, so the
  builder gets the room by default. Condition rows use a CSS container query:
  below ~640 px of available row width the value control and ✕ wrap onto a
  second line instead of squeezing the dropdowns.

## 4. Query builder

### Groups

- A group has a 3 px left border in its operator colour, short 16 px "arms" at
  its top and bottom (a `[` shape), and a faint tint of the same colour behind
  it (blue for AND, amber for OR). Nested tints stack.
- **Hover highlight:** the innermost hovered group darkens its outline and tint —
  pure CSS, `.qb-group:hover:not(:has(.qb-group:hover))`.
- **Header:** collapse caret · `Match [ALL | ANY] of the following` · `+ Condition`
  `+ Group` (right-aligned) · `✕` (not on the root). ALL/ANY are labels for the
  unchanged `LogicalOperator` `"AND" | "OR"`.
- **Joiner:** between consecutive children, a small `AND` / `OR` pill sits on the
  group's left border, in the group's colour.
- **Collapsed group:** one line — caret, ALL/ANY badge, `queryToText` of that
  group (ellipsised), `N condition(s)` (`countConditions`), `✕`.
- **`+ Group`** inserts a group pre-populated with one empty condition:
  `newGroup()` in `src/query/tree.ts` now returns an AND group with one
  `newCondition()` child (its only `src/` caller is the `+ Group` button). A group
  can still become empty when its last condition is removed, so the "Add a
  condition to this group." hint stays.

### Condition rows

- One line: `[Item] [Field] [Operator] [Value] ✕`, a CSS grid so columns align
  across sibling rows; wraps per the container query in §3.
- Icon-only buttons get `aria-label`s ("Remove condition", "Remove group",
  "Collapse group" / "Expand group").

### Incomplete vs invalid

- `Issue` gains `kind: "incomplete" | "invalid"`:
  - `incomplete` — "Choose a field.", "Choose an operator.", "Enter a value.",
    "Enter both values.", "Choose at least one value.", "Add a condition to this
    group." → rendered as a quiet grey hint directly under the row / under the
    group header.
  - `invalid` — "Unknown field.", "Unknown operator.", "That operator isn't
    available for this field." → rendered as today's red label.
- `severity` is unchanged (`"error"`), so both kinds still block Run and stats
  exactly as today; `hasBlockingErrors` and `canRunQuery` are untouched.

### Query footer

- Complete query (no issues) → `queryToText` of the whole tree, italic,
  ellipsised with the full text in `title=`.
- Otherwise → e.g. "2 conditions still need attention." (count of distinct
  nodes with an issue).

### Databases card

- Each database is a pill toggle: a native checkbox inside a styled `<label>`
  (keyboard accessible, no plugin). Header shows `N of M selected` plus small
  `All` / `None` buttons (replacing the text links). Zero selected → an amber
  "Select at least one database." note. Behaviour (`onDatabasesChange`) is
  unchanged.

## 5. Statistics column

- Header `Statistics` with a small inline spinner while `stats.status` is
  `"loading"`.
- Headline: big compact number + the label **matching entrysets**, then
  `‹matchRatio› of ‹compact(total)›`, then a thin primary-coloured bar. The
  existing "never show failed databases as zero" logic and the "Excludes N
  database(s) that failed" note are kept.
- By database: a compact 3-column grid per database — name · bar · ratio — exact
  figures in `title=`. Failed database: name + its `errorMessages` in red on its
  own line; `infoMessages` in small grey text beneath. While loading, a trailing
  "Waiting on N more database(s)…" line.
- Empty states use a quiet grey placeholder instead of blue `ui info message`
  boxes: "Select at least one database…", "Add a condition…", "Finish the query
  to see statistics." (incomplete), and "Counting matches…" while a complete
  query's first result is pending (idle = the 400 ms debounce, or loading with
  no line yet).
- All number formatting stays in `src/ui/format.ts`.

## 6. Matching entrysets

The existing `dataPreview.ts` panel, moved into the main column and renamed on
screen. **Run query lives here only.**

| State | Shown |
|---|---|
| no database / no condition / query incomplete | disabled `Run query` + "Finish the query to run it." (or the database/condition wording) |
| ready (`preview.status === "idle"`, `canRunQuery`) | enabled `Run query` + "Fetch a sample of the entrysets this query matches." Anonymous: + "You'll be asked to log in first." Authenticated without compliance: + "You'll be asked to confirm compliance first." |
| loading | spinner + "Fetching entrysets…" (no button) |
| error | red message + `Try again` (same run action) |
| ok | header `Matching entrysets · N`, then the list; **no Refresh button** |

- The button is rendered by the panel from `canRunQuery(state)` and
  `preview.status`; `syncRunButton` and the top-menu `run` handler are removed.
  The panel's delegated click handler calls the existing `runPreview()` — its
  401/403 redirect behaviour, request slots and stale guards are unchanged.
- The panel still clears in the same `setState` as any query / database edit
  (§6 of ARCHITECTURE.md), which is what makes "one run per query" hold.
- Rows: `#id`, a short date (`toLocaleString` with `dateStyle: "medium"`,
  `timeStyle: "short"` → e.g. "7 Nov 2024, 09:15"), vehicle type, up to 3
  subsystem-group tags + `+N`, item count. Count wording `1 entryset` /
  `N entrysets`. The list flows with the page (the inner `max-height` scroll
  region is removed). Expanded JSON stays (throwaway until the planned viewer),
  in a monospace block capped at ~24rem height with its own scroll.

## 7. Docs panel

- Title **Data dictionary** + a close `✕` (same toggle as the rail).
- Subsystem groups become native `<details>` elements instead of a Fomantic
  accordion (like the entryset rows) — no plugin, and the filter can open them.
  `.ui.accordion` is removed from `activate()` / `destroy()` in `fomantic.ts`.
- Filter: matches item name **or** any field name/label, case-insensitive.
  Groups with a match open and show `N match(es)`; groups without are hidden;
  empty result → "No items match ‘…’". A clear `✕` in the input. The matching is
  a pure function — `matchDocs(individuals, text)` in a new
  `src/ui/docsFilter.ts`, returning the matching item labels and a per-group
  match count — with a unit test; the input
  handler applies its result to the already-painted DOM (open/hidden attributes),
  as the current filter already does with `style.display`.
- **Group and tag text is shown in the backend's casing, with underscores
  replaced by spaces** (`battery_ev` → `battery ev`). One shared helper is used
  by the docs panel and the entryset-row tags; the current title-casing in
  `docsSidebar.ts` is removed.
- Item entries: name, tags as small chips, description, italic comment,
  "In 3B entrysets (39%)", fields as code chips with their type.

## 8. Unchanged (explicitly)

- ARCHITECTURE.md §6: stats and preview always match the on-screen query;
  request slots, abort-on-supersede and stale guards.
- The login / compliance redirect-on-401/403 flow, `data-flow-link` query saving,
  and `?resume=1` restore.
- API contract, mock server, query model shape (other than `Issue.kind`).

## 9. Testing

Unit tests only, per the repo's no-DOM-tests rule:

- `tests/query/validate.test.ts` — each issue carries the right `kind`; both
  kinds still count as blocking.
- `tests/query/tree.test.ts` — `newGroup()` yields an AND group containing
  exactly one empty condition. Existing tests that relied on `newGroup()` being
  empty (`tree`, `validate`, `summary`, `pendingQuery`) are updated — where they
  need an empty group (e.g. the empty-group validation case) they build one
  explicitly.
- `tests/ui/format.test.ts` — entryset date format; `1 entryset` / `N entrysets`;
  the underscore → space label helper.
- New `tests/ui/docsFilter.test.ts` — item-name and field-name matching,
  per-group match counts, empty result.
- `tests/ui/statsPanel.test.ts` — updated for the new headline markup.
- Gates: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`
  (includes `check:offline`).
- Visual check: the review's Playwright screenshot script re-run against the new
  UI (fresh load, 3-level query, login + compliance, Run, 1440 / 1280 / 1024 px);
  before/after screenshots shared.

## 10. Documentation

`docs/ARCHITECTURE.md`: §1 screen-layout diagram and bullets, §3 (the accordion
leaves the airlock list), §5 (render triggers:
account menu, preview owns the Run button), §9 panels (account menu, docs rail +
filter, stats column, matching entrysets, soft hints), §11 (incomplete vs invalid
display), §13 changelog row. README: no new rules.

## 11. Out of scope

Real Review / Approval / Done views; the dedicated entryset JSON viewer;
drag-and-drop reordering; saving / sharing queries; "add as condition" from the
docs; dark mode; layouts below 1024 px beyond remaining usable.

## 12. Delivery

Committed and pushed to `claude/frontend-ui-ux-improvements-73afba`. No pull
request unless explicitly requested.
