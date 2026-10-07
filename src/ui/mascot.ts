import type { AppState } from "../state";

export type MascotState = "neutral" | "disappointed" | "loading";

/**
 * Which face the logo pickle shows: busy while results load, disappointed
 * while the query is invalid (a red message — a merely unfinished query is
 * not a mistake), neutral otherwise.
 */
export function mascotFor(s: Pick<AppState, "issues" | "stats" | "preview">): MascotState {
  if (s.stats.status === "loading" || s.preview.status === "loading") return "loading";
  if (s.issues.some((i) => i.kind === "invalid")) return "disappointed";
  return "neutral";
}
