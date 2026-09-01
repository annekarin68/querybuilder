import type { AppState } from "../state";
import type { SchemaResponse } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

function sectionHtml(schema: SchemaResponse, field: SchemaResponse["fields"][number]): string {
  const ops = field.operatorIds
    .map((id) => schema.operators.find((o) => o.id === id))
    .filter((o): o is SchemaResponse["operators"][number] => Boolean(o));
  return `
    <div class="title" data-field-label="${escapeHtml(field.label.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(field.label)}
      <span class="ui mini label">${escapeHtml(field.valueType)}</span>
    </div>
    <div class="content" data-field-label="${escapeHtml(field.label.toLowerCase())}">
      <p>${escapeHtml(field.description)}</p>
      <div class="ui relaxed list">
        ${ops
          .map(
            (o) => `<div class="item"><div class="content">
              <div class="header">${escapeHtml(o.label)}</div>
              <div class="description">${escapeHtml(o.description)}</div>
            </div></div>`,
          )
          .join("")}
      </div>
    </div>`;
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.schema) {
    paint(
      el,
      `<div class="ui segment"><div class="ui active inline loader"></div> Loading fields…</div>`,
    );
    return;
  }
  const { schema } = state;
  paint(
    el,
    `<h4 class="ui header">Fields &amp; operators</h4>
     <div class="ui fluid icon input" style="margin-bottom:.5rem">
       <input type="text" id="qb-docs-filter" placeholder="Filter fields…" />
       <i class="search icon"></i>
     </div>
     <div class="ui styled fluid accordion">
       ${schema.fields.map((f) => sectionHtml(schema, f)).join("")}
     </div>`,
  );

  const filter = el.querySelector<HTMLInputElement>("#qb-docs-filter");
  filter?.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>("[data-field-label]").forEach((node) => {
      node.style.display = node.dataset.fieldLabel!.includes(q) ? "" : "none";
    });
  });
}
