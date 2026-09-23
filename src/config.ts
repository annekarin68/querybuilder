/**
 * Display settings meant to be edited by hand. Values are matched against the
 * backend's own spelling (as in GET /api/individuals), ignoring case and
 * surrounding whitespace.
 */

/**
 * Tags and third-party groups never shown as badges on the Matching entrysets
 * rows — for values that appear on nearly every entryset and so say nothing
 * about any one of them. Hiding a value hides only that badge: the item's
 * other tags and group still count. The data dictionary is not affected.
 *
 * Example: `tags: ["deprecated"], groups: ["identity", "timing"]`.
 */
export const HIDDEN_ROW_BADGES: { tags: string[]; groups: string[] } = {
  tags: [],
  groups: [],
};
