import type { AppState } from "../state";
import type { DatabasesResponse, Individual } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { compact, countLabel, displayLabel, fieldTitle, matchRatio, text } from "./format";
import { groupByTag, matchDocs, tagsOf, UNTAGGED } from "./docsFilter";

/** Total entrysets across every loaded database — the denominator for an
 * individual's percentage, since the backend no longer sends one directly
 * (Individual only carries totalCount, an absolute figure). */
function totalEntrysets(databases: DatabasesResponse[] | null): number {
  return databases?.reduce((s, d) => s + d.totalEntrysets, 0) ?? 0;
}

function itemHtml(item: Individual, total: number): string {
  const tagList = tagsOf(item).filter((t) => t !== UNTAGGED);
  const tags = tagList.length
    ? `<div class="qb-doc-tags">${tagList.map((t) => `<span class="qb-tag">${escapeHtml(displayLabel(t))}</span>`).join("")}</div>`
    : "";
  const group = text(item.group);
  const description = text(item.description);
  const comment = text(item.comment);
  const fields = item.fields
    .map((f) => {
      const title = fieldTitle(f);
      return `<span class="qb-field-chip"${title ? ` title="${escapeHtml(title)}"` : ""}><code>${escapeHtml(f.name || f.label)}</code><span class="qb-field-type">${escapeHtml(f.type || f.format)}</span></span>`;
    })
    .join("");
  return `<div class="qb-doc-item" data-item-label="${escapeHtml(item.label)}">
      <div class="qb-doc-name">${escapeHtml(item.name)}</div>
      ${tags}
      ${group ? `<p class="qb-doc-source" title="Third-party group">Group: ${escapeHtml(displayLabel(group))}</p>` : ""}
      ${description ? `<p class="qb-doc-desc">${escapeHtml(description)}</p>` : ""}
      ${comment ? `<p class="qb-doc-comment">${escapeHtml(comment)}</p>` : ""}
      <p class="qb-doc-count" title="${escapeHtml(item.totalCount.toLocaleString())} of ${total.toLocaleString()} entrysets">
        In ${compact(item.totalCount)} entrysets (${matchRatio(item.totalCount, total)})
      </p>
      <div class="qb-doc-fields">${fields}</div>
    </div>`;
}

/** One collapsible section per tag (see groupByTag); `UNTAGGED` gets its own. */
function groupHtml(tag: string, items: Individual[], total: number): string {
  const name =
    tag === UNTAGGED
      ? `<span class="qb-doc-group-name qb-doc-untagged">Untagged</span>`
      : `<span class="qb-doc-group-name">${escapeHtml(displayLabel(tag))}</span>`;
  return `<details class="qb-doc-group" data-group="${escapeHtml(tag)}" data-size="${items.length}">
      <summary>
        ${name}
        <span class="qb-count" data-group-count>${items.length}</span>
      </summary>
      <div class="qb-doc-items">${items.map((item) => itemHtml(item, total)).join("")}</div>
    </details>`;
}

/**
 * Show only what matches: hide non-matching items and groups, open the groups
 * that have a match, and swap each group's size for its match count. This
 * sets hidden/open on the painted DOM directly instead of repainting — the
 * filter text is local to this panel (not AppState), and a repaint on every
 * keystroke would throw away the input's focus and caret.
 */
function applyFilter(el: HTMLElement, individuals: Individual[], query: string): void {
  const match = matchDocs(individuals, query);
  el.querySelectorAll<HTMLElement>("[data-item-label]").forEach((node) => {
    node.hidden = match !== null && !match.items.has(node.dataset.itemLabel!);
  });
  el.querySelectorAll<HTMLDetailsElement>("details[data-group]").forEach((group) => {
    const count = group.querySelector<HTMLElement>("[data-group-count]")!;
    if (!match) {
      group.hidden = false;
      group.open = false;
      count.textContent = group.dataset.size!;
      return;
    }
    const n = match.groups.get(group.dataset.group!) ?? 0;
    group.hidden = n === 0;
    group.open = n > 0;
    count.textContent = countLabel(n, "match", "matches");
  });
  const empty = el.querySelector<HTMLElement>(".qb-docs-empty")!;
  empty.hidden = !match || match.items.size > 0;
  empty.textContent = `No items match “${query.trim()}”.`;
  el.querySelector<HTMLElement>("[data-action='clear-filter']")!.hidden = query === "";
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.individuals) {
    paint(
      el,
      `<div class="qb-card"><div class="ui active mini inline loader"></div> Loading the data dictionary…</div>`,
    );
    return;
  }
  const individuals = state.individuals;
  const total = totalEntrysets(state.databases);
  const groups = groupByTag(individuals);

  paint(
    el,
    `<div class="qb-card qb-docs">
       <h2 class="qb-card-title">
         Data dictionary
         <span class="qb-spacer"></span>
         <button type="button" class="qb-icon-btn" data-menu="toggle-sidebar" aria-label="Close the data dictionary" title="Close"><i class="times icon"></i></button>
       </h2>
       <div class="ui fluid small input qb-docs-search">
         <input type="text" id="qb-docs-filter" placeholder="Search items and fields…" aria-label="Search the data dictionary" autocomplete="off" />
         <button type="button" class="qb-icon-btn qb-docs-clear" data-action="clear-filter" aria-label="Clear search" hidden><i class="times icon"></i></button>
       </div>
       <p class="qb-docs-empty" hidden></p>
       <div class="qb-doc-groups">
         ${[...groups.entries()].map(([group, items]) => groupHtml(group, items, total)).join("")}
       </div>
     </div>`,
  );

  const input = el.querySelector<HTMLInputElement>("#qb-docs-filter")!;
  const clear = () => {
    input.value = "";
    applyFilter(el, individuals, "");
  };
  input.addEventListener("input", () => applyFilter(el, individuals, input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) clear();
  });
  el.querySelector("[data-action='clear-filter']")!.addEventListener("click", () => {
    clear();
    input.focus();
  });
}
