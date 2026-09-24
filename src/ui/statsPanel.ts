import { runBlocker, type AppState, type RunBlocker, type StatsState } from "../state";
import type { Database, DatabaseResult } from "../model";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, countLabel, exact, matchRatio } from "./format";

/** The databases are loaded once into AppState.databases; a result only
 * carries a `databaseId`, so its name and event count are looked up here
 * rather than resent with every result. */
function databaseFor(databases: Database[] | null, id: string): Database | undefined {
  return databases?.find((d) => d.id === id);
}

function bar(match: number, total: number): string {
  return `<span class="qb-bar"><i style="width:${barWidth(match, total)}"></i></span>`;
}

function messagesHtml(list: string[], cls: string): string {
  return list.length ? `<span class="${cls}">${list.map(escapeHtml).join(" · ")}</span>` : "";
}

type Ok = Extract<DatabaseResult, { status: "ok" }>;
type Failed = Extract<DatabaseResult, { status: "failed" }>;

function successRowHtml(result: Ok, db: Database | undefined): string {
  const name = db?.name ?? result.databaseId;
  const total = db?.eventCount ?? 0;
  const { matchCount } = result;
  return `<div class="qb-db-row" title="${escapeHtml(name)}: ${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${bar(matchCount, total)}
    <span class="qb-db-ratio">${escapeHtml(matchRatio(matchCount, total))}</span>
    ${messagesHtml(result.notes, "qb-db-msg")}
  </div>`;
}

function failureRowHtml(result: Failed, db: Database | undefined): string {
  const name = db?.name ?? result.databaseId;
  const errors = result.errors.length
    ? messagesHtml(result.errors, "qb-db-msg qb-db-error")
    : `<span class="qb-db-msg qb-db-error">Failed.</span>`;
  return `<div class="qb-db-row is-failed">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    ${errors}
    ${messagesHtml(result.notes, "qb-db-msg")}
  </div>`;
}

/** Statistics that have (some) results: everything but the error state. */
type StatsWithResults = Exclude<StatsState, { status: "error" }>;

/** One row per database that has reported so far — success (ratio + bar),
 * failure (errors in red, notes beneath) — as each streamed result arrives. */
function perDatabaseHtml(results: DatabaseResult[], databases: Database[] | null): string {
  if (!results.length) return "";
  return `<h3 class="qb-stat-subtitle">By database</h3>
    <div class="qb-stat-perdb">
      ${results
        .map((result) => {
          const db = databaseFor(databases, result.databaseId);
          return result.status === "ok" ? successRowHtml(result, db) : failureRowHtml(result, db);
        })
        .join("")}
    </div>`;
}

/**
 * The combined headline sums only the databases that succeeded. A failed
 * database has no count at all (only an "ok" DatabaseResult has a
 * `matchCount`), so the headline must never present failures as "0 matched":
 * with no successes yet it shows no number, and when some failed it says the
 * total excludes them.
 */
export function headlineHtml(
  { status, results }: StatsWithResults,
  databases: Database[] | null,
): string {
  const succeeded = results.filter((r): r is Ok => r.status === "ok");
  const failed = results.length - succeeded.length;
  const failedNote =
    failed > 0
      ? `<div class="qb-stat-failed">Excludes ${failed} database${failed === 1 ? "" : "s"} that failed (see below).</div>`
      : "";
  if (succeeded.length === 0) {
    const text =
      status === "loading" ? "No results yet." : "No database returned a result for this query.";
    return `<div class="qb-stat-headline"><p class="qb-stat-sub">${text}</p></div>`;
  }
  const matchCount = succeeded.reduce((s, r) => s + r.matchCount, 0);
  const total = succeeded.reduce(
    (s, r) => s + (databaseFor(databases, r.databaseId)?.eventCount ?? 0),
    0,
  );
  return `<div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
    <div class="qb-stat-label">matching events</div>
    <div class="qb-stat-sub">${escapeHtml(matchRatio(matchCount, total))} of ${escapeHtml(compact(total))}</div>
    ${bar(matchCount, total)}
    ${failedNote}
  </div>`;
}

/** While loading, how many selected databases haven't reported a line yet. */
function pendingHtml(stats: StatsWithResults, selectedCount: number): string {
  if (stats.status !== "loading") return "";
  const remaining = selectedCount - stats.results.length;
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

/** Why the statistics column is empty (see `runBlocker`). */
const BLOCKED_MESSAGES: Record<Exclude<RunBlocker, "loading">, string> = {
  "no-database": "Select at least one database to see statistics.",
  "no-condition": "Add a condition to see statistics.",
  unfinished: "Finish the query to see statistics.",
};

export function renderStatsPanel(el: HTMLElement, state: AppState): void {
  const blocker = runBlocker(state);
  if (blocker === "loading") {
    paint(el, "");
    return;
  }
  if (blocker) {
    paint(el, card(state, placeholder(BLOCKED_MESSAGES[blocker])));
    return;
  }
  const stats = state.stats;
  if (stats.status === "error") {
    paint(
      el,
      card(
        state,
        `<div class="ui small negative message"><div class="header">Statistics failed</div><p>${escapeHtml(stats.error)}</p></div>`,
      ),
    );
    return;
  }
  // "idle" with a complete query = the debounce before the fetch starts.
  if (stats.status === "idle" || (stats.status === "loading" && stats.results.length === 0)) {
    paint(el, card(state, placeholder("Counting matches…")));
    return;
  }
  // The headline stays on top; the per-database list follows. The whole
  // column is sticky and scrolls internally (styles.css .qb-col-stats).
  paint(
    el,
    card(
      state,
      headlineHtml(stats, state.databases) +
        perDatabaseHtml(stats.results, state.databases) +
        pendingHtml(stats, state.selectedDatabaseIds.length),
    ),
  );
}
