/**
 * Display settings meant to be edited by hand — the ONLY place the frontend
 * may name anything from the backend's data (facets, fields, tags, groups).
 * Everything else learns those names at runtime from GET /api/individuals.
 * Every setting about the data defaults to empty, so the app works against any
 * dataset. (The mascot and the easter-egg toast below are not backend data.)
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

/**
 * The pickle mascot's artwork. Replace the files in public/pickle/ (same
 * names) to change it; no code change is needed. `loading` falls back to
 * `neutral` if its file is missing.
 */
export const MASCOT = {
  neutral: "/pickle/logo.svg",
  disappointed: "/pickle/disappointed.svg",
  loading: "/pickle/loading.svg",
} as const;

/**
 * Who wrote a text in the data dictionary. Each description starts with a
 * small logo, and the label is its hover text and its text for screen readers
 * (users found the words "Third-party:" confusing, 2026-10-13).
 *
 * - `ours`: the backend's own, always-correct `comment`. By default the app's
 *   own logo (`MASCOT.neutral`), so a deployment that replaces that file gets
 *   its logo here too.
 * - `thirdParty`: the third party's `description` and group, which may
 *   contain errors (one label for both: it is one source).
 *   A neutral placeholder by default: put the company's logo in
 *   public/sources/third-party.svg (same rules as the mascot files: a
 *   self-contained plain SVG), or point `logo` at another file in public/,
 *   and name the company in `label`.
 */
export const TEXT_SOURCES = {
  ours: { logo: "/pickle/logo.svg", label: "Our description" },
  thirdParty: {
    logo: "/sources/third-party.svg",
    label: "Third-party text; may contain errors",
  },
} as const;

export type TextSource = keyof typeof TEXT_SOURCES;

/**
 * The hidden second set of faces: five clicks on the logo switch to it (and
 * five more switch back), for this page load only. Replace the files in
 * public/pickle/ to change it. Same keys and fallbacks as `MASCOT`: a face
 * whose file is missing falls back to this set's `neutral`, then to
 * `MASCOT.neutral`.
 */
export const EASTER_EGG_MASCOT = {
  neutral: "/pickle/egg-logo.svg",
  disappointed: "/pickle/egg-disappointed.svg",
  loading: "/pickle/egg-loading.svg",
} as const;

/** Shown (instead of the falling pickles) for people who prefer reduced motion. */
export const EASTER_EGG_TOAST = "I'm Pickle Rick!";
