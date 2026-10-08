# Grouping, saved queries, error display, dictionary values, easter egg — design

Date: 2026-10-08. Status: approved in conversation, decisions recorded below.

Six independent changes, built and committed in this order (lowest risk
first): **6 → 1 → 5 → 3 → 4 → 2**. Each section says what changes, the
decisions taken (with the reason), and how it is tested. Every change updates
`docs/ARCHITECTURE.md` in the same commit (never rename its headings).

---

## 6. Pickle rain works in more browsers

**Root cause (found by a spike, Chromium 141 and Firefox 157 via Playwright):**
the logo is a plain `<img>`, which browsers make draggable. A click whose
pointer moves a few pixels between press and release becomes an image drag
and the `click` never fires (Chromium: ≥4 px, Firefox: ≥6 px; the threshold
also depends on the OS). Five clicks within 3 s then rarely all count. The CSS
(`var()` inside `@keyframes`, `inset`) and the image preload work in both
engines. WebKit could not be launched here (missing system libraries, no
sudo), so Safari is untested.

**Change:** `draggable="false"` on the logo `<img>` in `src/ui/layout.ts`,
with a comment saying why. Nothing else.

**Tests:** a Node test that the shell template's logo carries
`draggable="false"`. Browser check: five jittery clicks (pointer moved 6 px
during each) start the rain in Chromium and Firefox.

---

## 1. "Group contents" and "Ungroup"

**Problem:** users add several conditions, then realise they wanted them in a
group to AND/OR with another group; today they must create a group and drag
each condition in.

**Pure functions (`src/query/tree.ts`):**

- `groupContents(tree, groupId): Group` — the group's children move into one
  new group (fresh id, **same** ALL/ANY as the group, not collapsed), which
  becomes the group's only child. Query results do not change. Unknown id →
  tree unchanged.
- `ungroupBlocker(tree, groupId): string | null` — `null` when ungrouping is
  allowed, otherwise the reason in words. Allowed when the group is not the
  root and **either** its ALL/ANY equals its parent's **or** it has exactly one
  child (a one-child group means the same whatever its ALL/ANY). Both rules
  keep the query's meaning unchanged.
- `ungroup(tree, groupId): Group | null` — replaces the group, in its parent,
  by its children, at the group's position. `null` when `ungroupBlocker` says
  no (callers never rewrite meaning).

**UI (`src/ui/queryBuilder.ts`):**

- **Group contents** (mini basic button, icon + label) in every group header,
  the root included, drawn when the group has **2 or more children**. Tooltip:
  "Put this group's conditions and groups into a new group inside it".
  Announced: "Grouped N items." (N = the children moved).
- **Ungroup** on every non-root group header. When `ungroupBlocker` returns a
  reason the button is `aria-disabled="true"` (still focusable, so keyboard and
  screen-reader users find it), carries the reason as its `title`, and pressing
  it sets the reason as the drop notice (`setNotice`, which also announces it).
  The reason: "Ungroup works only when this group and the one around it are
  both ALL or both ANY, or when it holds one item." Announced on success:
  "Ungrouped."
- **Decision (user, 2026-10-08):** the label is "Group contents", not
  "Indent" (a text-editor word that does not say a group is created) nor
  "Group children" ("children" is tree vocabulary the UI never uses).
- **Decision (user):** Ungroup only when meaning is unchanged; disabled with a
  reason, not hidden, so users learn why.
- The header gains up to two buttons: check at 512 px wide and let the buttons
  wrap rather than overflow.
- Focus after either action follows "Keyboard focus across repaints": it stays
  on the pressed button where it still exists, else the group's header landing.

**Tests:** `tree.ts` unit tests (root, nested, collapsed group, 1-child,
mixed operators, unknown id, `sameSemantics` before/after for both
operations); `queryBuilder` HTML tests for when each button is drawn and the
`aria-disabled` state; browser check at 512 px.

---

## 5. Previously seen values in the dictionary

**Problem:** a field's known values show as floating chips beside its texts.
Users do not see that they are suggested values. Facet **tags** are also chips
in the same card, so the value chips look like tags.

**Change (`src/ui/docsSidebar.ts`, `styles.css`):** inside an opened field, a
labelled block after the texts:

- Heading: **Previously seen values (N)** (N = all known values, not only the
  shown ones).
- Hint under it: "Drag one or press + to add *field* equals *value*. Other
  values may work too." (*field* is the field's name.)
- The values as a compact list, **one value per line**, each with its grip and
  its + button (unchanged `data-item`, `aria-label`, drag payload), visually a
  small table rather than chips.
- At most 30 shown and "N more" as today.

**Decision (user):** wording "Previously seen values …, Other values may work
too." The heading uses the same words as the hint so there is one name.

**Tests:** docsSidebar HTML tests (heading with count, hint with the field
name, one row per value, the cap); browser check of the look, keyboard + and
drag still adding `field equals value`.

---

## 3. Easter-egg mascot (this page load only)

**Change:** five clicks on the logo within 3 s **toggle** the easter-egg
mascot on; five more toggle it off. Each toggle also makes it rain with the
**new** set (or shows the toast under reduced motion). Not stored: a reload
returns to the neutral pickle.

- New artwork: `public/pickle/egg-logo.svg`, `egg-disappointed.svg`,
  `egg-loading.svg` — original "knockoff Pickle Rick" style drawings made for
  this repo (nothing traced or copied), plain self-contained SVG so
  `check:offline` passes.
- `src/config.ts`: `EASTER_EGG_MASCOT` with the same keys as `MASCOT`
  (`neutral`, `disappointed`, `loading`). **Decision (user):** this name, not
  `RICK_MASCOT` or `PICKLE_MASCOT` — the normal mascot is a pickle too, and the
  name pairs with `EASTER_EGG_TOAST` without tying the code to one character.
- `AppState` gains `easterEgg: boolean` (display only, `false` at start).
  `mascotFor` stays the face picker; the file comes from the active set
  (`EASTER_EGG_MASCOT` or `MASCOT`). Fallback to the neutral file of the
  **same** set, then to `MASCOT.neutral`, as today.
- The favicon is not changed.
- Reduced motion: the toast keeps `EASTER_EGG_TOAST` when turning on; turning
  off needs no toast (the face changes back visibly).

**Tests:** pure tests for the set selection and toggle; `check:offline` and the
existing replaceable-SVG rules cover the files; browser check of the toggle.

---

## 4. Showing errors where they can be fixed

Three kinds of problem, each shown once, where its fixer looks:

| Problem | Who fixes it | Where |
|---|---|---|
| Error pointing at a query node (`nodeId`) | the user, in the query | in the builder only (unchanged); stats shows one summary line |
| Database error without `nodeId` | the user (deselect) or the service | in that database's stats row and as a marker in the database picker |
| Request failure (`ApiError`, `TimeoutError`, `ContractError`) | retry / the service | a "Couldn't get statistics" box with **Try again** |

**Mock (`mock-server/evaluate.ts`, `queryErrors`):** besides "Text is too
long", a group **all of whose children have an error** gets
`{ nodeId: <group id>, kind: "incomplete", message: "Group contains no valid conditions." }`,
like the real backend. **Decision (user):** `incomplete`, not `invalid`. (So it
shows as a grey hint and does not switch the mascot to disappointed; the
condition errors that cause it are still red.)

**Statistics panel (`src/ui/statsPanel.ts`):**

- Node errors are not repeated per database. If any result has errors with a
  `nodeId`, one line under the headline: "Not counted: N problem(s) in the
  query are marked in the query." with a **Show** button that scrolls the first
  marked issue into view and moves focus to it. N = `state.serverIssues.length`
  (already de-duplicated). Each such database's row says "Not counted".
- Errors without `nodeId` stay in that database's row, in red (unchanged).
- `stats.status === "error"`: a `ui negative message` headed "Couldn't get
  statistics", the message, and **Try again** (re-runs the stats fetch for the
  current query; new `app` action).
- **Answer to the maintainers' question:** errors with a known id are not
  duplicated in the stats panel; it only says that the query has problems and
  where.

**Database picker (`src/ui/databasePicker.ts`):**

- Every selected database whose stats line for the **current** results is
  `"failed"` gets a red marker on its pill (icon + red outline), its errors'
  messages as the `title`, and visually hidden text "failed for this query".
  Markers come from `state.stats.results` only, so they disappear when a new
  query starts loading and come back as lines arrive.
- **Deselect failing (N)** beside All/None, drawn only when at least one
  selected database failed **and** at least one selected database did not
  (deselecting all would leave nothing; then the query itself is the likely
  problem and the stats panel says so). It calls `onDatabasesChange` with the
  selection minus the failed ones.

**Tests:** mock `queryErrors` tests (group error, nested, root, kind);
statsPanel HTML tests (summary line and count, "Not counted" rows, no
repeated node messages, error box with Try again); databasePicker HTML tests
(marker, title, hidden text, button visibility rules); app test for the
retry action; browser check with a too-long text value.

---

## 2. Saved queries

**Decision (user):** stored by the backend (mocked), per user, needing a
session. Half-built queries can be saved. The list never shows the query
itself (queries can be sensitive); a short optional note helps recall it.

### API (new; `src/api/types.ts`, `client.ts`, `request.ts`, `response.ts`)

Needs a session (`401` without); no compliance reason (saving reads no data).

| Endpoint | Body | Answer |
|---|---|---|
| `GET {prefix}/saved-queries` | — | `SavedQueryResponse[]`, newest `updatedAt` first |
| `POST {prefix}/saved-queries` | `SavedQueryRequest` | `201` + `SavedQueryResponse` |
| `PUT {prefix}/saved-queries/{id}` | `SavedQueryRequest` | `200` + `SavedQueryResponse` |
| `DELETE {prefix}/saved-queries/{id}` | — | `204` |

- `SavedQueryRequest`: `{ name, note, databases, query }`. `name`: 1–80
  characters after trimming. `note`: 0–80 characters (`""` for none).
  `databases`: database labels. `query`: a **draft tree** (below).
- `SavedQueryResponse`: the same plus `id` (made by the server) and
  `updatedAt` (ISO 8601 UTC). **Note:** the backend usually calls machine ids
  `label`; a saved query's id is generated by the server, not a label of
  backend data, so it is `id` (recorded in the architecture doc's naming
  table).
- Names are unique per user, ignoring case and surrounding spaces: a clash
  answers `409` `{ error }`. `404` for an unknown id (or another user's).
  `400` for a malformed body (mock: `requestBody.ts` style, naming the first
  problem).
- **Draft tree** (`SavedGroup` / `SavedCondition` in `types.ts`): the shape
  of `RequestGroup` / `RequestCondition`, but a condition's `facetId`,
  `fieldId`, `operatorId` and `value` may each be `null`, and a group's
  `children` may be empty. No `collapsed` (display state is not saved). The
  backend checks the **shape only**, never the meaning: a saved query may be
  unfinished or invalid. The frontend converts it both ways in `src/api/`
  (`toSavedQueryRequest`, `toSavedQuery`), so the rest of the app sees only
  `Group` / `QueryNode` and a model type `SavedQuery`.
- Why not the `/stats` format: it cannot hold unfinished conditions, and a
  validation bug on our side must never stop a user saving their work.

### Mock (`mock-server/`)

In memory, per logged-in user, lost when the mock restarts; starts empty.
Shape check of the body like `requestBody.ts`. The router matches exact
`METHOD /path` today, so the `{id}` routes need a small prefix match (keep it
explicit and tested).

### UX

- The query card's title row gets **Save…** and **Saved queries**.
- The title shows the open saved query: `Query · <name>`, and *(edited)* when
  the query or the database selection differs from what was last saved or
  opened (`sameSemantics` on the tree, set equality on database ids; collapse
  is not an edit).
- **Save…** opens a dialog: Name (required, prefilled with the open saved
  query's name), Note (optional, max 80, hint "A few words to recognise it
  later"). Saving under the open query's name **updates** it (`PUT`); a new
  name **creates** one (`POST`); a name that clashes with **another** saved
  query asks "A saved query called “…” exists. Replace it?" and on yes
  overwrites that one (`PUT` to its id). Errors show inside the dialog, which
  stays open. Success closes it and announces "Saved “…”.".
- **Saved queries** opens a dialog listing name, note, number of databases
  and date (in the viewer's locale), newest first; **never** the query or its
  summary. Each item: **Open** and **Delete** (Delete asks "Delete “…”?"
  first). Empty state: "No saved queries yet. Build a query and press
  Save…". Loading and errors (with **Try again**) shown in the dialog.
- **Open** replaces the current query and database selection. If the current
  query has unsaved changes (it differs from what was last saved/opened, and
  has at least one condition with anything chosen), confirm first: "Replace
  the current query? Its changes are not saved.". Database ids that no longer
  exist are dropped with a drop-notice-style warning naming how many. Facets or
  fields that no longer exist show up as normal validation issues. Statistics
  refetch as after any edit.
- **Logged out:** both buttons start the login redirect, saving the query
  first like Run does (`saveQueryBeforeRedirect`); after the return hop the
  user presses Save again (no automatic retry, same rule as Run).
- Dialogs are native `<dialog>` with `showModal()` (focus is kept inside,
  Escape closes, focus returns to the button that opened it), styled with
  Fomantic CSS classes only — no Fomantic modal plugin and so no new jQuery.
  Every control has an accessible name.
- `docs/ARCHITECTURE.md`: remove "Saving / sharing queries" from Non-goals
  (sharing stays a non-goal), add the endpoints to the API table, a section
  for saved queries, and the new state.

### Tests

`tests/api/` conversion tests both ways (null parts, empty groups, unknown
keys, contract errors); mock route tests (401, 400, 404, 409, per-user
isolation, ordering, PUT/DELETE); `mockContract` coverage for the new
endpoints; pure tests for "edited" detection and the save-target decision
(update / create / replace); dialog HTML tests; browser check of save, open,
replace, delete, logged-out redirect and keyboard use.

---

## Out of scope

Sharing saved queries; tags on saved queries; renaming without saving;
selecting individual rows to group; an undo stack; favicon swap; storing the
easter-egg state.
