import type { AppState } from "../state";
import type { Individual } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

function hint(text: string): string {
  return `<h4 class="ui header">Data preview</h4><div class="ui info message">${escapeHtml(text)}</div>`;
}

function individualsByLabel(state: AppState): Map<string, Individual> {
  const map = new Map<string, Individual>();
  for (const item of state.individuals?.individuals ?? []) map.set(item.label, item);
  return map;
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
      `<h4 class="ui header">Data preview</h4><div class="ui info message">Press <b>Run / Refresh</b> to load the sample entryset.</div>`,
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui segment"><div class="ui active inline loader"></div> Loading entryset…</div>`,
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui negative message"><div class="header">Could not load entryset</div><p>${escapeHtml(p.error)}</p></div>`,
    );
    return;
  }

  if (p.status !== "ok" || !p.data) {
    paint(el, "");
    return;
  }
  const d = p.data;
  const byLabel = individualsByLabel(state);
  const rows = Object.entries(d.items).map(([slug, values]) => {
    const individual = byLabel.get(slug);
    const name = individual?.name ?? slug;
    const group = individual?.group ?? "—";
    const valuesText = Object.entries(values)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(group)}</td><td>${escapeHtml(valuesText)}</td></tr>`;
  });

  paint(
    el,
    `<h4 class="ui header">Data preview</h4>
     <p class="ui small text">
       Entryset #${d.id} — mock data; the query above does not filter this yet.
     </p>
     <table class="ui celled compact table">
       <thead><tr><th>Item</th><th>Group</th><th>Values</th></tr></thead>
       <tbody>${rows.join("")}</tbody>
     </table>`,
  );
}
