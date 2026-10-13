# Matching events as a table — design

Date: 2026-10-13. Status: approved in conversation section by section; awaiting
the maintainers' review of this written version.

Branch `claude/matching-events-table`, started on top of
`claude/user-feedback-round` (not merged yet); it moves onto `main` once that
is merged. Every code change updates `docs/ARCHITECTURE.md` in the same commit
(never rename its headings).

## Why

`POST /filter/execute` now returns a **random sample of up to 2,000** matching
events. The users asked to see the facets **as columns of a table**, to compare
values across events, and accept a horizontal scroll bar for it. This reverses
the recorded decision "a list, not a grid" in "Under the query —
`dataPreview.ts` (Matching events)": it is recorded there as **decided
2026-10-13 by the users: a table, not a list**.

Out of scope (decided): one column per *field* (that belongs in a later, separate
**Event viewer** for single events); sorting, filtering or resizing columns;
virtual scrolling. Keep it simple: a plain HTML table, plain CSS, no new
dependency (approach A of three; a `<div>` grid loses table semantics and
alignment, a data-grid library is a large dependency that fights `paint()`).

## What the user sees

After **Run query**, the Matching events card shows:

- **"Events 101–200 of 1,987"** with **Previous** / **Next**. Pages hold **100
  rows**. With 100 events or fewer the line just says "42 events" and there
  are no paging buttons.
- **A scroll box** (both directions, at most about 70% of the window high)
  holding the table. Its **header row is sticky**: it stays visible while the
  user scrolls down, and moves sideways together with its columns, so a value
  never loses its header. The **event id column is pinned** on the left the
  same way.
- **Columns:**
  1. **Event id** (pinned): the shortened id (`shortId`, first 8 characters). It
     is a button; pressing it opens the event's JSON in a dialog.
  2. **One column per facet that occurs in the sample** (in at least one of all
     the returned events, not only the current page, so the columns stay the
     same while paging). Order: the facets listed in `FIRST_COLUMNS`
     (`src/config.ts`, in that order), then the rest by **facet number
     ascending** (the backend's `id_number`); a facet that is in an event but
     not in the data dictionary comes last, by its label.
- **Header cell:** the facet's name, and under it, small and muted, **"in N
  events"** (N counted over the whole sample), so a mostly empty column is
  recognised at once. The count is information only; it does not decide the
  order.
- **Cell:** empty when the event lacks the facet. Otherwise **one boxed set per
  occurrence** of the facet in the event, each set listing `field: value`
  lines, e.g. `position: right` / `value: 2.2`. Several occurrences are separate
  boxes, stacked, so a value is only ever read together with the values of its
  own occurrence ("right" with "2.2", never with "1.1"). Within a set the fields
  follow the **dictionary's field order** (so a facet looks the same in every
  row), named by the dictionary's field name; fields the dictionary does not
  know come after, by their key. Values show as text exactly as sent; long
  values **wrap** inside a maximum cell width, never cut off. A set with no
  values shows "—".

**Removed:** the tag and group badges on each event (and `HIDDEN_ROW_BADGES`).
`ROW_COLUMNS` becomes **`FIRST_COLUMNS: string[]`** (facet ids shown first);
its per-field columns and their `datetime` formatting go. Both settings ship
empty, so nothing changes by default.

Unchanged: the Run query button and its notes, the loader, the error with
**Try again**, the announcements, and resetting the panel on every query or
database change ("Correctness invariant").

## How it is built

**Pure helpers, Node-tested — `src/ui/eventTable.ts`:**

- `tableColumns(events, facets, firstColumns)` → the ordered facet columns, each
  `{ facetId, name, eventCount, fields }` (`fields` in dictionary order).
- `cellSets(event, column)` → the facet's occurrences in one event, each a list
  of `{ name, value }` in the column's field order, unknown keys after, `null`
  dropped.
- `pageOf(total, page, size)` → the clamped page and its row range (`from`,
  `to`, `pageCount`) for "Events 101–200 of 1,987".
- `eventTableHtml(events, columns, page)` → the table's HTML string (everything
  escaped), like every other panel.

**Model:** `Facet` gains `number: number` from `IndividualResponse.id_number`
(`toFacet`, `src/api/response.ts`; a required `number` read). The doc's "only
what the app uses is mapped" note loses `id_number` from its list of unmapped
keys.

**State (`src/state.ts`):**

- The page lives in the successful preview: `preview: { status: "ok", events,
  page }` (0-based). Every new run starts at page 0, and every query or
  database change resets `preview` as today, so a stale page cannot survive.
- `openEventId: string | null`: the event whose JSON dialog is open.

**Actions (`src/app.ts`):** `showEventPage(page)` (clamps; announces "Showing
events 101 to 200 of 1,987."), `openEvent(id)`, `closeEvent()`.

**Dialog:** a second native `<dialog>` created once by `renderShell`, painted
by a small `renderEventDialog` (heading "Event 6f1c2a9e…", the event's JSON in
a scrollable `<pre>`, **Close**), opened and closed to match `openEventId`, in
the pattern of the saved-queries dialog (Escape and a close the state did not
ask for both call `closeEvent`; closing returns the focus to the id button
that opened it). It is where the later Event viewer can plug in.

**`src/ui/dataPreview.ts`:** keeps Run query and its states; the `"ok"` branch
renders the paging line, the scroll box and `eventTableHtml`. `eventBadges`,
`rowGrid`, `rowCell` and `fieldValues` go if nothing else uses them.

**`src/main.ts`:** the preview row of `panelRenderers` keeps its keys (it reads
`facets` for names and `preview` for page); a new row renders the event dialog
on `openEventId` / `preview`; wiring for Previous / Next / id buttons is
delegated in `wireDataPreview`.

**CSS (`src/styles.css`, tokens only):** the scroll box (`overflow: auto`,
`max-height` about 70vh), `position: sticky; top: 0` on header cells,
`position: sticky; left: 0` on the id column (the corner cell above both), an
opaque background on sticky cells so scrolled content does not show through,
the set boxes, and the maximum cell width with wrapping
(`overflow-wrap: anywhere`).

**Size:** one page is at most 100 rows × the facets that occur — a few thousand
cells, painted once per page change. The sticky header and column are CSS only.

## Edge cases

- No events: "No events match this query." (as today).
- A `FIRST_COLUMNS` facet that does not occur in the sample: no column.
- An event facet missing from the dictionary: a column at the end, headed by
  its label; its fields named by their keys.
- `null` values are dropped; numbers and booleans show as text; an occurrence
  with no values shows "—".
- A page number out of range (a stale click) is clamped.

## Accessibility

- A real `<table>`: a visually hidden `<caption>` ("Matching events, page 2 of
  20"); facet headers are `<th scope="col">`; each row's id cell is its
  `<th scope="row">`, holding the button "Show event 6f1c2a9e… as JSON".
- A set is a `<dl>` (field → value); several sets in one cell are a `<ul>`, so
  a screen reader reads them as separate sets.
- The scroll box is focusable (`tabindex="0"`, `role="region"`, labelled
  "Matching events table") so it scrolls from the keyboard.
- Previous / Next are real buttons; the dialog closes on Escape and returns the
  focus to the opener; "Keyboard focus across repaints" gains the new controls
  (`data-action` on the paging buttons, `data-id` on the id buttons).

## Testing

- **Node:** `tableColumns` (order: `FIRST_COLUMNS`, then facet number, unknown
  facets last; only occurring facets; counts over the whole sample),
  `cellSets` (dictionary field order, unknown keys after, occurrences kept
  apart, `null` dropped, empty set), `pageOf` (bounds, clamping, totals),
  `eventTableHtml` (escaping, sets as separate `<dl>`s, header counts, caption,
  row headers), `toFacet` (`number` from `id_number`), `app` (`showEventPage`
  clamps and announces; a new run and a query edit reset the page;
  `openEvent` / `closeEvent`).
- **Chromium (Playwright, private ports):** a synthetic 2,000-event answer
  served through `page.route` (the mock has 21 events): the header stays put
  while scrolling down and moves with its columns while scrolling sideways, the
  id column stays pinned, paging is quick, the dialog opens, closes on Escape
  and returns the focus, and a 512 px window works.

## Docs

`docs/ARCHITECTURE.md`: "Under the query — `dataPreview.ts` (Matching events)"
rewritten, with the decision replaced as above; "Data model" (`Facet.number`);
"Directory layout" (`eventTable.ts`; `config.ts` settings); "State and the
render loop" (`preview.page`, `openEventId`, the triggers table); "Keyboard
focus across repaints" (new controls and landings); "How do I… hide a badge, or
add a column" becomes "…show certain facets first?" (`FIRST_COLUMNS`).
