import type { AppState } from "../state";
import type { Facet } from "../model";
import type { FieldRef } from "../query/drop";
import { findNode } from "../query/tree";
import type { FacetBlock } from "../query/types";
import { facetDetailsHtml, fieldDetailsHtml, totalEvents } from "./docsSidebar";
import { facetNameOrId, UNKNOWN_FACET } from "./facetWords";
import { escapeHtml, paint } from "./panel";

// The About tab of the panel beside each facet block (spec, section 5 and
// decision 17): the dictionary's words on the block's facet, or on the field
// selected for the panel, with a way back to the facet. It reuses the
// dictionary's detail parts (docsSidebar.ts), so the two never disagree.
//
// It has its own painter (`paintAboutPanels`), separate from the builder's:
// selecting a field happens on every focus move into a row, and a builder
// repaint then would close the dropdown the user just opened.

/** What the About panel needs from the state. */
export interface AboutCtx {
  /** The dictionary; null while it loads. */
  facets: Facet[] | null;
  /** All events of the loaded databases: "In N events (x %)". */
  totalEvents: number;
  /** The field About describes, if it is in this block. */
  selectedField: FieldRef | null;
}

/** The state keys `paintAboutPanels` listens to in main.ts. Only this one:
 *  everything else About shows also repaints the builder, which draws the
 *  About panels itself. */
export const ABOUT_PANEL_KEYS: (keyof AppState)[] = ["selectedField"];

export function aboutCtxOf(state: AppState): AboutCtx {
  return {
    facets: state.facets,
    totalEvents: totalEvents(state.databases),
    selectedField: state.selectedField,
  };
}

/** The words for a part the dictionary does not (or not yet) know
 *  (`UNKNOWN_FACET` is in facetWords.ts: the chart says it too). */
const UNKNOWN_FIELD = "This field is not in the data dictionary.";
const NO_DESCRIPTION = "No description in the data dictionary.";
/** Tells a first-time user that About can say more than the facet. */
const FIELD_HINT = "Click a field's name, or move into its row, to read about it.";

/** The dictionary's facet of `block`, or null when it does not (yet) know it. */
function facetOf(ctx: AboutCtx, block: FacetBlock): Facet | null {
  return ctx.facets?.find((f) => f.id === block.facetId) ?? null;
}

/** "About <facet>": the panel's title, and (in blockHtml.ts) its accessible
 *  name, from one place so the two never differ. The facet id stands in for
 *  a facet the dictionary does not know. Plain text: escape it for HTML. */
export function aboutTitle(ctx: AboutCtx, block: FacetBlock): string {
  return `About ${facetNameOrId(ctx.facets, block.facetId)}`;
}

/** The About panel's content for `block`: its facet, or the selected field
 *  when that field is in this block. */
export function aboutPanelHtml(ctx: AboutCtx, block: FacetBlock): string {
  const facet = facetOf(ctx, block);
  const title = escapeHtml(aboutTitle(ctx, block));
  const selected = ctx.selectedField?.blockId === block.id ? ctx.selectedField.fieldId : null;
  if (selected === null) {
    const details = facet
      ? facetDetailsHtml(facet, ctx.totalEvents)
      : `<p class="qb-muted">${UNKNOWN_FACET}</p>`;
    return `<h3 class="qb-about-title">${title}</h3>${details}<p class="qb-about-hint">${FIELD_HINT}</p>`;
  }
  const field = facet?.fields.find((f) => f.id === selected) ?? null;
  // The way back is drawn first, where the eye lands, before the details.
  const back = `<button type="button" class="ui mini basic button qb-about-back" data-action="about-facet"><span aria-hidden="true">←</span> ${title}</button>`;
  if (!field) {
    return `${back}<h3 class="qb-about-title"><code>${escapeHtml(selected)}</code></h3><p class="qb-muted">${UNKNOWN_FIELD}</p>`;
  }
  const details = fieldDetailsHtml(field) || `<p class="qb-muted">${NO_DESCRIPTION}</p>`;
  return `${back}<h3 class="qb-about-title"><code>${escapeHtml(field.name)}</code> <span class="qb-field-type">${escapeHtml(field.typeName)}</span></h3>${details}`;
}

/**
 * Repaint only the About panels in `container` (the builder), not the rows
 * beside them, so an open dropdown stays open. Each `.qb-about[data-block-id]`
 * keeps its element; only its content is rewritten. When the focus was on a
 * control that is gone afterwards (the "← About" button), it goes to the panel
 * itself rather than dropping to the page.
 */
export function paintAboutPanels(container: HTMLElement, state: AppState): void {
  const ctx = aboutCtxOf(state);
  for (const panel of container.querySelectorAll<HTMLElement>(".qb-about[data-block-id]")) {
    const block = findNode(state.query, panel.dataset.blockId!);
    if (block?.kind !== "facet") continue;
    const hadFocus = panel.contains(document.activeElement);
    paint(panel, aboutPanelHtml(ctx, block));
    if (hadFocus && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }
}
