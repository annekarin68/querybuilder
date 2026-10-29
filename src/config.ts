/**
 * Display settings meant to be edited by hand — the ONLY place the frontend
 * may name anything from the backend's data (facets, fields, tags, groups).
 * Everything else learns those names at runtime from GET /api/documentation/individuals.
 * Every setting about the data defaults to empty, so the app works against any
 * dataset. (The mascot and the easter-egg toast below are not backend data.)
 */

/**
 * The digit grouping and decimal mark of every number on screen (a BCP 47
 * locale): "nb-NO" writes "12 345" and "28,86". Only the marks: the words
 * stay English ("1,2 billion"), as all text in the app is English.
 */
export const NUMBER_LOCALE = "nb-NO";

/**
 * Facets shown first in the Matching events table, right after the event id,
 * in this order (`Facet.id`, the backend's label). The other facets follow by
 * facet number. A listed facet that no result holds gets no column. Empty by
 * default: then every column is ordered by facet number.
 *
 * Example: ["some_facet", "other_facet"]
 */
export const FIRST_COLUMNS: string[] = [];

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
  ours: { logo: MASCOT.neutral, label: "Our description" },
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

/** A short toast shown together with the rain when the easter-egg set turns on. */
export const EASTER_EGG_TOAST = "I'm Pickle Rick!";
