import type { AppState } from "../state";
import type { Entryset, Individual } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { countLabel, displayLabel, formatWhen } from "./format";

/** How many group tags to show inline before collapsing the rest into "+N". */
const MAX_GROUP_BADGES = 3;

function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals ?? []) map.set(item.label, item);
  return map;
}

function groupsBadgesHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const groups = [
    ...new Set(
      Object.keys(entryset.items)
        .map((slug) => byLabel.get(slug)?.group)
        .filter((g): g is string => Boolean(g) && g !== "metadata"),
    ),
  ].sort();
  const shown = groups.slice(0, MAX_GROUP_BADGES);
  const overflow = groups.length - shown.length;
  return (
    shown.map((g) => `<span class="qb-tag">${escapeHtml(displayLabel(g))}</span>`).join("") +
    (overflow > 0 ? `<span class="qb-er-more">+${overflow}</span>` : "")
  );
}

function entrysetRowHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const vehicle = entryset.items["vehicle_identity"]?.["vehicle_type"];
  const when = entryset.items["observation_window"]?.["from_timestamp"];
  return `
    <details class="qb-entryset-row">
      <summary>
        <span class="qb-er-id">#${escapeHtml(entryset.id)}</span>
        <span class="qb-er-when">${escapeHtml(formatWhen(typeof when === "string" ? when : undefined))}</span>
        <span class="qb-er-vehicle">${escapeHtml(typeof vehicle === "string" ? vehicle : "—")}</span>
        <span class="qb-er-groups">${groupsBadgesHtml(entryset, byLabel)}</span>
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
       <div class="qb-entryset-list">${entrysets.map((e) => entrysetRowHtml(e, byLabel)).join("")}</div>`,
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
