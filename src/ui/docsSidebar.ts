import type { AppState } from "../state";
import type { Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, matchRatio } from "./format";

/** The universe size implied by this item's own count/percentage — derived rather
 * than hardcoded, so this stays correct however large the real dataset is (the API
 * already tells us the ratio; we only need it back in absolute terms for display). */
function impliedTotal(stats: Individual["stats"]): number {
  return stats.percentage > 0 ? Math.round(stats.count / stats.percentage) : stats.count;
}

function groupLabel(group: string): string {
  return group.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function itemHtml(item: Individual): string {
  const tags = item.tags.length
    ? `<div class="ui mini labels">${item.tags.map((t) => `<span class="ui mini label">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";
  const fields = item.fields
    .map(
      (f) =>
        `<code>${escapeHtml(f.name || f.label)}</code> <span class="ui mini basic label">${escapeHtml(f.type)}</span>`,
    )
    .join(" ");
  const total = impliedTotal(item.stats);
  const ratio = matchRatio(item.stats.count, total);
  return `
    <div class="item" data-item-label="${escapeHtml(item.name.toLowerCase())}">
      <div class="content">
        <div class="header">${escapeHtml(item.name)}</div>
        ${tags}
        <div class="description">${escapeHtml(item.description)}</div>
        ${item.comment ? `<p class="ui small text"><i>${escapeHtml(item.comment)}</i></p>` : ""}
        <p class="ui small text" title="${escapeHtml(item.stats.count.toLocaleString())} of ${total.toLocaleString()} entrysets">
          In ${compact(item.stats.count)} entrysets (${ratio})
        </p>
        <p class="ui small text">${fields}</p>
      </div>
    </div>`;
}

function groupSectionHtml(group: string, items: Individual[]): string {
  return `
    <div class="title" data-group-label="${escapeHtml(group.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(groupLabel(group))}
      <span class="ui mini label">${items.length}</span>
    </div>
    <div class="content" data-group-content="${escapeHtml(group)}">
      <div class="ui relaxed divided list">
        ${items.map(itemHtml).join("")}
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
  const groups = new Map<string, Individual[]>();
  for (const item of state.individuals.individuals) {
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
       ${[...groups.entries()].map(([group, items]) => groupSectionHtml(group, items)).join("")}
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
