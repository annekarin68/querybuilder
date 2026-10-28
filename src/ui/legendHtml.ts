// The colour legend of "Seen together" (spec, section 6): what the row of
// cells above every block and the square pie chart mean. It is only ever a
// popover from a small "?" (spec decision 22), so the builder stays compact.
// The popover is the browser's own (`<div popover>` opened by a
// `<button popovertarget>`): Escape, a click outside and the focus going back
// to the "?" come from the browser, with no jQuery. Pure strings and maths,
// so the Node-only tests can reach them; queryBuilder.ts places it on screen.

import { legendTicks, stepFactorText, type CoRange } from "../query/coOccurrence";
import { betterOn } from "../util/colour";
import type { CoTokens } from "./coTokens";
import { escapeHtml } from "./panel";

/** With no value anywhere in the matrix there is no scale to explain. The
 *  same words as the Seen together tab's (coOccurrenceHtml.ts). */
const NO_DATA = "No co-occurrence data for this facet.";
/** Without the colour tokens (the stylesheet did not load, or the dictionary
 *  is still loading) nothing is known about the data, so nothing is claimed. */
const CANNOT_SHOW = "The colours cannot be shown right now.";

/** The CSS gradient through the designer's stops, evenly spaced, as the
 *  colour scale places them (`coOccurrenceColour`). */
function gradient(stops: string[], space: string): string {
  const last = stops.length - 1;
  const parts = stops.map((stop, k) => `${stop} ${+((k / last) * 100).toFixed(3)}%`);
  return `linear-gradient(${space}to right,${parts.join(",")})`;
}

/** The bar, its stop labels, and "rarer" / "more often" under its ends. */
function barHtml(range: CoRange, stops: string[]): string {
  // Two declarations: a browser that cannot blend in OKLab (as the cells
  // are blended, `mixOklab`) drops the second and keeps the plain one.
  const style = `background-image:${gradient(stops, "")};background-image:${gradient(stops, "in oklab ")}`;
  // A label is moved left by its own share of the bar (translateX(-at %)):
  // the first starts at the left end, the last ends at the right end, and
  // the ones between sit round their stop. So no label sticks out.
  const ticks = legendTicks(range, stops.length)
    .map(({ at, label }) => {
      const percent = +(at * 100).toFixed(3);
      return `<span style="left:${percent}%;transform:translateX(-${percent}%)">${escapeHtml(label)}</span>`;
    })
    .join("");
  return `<div class="qb-legend-bar" style="${style}"></div>
    <div class="qb-legend-ticks">${ticks}</div>
    <div class="qb-legend-ends"><span>rarer</span><span>more often</span></div>`;
}

/** "Log scale: each step is about 10 times more often." Left out when every
 *  value is the same: then there are no steps. */
function stepHtml(range: CoRange, stopCount: number): string {
  if (range.min === range.max) return "";
  return `<p class="qb-legend-note">Log scale: each step is ${escapeHtml(stepFactorText(range, stopCount))} more often.</p>`;
}

/** One key: a sample mark drawn with the row's own classes, and its words. */
function keyHtml(cellClass: string, words: string, style = ""): string {
  const inline = style ? ` style="${style}"` : "";
  return `<li><span class="qb-co-cell ${cellClass}" aria-hidden="true"${inline}></span><span>${escapeHtml(words)}</span></li>`;
}

/** The four marks a cell can be (spec, section 6). The "seen" sample has the
 *  middle stop's colour, so it looks like a typical seen cell. */
function keysHtml(facetName: string, tokens: CoTokens): string {
  const middle = tokens.stops[Math.floor(tokens.stops.length / 2)] as string;
  const seenStyle = `background-color:${middle};color:${betterOn(middle, tokens.dotDark, tokens.dotLight)}`;
  return `<ul class="qb-legend-keys">
      ${keyHtml("is-seen", "Seen together", seenStyle)}
      ${keyHtml("is-never", "Never seen together")}
      ${keyHtml("is-own", `${facetName} itself`)}
      ${keyHtml("is-too-rare", "Seen together, too rare to colour")}
    </ul>`;
}

/**
 * What the popover says for the block of facet `facetName`: one sentence on
 * what is measured, the colour bar labelled with the real values of the
 * matrix-wide `range`, the log step, keys for the four marks, and that a
 * square opens the dictionary. A sentence instead when there is nothing to
 * explain: `tokens` null (no colours) or `range` null (no data at all).
 */
export function legendHtml(
  facetName: string,
  range: CoRange | null,
  tokens: CoTokens | null,
): string {
  const name = escapeHtml(facetName);
  if (!tokens || tokens.stops.length < 2) return `<p class="qb-muted">${CANNOT_SHOW}</p>`;
  if (!range) return `<p class="qb-muted">${NO_DATA}</p>`;
  return `<p class="qb-legend-sentence">How often each facet is seen together with <strong>${name}</strong>: the share of ${name}'s events that also hold it.</p>
    ${barHtml(range, tokens.stops)}
    ${stepHtml(range, tokens.stops.length)}
    ${keysHtml(facetName, tokens)}
    <p class="qb-legend-note">Click a square to open that facet in the data dictionary.</p>`;
}

/** The popover's id: one for the row's "?" and one for the Seen together
 *  tab's, per block (ids are unique on the page). */
export function legendId(blockId: string, where: "row" | "seen"): string {
  return where === "row" ? `legend-${blockId}` : `legend-${blockId}-seen`;
}

/**
 * The "?" and its popover. `action` (`legend` or `legend-seen`) is what focus
 * memory tells the two "?" of a block apart by after a repaint; the builder's
 * click handler has nothing to do for it (the browser opens the popover).
 * The popover follows the button in the page, so a screen reader reaches
 * its text right after the button.
 */
export function legendToggleHtml(id: string, action: string, content: string): string {
  const safeId = escapeHtml(id);
  return `<button type="button" class="qb-icon-btn qb-legend-btn" data-action="${action}" popovertarget="${safeId}" aria-label="Explain the colours" title="Explain the colours">?</button><div id="${safeId}" popover class="qb-legend">${content}</div>`;
}

// ---- Where the popover opens ---------------------------------------------

/** The popover's widest, and its distance from the button and the window's
 *  edges, in px. styles.css gives `.qb-legend` no width of its own. */
export const LEGEND_MAX_WIDTH_PX = 352;
export const LEGEND_GAP_PX = 8;

/** Where to put the popover (fixed, in window pixels). Exactly one of `top`
 *  and `bottom` is set: it opens below the button, or above it when there is
 *  more room there. */
export interface LegendPlacement {
  left: number;
  width: number;
  top: number | null;
  bottom: number | null;
  maxHeight: number;
}

/**
 * Places the popover by its "?" (`button`, the button's window rectangle).
 * A popover opens in the middle of the window unless placed, far from the
 * block it explains; CSS anchor positioning would do this, but not in every
 * desktop browser yet. Its right edge lines up with the button's, as the
 * "?" sits on the right; it never leaves the window, even at 512 px.
 */
export function legendPlacement(
  button: { top: number; bottom: number; right: number },
  viewport: { width: number; height: number },
): LegendPlacement {
  const gap = LEGEND_GAP_PX;
  const width = Math.min(LEGEND_MAX_WIDTH_PX, viewport.width - 2 * gap);
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
