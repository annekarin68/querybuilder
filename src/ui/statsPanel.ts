import type { AppState } from "../state";
import type { DatabasesResponse, StatsResponse } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, exact, matchRatio } from "./format";

function hint(text: string): string {
  return `<div class="ui info message">${escapeHtml(text)}</div>`;
}

/** GET /api/databases is loaded once into AppState.databases; a stats line only
 * carries a `label`, so its display name and totalEntrysets are looked up here
 * rather than resent on every line. */
function databaseFor(databases: DatabasesResponse[] | null, label: string): DatabasesResponse | undefined {
  return databases?.find((d) => d.label === label);
}

function successRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const total = db?.totalEntrysets ?? 0;
  const matchCount = line.matchCount ?? 0;
  const info = line.infoMessages?.length
    ? `<div class="ui small text">${line.infoMessages.map(escapeHtml).join(" · ")}</div>`
    : "";
  return `<div class="item" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="qb-db-nums">${escapeHtml(compact(matchCount))} / ${escapeHtml(compact(total))} · ${escapeHtml(matchRatio(matchCount, total))}</div>
    <div class="ui tiny progress" style="margin:.1rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, total)}"></div>
    </div>
    ${info}
  </div>`;
}

function failureRowHtml(line: StatsResponse, db: DatabasesResponse | undefined): string {
  const name = db?.name ?? line.label;
  const messages = [...(line.errorMessages ?? []), ...(line.infoMessages ?? [])];
  return `<div class="item">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="ui negative small text">${messages.length ? messages.map(escapeHtml).join(" · ") : "Failed."}</div>
  </div>`;
}

/** One row per database that has reported so far — success (counts), failure
 * (errorMessages/infoMessages), shown as each streamed line arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<div class="ui segment">
    <h5 class="ui header">By database</h5>
    <div class="ui relaxed list qb-stat-perdb">
      ${lines
        .map((line) => {
          const db = databaseFor(state.databases, line.label);
          return line.success ? successRowHtml(line, db) : failureRowHtml(line, db);
        })
        .join("")}
    </div>
  </div>`;
}

function headlineHtml(state: AppState): string {
  const { lines } = state.stats;
  const matchCount = lines
    .filter((l) => l.success)
    .reduce((s, l) => s + (l.matchCount ?? 0), 0);
  const total = lines.reduce((s, l) => {
    const db = databaseFor(state.databases, l.label);
    return s + (l.success && db ? db.totalEntrysets : 0);
  }, 0);
  return `<div class="ui segment">
    <div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(total))}">
      <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
      <span class="qb-stat-sub">of ${escapeHtml(compact(total))} · ${escapeHtml(matchRatio(matchCount, total))}</span>
    </div>
    <div class="ui tiny progress" style="margin:.35rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, total)}"></div>
    </div>
  </div>`;
}

/** While loading, how many selected databases haven't reported a line yet. */
function pendingHtml(state: AppState): string {
  if (state.stats.status !== "loading") return "";
  const remaining = state.selectedDatabaseIds.length - state.stats.lines.length;
  if (remaining <= 0) return "";
  return `<div class="ui segment"><div class="ui active inline loader tiny"></div> Waiting on ${remaining} more database${remaining === 1 ? "" : "s"}…</div>`;
}

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Select at least one database to see statistics.")}`,
    );
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, `<h4 class="ui header">Statistics</h4>${hint("Add a condition to see statistics.")}`);
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Fix the errors in your query to see statistics.")}`,
    );
    return;
  }
  const { status, lines, error } = state.stats;
  if (status === "idle") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Finish the query to see statistics.")}`,
    );
    return;
  }
  if (status === "error") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui negative message"><div class="header">Statistics failed</div><p>${escapeHtml(error ?? "")}</p></div>`,
    );
    return;
  }
  if (status === "loading" && lines.length === 0) {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui segment"><div class="ui active inline loader"></div> Updating…</div>`,
    );
    return;
  }
  // Order matters: the combined headline stays pinned at the top; the
  // per-database list — the only dynamic content left once StatBlock is gone —
  // scrolls internally via .qb-stat-perdb. See src/styles.css.
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     ${headlineHtml(state)}
     ${perDatabaseHtml(state)}
     ${pendingHtml(state)}`,
  );
}
