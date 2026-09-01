import type { AppState } from "../state";
import type { StatBlock } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

function hint(text: string): string {
  return `<div class="ui info message">${escapeHtml(text)}</div>`;
}

function numberSummary(b: Extract<StatBlock, { kind: "number-summary" }>): string {
  return `<div class="ui tiny statistics">
    <div class="statistic"><div class="value">${b.min}</div><div class="label">min</div></div>
    <div class="statistic"><div class="value">${b.max}</div><div class="label">max</div></div>
    <div class="statistic"><div class="value">${b.avg}</div><div class="label">avg</div></div>
  </div><div class="ui small text">${b.nullCount} empty</div>`;
}

function distribution(b: Extract<StatBlock, { kind: "distribution" }>): string {
  const max = Math.max(1, ...b.buckets.map((x) => x.count));
  return `<div class="ui relaxed list">
    ${b.buckets
      .map(
        (x) => `<div class="item">
          <div class="ui tiny progress" data-percent="${Math.round((x.count / max) * 100)}" style="margin:.15rem 0">
            <div class="bar" style="width:${Math.round((x.count / max) * 100)}%"></div>
            <div class="label" style="text-align:left">${escapeHtml(x.label)} — ${x.count}</div>
          </div>
        </div>`,
      )
      .join("")}
  </div><div class="ui small text">${b.nullCount} empty</div>`;
}

function dateRange(b: Extract<StatBlock, { kind: "date-range" }>): string {
  return `<div>${escapeHtml(b.earliest)} → ${escapeHtml(b.latest)}</div><div class="ui small text">${b.nullCount} empty</div>`;
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

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
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
  const d = s.data!;
  const pct = d.totalCount ? Math.round((d.matchCount / d.totalCount) * 100) : 0;
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     <div class="ui segment">
       <div class="ui tiny statistic"><div class="value">${d.matchCount.toLocaleString()}</div>
         <div class="label">of ${d.totalCount.toLocaleString()} match</div></div>
       <div class="ui progress"><div class="bar" style="width:${pct}%"></div><div class="label">${pct}%</div></div>
     </div>
     ${d.blocks.map(blockHtml).join("")}`,
  );
}
