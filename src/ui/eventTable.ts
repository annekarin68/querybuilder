import type { EventRecord, Facet } from "../model";

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
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1; // a known facet before an unknown one
    if (nb !== undefined) return 1;
    return a.localeCompare(b);
  });
  return ids.map((id) => {
    const facet = byId.get(id);
    return {
      facetId: id,
      name: facet?.name ?? id,
      resultCount: counts.get(id) ?? 0,
      fields: facet ? facet.fields.map((f) => ({ id: f.id, name: f.name })) : [],
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
  const known = new Set(column.fields.map((f) => f.id));
  return (event.values[column.facetId] ?? []).map((occurrence) => [
    // `in` would also find names every object inherits ("constructor",
    // "toString"), so a field with such an id would show JavaScript internals
    // instead of being treated as missing. Object.hasOwn checks only the
    // occurrence's own keys.
    ...column.fields
      .filter((f) => Object.hasOwn(occurrence, f.id))
      .map((f) => ({ name: f.name, value: String(occurrence[f.id]) })),
    ...Object.keys(occurrence)
      .filter((key) => !known.has(key))
      .sort()
      .map((key) => ({ name: key, value: String(occurrence[key]) })),
  ]);
}
