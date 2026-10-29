// Shows more of a folded facet's rows where they fit beside the panel
// (docs/ARCHITECTURE.md, "Centre — `queryBuilder.ts`", "Folding long
// facets"). A facet with 7 fields used to show 3 rows beside a chart twice
// their height; the rows below the fold now fill that room, and only the
// rest stay behind "+ N more fields" (maintainers, 2026-10-29). Only the
// browser knows the heights, so this runs after every paint and whenever a
// panel changes size. The arithmetic is `extraRowsToShow`, for the tests.

import { foldLabel } from "./fieldRows";

/** How many hidden rows of `rowHeight` px fit into `spare` px, at most
 *  `hidden`. A row that would stick out below the panel is not shown. */
export function extraRowsToShow(spare: number, rowHeight: number, hidden: number): number {
  if (rowHeight <= 0 || spare <= 0) return 0;
  return Math.max(0, Math.min(hidden, Math.floor(spare / rowHeight)));
}

/**
 * Fits the folded rows of one block body (`.qb-block-body`): first back to
 * how it was drawn, then, only while the panel stands beside the rows (not
 * under them, and not hidden), shows as many hidden rows (`data-folded`) as
 * fit within the panel's height, in the facet's order, and updates the fold
 * button: "+ N more fields" with the new N, or no button once none is left.
 */
export function fitFoldedRows(body: HTMLElement): void {
  const rows = body.querySelector<HTMLElement>(":scope > .qb-field-rows");
  const panel = body.querySelector<HTMLElement>(":scope > .qb-panel");
  const button = rows?.querySelector<HTMLElement>(":scope > .qb-more-fields") ?? null;
  if (!rows || !button || button.getAttribute("aria-expanded") === "true") return;
  const folded = Array.from(rows.querySelectorAll<HTMLElement>(":scope > [data-folded]"));
  folded.forEach((row) => (row.hidden = true));
  button.hidden = false;
  let shown = 0;
  const besidePanel = panel !== null && panel.offsetLeft > rows.offsetLeft;
  if (besidePanel && folded.length > 0) {
    // One row's height, gap included: what the rows grow by when it shows.
    const before = rows.offsetHeight;
    folded[0]!.hidden = false;
    const rowHeight = rows.offsetHeight - before;
    folded[0]!.hidden = true;
    // Once every row shows, the button goes too and leaves its room.
    const all = folded.length;
    const spareWithButton = panel.offsetHeight - rows.offsetHeight;
    const spareWithout = spareWithButton + button.offsetHeight;
    shown =
      extraRowsToShow(spareWithout, rowHeight, all) === all
        ? all
        : extraRowsToShow(spareWithButton, rowHeight, all);
    folded.slice(0, shown).forEach((row) => (row.hidden = false));
  }
  const left = folded.length - shown;
  button.hidden = left === 0;
  const label = foldLabel(left, false);
  button.textContent = label;
  button.setAttribute("aria-label", `${label} of ${button.dataset.facetName ?? ""}`);
}
