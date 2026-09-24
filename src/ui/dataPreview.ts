import { runBlocker, type AppState, type RunBlocker } from "../state";
import type { EventRecord, Facet } from "../model";
import { escapeHtml, paint } from "./panel";
import { countLabel, displayLabel, formatWhen } from "./format";
import { HIDDEN_ROW_BADGES, ROW_COLUMNS, type RowColumn } from "../config";

/** How many tag / group badges to show inline before collapsing the rest into "+N". */
const MAX_TAG_BADGES = 3;
const MAX_GROUP_BADGES = 2;

function facetsById(state: AppState): Map<string, Facet> {
  const map = new Map<string, Facet>();
  for (const facet of state.facets ?? []) map.set(facet.id, facet);
  return map;
}

/**
 * The distinct tags and third-party groups of an event's facets, each
 * ordered by how many of its facets carry it (most first, then alphabetical),
 * so the inline badges show what this event is mostly about. Values listed in
 * `hidden` (default: `HIDDEN_ROW_BADGES` in config.ts, matched ignoring case
 * and surrounding whitespace) are dropped.
 */
export function eventBadges(
  event: EventRecord,
  byId: Map<string, Facet>,
  hidden: { tags: string[]; groups: string[] } = HIDDEN_ROW_BADGES,
): { tags: string[]; groups: string[] } {
  const norm = (s: string) => s.trim().toLowerCase();
  const hiddenTags = new Set(hidden.tags.map(norm));
  const hiddenGroups = new Set(hidden.groups.map(norm));
  const tags = new Map<string, number>();
  const groups = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const id of Object.keys(event.values)) {
    const facet = byId.get(id);
    if (!facet) continue;
    if (facet.group && !hiddenGroups.has(norm(facet.group))) bump(groups, facet.group);
    for (const tag of facet.tags) {
      if (!hiddenTags.has(norm(tag))) bump(tags, tag);
    }
  }
  const ranked = (m: Map<string, number>) =>
    [...m.keys()].sort((a, b) => m.get(b)! - m.get(a)! || a.localeCompare(b));
  return { tags: ranked(tags), groups: ranked(groups) };
}

/** Up to `max` badges of one kind, then a "+N" whose hover lists the rest. */
function badgesHtml(values: string[], max: number, cls: string, kind: string): string {
  const shown = values.slice(0, max);
  const rest = values.slice(max).map(displayLabel);
  return (
    shown
      .map((v) => `<span class="${cls}" title="${kind}">${escapeHtml(displayLabel(v))}</span>`)
      .join("") +
    (rest.length
      ? `<span class="qb-er-more" title="${escapeHtml(`More ${kind.toLowerCase()}s: ${rest.join(", ")}`)}">+${rest.length}</span>`
      : "")
  );
}

/** Tags first (our own, filled chips), then third-party groups (outlined). */
function tagsAndGroupsHtml(event: EventRecord, byId: Map<string, Facet>): string {
  const { tags, groups } = eventBadges(event, byId);
  return (
    badgesHtml(tags, MAX_TAG_BADGES, "qb-tag", "Tag") +
    badgesHtml(groups, MAX_GROUP_BADGES, "qb-group-badge", "Group")
  );
}

/** The text of one configured column for one event ("—" when absent). */
export function rowCell(event: EventRecord, col: RowColumn): string {
  const v = event.values[col.facet]?.[col.field];
  if (v === undefined || v === null || v === "") return "—";
  return col.format === "datetime" ? formatWhen(String(v)) : String(v);
}

/** The row grid: id, one column per ROW_COLUMNS entry, badges, facet count.
 *  Every row is its own grid, so tracks must not depend on content or the
 *  columns would misalign: dates get a fixed width that fits a medium
 *  date + short time; text is capped and ellipsised, full value on hover. */
export function rowGrid(columns: RowColumn[]): string {
  const cols = columns.map((c) => (c.format === "datetime" ? "12rem" : "minmax(0, 10rem)"));
  return ["3rem", ...cols, "minmax(0, 1fr)", "auto"].join(" ");
}

function eventRowHtml(event: EventRecord, byId: Map<string, Facet>, columns: RowColumn[]): string {
  const cells = columns
    .map((col) => {
      const value = rowCell(event, col);
      return `<span class="qb-er-cell" title="${escapeHtml(`${col.heading}: ${value}`)}">${escapeHtml(value)}</span>`;
    })
    .join("");
  return `
    <details class="qb-event-row">
      <summary>
        <span class="qb-er-id">#${escapeHtml(event.id)}</span>
        ${cells}
        <span class="qb-er-groups">${tagsAndGroupsHtml(event, byId)}</span>
        <span class="qb-er-count">${countLabel(Object.keys(event.values).length, "facet")}</span>
      </summary>
      <pre class="qb-er-json">${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    </details>`;
}

function card(body: string, count?: number): string {
  const n =
    count === undefined ? "" : ` <span class="qb-card-count">· ${count.toLocaleString()}</span>`;
  return `<div class="qb-card qb-preview"><h2 class="qb-card-title">Matching events${n}</h2>${body}</div>`;
}

/** The Run control — the only one in the app. Its enabled state is decided by
 *  the same checks renderDataPreview makes before calling it. */
function runBlock(message: string, enabled: boolean, note = "", label = "Run query"): string {
  return `<div class="qb-run">
    ${message ? `<p class="qb-run-msg">${escapeHtml(message)}</p>` : ""}
    <button type="button" class="ui primary button" data-action="run"${enabled ? "" : " disabled"}><i class="play icon"></i>${escapeHtml(label)}</button>
    ${note ? `<p class="qb-run-note">${escapeHtml(note)}</p>` : ""}
  </div>`;
}

/** Advisory only (docs/ARCHITECTURE.md, "Auth"): Run always attempts the
 *  request; src/app.ts reacts to the real 401/403 by redirecting into
 *  login/compliance and back. */
function runNote(state: AppState): string {
  if (state.auth.status === "anonymous") return "You'll be asked to log in first.";
  if (state.auth.status === "authenticated" && state.compliance.status === "required") {
    return "You'll be asked to confirm compliance first.";
  }
  return "";
}

/** Why Run is disabled (see `runBlocker`). */
const BLOCKED_MESSAGES: Record<Exclude<RunBlocker, "loading">, string> = {
  "no-database": "Select at least one database, then run the query.",
  "no-condition": "Add a condition, then run the query.",
  unfinished: "Finish the query to run it.",
};

export function renderDataPreview(el: HTMLElement, state: AppState): void {
  const p = state.preview;

  // This panel never shows anything that does not belong to the query on
  // screen, and it says WHY it is empty (docs/ARCHITECTURE.md, "Correctness
  // invariant").
  const blocker = runBlocker(state);
  if (blocker === "loading") {
    paint(el, "");
    return;
  }
  if (blocker) {
    paint(el, card(runBlock(BLOCKED_MESSAGES[blocker], false)));
    return;
  }
  // app.ts resets preview to "idle" (changeScope) in the same
  // setState that changes the query, so one run always belongs to one query.
  if (p.status === "idle") {
    paint(
      el,
      card(runBlock("Fetch a sample of the events this query matches.", true, runNote(state))),
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      card(
        `<div class="qb-run"><div class="ui active inline loader"></div><p class="qb-run-msg">Fetching events…</p></div>`,
      ),
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      card(
        `<div class="ui small negative message"><div class="header">Could not load events</div><p>${escapeHtml(p.error)}</p></div>
         ${runBlock("", true, "", "Try again")}`,
      ),
    );
    return;
  }
  const { events } = p;
  if (events.length === 0) {
    paint(el, card(`<p class="qb-placeholder">No events match this query.</p>`, 0));
    return;
  }
  const byId = facetsById(state);
  paint(
    el,
    card(
      `<p class="qb-preview-note qb-muted">Showing ${countLabel(events.length, "event")} — click a row to see its full JSON.</p>
       <div class="qb-event-list" style="--qb-er-grid: ${rowGrid(ROW_COLUMNS)}">${events.map((e) => eventRowHtml(e, byId, ROW_COLUMNS)).join("")}</div>`,
      events.length,
    ),
  );
}

/** One delegated listener for the Run / Try again button. Call once at startup. */
export function wireDataPreview(container: HTMLElement, onRun: () => void): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action='run']");
    if (btn && !btn.disabled) onRun();
  });
}
