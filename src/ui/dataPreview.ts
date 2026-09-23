import type { AppState } from "../state";
import type { Entryset, Individual } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { countLabel, displayLabel, formatWhen, text } from "./format";
import { tagsOf, UNTAGGED } from "./docsFilter";
import { HIDDEN_ROW_BADGES, ROW_COLUMNS, type RowColumn } from "../config";

/** How many tag / group badges to show inline before collapsing the rest into "+N". */
const MAX_TAG_BADGES = 3;
const MAX_GROUP_BADGES = 2;

function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals ?? []) map.set(item.label, item);
  return map;
}

/**
 * The distinct tags and third-party groups of an entryset's items, each
 * ordered by how many of its items carry it (most first, then alphabetical),
 * so the inline badges show what this entryset is mostly about. Blank values
 * and those listed in `hidden` (default: `HIDDEN_ROW_BADGES` in config.ts,
 * matched ignoring case) are dropped.
 */
export function entrysetBadges(
  entryset: Entryset,
  byLabel: Map<string, Individual>,
  hidden: { tags: string[]; groups: string[] } = HIDDEN_ROW_BADGES,
): { tags: string[]; groups: string[] } {
  const norm = (s: string) => text(s).toLowerCase();
  const hiddenTags = new Set(hidden.tags.map(norm));
  const hiddenGroups = new Set(hidden.groups.map(norm));
  const tags = new Map<string, number>();
  const groups = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const label of Object.keys(entryset.items)) {
    const ind = byLabel.get(label);
    if (!ind) continue;
    const group = text(ind.group);
    if (group && !hiddenGroups.has(norm(group))) bump(groups, group);
    for (const tag of tagsOf(ind)) {
      if (tag !== UNTAGGED && !hiddenTags.has(norm(tag))) bump(tags, tag);
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
function tagsAndGroupsHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const { tags, groups } = entrysetBadges(entryset, byLabel);
  return (
    badgesHtml(tags, MAX_TAG_BADGES, "qb-tag", "Tag") +
    badgesHtml(groups, MAX_GROUP_BADGES, "qb-group-badge", "Group")
  );
}

/** The text of one configured column for one entryset ("—" when absent). */
export function rowCell(entryset: Entryset, col: RowColumn): string {
  const v = entryset.items[col.item]?.[col.field];
  if (v === undefined || v === null || v === "") return "—";
  return col.format === "datetime" ? formatWhen(String(v)) : String(v);
}

/** The row grid: id, one column per ROW_COLUMNS entry, badges, item count.
 *  Every row is its own grid, so tracks must not depend on content or the
 *  columns would misalign: dates get a fixed width that fits a medium
 *  date + short time; text is capped and ellipsised, full value on hover. */
export function rowGrid(columns: RowColumn[]): string {
  const cols = columns.map((c) => (c.format === "datetime" ? "12rem" : "minmax(0, 10rem)"));
  return ["3rem", ...cols, "minmax(0, 1fr)", "auto"].join(" ");
}

function entrysetRowHtml(
  entryset: Entryset,
  byLabel: Map<string, Individual>,
  columns: RowColumn[],
): string {
  const cells = columns
    .map((col) => {
      const value = rowCell(entryset, col);
      return `<span class="qb-er-cell" title="${escapeHtml(`${col.heading}: ${value}`)}">${escapeHtml(value)}</span>`;
    })
    .join("");
  return `
    <details class="qb-entryset-row">
      <summary>
        <span class="qb-er-id">#${escapeHtml(entryset.id)}</span>
        ${cells}
        <span class="qb-er-groups">${tagsAndGroupsHtml(entryset, byLabel)}</span>
        <span class="qb-er-count">${countLabel(Object.keys(entryset.items).length, "item")}</span>
      </summary>
      <pre class="qb-er-json">${escapeHtml(JSON.stringify(entryset, null, 2))}</pre>
    </details>`;
}

function card(body: string, count?: number): string {
  const n =
    count === undefined ? "" : ` <span class="qb-card-count">· ${count.toLocaleString()}</span>`;
  return `<div class="qb-card qb-preview"><h2 class="qb-card-title">Matching entrysets${n}</h2>${body}</div>`;
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

/** Advisory only (§9): Run always attempts the request; main.ts reacts to the
 *  real 401/403 by redirecting into login/compliance and back. */
function runNote(state: AppState): string {
  if (state.auth.status === "anonymous") return "You'll be asked to log in first.";
  if (state.auth.status === "authenticated" && state.compliance.status === "required") {
    return "You'll be asked to confirm compliance first.";
  }
  return "";
}

export function renderDataPreview(state: AppState): void {
  const el = panelEls().preview;
  const p = state.preview;

  // §6: this panel never shows anything that does not belong to the query on
  // screen, and it says WHY it is empty. These checks mirror statsPanel.ts.
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(el, card(runBlock("Select at least one database, then run the query.", false)));
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, card(runBlock("Add a condition, then run the query.", false)));
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, card(runBlock("Finish the query to run it.", false)));
    return;
  }
  // onQueryChange/onDatabasesChange reset preview to "idle" in the same
  // setState that changes the query, so one run always belongs to one query.
  if (p.status === "idle") {
    paint(
      el,
      card(runBlock("Fetch a sample of the entrysets this query matches.", true, runNote(state))),
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      card(
        `<div class="qb-run"><div class="ui active inline loader"></div><p class="qb-run-msg">Fetching entrysets…</p></div>`,
      ),
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      card(
        `<div class="ui small negative message"><div class="header">Could not load entrysets</div><p>${escapeHtml(p.error)}</p></div>
         ${runBlock("", true, "", "Try again")}`,
      ),
    );
    return;
  }
  if (!p.data) {
    paint(el, "");
    return;
  }
  const { entrysets } = p.data;
  if (entrysets.length === 0) {
    paint(el, card(`<p class="qb-placeholder">No entrysets match this query.</p>`, 0));
    return;
  }
  const byLabel = individualsByLabel(state);
  paint(
    el,
    card(
      `<p class="qb-preview-note qb-muted">Showing ${countLabel(entrysets.length, "entryset")} — click a row to see its full JSON.</p>
       <div class="qb-entryset-list" style="--qb-er-grid: ${rowGrid(ROW_COLUMNS)}">${entrysets.map((e) => entrysetRowHtml(e, byLabel, ROW_COLUMNS)).join("")}</div>`,
      entrysets.length,
    ),
  );
}

/** One delegated listener for the Run / Try again button (attached once). */
export function wireDataPreview(container: HTMLElement, onRun: () => void): void {
  if (container.dataset.previewWired === "1") return;
  container.dataset.previewWired = "1";
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action='run']");
    if (btn && !btn.disabled) onRun();
  });
}
