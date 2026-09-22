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
 * carries a `label`, so its display name is looked up here rather than resent
 * on every line (see StatsResponse's docstring in src/api/types.ts). */
function nameFor(databases: DatabasesResponse["databases"] | null, label: string): string {
  return databases?.find((d) => d.label === label)?.name ?? label;
}

function successRowHtml(line: Extract<StatsResponse, { success: true }>, name: string): string {
  const info = line.infoMessages.length
    ? `<div class="ui small text">${line.infoMessages.map(escapeHtml).join(" · ")}</div>`
    : "";
  return `<div class="item" title="${escapeHtml(exact(line.matchCount))} of ${escapeHtml(exact(line.totalCount))}">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="qb-db-nums">${escapeHtml(compact(line.matchCount))} / ${escapeHtml(compact(line.totalCount))} · ${escapeHtml(matchRatio(line.matchCount, line.totalCount))}</div>
    <div class="ui tiny progress" style="margin:.1rem 0 0">
      <div class="bar" style="width:${barWidth(line.matchCount, line.totalCount)}"></div>
    </div>
    ${info}
  </div>`;
}

function failureRowHtml(line: Extract<StatsResponse, { success: false }>, name: string): string {
  const messages = [...line.validationErrors, ...line.infoMessages];
  return `<div class="item">
    <div class="qb-db-name">${escapeHtml(name)}</div>
    <div class="ui negative small text">${messages.length ? messages.map(escapeHtml).join(" · ") : "Failed."}</div>
  </div>`;
}

/** One row per database that has reported so far — success (counts), failure
 * (validationErrors/infoMessages), shown as each streamed line arrives. */
function perDatabaseHtml(state: AppState): string {
  const { lines } = state.stats;
  if (!lines.length) return "";
  return `<div class="ui segment">
    <h5 class="ui header">By database</h5>
    <div class="ui relaxed list qb-stat-perdb">
      ${lines
        .map((line) => {
          const name = nameFor(state.databases, line.label);
          return line.success ? successRowHtml(line, name) : failureRowHtml(line, name);
        })
        .join("")}
    </div>
  </div>`;
}

function headlineHtml(lines: StatsResponse[]): string {
  const successes = lines.filter(
    (l): l is Extract<StatsResponse, { success: true }> => l.success,
  );
  const matchCount = successes.reduce((s, l) => s + l.matchCount, 0);
  const totalCount = successes.reduce((s, l) => s + l.totalCount, 0);
  return `<div class="ui segment">
    <div class="qb-stat-headline" title="${escapeHtml(exact(matchCount))} of ${escapeHtml(exact(totalCount))}">
      <span class="qb-stat-big">${escapeHtml(compact(matchCount))}</span>
      <span class="qb-stat-sub">of ${escapeHtml(compact(totalCount))} · ${escapeHtml(matchRatio(matchCount, totalCount))}</span>
    </div>
    <div class="ui tiny progress" style="margin:.35rem 0 0">
      <div class="bar" style="width:${barWidth(matchCount, totalCount)}"></div>
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
     ${headlineHtml(lines)}
     ${perDatabaseHtml(state)}
     ${pendingHtml(state)}`,
  );
}
