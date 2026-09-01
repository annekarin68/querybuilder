import type { AppState } from "../state";
import type { StatBlock, StatsResponse } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { barWidth, compact, exact, matchRatio } from "./format";

function hint(text: string): string {
  return `<div class="ui info message">${escapeHtml(text)}</div>`;
}

/** "N missing" line under a block; N can be billions, so compact it (exact on hover). */
function missing(nullCount: number): string {
  return `<div class="ui small text" title="${escapeHtml(exact(nullCount))} missing">${escapeHtml(compact(nullCount))} missing in dataset</div>`;
}

function numberSummary(b: Extract<StatBlock, { kind: "number-summary" }>): string {
  return `<div class="ui tiny statistics" title="min ${escapeHtml(exact(b.min))} · max ${escapeHtml(exact(b.max))} · avg ${escapeHtml(exact(b.avg))}">
    <div class="statistic"><div class="value">${escapeHtml(compact(b.min))}</div><div class="label">min</div></div>
    <div class="statistic"><div class="value">${escapeHtml(compact(b.max))}</div><div class="label">max</div></div>
    <div class="statistic"><div class="value">${escapeHtml(compact(b.avg))}</div><div class="label">avg</div></div>
  </div>${missing(b.nullCount)}`;
}

function distribution(b: Extract<StatBlock, { kind: "distribution" }>): string {
  const max = Math.max(1, ...b.buckets.map((x) => x.count));
  return `<div class="ui relaxed list">
    ${b.buckets
      .map(
        (x) => `<div class="item" title="${escapeHtml(exact(x.count))}">
          <div class="ui tiny progress" style="margin:.15rem 0">
            <div class="bar" style="width:${Math.round((x.count / max) * 100)}%"></div>
            <div class="label" style="text-align:left">${escapeHtml(x.label)} — ${escapeHtml(compact(x.count))}</div>
          </div>
        </div>`,
      )
      .join("")}
  </div>${missing(b.nullCount)}`;
}

function dateRange(b: Extract<StatBlock, { kind: "date-range" }>): string {
  return `<div>${escapeHtml(b.earliest)} → ${escapeHtml(b.latest)}</div>${missing(b.nullCount)}`;
}

function blockHtml(b: StatBlock): string {
  const inner =
    b.kind === "number-summary"
      ? numberSummary(b)
      : b.kind === "distribution"
        ? distribution(b)
        : dateRange(b);
  return `<div class="ui segment"><h5 class="ui header">${escapeHtml(b.fieldLabel)}</h5>${inner}</div>`;
}

/** Per-database match counts. Skipped for a single database — the combined header already says it. */
function perDatabaseHtml(rows: StatsResponse["perDatabase"]): string {
  if (rows.length < 2) return "";
  return `<div class="ui segment">
    <h5 class="ui header">By database</h5>
    <div class="ui relaxed list">
      ${rows
        .map(
          (
            r,
          ) => `<div class="item" title="${escapeHtml(exact(r.matchCount))} of ${escapeHtml(exact(r.totalCount))}">
            <div class="qb-db-name">${escapeHtml(r.label)}</div>
            <div class="qb-db-nums">${escapeHtml(compact(r.matchCount))} / ${escapeHtml(compact(r.totalCount))} · ${escapeHtml(matchRatio(r.matchCount, r.totalCount))}</div>
            <div class="ui tiny progress" style="margin:.1rem 0 0">
              <div class="bar" style="width:${barWidth(r.matchCount, r.totalCount)}"></div>
            </div>
          </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

function headlineHtml(d: StatsResponse): string {
  return `<div class="ui segment">
    <div class="qb-stat-headline" title="${escapeHtml(exact(d.matchCount))} of ${escapeHtml(exact(d.totalCount))}">
      <span class="qb-stat-big">${escapeHtml(compact(d.matchCount))}</span>
      <span class="qb-stat-sub">of ${escapeHtml(compact(d.totalCount))} · ${escapeHtml(matchRatio(d.matchCount, d.totalCount))}</span>
    </div>
    <div class="ui tiny progress" style="margin:.35rem 0 0">
      <div class="bar" style="width:${barWidth(d.matchCount, d.totalCount)}"></div>
    </div>
  </div>`;
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
  const s = state.stats;
  if (s.status === "loading") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui segment"><div class="ui active inline loader"></div> Updating…</div>`,
    );
    return;
  }
  if (s.status === "idle") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4>${hint("Finish the query to see statistics.")}`,
    );
    return;
  }
  if (s.status === "error") {
    paint(
      el,
      `<h4 class="ui header">Statistics</h4><div class="ui negative message"><div class="header">Statistics failed</div><p>${escapeHtml(s.error)}</p></div>`,
    );
    return;
  }
  if (s.status !== "ok" || !s.data) {
    paint(el, "");
    return;
  }
  const d = s.data;
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     ${headlineHtml(d)}
     ${d.blocks.map(blockHtml).join("")}
     ${perDatabaseHtml(d.perDatabase)}`,
  );
}
