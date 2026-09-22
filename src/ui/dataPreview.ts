import type { AppState } from "../state";
import type { Entryset, Individual } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/** How many group badges to show inline before collapsing the rest into "+N". */
const MAX_GROUP_BADGES = 3;

function hint(text: string): string {
  return `<h4 class="ui header">Data preview</h4><div class="ui info message">${escapeHtml(text)}</div>`;
}

function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals ?? []) map.set(item.label, item);
  return map;
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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
    shown
      .map((g) => `<span class="ui mini label">${escapeHtml(g.replace(/_/g, " "))}</span>`)
      .join(" ") + (overflow > 0 ? ` <span class="qb-er-more">+${overflow}</span>` : "")
  );
}

function entrysetRowHtml(entryset: Entryset, byLabel: Map<string, Individual>): string {
  const vehicle = entryset.items["vehicle_identity"]?.["vehicle_type"];
  const when = entryset.items["observation_window"]?.["from_timestamp"];
  const itemCount = Object.keys(entryset.items).length;
  return `
    <details class="qb-entryset-row">
      <summary>
        <span class="qb-er-id">#${entryset.id}</span>
        <span class="qb-er-when">${escapeHtml(formatWhen(typeof when === "string" ? when : undefined))}</span>
        <span class="qb-er-vehicle">${escapeHtml(typeof vehicle === "string" ? vehicle : "—")}</span>
        <span class="qb-er-groups">${groupsBadgesHtml(entryset, byLabel)}</span>
        <span class="qb-er-count">${itemCount} items</span>
      </summary>
      <pre class="qb-er-json">${escapeHtml(JSON.stringify(entryset, null, 2))}</pre>
    </details>`;
}

export function renderDataPreview(state: AppState): void {
  const el = panelEls().preview;
  const p = state.preview;

  // §6: the preview never shows anything that does not belong to the query on
  // screen, and it says WHY it is empty. These three checks mirror statsPanel.ts.
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (state.selectedDatabaseIds.length === 0) {
    paint(el, hint("Select at least one database, then press Run."));
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, hint("Add a condition, then press Run."));
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, hint("Fix the errors in your query, then press Run."));
    return;
  }

  if (p.status === "idle") {
    // onQueryChange nulls preview.data in the same setState that writes the query,
    // so "idle" always means "nothing current" — never run yet, or edited since.
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui info message">Press <b>Run / Refresh</b> to load sample entrysets.</div>`,
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui segment"><div class="ui active inline loader"></div> Loading entrysets…</div>`,
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui negative message"><div class="header">Could not load entrysets</div><p>${escapeHtml(p.error)}</p></div>`,
    );
    return;
  }

  if (p.status !== "ok" || !p.data) {
    paint(el, "");
    return;
  }
  const byLabel = individualsByLabel(state);
  const rows = p.data.entrysets.map((e) => entrysetRowHtml(e, byLabel));

  paint(
    el,
    `<h4 class="ui header">Data preview</h4>
     <p class="ui small text">
       ${p.data.entrysets.length} entryset(s) matching your query — click a row to see its full JSON.
     </p>
     <div class="qb-entryset-list">${rows.join("")}</div>`,
  );
}
