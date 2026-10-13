import type { AppState } from "../state";

export type MascotState = "neutral" | "disappointed" | "loading";

type MascotInputs = Pick<AppState, "issues" | "stats" | "preview">;

/**
 * Which face the logo pickle shows (docs/ARCHITECTURE.md, "Pickle theme and
 * mascot"):
 * - busy while statistics or Matching events load;
 * - disappointed when something went wrong or nothing was found (`letDown`);
 * - neutral otherwise, also while the query is merely unfinished: every query
 *   starts as a blank row, and a pickle that is sad from page load would mean
 *   nothing (maintainers' decision, 2026-10-13).
 */
export function mascotFor(s: MascotInputs): MascotState {
  if (s.stats.status === "loading" || s.preview.status === "loading") return "loading";
  return letDown(s) ? "disappointed" : "neutral";
}

/**
 * The query is invalid (a red message); a request failed; a database failed
 * or found a problem in the query (a failed result: `serverIssues` come from
 * those, so they need no check of their own); or the query matches nothing.
 */
function letDown({ issues, stats, preview }: MascotInputs): boolean {
  if (issues.some((i) => i.kind === "invalid")) return true;
  if (stats.status === "error" || preview.status === "error") return true;
  if (preview.status === "ok" && preview.events.length === 0) return true;
  if (stats.status !== "ok") return false;
  if (stats.results.some((r) => r.status === "failed")) return true;
  // No database answered at all is not "found nothing": `every` would say yes
  // for an empty list, so ask for at least one answer.
  return (
    stats.results.length > 0 && stats.results.every((r) => r.status === "ok" && r.matchCount === 0)
  );
}
