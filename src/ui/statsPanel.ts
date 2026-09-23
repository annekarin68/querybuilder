import type { AppState } from "../state";
import type { DatabasesResponse, StatsResponse } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, countLabel, exact, matchRatio } from "./format";

/** GET /api/databases is loaded once into AppState.databases; a stats line only
 * carries a `label`, so its display name and totalEntrysets are looked up here
 * rather than resent on every line. */
function databaseFor(
  databases: DatabasesResponse[] | null,
  label: string,
): DatabasesResponse | undefined {
  return databases?.find((d) => d.label === label);
}

function bar(match: number, total: number): string {
  return `<span class="qb-bar"><i style="width:${barWidth(match, total)}"></i></span>`;
}

function messagesHtml(list: string[] | undefined, cls: string): string {
  return list?.length ? `<span class="${cls}">${list.map(escapeHtml).join(" · ")}</span>` : "";
}

function successRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const total = db?.totalEntrysets ?? 0;
  const matchCount = line.matchCount ?? 0;
  return `<div class="qb-db-row" title="${escapeHtml(name)}: ${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${bar(matchCount, total)}
    <span class="qb-db-ratio">${escapeHtml(matchRatio(matchCount, total))}</span>
    ${messagesHtml(line.infoMessages, "qb-db-msg")}
  </div>`;
}

function failureRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const errors = line.errorMessages?.length
    ? messagesHtml(line.errorMessages, "qb-db-msg qb-db-error")
    : `<span class="qb-db-msg qb-db-error">Failed.</span>`;
  return `<div class="qb-db-row is-failed">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${errors}
    ${messagesHtml(line.infoMessages, "qb-db-msg")}
  </div>`;
}

/** One row per database that has reported so far — success (ratio + bar),
 * failure (errorMessages in red, infoMessages beneath) — as each streamed line
 * arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<h3 class="qb-stat-subtitle">By database</h3>
    <div class="qb-stat-perdb">
      ${lines
        .map((line) => {
          const db = databaseFor(state.databases, line.label);
          return line.success ? successRowHtml(line, db) : failureRowHtml(line, db);
        })
        .join("")}
    </div>`;
}

/**
 * The combined headline sums only the databases that succeeded. A failed
 * database has no count at all (StatsResponse.matchCount is deliberately
 * optional), so the headline must never present failures as "0 matched": with
 * no successes yet it shows no number, and when some failed it says the total
 * excludes them.
 */
export function headlineHtml(state: AppState): string {
  const { lines, status } = state.stats;
  const succeeded = lines.filter((l) => l.success);
  const failed = lines.length - succeeded.length;
  const failedNote =
    failed > 0
      ? `<div class="qb-stat-failed">Excludes ${failed} database${failed === 1 ? "" : "s"} that failed (see below).</div>`
      : "";
  if (succeeded.length === 0) {
    const text =
      status === "loading" ? "No results yet." : "No database returned a result for this query.";
    return `<div class="qb-stat-headline"><p class="qb-stat-sub">${text}</p></div>`;
  }
  const matchCount = succeeded.reduce((s, l) => s + (l.matchCount ?? 0), 0);
  const total = succeeded.reduce(
    (s, l) => s + (databaseFor(state.databases, l.label)?.totalEntrysets ?? 0),
    0,
  );
  return `<div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
    <div class="qb-stat-label">matching entrysets</div>
    <div class="qb-stat-sub">${escapeHtml(matchRatio(matchCount, total))} of ${escapeHtml(compact(total))}</div>
    ${bar(matchCount, total)}
    ${failedNote}
  </div>`;
}

/** While loading, how many selected databases haven't reported a line yet. */
function pendingHtml(state: AppState): string {
  if (state.stats.status !== "loading") return "";
  const remaining = state.selectedDatabaseIds.length - state.stats.lines.length;
  if (remaining <= 0) return "";
  return `<div class="qb-stat-pending"><span class="ui active mini inline loader"></span>Waiting on ${countLabel(remaining, "more database", "more databases")}…</div>`;
}

function card(state: AppState, body: string): string {
  const busy =
    state.stats.status === "loading"
      ? `<span class="ui active mini inline loader" aria-label="Updating"></span>`
      : "";
  return `<div class="qb-card qb-stats"><h2 class="qb-card-title">Statistics${busy ? " " + busy : ""}</h2>${body}</div>`;
}

const placeholder = (text: string) => `<p class="qb-placeholder">${escapeHtml(text)}</p>`;

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(el, card(state, placeholder("Select at least one database to see statistics.")));
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, card(state, placeholder("Add a condition to see statistics.")));
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, card(state, placeholder("Finish the query to see statistics.")));
    return;
  }
  const { status, lines, error } = state.stats;
  if (status === "error") {
    paint(
      el,
      card(
        state,
        `<div class="ui small negative message"><div class="header">Statistics failed</div><p>${escapeHtml(error ?? "")}</p></div>`,
      ),
    );
    return;
  }
  // "idle" with a complete query = the debounce before the fetch starts.
  if (status === "idle" || (status === "loading" && lines.length === 0)) {
    paint(el, card(state, placeholder("Counting matches…")));
    return;
  }
  // The headline stays on top; the per-database list follows. The whole
  // column is sticky and scrolls internally (styles.css .qb-col-stats).
  paint(el, card(state, `${headlineHtml(state)}${perDatabaseHtml(state)}${pendingHtml(state)}`));
}
