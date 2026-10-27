# Facet blocks, co-occurrence and the compact builder — design

Date: 2026-10-27. Status: agreed with the maintainers section by section;
waiting for their review of this written version.

## 1. Why

Users want to build their filter **per facet** instead of per field: adding
anything puts the whole facet in the query, and inside it they choose ALL or
ANY over its fields, where ALL means **all within one occurrence** of that
facet in an event. Today's query cannot say that: two conditions on the same
facet may be met by different occurrences. Users also want each facet's
documentation and its co-occurrence with other facets next to the facet they
are filtering on, and a more compact builder.

Related, already done on its own branch (`claude/saved-queries-without-node-ids`):
saved queries no longer store node ids; a saved tree is read back with fresh
ids. This design assumes that change.

## 2. Decisions (maintainers, 2026-10-27)

1. **A facet block is a node of its own** (approach 1 of three; a group with an
   optional facet id and occurrence tags on conditions were rejected): the
   block names the facet; its conditions name only a field.
2. **ALL / ANY inside a block apply within one occurrence.**
3. **Blocks are flat**: field conditions only, no sub-groups. "A and (B or C)
   in one occurrence" is built as two ALL blocks joined with ANY.
4. **Has / has no** on every block: "has (no) occurrence where ALL / ANY of the
   set fields match". With nothing set it is "facet present / absent".
5. **A block shows every field of its facet**, one row each. A field with
   nothing chosen means "don't care" (no condition on its value or on whether
   it exists): a muted grey label and empty controls, **no text** (not "any
   value", which reads as "must have a value").
6. **One row per field, one condition per field.** A new operator `not_in`
   ("Is none of") covers "neither 1 nor 2 in the same occurrence".
7. **Facets with more than 5 fields fold** to the set rows plus the first 3,
   behind "+ N more fields". Real facets have 2 to over 20 fields.
8. **Only whole blocks (and groups) move.** Field rows stay where they are.
9. **The old query shape is dropped, not migrated.** The saved-query database
   is emptied and users rebuild their queries. A kept query (sessionStorage)
   in the old shape fails the structural check and is dropped once.
10. **The facet query is always visible**; tabs only change the panel beside
    it: **Seen together** (the square pie chart) and **About** (facet docs, or
    the selected field's docs). Clicking the open tab hides the panel, **for
    every block at once**, so the builder uses the full width.
11. **The co-occurrence row** (the designer's "matrix") is always above each
    block and shows every facet that is ever seen with another facet;
    facets seen with none are left out of the row. A block whose facet is
    seen with no other facet shows a row of never-seen cells, with hover text
    "Never seen together with another facet." (no visible words).
12. **This block's own facet** is a round mustard mark (no ring).
13. **Cell meaning**: a dot = ever seen together; the colour behind it = how
    often; never seen together = plain grey with no dot (variant A); a value
    too small for a JavaScript number = an empty box with a dot.
14. **Colour scale**: log scale from the smallest non-zero value in the whole
    matrix to the largest; designer-chosen colour stops with a smooth blend
    between neighbouring stops. The range is the whole matrix, never a single
    block, so blocks can be compared.
15. **Clicking a cell or a square-pie box opens the dictionary sidebar at that
    facet.** Hovering shows only name and value.
16. **Square pie chart**: area proportional to the value; facets never seen
    together are absent; labels only where the whole name fits, never cut.
17. **One About tab, not Facet + Field**: facet docs until a field is
    selected, then the field's docs.
18. **Palette**: every new colour is a `:root` token; the designer swaps
    them in one place.
19. **Preferences** (fields expanded by default, default tab) and **dark mode**
    are a later sub-project. Preferences live in the browser
    (`localStorage`); dark mode starts as "follow the operating system".
20. **The dictionary sidebar** only gains "open at facet X" here; its wider
    rethink comes after users have tried the blocks.
21. **The summary is as short as possible** (it is often cut off), with
    brackets around a block's fields and `between (20, 80)` (section 5).
22. **The legend is only a popover**, from a "?" on every block's row
    (section 6).

## 3. Query model (`src/query/types.ts`)

```ts
interface Group {
  kind: "group"; id: string; operator: "AND" | "OR";
  children: (Group | FacetBlock)[]; collapsed?: boolean;
}
interface FacetBlock {
  kind: "facet"; id: string; facetId: string;
  negated: boolean;             // false: "Has", true: "Has no"
  operator: "AND" | "OR";       // over the set fields, within one occurrence
  conditions: FieldCondition[]; // at most one per fieldId; unset fields are absent
  collapsed?: boolean;          // folded to header + summary (display only)
}
interface FieldCondition {
  kind: "condition";
  id: string; fieldId: string; operatorId: string | null; value: ConditionValue;
}
```

- The root is always a `Group`. There are no loose conditions.
- **Setting a field** adds its `FieldCondition` (choosing an operator in the
  row); the blank choice at the top of the operator dropdown removes it.
  An operator with no value yet is "not finished".
- Which fields are folded ("+ N more fields") is display state, kept in UI
  state, not in the tree, and never saved or sent.
- Removed: `Condition.facetId`, `fieldId: null` (facet-level conditions),
  `isFacetLevel`, the Field dropdown's whole-facet choices,
  `replaceLoneBlankCondition` and the starting blank row.
- **The starting query** is an empty root group. It is "not finished" ("Add a
  facet to start"), not invalid, so the mascot keeps its normal face. An empty
  group below the root stays invalid, as today.

`tree.ts` keeps its rules (immutable, fresh ids only for new nodes) and gains
block operations: add a block, set / clear a field condition, toggle negated,
switch ALL / ANY. `moveNode`, `moveSibling`, `groupContents` and `ungroup`
work on groups and blocks; a field condition is never moved.

## 4. Wire format

`/filter/validate` and `/filter/execute` (`toQueryRequest`):

```json
{ "kind": "group", "id": "g-…", "operator": "AND", "children": [
  { "kind": "facet", "id": "f-…", "facet_id": "…", "negated": false,
    "operator": "AND", "conditions": [
      { "kind": "condition", "id": "c-…", "field_id": "…", "operator_id": "gt", "value": 40 } ] } ] }
```

- Meaning (the backend's to implement): the event **has** (when `negated`,
  **has no**) occurrence of `facet_id` in which ALL / ANY of `conditions`
  hold. Empty `conditions`: the facet is present / absent.
- `not_in`, arity `many`: the value is none of the list.
- `node_id` in a stats error may name a block or a field condition.
- The frontend still sends the query as the user built it; unset fields are
  not part of the query, so leaving them out is not a rewrite.

**Saved queries**: the same shape, unfinished parts allowed (operator or value
`null`), without node ids. The backend checks the shape only.

**Backend hand-off**: the `facet` node and its meaning, `negated`, `not_in`,
`node_id` on blocks and field conditions, `kind: "condition"` on every field
condition, no more `field_id: null` or group-level conditions, `co_occurrence`
on facets (section 6), and emptying the saved-query store.

Question for the backend: the mock reports `Facet contains no valid conditions.`
on a block whose every set field failed (by analogy with the group message);
does the real backend do the same?

## 5. The builder (`src/ui/queryBuilder.ts`)

**Adding**
- Dictionary facet dropped → new block (Has, ALL, nothing set).
- Field dropped on a block of its facet → that row is focused; dropped
  elsewhere → new block with that row focused.
- Value dropped → the field's row becomes "equals value" if it is unset;
  if it is already set, a new block (nothing the user chose is overwritten).
- Tag dropped / "Add all" → one ALL group of blocks, one per facet.
- "+ Condition" becomes **"+ Facet"** (a searchable facet picker) in every
  group; "+ Group" stays.

**A block**
- Above it: the co-occurrence row (section 6).
- Header: grip, facet name, Has / Has no, ALL / ANY with "of the set fields
  match" (shown once two or more fields are set), the tabs Seen together /
  About, a fold chevron, remove. The block's facet cannot be changed.
- Rows: label, operator, value. Unset: muted label, empty controls, a
  visually hidden "not filtered" for screen readers.
- **Unset rows draw two plain buttons, not Fomantic dropdowns.** Activating
  one turns the row into real dropdowns with the operator list open. Folded
  rows are not drawn. Reason: the builder repaints fully on every edit, and
  ten 20-field blocks would otherwise initialise about 400 dropdowns per
  keystroke.
- Folded block: header plus a one-line summary.
- Issues: on the row or the block, colours as today.

**Panel**: beside the rows; under them when the builder itself is narrow (a
CSS container query on the builder's width, since the open dictionary takes
width too). `AppState.panelTab` (`"seen" | "about" | null`, all blocks) and
`AppState.selectedField` (`{ blockId, fieldId } | null`): a field is selected
by clicking its label or focusing its row, and stays selected until another
is selected or Escape is pressed; the About panel offers "← About <facet>".

**Summary** (`summary.ts`) is as short as it can be without becoming
ambiguous, because it is often cut off (maintainers, 2026-10-27):
- `<Facet> has <field> <op> <value>`; with two or more set fields, in
  brackets: `Battery pack has (cell_temp > 40 AND charge_level between (20, 80))`. The
  brackets are the one addition to the maintainers' wording: without them, an
  AND inside a block (same occurrence) reads like the AND between two blocks,
  and "has no" would seem to cover only the first field.
- Has no: `Battery pack has no (…)` / `has no cell_temp > 40`.
- Nothing set: `Battery pack present` / `Battery pack absent`.
- Operators as symbols or one word: `=`, `≠`, `>`, `≥`, `<`, `≤`, `before`,
  `after`, `contains`, `in (a, b)`, `not in (a, b)`, `between (20, 80)`
  (not `20–80`, which can read as "twenty minus eighty"), and
  `cell_temp present` / `absent` for the field-level tests.
- Groups join blocks with AND / OR and are bracketed as today; an unfinished
  value shows as `(value?)` as today.

## 6. Co-occurrence

**Data**: each `IndividualResponse` gains `co_occurrence: { [facet label]:
string }`, the percentage of this facet's events that also hold the other
facet, as text so scientific notation works (`"1.2e-20"`; JavaScript numbers
reach about 1e-308). `response.ts` reads it into `Facet.coOccurrence`
(`Map<facetId, number>`). Display data, never required: a missing map, or a
value that is not a number from 0 to 100, is left out with a console warning;
ids of unknown facets are left out with **one warning per facet listing
them**. The mock computes the map from its sample events at startup.

**Values too small for a JavaScript number.** The smallest positive number is
about `5e-324`; `Number("1e-400")` gives `0`, which would silently turn "seen
together, very rarely" into "never". The reader treats a text that is not a
zero but parses to `0` as **too rare to colour**: it keeps the flag (and the
original text), logs one console warning per facet listing them, and
leaves those values **out of the colour range and the square pie chart's
sizes**. Clamping them to `5e-324` instead was rejected: one such value would
stretch the log scale over 300 powers of ten and squash every real value into
the dark end. On screen such a cell is an **empty box with a dot** (seen
together, but no colour exists for it); in the square pie chart it joins
"+ N less often". Hover always shows the original text from the backend
(`"1e-400 %"`), never a re-formatted number, so nothing is lost or rounded.

**Pure functions** (Node-tested):
- `connectedFacets(facets)`: facets with a value above 0 for some other facet,
  in either direction, their own value not counted; dictionary order.
- `coOccurrenceRange(facets)`: smallest non-zero and largest value in the
  whole matrix (the facet's own value excluded).
- `coOccurrenceColour(value, range, stops)`: position on a log scale between
  the range ends, blended between the two neighbouring stops in OKLCH.
- `dotColour(background)`: dark or light, whichever contrasts more.
- `squarify(values, width, height)`: the square pie chart's rectangles.
- `labelFits(name, rect)`: whether a box shows its name.

**Top row**: 11 px cells in a wrapping row, the same facets in the same order
in every block. A dot on every cell above 0, the gradient behind it; never
seen together: plain grey, no dot; this block's facet: a round mustard mark;
too rare to colour: an empty box with a dot.

**Legend** (it must make the row and the square pie chart readable to a
first-time user): one sentence saying what is measured ("How often each facet
is seen together with <facet>: the share of <facet>'s events that also hold
it"); the blended colour bar built from the same stops, labelled at each stop
with the actual values of the range (`1e-12 %` … `100 %`) and "rarer" / "more
often" at the ends, with "log scale: each step is about N times more often"
(N computed from the range); and keys for all four marks: seen together,
never seen together, the facet itself, too rare to colour. Tick labels are
computed by a pure function (`legendTicks(range, stopCount)`).

**Where the legend is shown** (maintainers, 2026-10-27): only in a popover,
from a small "?" button at the end of **every** block's row, the first block
included; never as a permanent legend, to keep the builder compact. The
sentence names that block's facet. The button has an accessible name
("Explain the colours"); click or Enter opens it, Escape or a click outside
closes it and returns the focus to the button. It is a Fomantic popup, so it
lives in `src/ui/fomantic.ts` like every other jQuery call. The Seen together
tab has the same "?" next to its tabs, because the square pie chart uses the
same colours.

One tab stop, arrow keys move;
hover and focus show name and value; click or Enter opens the dictionary at
that facet (opening it if folded, scrolling, expanding and highlighting it;
closing it returns the focus to the cell; under 1100 px it floats as today).

**Seen together tab**: `squarify` over this facet's non-zero values, area
proportional to value, the same gradient as the row. Boxes under about 12 px
merge into one "+ N less often" box whose hover lists them. Labels only where
the whole name fits. Boxes reachable with the arrow keys; click or Enter opens
the dictionary at that facet, like a cell.

**About tab**: the facet's description, comment, tags, group and fields, or the
selected field's docs, using the dictionary's existing renderers.

## 7. Palette and contrast

New `:root` tokens in `src/styles.css`, beside the pickle palette:
`--qb-cooc-stop-1` … `--qb-cooc-stop-N` (N ≥ 2, read in order until one is
missing), `--qb-cooc-never`, `--qb-cooc-own`, `--qb-cooc-dot-dark`,
`--qb-cooc-dot-light`. The square pie chart uses the same stops. Opaque
`#rrggbb` only, as `tests/themeContrast.test.ts` requires. The test gains:
every stop, the never grey and the own mark against the card (3:1, WCAG
1.4.11); the dot against each stop and the blend midpoints (3:1); box labels
against their box (4.5:1). The own mark must be darker than the mockup's
`#EF9F27` (2.2:1 on white); about `#BA7517` passes.

## 8. Out of scope here

- Preferences and dark mode (decision 19).
- The dictionary sidebar's wider rethink (decision 20).
- The "Open does nothing after a restart" report: not reproduced against the
  mock; waiting on the maintainers' Start fresh check and console output.
- Migrating old saved or kept queries (decision 9).

## 9. Testing

- Node: block edits in `tree.ts`, `validate.ts` (unknown facet, unknown
  field, wrong value type, `not_in`, empty root vs empty group), the wire
  projection both ways, the saved shape, `response.ts` reading
  `co_occurrence` with every warning case, the section 6 functions, the
  mock's per-occurrence matching (`rows.ts` / `evaluate.ts`) including
  has-no, and the new contrast pairs.
- Chromium (Playwright, realistic clicks) at 1280 and 512 px: add by drop and
  by "+ Facet", set and clear a field, fold and unfold, hide and show the
  panel, select a field and Escape, keyboard through the top row and the
  square pie chart, a cell opening the dictionary, the legend popover in the
  first and a later block (open, Escape, focus back), save and open.

## 10. Order of work

One branch, committed in stages, because the old builder cannot run on the
new model:
1. Model, wire format, validation, saved shape, mock (per occurrence, `not_in`,
   `co_occurrence`).
2. The builder: blocks, rows, unset buttons, folding, moving, adding.
3. Panel, tabs, co-occurrence row, square pie chart, palette tokens.
4. Dictionary "open at facet", docs update, browser checks.

`docs/ARCHITECTURE.md` changes with the code: "The query model", "Wire format
of the query", "Saved queries", "Centre — `queryBuilder.ts`", "Left —
`docsSidebar.ts` (data dictionary)", "Mock server", "Pickle theme and mascot"
(the new tokens and the mascot rule for the empty start), "Screen layout".
Headings keep their titles (`tests/docReferences.test.ts`).
