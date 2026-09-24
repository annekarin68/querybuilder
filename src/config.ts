/**
 * Display settings meant to be edited by hand — the ONLY place the frontend
 * may name anything from the backend's data (facets, fields, tags, groups).
 * Everything else learns those names at runtime from GET /api/individuals.
 * Every setting defaults to empty, so the app works against any dataset.
 */

/**
 * Tags and third-party groups never shown as badges on the Matching events
 * rows — for values that appear on nearly every event and so say nothing
 * about any one of them. Matched against the backend's spelling, ignoring case
 * and surrounding whitespace. Hiding a value hides only that badge: the facet's
 * other tags and group still count. The data dictionary is not affected.
 *
 * Example: `tags: ["some_tag"], groups: ["some_group", "another_group"]`.
 */
export const HIDDEN_ROW_BADGES: { tags: string[]; groups: string[] } = {
  tags: [],
  groups: [],
};

/** One extra column on each Matching events row: the value an event
 *  holds for `facet.field` (a `Facet.id` and one of its fields' `Field.id` —
 *  the backend's labels for them). */
export interface RowColumn {
  /** Shown when hovering the cell ("Recorded: …"). */
  heading: string;
  facet: string;
  field: string;
  /** "datetime" formats an ISO timestamp in the viewer's locale; "text"
   *  (default) shows the value as-is. */
  format?: "text" | "datetime";
}

/**
 * Columns shown on each Matching events row between the event id and
 * its badges, in order. A row missing the value shows "—". Empty by default:
 * rows then show just the id, badges and facet count.
 *
 * Example:
 *   [{ heading: "Recorded", facet: "some_facet", field: "start_time", format: "datetime" },
 *    { heading: "Source", facet: "other_facet", field: "kind" }]
 */
export const ROW_COLUMNS: RowColumn[] = [];
