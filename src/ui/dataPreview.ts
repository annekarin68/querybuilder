import type { AppState } from "../state";
import { queryToText } from "../query/summary";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

export function renderDataPreview(state: AppState): void {
  const el = panelEls().preview;
  const p = state.preview;

  if (p.status === "idle") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui message">Build a query and press <b>Run / Refresh</b>.</div>`,
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui segment"><div class="ui active inline loader"></div> Loading rows…</div>`,
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui negative message"><div class="header">Could not load rows</div><p>${escapeHtml(p.error)}</p></div>`,
    );
    return;
  }

  const d = p.data!;
  const summary = state.schema
    ? queryToText(state.query, { fields: state.schema.fields, operators: state.schema.operators })
    : "";
  const from = d.totalRows === 0 ? 0 : (d.page - 1) * d.pageSize + 1;
  const to = Math.min(d.page * d.pageSize, d.totalRows);
  const body = d.rows.length
    ? `<table class="ui celled compact table">
        <thead><tr>${d.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${d.rows
          .map(
            (r) => `<tr>${d.columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody>
      </table>`
    : `<div class="ui message">No rows match this query.</div>`;

  paint(
    el,
    `<h4 class="ui header">Data preview</h4>
     <p class="ui small text"><b>Query:</b> ${escapeHtml(summary)}</p>
     <p>Showing ${from}–${to} of ${d.totalRows.toLocaleString()}</p>
     ${body}
     <div class="ui buttons">
       <button class="ui button" data-preview="prev" ${d.page <= 1 ? "disabled" : ""}>Prev</button>
       <button class="ui button" data-preview="next" ${to >= d.totalRows ? "disabled" : ""}>Next</button>
     </div>`,
  );
}

export function wireDataPreview(
  container: HTMLElement,
  handlers: { prev(): void; next(): void },
): void {
  if (container.dataset.dpWired === "1") return;
  container.dataset.dpWired = "1";
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-preview]");
    if (!btn) return;
    if (btn.dataset.preview === "prev") handlers.prev();
    if (btn.dataset.preview === "next") handlers.next();
  });
}
