import type { AppState } from "../state";
import type { Database, Facet } from "../model";
import { escapeHtml, paint } from "./panel";
import { compact, countLabel, displayLabel, fieldTitle, matchRatio } from "./format";
import { groupByTag, matchDocs, tagsOf, UNTAGGED } from "./docsFilter";

/** Total events across every loaded database — the denominator for a
 * facet's percentage. The backend sends no percentage: a Facet only carries
 * `eventCount`, an absolute figure. */
function totalEvents(databases: Database[] | null): number {
  return databases?.reduce((s, d) => s + d.eventCount, 0) ?? 0;
}

function facetHtml(facet: Facet, total: number): string {
  const tagList = tagsOf(facet).filter((t) => t !== UNTAGGED);
  const tags = tagList.length
    ? `<div class="qb-doc-tags">${tagList.map((t) => `<span class="qb-tag">${escapeHtml(displayLabel(t))}</span>`).join("")}</div>`
    : "";
  const { group, description, comment } = facet;
  const fields = facet.fields
    .map((f) => {
      const title = fieldTitle(f);
      return `<span class="qb-field-chip"${title ? ` title="${escapeHtml(title)}"` : ""}><code>${escapeHtml(f.name)}</code><span class="qb-field-type">${escapeHtml(f.typeName)}</span></span>`;
    })
    .join("");
  return `<div class="qb-doc-facet" data-facet-id="${escapeHtml(facet.id)}">
      <div class="qb-doc-name">${escapeHtml(facet.name)}</div>
      ${tags}
      ${group ? `<p class="qb-doc-source" title="Third-party group">Group: ${escapeHtml(displayLabel(group))}</p>` : ""}
      ${description ? `<p class="qb-doc-desc">${escapeHtml(description)}</p>` : ""}
      ${comment ? `<p class="qb-doc-comment">${escapeHtml(comment)}</p>` : ""}
      <p class="qb-doc-count" title="${escapeHtml(facet.eventCount.toLocaleString())} of ${total.toLocaleString()} events">
        In ${compact(facet.eventCount)} events (${matchRatio(facet.eventCount, total)})
      </p>
      <div class="qb-doc-fields">${fields}</div>
    </div>`;
}

/** One collapsible section per tag (see groupByTag); `UNTAGGED` gets its own. */
function groupHtml(tag: string, facets: Facet[], total: number): string {
  const name =
    tag === UNTAGGED
      ? `<span class="qb-doc-group-name qb-doc-untagged">Untagged</span>`
      : `<span class="qb-doc-group-name">${escapeHtml(displayLabel(tag))}</span>`;
  return `<details class="qb-doc-group" data-group="${escapeHtml(tag)}" data-size="${facets.length}">
      <summary>
        ${name}
        <span class="qb-count" data-group-count>${facets.length}</span>
      </summary>
      <div class="qb-doc-facets">${facets.map((facet) => facetHtml(facet, total)).join("")}</div>
    </details>`;
}

/**
 * Show only what matches: hide non-matching facets and groups, open the groups
 * that have a match, and swap each group's size for its match count.
 *
 * This is the one place a panel changes its painted DOM directly instead of
 * repainting: the filter text is local to this panel (not AppState), and a
 * repaint on every keystroke would throw away the input's focus and caret.
 */
function applyFilter(el: HTMLElement, facets: Facet[], query: string): void {
  const match = matchDocs(facets, query);
  el.querySelectorAll<HTMLElement>("[data-facet-id]").forEach((node) => {
    node.hidden = match !== null && !match.facets.has(node.dataset.facetId!);
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
  empty.hidden = !match || match.facets.size > 0;
  empty.textContent = `No facets match “${query.trim()}”.`;
  el.querySelector<HTMLElement>("[data-action='clear-filter']")!.hidden = query === "";
}

export function renderDocsSidebar(el: HTMLElement, state: AppState): void {
  if (!state.facets) {
    paint(
      el,
      `<div class="qb-card"><div class="ui active mini inline loader"></div> Loading the data dictionary…</div>`,
    );
    return;
  }
  const total = totalEvents(state.databases);
  const groups = groupByTag(state.facets);

  paint(
    el,
    `<div class="qb-card qb-docs">
       <h2 class="qb-card-title">
         Data dictionary
         <span class="qb-spacer"></span>
         <button type="button" class="qb-icon-btn" data-menu="toggle-sidebar" aria-label="Close the data dictionary" title="Close"><i class="times icon"></i></button>
       </h2>
       <div class="ui fluid small input qb-docs-search">
         <input type="text" id="qb-docs-filter" placeholder="Search facets and fields…" aria-label="Search the data dictionary" autocomplete="off" />
         <button type="button" class="qb-icon-btn qb-docs-clear" data-action="clear-filter" aria-label="Clear search" hidden><i class="times icon"></i></button>
       </div>
       <p class="qb-docs-empty" hidden></p>
       <div class="qb-doc-groups">
         ${[...groups.entries()].map(([group, facets]) => groupHtml(group, facets, total)).join("")}
       </div>
     </div>`,
  );
}

/**
 * Delegated listeners for the search box: typing filters, Escape or ✕ clears.
 * Call once at startup. `getFacets` reads the current facets when an event
 * fires, so the listeners never go stale across repaints.
 */
export function wireDocsSidebar(container: HTMLElement, getFacets: () => Facet[] | null): void {
  const isSearch = (t: EventTarget | null): t is HTMLInputElement =>
    t instanceof HTMLInputElement && t.id === "qb-docs-filter";
  const filter = (text: string) => {
    const facets = getFacets();
    if (facets) applyFilter(container, facets, text);
  };

  container.addEventListener("input", (e) => {
    if (isSearch(e.target)) filter(e.target.value);
  });
  container.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isSearch(e.target) || !e.target.value) return;
    e.target.value = "";
    filter("");
  });
  container.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("[data-action='clear-filter']")) return;
    const input = container.querySelector<HTMLInputElement>("#qb-docs-filter");
    if (!input) return;
    input.value = "";
    filter("");
    input.focus();
  });
}
