// What the co-occurrence popovers share: the legend that a "?" opens
// (legendHtml.ts) and the list that the chart's "+ N less often" box opens
// (coOccurrenceHtml.ts). Both are the browser's own popover (`<div popover>`
// opened by a `<button popovertarget>`), so Escape, a click outside and the
// focus going back to the button come from the browser. Here: their class,
// their ids and where one opens. Pure, so the Node-only tests can reach it;
// coOccurrenceWiring.ts places them on screen.

/** The class every co-occurrence popover has: styles.css places and draws it
 *  with this class, and coOccurrenceWiring.ts finds the open one by it. */
export const POPOVER_CLASS = "qb-popover";

/** A popover's id, per block (ids are unique on the page): the row's "?"
 *  legend (`row`), the Seen together tab's "?" legend (`seen`), and the list
 *  of the chart's "+ N less often" box (`merged`). */
export function popoverId(blockId: string, where: "row" | "seen" | "merged"): string {
  return `popover-${blockId}-${where}`;
}

/** The popover's widest, and its distance from the button and the window's
 *  edges, in px. styles.css gives `.qb-popover` no width of its own. */
export const POPOVER_MAX_WIDTH_PX = 352;
export const POPOVER_GAP_PX = 8;

/** Where to put the popover (fixed, in window pixels). Exactly one of `top`
 *  and `bottom` is set: it opens below the button, or above it when there is
 *  more room there. */
export interface PopoverPlacement {
  left: number;
  width: number;
  top: number | null;
  bottom: number | null;
  maxHeight: number;
}

/**
 * Places the popover by the button that opens it (`button`, the button's
 * window rectangle: a "?" or the "+N" box). A popover opens in the middle of
 * the window unless placed, far from the block it is about; CSS anchor
 * positioning would do this, but not in every desktop browser yet. Its right
 * edge lines up with the button's, as the "?" sits on the right; it never
 * leaves the window, even at 512 px.
 */
export function popoverPlacement(
  button: { top: number; bottom: number; right: number },
  viewport: { width: number; height: number },
): PopoverPlacement {
  const gap = POPOVER_GAP_PX;
  const width = Math.min(POPOVER_MAX_WIDTH_PX, viewport.width - 2 * gap);
  const left = Math.max(gap, Math.min(button.right - width, viewport.width - width - gap));
  const roomBelow = viewport.height - button.bottom;
  const roomAbove = button.top;
  if (roomBelow >= roomAbove) {
    return { left, width, top: button.bottom + gap, bottom: null, maxHeight: roomBelow - 2 * gap };
  }
  return {
    left,
    width,
    top: null,
    bottom: viewport.height - button.top + gap,
    maxHeight: roomAbove - 2 * gap,
  };
}
