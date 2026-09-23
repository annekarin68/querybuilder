import type { AppState } from "../state";
import type { DatabasesResponse, Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, matchRatio } from "./format";

/** Total entrysets across every loaded database — the denominator for an
 * individual's percentage, since the backend no longer sends one directly
 * (Individual only carries totalCount, an absolute figure). */
function totalEntrysets(databases: DatabasesResponse[] | null): number {
  return databases?.reduce((s, d) => s + d.totalEntrysets, 0) ?? 0;
}

function groupLabel(group: string): string {
  return group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function itemHtml(item: Individual, total: number): string {
  const tags = item.tags.length
    ? `<div class="ui mini labels">${item.tags.map((t) => `<span class="ui mini label">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.name || f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type || f.format)}</span>`,
    )
    .join(" ");
  const ratio = matchRatio(item.totalCount, total);
  return `
    <div class="item" data-item-label="${escapeHtml(item.name.toLowerCase())}">
      <div class="content">
        <div class="header">${escapeHtml(item.name)}</div>
        ${tags}
        <div class="description">${escapeHtml(item.description)}</div>
        ${item.comment ? `<p class="ui small text"><i>${escapeHtml(item.comment)}</i></p>` : ""}
        <p class="ui small text" title="${escapeHtml(item.totalCount.toLocaleString())} of ${total.toLocaleString()} entrysets">
          In ${compact(item.totalCount)} entrysets (${ratio})
        </p>
        <p class="ui small text">${fields}</p>
      </div>
    </div>`;
}

function groupSectionHtml(group: string, items: Individual[], total: number): string {
  return `
    <div class="title" data-group-label="${escapeHtml(group.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(groupLabel(group))}
      <span class="ui mini label">${items.length}</span>
    </div>
    <div class="content" data-group-content="${escapeHtml(group)}">
      <div class="ui relaxed divided list">
        ${items.map((item) => itemHtml(item, total)).join("")}
      </div>
    </div>`;
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.individuals) {
    paint(
      el,
      `<div class="ui segment"><div class="ui active inline loader"></div> Loading individuals…</div>`,
    );
    return;
  }
  const total = totalEntrysets(state.databases);
  const groups = new Map<string, Individual[]>();
  for (const item of state.individuals) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }

  paint(
    el,
    `<h4 class="ui header">Individuals</h4>
     <div class="ui fluid icon input" style="margin-bottom:.5rem">
       <input type="text" id="qb-docs-filter" placeholder="Filter items…" />
       <i class="search icon"></i>
     </div>
     <div class="ui styled fluid accordion">
       ${[...groups.entries()].map(([group, items]) => groupSectionHtml(group, items, total)).join("")}
     </div>`,
  );

  const filter = el.querySelector<HTMLInputElement>("#qb-docs-filter");
  filter?.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>("[data-item-label]").forEach((node) => {
      node.style.display = node.dataset.itemLabel!.includes(q) ? "" : "none";
    });
  });
}
