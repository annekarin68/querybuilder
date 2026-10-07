# Drag-to-build, facet presence and the pickle theme — design

Status: approved in chat on 2026-10-07; revised the same day after review (value drops, sidebar redesign, easter egg, "no field" choice). Awaiting final spec review.

Where this spec and docs/ARCHITECTURE.md differ, ARCHITECTURE.md describes the code as built (e.g. no text/plain drag fallback; the mascot state comes from mascotFor; the rain is wired in main.ts; facet cards show name and field count).

## 1. Goals

1. Build the query by dragging items from the docs sidebar into the query
   builder.
2. Express "this facet must be present, whatever its values" as a query in
   itself.
3. Restyle the frontend with a pickle theme (logo, favicon, palette).
4. Make facet and field documentation readable and usable in the sidebar,
   since it is now a drag source.

Non-goals: new backend endpoints, a drag library, renamed UI copy, dark mode.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Keep one node kind, `condition`. `fieldId` becomes optional (`string \| null`). A condition with `fieldId` null is about the facet itself. |
| D2 | Replace `isNotEmpty` / `isEmpty` with `present` / `absent`. Same operators serve facets and fields. |
| D3 | A facet-level condition (`fieldId` null) offers only `present` / `absent`. |
| D4 | The label of `present` / `absent` depends on context (table below); the id does not. |
| D5 | Native HTML5 drag-and-drop. Fomantic has no drag module; no new dependency. |
| D6 | Existing nodes can be dragged to reorder. The Add buttons stay as the keyboard path. |
| D7 | Theme is visuals only and fully offline: local SVGs, CSS variables, system fonts. `npm run check:offline` must keep passing. |
| D8 | The frontend sends the query as built; the backend decides what a null `fieldId` means (project rule: no rewriting of conditions). |
| D9 | Sample field values are draggable too (string and number fields with a pick-list). |
| D10 | The sidebar is redesigned: wider, resizable, open by default, with an obvious collapse control. |
| D11 | The pickle mascot is a set of replaceable SVG files with fixed names. Swapping the files changes the artwork with no code change. |

| Operator id | Field-level label | Facet-level label |
|---|---|---|
| `present` | Has any value | Is present |
| `absent` | Has no value | Is absent |

## 3. Query model and wire format

- `Condition.fieldId: string | null` (was effectively always set when
  complete). `RequestCondition.fieldId: string | null`, sent as an explicit
  `null` so the shape is uniform.
- `OPERATORS` in `src/query/fieldCatalog.ts`: `isEmpty` / `isNotEmpty` are
  replaced by `absent` / `present` (arity `none`). Every field type's
  `operatorIds` swaps them in place. A facet-level operator list
  (`FACET_OPERATOR_IDS = ["present", "absent"]`) is added.
- `validate.ts` (`checkCondition`): a null `fieldId` is complete when
  `facetId` is a known facet and the operator is in `FACET_OPERATOR_IDS`;
  an unset operator is "Choose an operator."; any other operator is
  invalid. A null `facetId` still reports "Choose a field."
- `request.ts` (`conditionOf`): stops requiring `fieldId`; still requires
  `facetId` and `operatorId`.
- A condition is facet-level when `facetId` is set, `fieldId` is null and
  `operatorId` is set; choosing the no-field option sets `operatorId` to
  `present`.
- `summary.ts`: a facet-level condition reads "Facet name is present".
- Mock server (`mock-server/evaluate.ts`, contract tests): evaluates
  `present` / `absent` for a facet (the event holds a values entry for
  that facet id) and for a field (the entry holds that field id). `isEmpty`
  and `isNotEmpty` are removed. Backend change on the real server is the
  user's; `docs/ARCHITECTURE.md` "Wire format of the query" is the
  hand-off.

## 4. Drag and drop

**Sources** (docs sidebar, `docsSidebar.ts`): facet card, field row,
sample-value chip, tag heading. Each carries a custom MIME payload
(`application/x-qb-item`) holding JSON: `{type: "facet", facetId}`,
`{type: "field", facetId, fieldId}`,
`{type: "value", facetId, fieldId, value}` or `{type: "tag", tag}`; and a
`text/plain` fallback. Drag data is untrusted on drop: it is parsed and
checked against the loaded facets. Nothing is dropped silently: see
"Drop feedback" below.

**What a drop creates** (pure function in a new `src/query/drop.ts`, unit
tested):

| Dropped | Result in the receiving group |
|---|---|
| Facet | `{facetId, fieldId: null, operatorId: "present"}` |
| Field | `{facetId, fieldId, operatorId: null}`; user chooses the operator |
| Value | `{facetId, fieldId, operatorId: "eq", value}`; a number field's value is sent as a number (normalised like `pickListFor`) |
| Tag | one facet-level `present` condition per facet with that tag |

**Targets** (`queryBuilder.ts`): the root group and every group accept
drops and append to that group's children. A group being dragged over
shows a drop highlight. Dropping a node onto a group moves it there
(reordering), with an insertion line between siblings. A group cannot be
dropped into itself or its own descendants. Moves go through `tree.ts`
(new `moveNode`, unit tested) so ids and collapse state are preserved.

**Drop feedback.** Whenever a drop (or "Add to query") cannot be honoured
in full, the user is told why, using the app's existing visible-message
pattern (docs/ARCHITECTURE.md, "Error and loading model"): a dismissible
`ui warning message` above the query. `AppState` gets one field,
`dropNotice: string | null`, set by the drop handler, cleared when
dismissed or on the next successful drop. `drop.ts` returns the nodes it
could create plus a list of problems; it never throws on bad drag data.

| Situation | Behaviour |
|---|---|
| Unknown facet, field or value (docs out of date, or tampered payload) | Nothing added. Message: "Couldn't add *name*: it is not in the loaded docs. The docs may be out of date; reload the page." |
| Tag drop | The facets carrying the tag in the loaded docs are added; a tag with none gets the "has no facets" message. |
| Tag with no facets | Message: "The tag *name* has no facets." |
| Payload isn't ours or can't be parsed | Message: "That item can't be added to a query." |
| Group moved into itself or a descendant | Not moved. Message: "A group can't be moved into itself." |

Drags from outside the app carry no `application/x-qb-item` type, so the
builder does not offer itself as a drop target and the browser shows the
"not allowed" cursor. That is the feedback for those.

**Keyboard path:** each facet card and field row gets an "Add to query"
button that performs the same creation into the root group. The existing
Add condition / Add group buttons stay.

**Condition row:** the Field dropdown gains a "no field" choice. Choosing it
sets `fieldId` null and restricts the operator dropdown to `present` /
`absent`. Operator labels follow D4.

The "no field" choice must never be mistakable for a field, even one
literally named "Any field":
- it is listed first, in its own group above a divider;
- it reads `— no field (facet only) —` in muted italics with a dashed
  outline and its own icon (the distinction is visual only; Fomantic offers
  no hook to exclude one item from search, so search exclusion is not
  attempted);
- once chosen, the field cell keeps the dashed, muted look, and the
  row summary reads "Facet name is present";
- it is identified by its option value, never by a label, so a real field
  cannot collide with it: the no-field option has `value="none"`, real
  fields are `f:<id>`, and unset is `""`. A unit test covers a field named "Any field" beside it.

Dropping a value onto a field also works for values that are numbers or
strings only; boolean and date fields have no pick-list and so no value
chips.

## 5. Docs sidebar redesign

The sidebar becomes the main way to build a query, so it is rebuilt, not
patched. It replaces the small field chips and the `title` tooltips.

- **Layout:** a sticky search box on top; below it tag groups; each facet
  is a card. The existing filter (`docsFilter.ts`) and tag grouping stay.
- **Width:** 26rem by default (was 20rem), resizable by a drag handle on
  its right edge between 20 and 40rem. The width is remembered in
  `localStorage` (try/catch around every access; the page renders without
  it). On narrow screens the sidebar overlays instead of squeezing the
  builder.
- **Open by default** (was collapsed). Collapsing must be obvious: a labelled
  "Hide docs" button with a chevron icon in the sidebar header, and when
  collapsed, the existing "Docs" rail stays as the way to reopen it. Both
  carry `aria-expanded`.
- **Facet card:** header with name, tags and event count; the field count is
  shown; activating it (click, Enter, Space) expands it (Fomantic
  native `<details>`, like the tag groups).
- **Field row (expanded card):** full width, name, type badge, one-line
  description clamped to two lines. Activating it expands the complete
  comment, third-party description and sample-value chips.
- **Drag affordance:** a grip handle and `grab` cursor on everything
  draggable, plus an "Add to query" button on each card, row and value
  chip for keyboard users.
- `fieldTitle` and the `title` attributes are removed once their content is
  visible.

## 6. Pickle theme and mascot

- Palette as CSS variables in `src/styles.css`: brine/dill greens as
  primary, a mustard-seed accent, cream background. Exact values are
  checked for text contrast (WCAG AA) during implementation.
- System fonts only; no webfont, CDN or remote image. Fomantic's own colour
  variables are overridden through CSS, not by a theme build.
- UI text is unchanged, except the easter-egg toast below.
- All artwork is original (a pickle with a face), not the Rick and Morty
  character.

### Replaceable mascot files

The artwork lives in `public/pickle/` under fixed names, shipped as plain
files (copied unprocessed into `dist/pickle/`, so they can even be swapped
on a deployed build):

| File | Used for |
|---|---|
| `favicon.svg` | browser tab icon (`index.html`) |
| `logo.svg` | top bar, normal state |
| `disappointed.svg` | top bar while the query has invalid (red) issues |
| `loading.svg` | top bar while results are loading (falls back to `logo.svg` if the file is removed) |

Code only references these paths (listed once in `src/config.ts`).
Animations (a wobble while loading; reduced to none under
`prefers-reduced-motion`) are CSS on the `<img>` element, not part of the
SVG, so any replacement file animates the same way. Files may be any
size; they are scaled to the logo's box. SVGs must be self-contained (no
external references), which `check:offline` enforces on the build.

State is shown by swapping the `<img src>` from existing app state
(`runBlocker` / pending run), in `layout.ts`; no new state is added.

### Easter egg

Clicking the logo five times within three seconds makes it rain pickles
for about four seconds: `logo.svg`, `disappointed.svg` and `loading.svg`
fall from the top of the screen, mixed. They are the same replaceable
files as above, so new artwork changes the rain too.

- A fixed, full-screen overlay (`pointer-events: none`, `aria-hidden`,
  above the page, below modals) holds about 30 `<img>` elements with
  randomised column, size, delay, duration and spin. The fall is a CSS
  keyframe animation; JS only creates the elements and removes the overlay
  when the animation ends. No animation loop.
- A second trigger while it rains is ignored. A file that fails to load
  (removed or broken) is left out of the mix; if none load, nothing falls.
- Under `prefers-reduced-motion` nothing falls; a small toast reads "I'm
  Pickle Rick!" instead (wording in `src/config.ts`).
- Lives in one small module (`src/ui/pickleRain.ts`) that `layout.ts`
  wires to the logo. Nothing else in the UI changes.

## 7. Tests and verification

- Unit: `validate` (facet-level conditions), value drops (string and number), drop problems (unknown facet/field/value, empty tag, unparseable payload, group into itself), `request` (null `fieldId`),
  `summary`, `fieldCatalog` (renamed operators), `drop.ts`, `tree.moveNode`.
- Mock server and contract tests: `present` / `absent` for facets and fields.
- Browser check with Playwright (needs a real `npm ci`, not a symlinked
  `node_modules`): drag a facet, field and tag; reorder; keyboard Add; each drop-problem message appears; the rain starts after five fast clicks, ends, and does not block clicks.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` (includes
  `check:offline`).
- `docs/ARCHITECTURE.md` is updated in the same change (sections 7, 8, 9,
  10). `docs/CHANGELOG.md` is archived and no longer updated.

## 8. Open questions

None blocking. Delivered as separate commits in this order: operator
rename and facet-level conditions (model, validation, wire, mock), then
sidebar redesign, then drag and drop (including values), then the theme and mascot.
