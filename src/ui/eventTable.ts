import type { EventRecord, Facet } from "../model";
import { countLabel, exact } from "./format";
import { escapeHtml } from "./panel";
import type { Page } from "../util/paging";

/**
 * The Matching events table (docs/ARCHITECTURE.md, "Under the query —
 * `dataPreview.ts` (Matching events)"): which facet columns it has, and what
 * each cell holds. Pure, so it is tested in Node; dataPreview.ts paints it.
 */

/** One facet column of the table. */
export interface FacetColumn {
  facetId: string;
  /** The dictionary's name; the id for a facet the dictionary does not know. */
  name: string;
  /** How many results (events of the sample) hold this facet. */
  resultCount: number;
  /** The facet's fields in dictionary order. Empty for an unknown facet. */
  fields: { id: string; name: string }[];
  /** The ids of `fields`, built once per column (not once per cell) for `cellSets`. */
  knownFieldIds: Set<string>;
}

/** One field value inside a set. */
export interface CellEntry {
  name: string;
  value: string;
}

/** The start of a long event id (a GUID has 36 characters). The id button's
 *  tooltip and the event's JSON show the whole id. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Ids in code order (plain `<`), not `localeCompare`: the columns must come
 *  out the same on every machine, whatever language the viewer's browser uses. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The table's facet columns: one per facet that at least one result holds,
 * counted over the whole sample so the columns stay the same from page to
 * page. Order: `firstColumns` (src/config.ts `FIRST_COLUMNS`) in their order,
 * then by facet number; a facet the dictionary does not know comes last, by
 * id (maintainers' decision, 2026-10-13).
 */
export function tableColumns(
  events: EventRecord[],
  facets: Facet[],
  firstColumns: string[],
): FacetColumn[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const [facetId, occurrences] of Object.entries(event.values)) {
      if (occurrences.length > 0) counts.set(facetId, (counts.get(facetId) ?? 0) + 1);
    }
  }
  const byId = new Map(facets.map((f) => [f.id, f]));
  // Not listed: after every listed facet.
  const listed = (id: string) => {
    const i = firstColumns.indexOf(id);
    return i === -1 ? firstColumns.length : i;
  };
  const ids = [...counts.keys()].sort((a, b) => {
    if (listed(a) !== listed(b)) return listed(a) - listed(b);
    const na = byId.get(a)?.number;
    const nb = byId.get(b)?.number;
    // Equal numbers (a backend quirk) fall back to the id, so the order never depends on event order.
    if (na !== undefined && nb !== undefined) return na - nb || compareIds(a, b);
    if (na !== undefined) return -1; // a known facet before an unknown one
    if (nb !== undefined) return 1;
    return compareIds(a, b);
  });
  return ids.map((id) => {
    const facet = byId.get(id);
    const fields = facet ? facet.fields.map((f) => ({ id: f.id, name: f.name })) : [];
    return {
      facetId: id,
      name: facet?.name ?? id,
      resultCount: counts.get(id) ?? 0,
      fields,
      knownFieldIds: new Set(fields.map((f) => f.id)),
    };
  });
}

/**
 * What one cell shows: one set per occurrence of the column's facet in the
 * event, so values that belong together are never mixed with another
 * occurrence's ("right" stays with 2.2, "left" with 1.1). In a set, the fields
 * follow the dictionary's order, so a facet looks the same in every row; keys
 * the dictionary does not know come after, sorted. Values are text, exactly
 * as sent (`null` never reaches here: toEvent drops it).
 */
export function cellSets(event: EventRecord, column: FacetColumn): CellEntry[][] {
  // Checked with hasOwn: a plain `??` would take a built-in such as
  // "constructor" from Object.prototype for an event that lacks the facet.
  const occurrences = Object.hasOwn(event.values, column.facetId)
    ? event.values[column.facetId]!
    : [];
  return occurrences.map((occurrence) => [
    // `in` would also find names every object inherits ("constructor",
    // "toString"), so a field with such an id would show JavaScript internals
    // instead of being treated as missing. Object.hasOwn checks only the
    // occurrence's own keys.
    ...column.fields
      .filter((f) => Object.hasOwn(occurrence, f.id))
      .map((f) => ({ name: f.name, value: String(occurrence[f.id]) })),
    ...Object.keys(occurrence)
      .filter((key) => !column.knownFieldIds.has(key))
      .sort()
      .map((key) => ({ name: key, value: String(occurrence[key]) })),
  ]);
}

/** One cell: nothing when the result lacks the facet; otherwise one set per
 *  occurrence, each a small definition list, all in a list, so a screen
 *  reader reads them as separate sets too. `role="list"` because
 *  `list-style: none` (styles.css) makes Safari / VoiceOver drop the list. */
function cellHtml(sets: CellEntry[][]): string {
  if (sets.length === 0) return "";
  const setHtml = (set: CellEntry[]) =>
    set.length === 0
      ? `<span class="qb-et-empty">—</span>`
      : `<dl class="qb-et-set">${set.map((e) => `<dt>${escapeHtml(e.name)}</dt><dd>${escapeHtml(e.value)}</dd>`).join("")}</dl>`;
  return `<ul class="qb-et-sets" role="list">${sets.map((set) => `<li>${setHtml(set)}</li>`).join("")}</ul>`;
}

/** The one hidden sentence every id button points to (`aria-describedby`):
 *  the button's name is its visible text (#6f1c2a9e…), so what it does is a
 *  description, said once instead of once per row. */
const ID_HINT_ID = "qb-et-id-hint";

/**
 * The table for one page of the results, in its scroll box. The header row
 * and the id column are sticky (styles.css): the headers stay in view while
 * the user scrolls down and move with their columns sideways, so a value
 * never loses its header (maintainers, 2026-10-13). Every text is escaped.
 */
export function eventTableHtml(
  events: EventRecord[],
  columns: FacetColumn[],
  page: Page,
  locale?: string,
): string {
  const caption =
    page.pageCount > 1
      ? `Matching events, page ${page.page + 1} of ${page.pageCount}`
      : "Matching events";
  const total = exact(page.total, locale);
  const head = columns
    .map(
      (c) =>
        `<th scope="col"><span class="qb-et-facet">${escapeHtml(c.name)}</span><span class="qb-et-count">in ${exact(c.resultCount, locale)} of ${total} results</span></th>`,
    )
    .join("");
  const rows = events
    .slice(Math.max(0, page.from - 1), page.to)
    .map((e) => {
      const id = escapeHtml(e.id);
      const short = escapeHtml(shortId(e.id));
      const cells = columns.map((c) => `<td>${cellHtml(cellSets(e, c))}</td>`).join("");
      return `<tr><th scope="row" class="qb-et-id"><button type="button" class="qb-et-id-btn" data-action="open-event" data-event-id="${id}" aria-describedby="${ID_HINT_ID}" title="Event ${id}">#${short}</button></th>${cells}</tr>`;
    })
    .join("");
  return `<div class="qb-et-scroll" tabindex="0" role="region" aria-label="Matching events table"><table class="qb-et"><caption class="qb-sr-only">${caption}</caption><thead><tr><th scope="col" class="qb-et-id">Event</th>${head}</tr></thead><tbody>${rows}</tbody></table></div><span id="${ID_HINT_ID}" class="qb-sr-only">Opens this result's JSON.</span>`;
}

/**
 * The line above the table: "42 results" when they fit on one page,
 * otherwise "Results 101–200 of 1,987" with Previous and Next. "Results" is
 * the one word for the returned sample, so nobody reads a count as a total
 * across all databases (maintainers, 2026-10-13). The two buttons have their
 * own `data-action`, so a repaint keeps the keyboard focus on the one pressed.
 */
export function pagingHtml(page: Page, locale?: string): string {
  if (page.pageCount === 1) {
    return `<p class="qb-et-paging">${countLabel(page.total, "result", "results", locale)}</p>`;
  }
  // aria-disabled, not disabled: the button stays focusable, so pressing Next
  // on the last page does not throw the keyboard focus out of the card
  // (the click handler in dataPreview.ts ignores it).
  const first = page.page === 0 ? ' aria-disabled="true"' : "";
  const last = page.page === page.pageCount - 1 ? ' aria-disabled="true"' : "";
  return `<div class="qb-et-paging">
    <span>Results ${exact(page.from, locale)}–${exact(page.to, locale)} of ${exact(page.total, locale)}</span>
    <button type="button" class="ui mini basic button" data-action="previous-event-page" data-page="${page.page - 1}"${first}>Previous</button>
    <button type="button" class="ui mini basic button" data-action="next-event-page" data-page="${page.page + 1}"${last}>Next</button>
  </div>`;
}

/**
 * Where the table's scroll box should be after a repaint. The box is rebuilt
 * on every repaint of the panel (a collapsed builder group, a login, … also
 * repaint it), which would send it back to the top left. On the page that was
 * on screen both offsets are kept; on another page only the sideways one, so
 * a user who follows one facet across pages keeps their column in view and
 * every page starts at its first row (maintainers, 2026-10-13).
 * `before` is null when no table was on screen.
 */
export function scrollAfterRepaint(
  before: { left: number; top: number } | null,
  samePage: boolean,
): { left: number; top: number } {
  if (!before) return { left: 0, top: 0 };
  return { left: before.left, top: samePage ? before.top : 0 };
}
