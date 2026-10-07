import type { AppState } from "../state";
import type { Database, Facet } from "../model";
import { escapeHtml, paint } from "./panel";
import { compact, countLabel, displayLabel, exact, matchRatio } from "./format";
import { groupByTag, matchDocs, UNTAGGED } from "./docsFilter";
import { DRAG_MIME, parseDragItem, type DragItem } from "../query/drop";
import { findField, type FieldCatalog } from "../query/fieldCatalog";

/** Total events across every loaded database — the denominator for a
 * facet's percentage. The backend sends no percentage: a Facet only carries
 * `eventCount`, an absolute figure. */
function totalEvents(databases: Database[] | null): number {
  return databases?.reduce((s, d) => s + d.eventCount, 0) ?? 0;
}

/** Most sample values shown per field; the rest are counted, not listed. */
const MAX_VALUE_CHIPS = 30;

/** The JSON for an element's `data-item` attribute (already HTML-escaped). It
 *  is what dragging the element carries, and what its "Add to query" button adds. */
export function dragData(item: DragItem): string {
  return escapeHtml(JSON.stringify(item));
}

const grip = `<span class="qb-grip" draggable="true" aria-hidden="true"><i class="grip vertical icon"></i></span>`;

/** The arrow in front of every row that opens when clicked. CSS turns it a
 *  quarter-turn while its <details> is open (styles.css, `.qb-chevron`). It is
 *  decoration: the icon font draws a stray character that screen readers would
 *  otherwise read out as part of the row's name. */
const chevron = `<i class="angle right icon qb-chevron" aria-hidden="true"></i>`;

/** Takes the chevron's place on a row with nothing to open, so its grip and
 *  name line up with the rows that do have a chevron (CSS gives it the width). */
const chevronSpacer = `<span class="qb-chevron-spacer" aria-hidden="true"></span>`;

/** What the sidebar tells people about its rows, shown under the title. */
export const DOCS_HINT =
  "Click a section, facet or field with an arrow to expand it. Drag it into the query, or press + Add.";

/**
 * The "Add to query" button. With `text` it is a labelled button, like the
 * builder's "+ Condition", so a "+" is never mistaken for "expand"; without it
 * (the small value chips) it is icon-only. Either way `label` names it for
 * screen readers.
 */
function addButton(label: string, text?: string): string {
  const aria = `aria-label="Add ${escapeHtml(label)} to the query" title="Add to query"`;
  if (!text) {
    return `<button type="button" class="qb-icon-btn qb-add-btn" data-action="add-item" ${aria}><i class="plus icon"></i></button>`;
  }
  return `<button type="button" class="ui mini basic button qb-add-btn" data-action="add-item" ${aria}><i class="plus icon"></i><span class="qb-add-label">${escapeHtml(text)}</span></button>`;
}

function valuesHtml(facet: Facet, fieldId: string, catalog: FieldCatalog | null): string {
  const options =
    findField(catalog ?? { facets: [], fields: [] }, facet.id, fieldId)?.options ?? [];
  if (options.length === 0) return "";
  const shown = options.slice(0, MAX_VALUE_CHIPS).map((value) => {
    const item = dragData({ type: "value", facetId: facet.id, fieldId, value });
    return `<span class="qb-doc-value" data-item="${item}">${grip}<span class="qb-doc-value-text">${escapeHtml(value)}</span>${addButton(value)}</span>`;
  });
  const more = options.length - shown.length;
  return `<div class="qb-doc-values" role="group" aria-label="Known values">${shown.join("")}${more > 0 ? `<span class="qb-muted">and ${more} more</span>` : ""}</div>`;
}

function fieldHtml(facet: Facet, f: Facet["fields"][number], catalog: FieldCatalog | null): string {
  const item = dragData({ type: "field", facetId: facet.id, fieldId: f.id });
  const blurb = f.comment || f.description;
  const values = valuesHtml(facet, f.id, catalog);
  // A field with nothing to show when opened is a plain row, not a <details>:
  // an arrow that opens onto nothing would teach people to distrust the arrows.
  if (!blurb && !values) {
    return `<div class="qb-doc-field is-leaf" data-field-id="${escapeHtml(f.id)}" data-item="${item}">
      <div class="qb-doc-field-row">
        ${chevronSpacer}
        ${grip}
        <code class="qb-doc-field-name">${escapeHtml(f.name)}</code>
        <span class="qb-field-type">${escapeHtml(f.typeName)}</span>
        ${addButton(f.name, "Add")}
      </div>
    </div>`;
  }
  return `<details class="qb-doc-field" data-field-id="${escapeHtml(f.id)}" data-item="${item}">
      <summary>
        ${chevron}
        ${grip}
        <code class="qb-doc-field-name">${escapeHtml(f.name)}</code>
        <span class="qb-field-type">${escapeHtml(f.typeName)}</span>
        ${addButton(f.name, "Add")}
        ${blurb ? `<span class="qb-doc-field-blurb">${escapeHtml(blurb)}</span>` : ""}
      </summary>
      <div class="qb-doc-field-body">
        ${f.comment ? `<p class="qb-doc-comment">${escapeHtml(f.comment)}</p>` : ""}
        ${f.description ? `<p class="qb-doc-desc" title="Third-party description; may contain errors">Third-party: ${escapeHtml(f.description)}</p>` : ""}
        ${values}
      </div>
    </details>`;
}

/** One facet card: a draggable header, then (when opened) its details and fields. */
export function facetHtml(facet: Facet, total: number, catalog: FieldCatalog | null): string {
  const tags = facet.tags.length
    ? `<div class="qb-doc-tags">${facet.tags.map((t) => `<span class="qb-tag">${escapeHtml(displayLabel(t))}</span>`).join("")}</div>`
    : "";
  const { group, description, comment } = facet;
  return `<details class="qb-doc-facet" data-facet-id="${escapeHtml(facet.id)}" data-item="${dragData({ type: "facet", facetId: facet.id })}">
      <summary>
        ${chevron}
        ${grip}
        <span class="qb-doc-name">${escapeHtml(facet.name)}</span>
        <span class="qb-count">${countLabel(facet.fields.length, "field")}</span>
        ${addButton(facet.name, "Add")}
      </summary>
      <div class="qb-doc-facet-body">
        ${tags}
        ${group ? `<p class="qb-doc-source" title="Third-party group">Group: ${escapeHtml(displayLabel(group))}</p>` : ""}
        ${comment ? `<p class="qb-doc-comment">${escapeHtml(comment)}</p>` : ""}
        ${description ? `<p class="qb-doc-desc">${escapeHtml(description)}</p>` : ""}
        <p class="qb-doc-count" title="${escapeHtml(exact(facet.eventCount))} of ${escapeHtml(exact(total))} events">In ${compact(facet.eventCount)} events (${matchRatio(facet.eventCount, total)})</p>
        <div class="qb-doc-fields">${facet.fields.map((f) => fieldHtml(facet, f, catalog)).join("")}</div>
      </div>
    </details>`;
}

/** One collapsible section per tag (see groupByTag); `UNTAGGED` gets its own. */
export function groupHtml(
  tag: string,
  facets: Facet[],
  total: number,
  catalog: FieldCatalog | null,
): string {
  const name =
    tag === UNTAGGED
      ? `<span class="qb-doc-group-name qb-doc-untagged">Untagged</span>`
      : `<span class="qb-doc-group-name">${escapeHtml(displayLabel(tag))}</span>`;
  // The tag's own <summary> carries the data-item, so closest("[data-item]")
  // from its grip or + button finds the tag, not a facet.
  const tagItem = tag === UNTAGGED ? "" : ` data-item="${dragData({ type: "tag", tag })}"`;
  const tagGrip = tag === UNTAGGED ? "" : grip;
  const tagAdd =
    tag === UNTAGGED
      ? ""
      : addButton(`all “${displayLabel(tag)}” facets`, `Add all ${facets.length}`);
  return `<details class="qb-doc-group" data-group="${escapeHtml(tag)}" data-size="${facets.length}">
      <summary${tagItem}>
        ${chevron}
        ${tagGrip}
        ${name}
        <span class="qb-count" data-group-count title="${countLabel(facets.length, "facet")}">${facets.length}</span>
        ${tagAdd}
      </summary>
      <div class="qb-doc-facets">${facets.map((facet) => facetHtml(facet, total, catalog)).join("")}</div>
    </details>`;
}

/**
 * Show only what matches: hide non-matching facets and groups, open the groups
 * that have a match (and the facet cards whose fields matched, highlighting
 * those fields), and swap each group's size for its match count.
 *
 * This is the one place a panel changes its painted DOM directly instead of
 * repainting: the filter text is local to this panel (not AppState), and a
 * repaint on every keystroke would throw away the input's focus and caret.
 */
function applyFilter(el: HTMLElement, facets: Facet[], query: string): void {
  const match = matchDocs(facets, query);
  el.querySelectorAll<HTMLElement>("[data-facet-id]").forEach((node) => {
    node.hidden = match !== null && !match.facets.has(node.dataset.facetId!);
    // Open a card whose field matched, so the reason for the match is visible;
    // clearing the filter closes it again, like the tag groups below.
    if (node instanceof HTMLDetailsElement) {
      node.open = match !== null && match.openFacets.has(node.dataset.facetId!);
    }
    const matchingFields = match?.fields.get(node.dataset.facetId!);
    node.querySelectorAll<HTMLElement>(".qb-doc-field").forEach((field) => {
      field.classList.toggle("is-match", matchingFields?.has(field.dataset.fieldId!) ?? false);
    });
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
         <button type="button" class="ui mini primary button" data-menu="toggle-sidebar" aria-expanded="true" aria-controls="qb-docs"><i class="angle double left icon"></i>Hide dictionary</button>
       </h2>
       <p class="qb-docs-hint">${escapeHtml(DOCS_HINT)}</p>
       <div class="ui fluid small input qb-docs-search">
         <input type="text" id="qb-docs-filter" placeholder="Search facets and fields…" aria-label="Search the data dictionary" autocomplete="off" />
         <button type="button" class="qb-icon-btn qb-docs-clear" data-action="clear-filter" aria-label="Clear search" hidden><i class="times icon"></i></button>
       </div>
       <p class="qb-docs-empty" hidden></p>
       <div class="qb-doc-groups">
         ${[...groups.entries()].map(([group, facets]) => groupHtml(group, facets, total, state.catalog)).join("")}
       </div>
     </div>`,
  );
}

/**
 * Delegated listeners for the whole panel: typing in the search box filters
 * (Escape or ✕ clears), grips start a drag, and "+" buttons call `onAdd`.
 * Call once at startup. `getFacets` reads the current facets when an event
 * fires, so the listeners never go stale across repaints.
 */
export function wireDocsSidebar(
  container: HTMLElement,
  getFacets: () => Facet[] | null,
  onAdd: (item: DragItem) => void,
): void {
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
  /** The drag/add data of the nearest item at or above `el`, if it parses. */
  const itemOf = (el: EventTarget | null): { node: HTMLElement; item: DragItem } | null => {
    const node = el instanceof Element ? el.closest<HTMLElement>("[data-item]") : null;
    const item = node ? parseDragItem(node.dataset.item!) : null;
    return node && item ? { node, item } : null;
  };

  container.addEventListener("dragstart", (e) => {
    const grabbed =
      e.target instanceof Element && e.target.closest(".qb-grip") ? itemOf(e.target) : null;
    if (!grabbed || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(grabbed.item));
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setDragImage(grabbed.node, 12, 12);
  });

  container.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    // A grip inside a <summary> would otherwise open/close its card.
    if (e.target.closest(".qb-grip")) e.preventDefault();
    const add = e.target.closest("[data-action='add-item']");
    if (add) {
      e.preventDefault(); // inside a <summary>: don't also open/close the card
      const found = itemOf(add);
      if (found) onAdd(found.item);
      return;
    }
    if (!e.target.closest("[data-action='clear-filter']")) return;
    const input = container.querySelector<HTMLInputElement>("#qb-docs-filter");
    if (!input) return;
    input.value = "";
    filter("");
    input.focus();
  });
}
