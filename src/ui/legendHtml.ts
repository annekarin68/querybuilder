// The colour legend of "Seen together" (spec, section 6): what the row of
// cells above every block and the square pie chart mean. It is only ever a
// popover from a small "?" (spec decision 22), so the builder stays compact.
// The popover is the browser's own (`<div popover>` opened by a
// `<button popovertarget>`): Escape, a click outside and the focus going back
// to the "?" come from the browser, with no jQuery. Pure strings and maths,
// so the Node-only tests can reach them; coOccurrenceWiring.ts places it on
// screen (popover.ts says where).

import { FULL_PERCENT, LEGEND_TICKS, coOccurrenceColour } from "../query/coOccurrence";
import { betterOn } from "../util/colour";
import type { CoTokens } from "./coTokens";
import { escapeHtml } from "./panel";
import { POPOVER_CLASS } from "./popover";

/** The CSS gradient through the designer's stops, evenly spaced, as the
 *  colour scale places them (`coOccurrenceColour`). */
function gradient(stops: string[], space: string): string {
  const last = stops.length - 1;
  const parts = stops.map((stop, k) => `${stop} ${+((k / last) * 100).toFixed(3)}%`);
  return `linear-gradient(${space}to right,${parts.join(",")})`;
}

/** The bar, its labels (`LEGEND_TICKS`: always five, however many stops),
 *  and "rarer" / "more often" under its ends. */
function barHtml(stops: string[]): string {
  // Two declarations: a browser that cannot blend in OKLab (as the cells
  // are blended, `mixOklab`) drops the second and keeps the plain one.
  const style = `background-image:${gradient(stops, "")};background-image:${gradient(stops, "in oklab ")}`;
  // A label is moved left by its own share of the bar (translateX(-at %)):
  // the first starts at the left end, the last ends at the right end, and
  // the ones between sit round their place. So no label sticks out.
  const ticks = LEGEND_TICKS.map(({ at, label }) => {
    const percent = +(at * 100).toFixed(3);
    return `<span style="left:${percent}%;transform:translateX(-${percent}%)">${escapeHtml(label)}</span>`;
  }).join("");
  return `<div class="qb-legend-bar" style="${style}"></div>
    <div class="qb-legend-ticks">${ticks}</div>
    <div class="qb-legend-ends"><span>rarer</span><span>more often</span></div>`;
}

/** One key: a sample mark drawn with the row's own classes, and its words. */
function keyHtml(cellClass: string, words: string, style = ""): string {
  const inline = style ? ` style="${style}"` : "";
  return `<li><span class="qb-co-cell ${cellClass}" aria-hidden="true"${inline}></span><span>${escapeHtml(words)}</span></li>`;
}

/** The marks a cell can be (spec, section 6). The "seen" sample has the
 *  middle stop's colour, so it looks like a typical seen cell; the "in
 *  every event" sample has the colour of 100 % and the dot only it has. */
function keysHtml(facetName: string, tokens: CoTokens): string {
  const sample = (colour: string) =>
    `background-color:${colour};color:${betterOn(colour, tokens.dotDark, tokens.dotLight)}`;
  const middle = tokens.stops[Math.floor(tokens.stops.length / 2)] as string;
  const full = coOccurrenceColour(FULL_PERCENT, tokens.stops);
  return `<ul class="qb-legend-keys">
      ${keyHtml("is-seen", "Seen together", sample(middle))}
      ${keyHtml("is-seen is-full", "Seen together in every event (100 %)", sample(full))}
      ${keyHtml("is-never", "Never seen together")}
      ${keyHtml("is-own", `${facetName} itself`)}
    </ul>`;
}

/** The button that shows or hides every row's facet names above its cells
 *  (`AppState.coNamesShown`). A toggle: its words stay, `aria-pressed`
 *  says whether it is on. */
function namesButton(shown: boolean): string {
  const icon = shown ? "check square outline" : "square outline";
  return `<button type="button" class="ui mini basic button qb-names-btn" data-action="co-names" aria-pressed="${shown}"><i class="${icon} icon" aria-hidden="true"></i>Show facet names above the squares</button>`;
}

/**
 * What the popover says for the block of facet `facetName`: one sentence on
 * what is measured, the colour bar, keys for the marks, the names toggle,
 * and that a square opens the dictionary. Only drawn for a block that has
 * a row, so there are always colour tokens (blockHtml.ts).
 */
export function legendHtml(facetName: string, tokens: CoTokens, namesShown: boolean): string {
  const name = escapeHtml(facetName);
  return `<p class="qb-legend-sentence">How often each facet is seen together with <strong>${name}</strong>: the share of ${name}'s events that also hold it.</p>
    ${barHtml(tokens.stops)}
    <p class="qb-legend-note">The colour follows the share evenly, from 0 % to 100 %.</p>
    ${keysHtml(facetName, tokens)}
    <p>${namesButton(namesShown)}</p>
    <p class="qb-legend-note">Click a square to open that facet in the data dictionary.</p>`;
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
  return `<button type="button" class="qb-icon-btn qb-legend-btn" data-action="${action}" popovertarget="${safeId}" aria-label="Explain the colours" title="Explain the colours">?</button><div id="${safeId}" popover class="${POPOVER_CLASS} qb-legend">${content}</div>`;
}
