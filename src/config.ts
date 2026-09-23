/**
 * Display settings meant to be edited by hand — the ONLY place the frontend
 * may name anything from the backend's data (items, fields, tags, groups).
 * Everything else learns those names at runtime from GET /api/individuals.
 * Every setting defaults to empty, so the app works against any dataset.
 */

/**
 * Tags and third-party groups never shown as badges on the Matching entrysets
 * rows — for values that appear on nearly every entryset and so say nothing
 * about any one of them. Matched against the backend's spelling, ignoring case
 * and surrounding whitespace. Hiding a value hides only that badge: the item's
 * other tags and group still count. The data dictionary is not affected.
 *
 * Example: `tags: ["some_tag"], groups: ["some_group", "another_group"]`.
 */
export const HIDDEN_ROW_BADGES: { tags: string[]; groups: string[] } = {
  tags: [],
  groups: [],
};

/** One extra column on each Matching entrysets row: the value an entryset
 *  holds for `item.field` (an Individual's `label` and one of its fields'
 *  `label`). */
export interface RowColumn {
  /** Shown when hovering the cell ("Recorded: …"). */
  heading: string;
  item: string;
  field: string;
  /** "datetime" formats an ISO timestamp in the viewer's locale; "text"
   *  (default) shows the value as-is. */
  format?: "text" | "datetime";
}

/**
 * Columns shown on each Matching entrysets row between the entryset id and
 * its badges, in order. A row missing the value shows "—". Empty by default:
 * rows then show just the id, badges and item count.
 *
 * Example:
 *   [{ heading: "Recorded", item: "some_item", field: "start_time", format: "datetime" },
 *    { heading: "Source", item: "other_item", field: "kind" }]
 */
export const ROW_COLUMNS: RowColumn[] = [];
