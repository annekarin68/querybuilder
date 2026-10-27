import { runBlocker, type AppState, type RunBlocker, type StatsState } from "../state";
import type { Database, DatabaseResult } from "../model";
import { escapeHtml, paint } from "./panel";
import { placeIssues } from "../query/issues";
import { failureReasons, queryIsAtFault } from "./databasePicker";
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
export type Failed = Extract<DatabaseResult, { status: "failed" }>;

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

/**
 * A selected database that has not answered yet: its name, an empty bar and a
 * quiet "…" where the ratio will be. Drawn for every such database while the
 * statistics load, so the panel has its final height from the first line.
 * At 900 px and below the statistics sit above **Run query**, and a row that
 * appeared with each answer pushed the button down while the user aimed at it
 * (maintainers, 2026-10-27).
 */
export function pendingRowHtml(db: Database | undefined, databaseId: string): string {
  const name = db?.name ?? databaseId;
  return `<div class="qb-db-row is-pending" title="${escapeHtml(name)}: still counting">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    <span class="qb-bar" aria-hidden="true"></span>
    <span class="qb-db-ratio" aria-label="still counting">…</span>
  </div>`;
}

/**
 * A database that failed to run the query: a red, striped bar where the ratio
 * bar would be, an icon, and why it failed (`failureReasons`) on one line
 * under it, cut off with "…" if long; the row's tooltip holds all of it. The
 * users asked for a picture instead of the old "Not counted" sentences, and
 * then for the reason back, in one line (2026-10-13). The bar's own label says
 * only what happened: the name and the reason are read from the row's text,
 * so a screen reader does not hear them twice.
 */
export function failureRowHtml(result: Failed, db: Database | undefined): string {
  const name = db?.name ?? result.databaseId;
  const reason = failureReasons(result).join(" · ");
  return `<div class="qb-db-row is-failed" title="${escapeHtml(`${name} failed and is not counted: ${reason}`)}">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    <span class="qb-bar is-failed" role="img" aria-label="Failed and not counted."></span>
    <i class="exclamation circle icon qb-db-failed-icon" aria-hidden="true"></i>
    <span class="qb-db-reason">${escapeHtml(reason)}</span>
  </div>`;
}

/**
 * A database that did not run the query because the query itself has a
 * problem (`queryIsAtFault`: every database that answered refused it only
 * for problems in the query). The database did not fail, so its row is not
 * red: an empty bar and a warning icon that point at **Show problem**, where
 * the problem can be fixed. Red means a database that really failed; some of
 * them do break, and users must be able to tell the two apart (2026-10-13).
 */
export function notRunRowHtml(db: Database | undefined, databaseId: string): string {
  const name = db?.name ?? databaseId;
  return `<div class="qb-db-row is-not-run" title="${escapeHtml(name)} did not run the query: it has a problem (see Show problem).">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    <span class="qb-bar is-not-run" role="img" aria-label="Not run: the query has a problem (see Show problem)."></span>
    <i class="exclamation triangle icon qb-db-not-run-icon" aria-hidden="true"></i>
  </div>`;
}

/**
 * "⚠ Show problem", when the databases found a problem in the query: the one
 * way to jump to it from here (kept by the maintainers, 2026-10-13, when the
 * "Not counted: N problems are marked in the query" line went). The messages
 * are drawn in the builder, next to what is wrong. It points at the node drawn
 * for the first problem (`placeIssues`), so a problem inside a collapsed group
 * points at that group. The id goes in `data-target-id`, not `data-node-id`:
 * that attribute means "this element is a query node", and keyboard focus
 * memory (focusMemory.ts) would take the button for one.
 */
export function showProblemButton(state: AppState): string {
  const count = state.serverIssues.length;
  if (count === 0) return "";
  const first = placeIssues(state.query, state.serverIssues)[0]!;
  // The accessible name starts with the visible text, so a voice-control user
  // who says "Show problem" reaches it (WCAG 2.5.3, label in name).
  const label =
    count === 1 ? "Show problem in the query" : `Show problem (the first of ${count} in the query)`;
  return `<button type="button" class="ui mini basic button qb-show-problem" data-action="show-issue" data-target-id="${escapeHtml(first.nodeId)}" aria-label="${label}" title="${label}"><i class="exclamation triangle icon" aria-hidden="true"></i>Show problem</button>`;
}

/** Statistics that have (some) results: everything but the error state. */
type StatsWithResults = Exclude<StatsState, { status: "error" }>;

/** One row per selected database: those that have reported so far — success (ratio + bar),
 * failure (a red bar, an icon and the reason), or, when the query itself is
 * at fault, not run (a neutral bar) — as each streamed result arrives, then a placeholder row for each one still
 * to answer (`pendingRowHtml`). The
 * rule is the database picker's (`queryIsAtFault`), checked again on every
 * answer, so the pills and the rows always agree. */
function perDatabaseHtml(
  results: DatabaseResult[],
  databases: Database[] | null,
  pendingIds: string[],
): string {
  if (!results.length && !pendingIds.length) return "";
  const atFault = queryIsAtFault(results);
  return `<h3 class="qb-stat-subtitle">By database</h3>
    <div class="qb-stat-perdb">
      ${results
        .map((result) => {
          const db = databaseFor(databases, result.databaseId);
          if (result.status === "ok") return successRowHtml(result, db);
          return atFault ? notRunRowHtml(db, result.databaseId) : failureRowHtml(result, db);
        })
        .join("")}
      ${pendingIds.map((id) => pendingRowHtml(databaseFor(databases, id), id)).join("")}
    </div>`;
}

/** The selected databases that have not answered yet, while the statistics
 *  load; none once they are done (a database that never answered then has
 *  no row, as before). */
export function pendingDatabaseIds(stats: StatsWithResults, selectedIds: string[]): string[] {
  if (stats.status !== "loading") return [];
  const answered = new Set(stats.results.map((r) => r.databaseId));
  return selectedIds.filter((id) => !answered.has(id));
}

/** How the events of the selected databases split up. */
export interface Split {
  /** Events that match, in the databases that answered. */
  matched: number;
  /** Events in the databases that answered. */
  counted: number;
  /** Events in the databases that failed: nobody counted them. */
  notCounted: number;
  /** Events in every selected database, answered, failed or still loading:
   *  what `matched` is a share of (users, 2026-10-13). */
  selected: number;
  failedDatabases: number;
}

export function splitResults(
  results: DatabaseResult[],
  databases: Database[] | null,
  selectedIds: string[],
): Split {
  const size = (id: string) => databaseFor(databases, id)?.eventCount ?? 0;
  const split: Split = {
    matched: 0,
    counted: 0,
    notCounted: 0,
    selected: selectedIds.reduce((sum, id) => sum + size(id), 0),
    failedDatabases: 0,
  };
  for (const r of results) {
    if (r.status === "ok") {
      split.matched += r.matchCount;
      split.counted += size(r.databaseId);
    } else {
      split.notCounted += size(r.databaseId);
      split.failedDatabases += 1;
    }
  }
  return split;
}

/** The bar's words, for screen readers and the tooltip. */
export function splitLabel(s: Split): string {
  const ratio =
    s.counted > 0 ? `${matchRatio(s.matched, s.selected)} of the selected events match.` : "";
  if (s.failedDatabases === 0) return ratio;
  const failed = `${countLabel(s.failedDatabases, "database")} failed and ${s.failedDatabases === 1 ? "is" : "are"} not counted.`;
  return ratio ? `${ratio} ${failed}` : failed;
}

/**
 * The headline's bar: every event of the selected databases. Green (left) is
 * what matches, so it is the same share as the percentage above it; the
 * striped red end is the events of databases that failed, which nobody
 * counted; grey is the rest (no match, or not answered yet). Users found the
 * words "Excludes N databases" and "Not counted" confusing and asked for a
 * picture (2026-10-13); the words are still there for screen readers
 * (`splitLabel`). A failed database whose size is unknown still shows a sliver.
 */
function splitBar(s: Split): string {
  const failedWidth =
    s.failedDatabases === 0 ? null : s.notCounted > 0 ? barWidth(s.notCounted, s.selected) : "2px";
  const failed = failedWidth ? `<i class="qb-bar-failed" style="width:${failedWidth}"></i>` : "";
  return `<span class="qb-bar" role="img" aria-label="${escapeHtml(splitLabel(s))}"><i style="width:${barWidth(s.matched, s.selected)}"></i>${failed}</span>`;
}

/**
 * The headline: how many events match, as a share of ALL selected databases,
 * failed and still-loading ones included, because that is the share of the
 * data the query actually returned (users, 2026-10-13). A failed database has
 * no count at all, so it is never shown as "0 matched": the bar shows its
 * share in red (`splitBar`); with no success yet there is no number, and the
 * bar is red for every answer so far that failed. When the query itself is at
 * fault (`queryIsAtFault`), no database failed, so there is no bar at all:
 * **Show problem** below says what to do.
 */
export function headlineHtml(
  { status, results }: StatsWithResults,
  databases: Database[] | null,
  selectedIds: string[],
): string {
  const s = splitResults(results, databases, selectedIds);
  if (s.failedDatabases === results.length) {
    const text =
      status === "loading" ? "No results yet." : "No database returned a result for this query.";
    const bar = s.failedDatabases > 0 && !queryIsAtFault(results) ? splitBar(s) : "";
    return `<div class="qb-stat-headline"><p class="qb-stat-sub">${text}</p>${bar}</div>`;
  }
  const notCounted = s.failedDatabases
    ? ` · not counted: ${exact(s.notCounted)} in ${countLabel(s.failedDatabases, "database")} that failed`
    : "";
  const title = `${exact(s.matched)} of ${exact(s.selected)} selected events${notCounted}`;
  return `<div class="qb-stat-headline" title="${escapeHtml(title)}">
    <span class="qb-stat-big">${escapeHtml(compact(s.matched))}</span>
    <div class="qb-stat-label">matching events</div>
    <div class="qb-stat-sub">${escapeHtml(matchRatio(s.matched, s.selected))} of ${escapeHtml(compact(s.selected))}</div>
    ${splitBar(s)}
  </div>`;
}

/** The panel's card is its `data-focus-landing` (not in the Tab order, tabindex
 *  -1): Try again turns into the "Counting matches…" text, and a keyboard user
 *  who pressed it stays in this card instead of dropping to the page. */
function card(state: AppState, body: string): string {
  // Decoration only. (An aria-label on a span without a role is not read, and
  // the panel's own text, "Counting matches…" or the headline, says what is up.)
  const busy =
    state.stats.status === "loading" ? `<span class="ui active mini inline loader"></span>` : "";
  return `<div class="qb-card qb-stats" tabindex="-1" data-focus-landing><h2 class="qb-card-title">Statistics${busy ? " " + busy : ""}</h2>${body}</div>`;
}

const placeholder = (text: string) => `<p class="qb-placeholder">${escapeHtml(text)}</p>`;

/** Why the statistics column is empty (see `runBlocker`). */
const BLOCKED_MESSAGES: Record<Exclude<RunBlocker, "loading" | "rejected">, string> = {
  "no-database": "Select at least one database to see statistics.",
  "no-facet": "Add a facet to see statistics.",
  unfinished: "Finish the query to see statistics.",
};

/** The statistics column for `state`: "" while the app is still loading. */
export function statsPanelHtml(state: AppState): string {
  const blocker = runBlocker(state);
  if (blocker === "loading") return "";
  // "rejected" is explained BY the results (each database's errors), so they
  // stay on screen; every other blocker means there are no results to show.
  if (blocker && blocker !== "rejected") {
    return card(state, placeholder(BLOCKED_MESSAGES[blocker]));
  }
  const stats = state.stats;
  if (stats.status === "error") {
    return card(
      state,
      `<div class="ui small negative message"><div class="header">Couldn't get statistics</div><p>${escapeHtml(stats.error)}</p><button type="button" class="ui mini basic button" data-action="retry-stats">Try again</button></div>`,
    );
  }
  // "idle" with a complete query = the debounce before the fetch starts.
  if (stats.status === "idle") return card(state, placeholder("Counting matches…"));
  if (stats.results.length === 0) {
    // Nothing answered yet: the rows are already there, waiting, so the first
    // answer does not change the panel's height.
    return card(
      state,
      placeholder("Counting matches…") +
        perDatabaseHtml([], state.databases, pendingDatabaseIds(stats, state.selectedDatabaseIds)),
    );
  }
  // The headline stays on top; the per-database list follows. Above 900 px the
  // whole column is sticky and scrolls internally; at 900 px and below it sits
  // in the page flow and does not scroll (styles.css .qb-col-stats and the
  // 900px block).
  return card(
    state,
    headlineHtml(stats, state.databases, state.selectedDatabaseIds) +
      showProblemButton(state) +
      perDatabaseHtml(
        stats.results,
        state.databases,
        pendingDatabaseIds(stats, state.selectedDatabaseIds),
      ),
  );
}

export function renderStatsPanel(el: HTMLElement, state: AppState): void {
  paint(el, statsPanelHtml(state));
}

/**
 * One delegated listener for the Try again and Show problem buttons. Call once at
 * startup; the buttons are redrawn with every repaint, the container is not.
 */
export function wireStatsPanel(
  container: HTMLElement,
  hooks: { onRetry(): void; onShowIssue(nodeId: string): void },
): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "retry-stats") hooks.onRetry();
    else if (btn.dataset.action === "show-issue" && btn.dataset.targetId) {
      hooks.onShowIssue(btn.dataset.targetId);
    }
  });
}
