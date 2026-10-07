# Drag-to-build, facet presence and the pickle theme — design

Status: approved in chat on 2026-10-07, awaiting written-spec review.

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
- `summary.ts`: a facet-level condition reads "Facet name is present".
- Mock server (`mock-server/evaluate.ts`, contract tests): evaluates
  `present` / `absent` for a facet (the event holds a values entry for
  that facet id) and for a field (the entry holds that field id). `isEmpty`
  and `isNotEmpty` are removed. Backend change on the real server is the
  user's; `docs/ARCHITECTURE.md` "Wire format of the query" is the
  hand-off.

## 4. Drag and drop

**Sources** (docs sidebar, `docsSidebar.ts`): facet card, field row, tag
heading. Each carries a custom MIME payload
(`application/x-qb-item`) holding JSON: `{type: "facet", facetId}`,
`{type: "field", facetId, fieldId}` or `{type: "tag", tag}`; and a
`text/plain` fallback. Drag data is untrusted on drop: it is parsed and
checked against the loaded facets, and ignored if unknown.

**What a drop creates** (pure function in a new `src/query/drop.ts`, unit
tested):

| Dropped | Result in the receiving group |
|---|---|
| Facet | `{facetId, fieldId: null, operatorId: "present"}` |
| Field | `{facetId, fieldId, operatorId: null}`; user chooses the operator |
| Tag | one facet-level `present` condition per facet with that tag |

**Targets** (`queryBuilder.ts`): the root group and every group accept
drops and append to that group's children. A group being dragged over
shows a drop highlight. Dropping a node onto a group moves it there
(reordering), with an insertion line between siblings. A group cannot be
dropped into itself or its own descendants. Moves go through `tree.ts`
(new `moveNode`, unit tested) so ids and collapse state are preserved.

**Keyboard path:** each facet card and field row gets an "Add to query"
button that performs the same creation into the root group. The existing
Add condition / Add group buttons stay.

**Condition row:** the Field dropdown gains an empty choice ("Any field —
facet only"). Choosing it sets `fieldId` null and restricts the operator
dropdown to `present` / `absent`. Operator labels follow D4.

## 5. Docs sidebar readability

Replaces the small field chips and the `title` tooltips.

- Within each tag group, a facet card shows its header and field count;
  activating it (click, Enter or Space) expands it (Fomantic accordion).
- Expanded, each field is a full-width row: name, type badge, one-line
  description (clamped to two lines).
- Activating a field row expands the complete comment, third-party
  description and sample values.
- A grip handle and `grab` cursor mark everything draggable.
- `fieldTitle` and the `title` attributes are removed once their content is
  visible. Search (`docsFilter.ts`) keeps working across the new markup.

## 6. Pickle theme

- Palette as CSS variables in `src/styles.css`: brine/dill greens as
  primary, a mustard-seed accent, cream background. Exact values are
  checked for text contrast (WCAG AA) during implementation.
- Logo: inline SVG pickle in the top bar (`layout.ts`) replacing the text-only
  brand. Favicon: `public/favicon.svg`, linked from `index.html`
  (replacing `data:,`).
- System fonts only; no webfont, CDN or remote image. Fomantic's own colour
  variables are overridden through CSS, not by a theme build.
- UI text is unchanged.

## 7. Tests and verification

- Unit: `validate` (facet-level conditions), `request` (null `fieldId`),
  `summary`, `fieldCatalog` (renamed operators), `drop.ts`, `tree.moveNode`.
- Mock server and contract tests: `present` / `absent` for facets and fields.
- Browser check with Playwright (needs a real `npm ci`, not a symlinked
  `node_modules`): drag a facet, field and tag; reorder; keyboard Add.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` (includes
  `check:offline`).
- `docs/ARCHITECTURE.md` and `docs/CHANGELOG.md` are updated in the same
  change (sections 7, 8, 9, 10).

## 8. Open questions

None blocking. Delivered as separate commits in this order: operator
rename and facet-level conditions (model, validation, wire, mock), then
sidebar readability, then drag and drop, then the theme.
