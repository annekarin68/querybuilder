// "Seen together" on screen (spec, section 6): the row of small cells above
// every facet block, and the square pie chart of the Seen together tab. Pure
// strings, so the Node-only tests can reach them; queryBuilder.ts paints
// them and coOccurrenceWiring.ts wires their arrow keys. The maths is in src/query/coOccurrence.ts.

import type { CoValue, Facet } from "../model";
import {
  coOccurrenceColour,
  coOccurrenceRange,
  connectedFacets,
  formatPercent,
  roundPercentText,
  squarify,
  type CoRange,
  type Rect,
} from "../query/coOccurrence";
import type { FacetBlock } from "../query/types";
import { betterOn } from "../util/colour";
import type { CoTokens } from "./coTokens";
import { facetNameOrId, UNKNOWN_FACET } from "./facetWords";
import { escapeHtml } from "./panel";
import { POPOVER_CLASS, popoverId } from "./popover";

/** What the row and the chart of every block need. Worked out once per
 *  paint (`coCtxOf`), because the connected facets and the colour range are
 *  the same in every block. */
export interface CoCtx {
  /** The dictionary. */
  facets: Facet[];
  /** The facets of the row: seen with at least one other, dictionary order. */
  connected: Facet[];
  /** The colour scale's ends; null when nothing is ever seen together. */
  range: CoRange | null;
  tokens: CoTokens;
}

/** The two matrix-wide results, kept per dictionary: the builder repaints on
 *  every edit, and the dictionary only changes when it is loaded again. */
const matrixCache = new WeakMap<Facet[], { connected: Facet[]; range: CoRange | null }>();

/** The context for one paint, or null when there is nothing to colour with:
 *  without two colour stops (the stylesheet did not load) the row and the
 *  chart are left out. Co-occurrence is display data and never blocks the
 *  builder. */
export function coCtxOf(facets: Facet[], tokens: CoTokens): CoCtx | null {
  if (tokens.stops.length < 2) return null;
  let matrix = matrixCache.get(facets);
  if (!matrix) {
    matrix = { connected: connectedFacets(facets), range: coOccurrenceRange(facets) };
    matrixCache.set(facets, matrix);
  }
  return { facets, ...matrix, tokens };
}

/** Said (hover and screen readers) by a block whose facet is seen with no
 *  other facet; its row is a row of never-seen cells. */
const NEVER_WITH_ANY = "Never seen together with another facet.";
const NO_DATA = "No co-occurrence data for this facet.";
/** Without a context (the dictionary is loading, or the colour tokens are
 *  missing) nothing is known about the data, so nothing is claimed about it. */
const CANNOT_SHOW = "Seen together cannot be shown right now.";

/** What a cell (or a box) shows about another facet. */
export type CellKind = "own" | "seen" | "too-rare" | "never";

/** One facet as seen from a block's facet: what it is, its name for hover
 *  and screen readers, and its colours (only a seen one has any). */
export interface CoMark {
  facet: Facet;
  kind: CellKind;
  name: string;
  /** What the caption and the merged list show: `name`, but with the
   *  backend's number cut to a few digits (`roundPercentText`). The name
   *  keeps the full text for screen readers. */
  caption: string;
  /** The value's size, 0 to 100; 0 for every kind but "seen" (a too-rare
   *  value is below what a number holds). */
  percent: number;
  /** Only for "seen": the heat colour and the dot (or label) on it. */
  background: string | null;
  ink: string | null;
}

/** The block's facet from the dictionary, or null when it does not know it. */
function ownFacet(ctx: CoCtx, block: FacetBlock): Facet | null {
  return ctx.facets.find((f) => f.id === block.facetId) ?? null;
}

/** Whether `block` has a co-occurrence row (and so a "?" for its colours):
 *  some facet is seen with another, and the block's own facet has data. A
 *  facet the backend sent no `co_occurrence` for has none: "no data" is not
 *  "never seen together", and a row of never-seen cells would claim the
 *  second. A facet the dictionary does not know keeps its row, as before. */
export function hasCoRow(ctx: CoCtx, block: FacetBlock): boolean {
  if (ctx.connected.length === 0) return false;
  return ownFacet(ctx, block)?.coOccurrence !== null;
}

function kindOf(own: Facet | null, other: Facet, value: CoValue | undefined): CellKind {
  if (own && other.id === own.id) return "own";
  if (value?.tooRare) return "too-rare";
  return value && value.percent > 0 ? "seen" : "never";
}

/** How `other` is seen from `own` (null: a facet the dictionary does not
 *  know, which is drawn as seen with nobody). `ownName` names the block. */
function markOf(ctx: CoCtx, own: Facet | null, ownName: string, other: Facet): CoMark {
  const value = own?.coOccurrence?.get(other.id);
  const kind = kindOf(own, other, value);
  const percent = kind === "seen" ? value!.percent : 0;
  const mark = { facet: other, kind, percent, background: null, ink: null };
  // The name says the backend's text in full; the caption rounds it.
  const worded = (text: string) => `${other.name}: ${formatPercent(text)} of ${ownName}'s events`;
  const both = (words: (text: string) => string) => ({
    name: words(value?.text ?? ""),
    caption: words(roundPercentText(value?.text ?? "")),
  });
  switch (kind) {
    case "own": {
      const name = `${other.name} (this facet)`;
      return { ...mark, name, caption: name };
    }
    case "too-rare":
      // Still the backend's text ("1e-400 %"): it is all there is to say
      // about a value too small for a number, and hover must never lose it.
      return { ...mark, ...both((text) => `${worded(text)}, too rare to colour`) };
    case "never": {
      const name = `${other.name}: never seen together`;
      return { ...mark, name, caption: name };
    }
    case "seen": {
      const { stops, dotDark, dotLight } = ctx.tokens;
      // A seen value is always inside the range, which is built from them all.
      const range = ctx.range ?? { min: value!.percent, max: value!.percent };
      const background = coOccurrenceColour(value!.percent, range, stops);
      return {
        ...mark,
        // The name has the backend's own text, never re-formatted (formatPercent).
        ...both(worded),
        background,
        ink: betterOn(background, dotDark, dotLight),
      };
    }
  }
}

/** The inline colours of a seen cell or box; the other kinds take theirs
 *  from styles.css. */
function colourStyle(mark: CoMark): string {
  return mark.background ? `background-color:${mark.background};color:${mark.ink}` : "";
}

/** ` data-caption="…"` when the caption differs from the accessible name
 *  (it shows the rounded number), else nothing: the caption falls back to the
 *  name, so repeating it would only make the page larger. */
function captionAttr(mark: CoMark): string {
  return mark.caption === mark.name ? "" : ` data-caption="${escapeHtml(mark.caption)}"`;
}

/** The roving tabindex: only the first item of a row or chart is a Tab stop;
 *  the arrow keys move inside it (coOccurrenceWiring.ts). */
const tabindexAt = (index: number) => (index === 0 ? "0" : "-1");

/**
 * The co-occurrence row above a block's head: one cell per connected facet,
 * in dictionary order, the same cells in every block. A cell is a button
 * that opens the dictionary at its facet (`data-facet-id`; `data-opens-docs`
 * keeps that click from also closing the floating dictionary, main.ts);
 * `data-co-cell` is what focus memory finds it by after a repaint (a box in
 * the chart has the same facet id, so `data-facet-id` alone would mix them
 * up). Empty when no facet is seen with any other: there is no data.
 */
export function coRowHtml(ctx: CoCtx, block: FacetBlock): string {
  if (!hasCoRow(ctx, block)) return "";
  const own = ownFacet(ctx, block);
  const ownName = facetNameOrId(ctx.facets, block.facetId);
  const marks = ctx.connected.map((other) => markOf(ctx, own, ownName, other));
  // Decided from this block's own values, as the chart is, so the two agree:
  // a facet that only other facets name is seen with nobody from its side.
  const isolated = marks.every((mark) => mark.kind === "never" || mark.kind === "own");
  const cells = marks
    .map((mark, index) => {
      const other = mark.facet;
      const name = escapeHtml(mark.name);
      const style = colourStyle(mark);
      const id = escapeHtml(other.id);
      return `<button type="button" class="qb-co-cell is-${mark.kind}" data-co-cell="${id}" data-facet-id="${id}" data-opens-docs tabindex="${tabindexAt(index)}" aria-label="${name}"${captionAttr(mark)}${style ? ` style="${style}"` : ""}></button>`;
    })
    .join("");
  // A title on the group itself: the browser shows it on the gaps and reads
  // it to screen readers as the group's description.
  const title = isolated ? ` title="${NEVER_WITH_ANY}"` : "";
  return `<div class="qb-co-row" role="group" aria-label="Seen together with ${escapeHtml(ownName)}"${title} data-roving>${cells}</div>`;
}

// ---- The caption ----------------------------------------------------------

/**
 * The line that shows the name and value of the cell or box under the
 * pointer or the keyboard focus. A `title` shows on hover only, never on
 * keyboard focus, and the spec asks for both (section 6); so the cells and
 * boxes have no `title`, which would repeat the caption a second later. It
 * shows an item's `data-caption`, else its accessible name (only the merged
 * box has one: its name is the whole list). It is `aria-hidden`: the words
 * are the item's accessible name already, and a screen reader would read
 * them twice. styles.css lays it over the page on one line (it takes no
 * room, and a long one ends in "…"), so showing it moves nothing.
 */
export const CAPTION = `<p class="qb-co-caption" aria-hidden="true"></p>`;

/** What the caption says: the hovered item's name while the pointer is on
 *  one (the user is looking there), else the focused item's, else nothing. */
export function captionText(hovered: string | null, focused: string | null): string {
  return hovered ?? focused ?? "";
}

// ---- The square pie chart -------------------------------------------------

/** The chart's box, in the units `squarify` lays out in. The HTML turns them
 *  into percentages, so the chart stretches with the panel. */
const CHART_WIDTH = 100;
const CHART_HEIGHT = 60;
/** The panel's typical width is about 300 px: one unit is about 3 px. The
 *  12 px rule is worked out at that size. The labels are not: every box gets
 *  one (the merged box two), and the browser, which knows the real size,
 *  hides those that do not fit (hideCutLabels, coOccurrenceWiring.ts). */
const PX_PER_UNIT = 3;
/** A box thinner than this is hard to see and to press: it is merged. */
const MIN_BOX_PX = 12;
/** "+ N less often" stands for a list, not one value, so it is not drawn to
 *  scale: it starts at this share of the chart and grows (MERGED_GROWTH)
 *  until it, too, is at least MIN_BOX_PX thick, so it can be seen and pressed
 *  (it also needs a size when it only holds values too rare to have one). */
const MERGED_MIN_SHARE = 0.02;
const MERGED_MAX_SHARE = 0.5;
const MERGED_GROWTH = 1.5;

export interface SeenBox {
  mark: CoMark;
  rect: Rect;
}

export interface MergedBox {
  /** The facets it stands for, largest first, the too-rare ones last. */
  items: CoMark[];
  rect: Rect;
}

export interface SeenLayout {
  /** Largest first. */
  boxes: SeenBox[];
  merged: MergedBox | null;
}

const isTiny = (rect: Rect) => Math.min(rect.w, rect.h) * PX_PER_UNIT < MIN_BOX_PX;

/**
 * The square pie chart of facet `own`: one box per facet it is seen with,
 * area proportional to the value; never-seen facets are absent. Values too
 * rare to have a size, and boxes too small to see, go into one "+ N less
 * often" box, always the rarest ones. Merging gives the other boxes more
 * room, so it is repeated until no box is too small.
 */
export function seenLayout(ctx: CoCtx, own: Facet): SeenLayout {
  const marks = ctx.connected
    .map((other) => markOf(ctx, own, own.name, other))
    .filter((mark) => mark.kind === "seen" || mark.kind === "too-rare");
  const percentOf = (mark: CoMark) => mark.percent;
  // A stable sort keeps the dictionary order between equal values.
  const bySize = (a: CoMark, b: CoMark) => percentOf(b) - percentOf(a);
  let shown = marks.filter((m) => m.kind === "seen").sort(bySize);
  let merged = marks.filter((m) => m.kind === "too-rare");

  let mergedShare = MERGED_MIN_SHARE;
  for (;;) {
    const values = shown.map(percentOf);
    const rects = squarify(
      [...values, mergedValue(values, merged, mergedShare)],
      CHART_WIDTH,
      CHART_HEIGHT,
      // Always last (bottom-right), whatever its size: it is an aggregate,
      // not "the most often", and in production it is often the largest.
      true,
    );
    const tiny = shown.filter((_, index) => isTiny(rects[index] as Rect));
    if (tiny.length > 0) {
      // Merged by value, not by shape: "less often" must hold, so every
      // merged facet is rarer than every box still shown. A box can be thin
      // because of where squarify put it, so all values up to the smallest
      // thin one go (at least that one, so the loop ends).
      const limit = Math.min(...tiny.map(percentOf));
      const rarer = shown.filter((m) => percentOf(m) <= limit);
      shown = shown.filter((m) => percentOf(m) > limit);
      // Largest first; the too-rare ones (size 0) stay last.
      merged = [...rarer, ...merged].sort(bySize);
      continue;
    }
    const mergedRect = rects[shown.length] as Rect;
    if (merged.length > 0 && isTiny(mergedRect) && mergedShare < MERGED_MAX_SHARE) {
      mergedShare = Math.min(MERGED_MAX_SHARE, mergedShare * MERGED_GROWTH);
      continue;
    }
    const boxes = shown.map((mark, index) => ({ mark, rect: rects[index] as Rect }));
    return { boxes, merged: merged.length ? { items: merged, rect: mergedRect } : null };
  }
}

/** The size `squarify` gets for "+ N less often": the merged values, but at
 *  least `share` of the whole chart (0 when nothing is merged). */
function mergedValue(shownValues: number[], merged: CoMark[], share: number): number {
  if (merged.length === 0) return 0;
  const shownTotal = shownValues.reduce((sum, v) => sum + v, 0);
  // A too-rare value's percent is 0: its real size is below what a number holds.
  const mergedSum = merged.reduce((sum, m) => sum + m.percent, 0);
  if (shownTotal === 0) return 1; // the merged box is the whole chart
  // share = value / (shownTotal + value), solved for value.
  return Math.max(mergedSum, (share * shownTotal) / (1 - share));
}

/** A length in chart units as a percentage of the chart's side. */
const percentOfSide = (units: number, side: number) => `${+((units / side) * 100).toFixed(3)}%`;

function placeStyle(rect: Rect): string {
  return [
    `left:${percentOfSide(rect.x, CHART_WIDTH)}`,
    `top:${percentOfSide(rect.y, CHART_HEIGHT)}`,
    `width:${percentOfSide(rect.w, CHART_WIDTH)}`,
    `height:${percentOfSide(rect.h, CHART_HEIGHT)}`,
  ].join(";");
}

/** "1 facet" / "30 facets". */
const facetCount = (n: number) => `${n} ${n === 1 ? "facet" : "facets"}`;

/** The caption of "+ N less often": what it is, in one short line. */
function mergedCaption(merged: MergedBox): string {
  return `${facetCount(merged.items.length)}, each less often than the boxes shown`;
}

/** The merged box's accessible name lists what it stands for, since it has
 *  no label for each. It can be thousands of characters, too long for the
 *  caption, which gets `mergedCaption` instead (`data-caption`). */
function mergedName(merged: MergedBox): string {
  return `${merged.items.length} less often: ${merged.items.map((m) => m.name).join("; ")}`;
}

/**
 * What "+ N less often" stands for, as a popover its box opens (click or
 * Enter; `popovertarget`): sighted users see only "+N" on the box, and a
 * box that does nothing when pressed would be a dead control. Each facet in
 * the words of its cell, largest first, the too-rare ones last (the order of
 * `MergedBox.items`). It is a popover like the legend (`POPOVER_CLASS`), so
 * coOccurrenceWiring.ts places it by its box, follows the scroll and reopens
 * it after a repaint as it does a legend. It sits after the chart, not inside it: the chart's arrow keys go
 * through the chart's own buttons only (`rovingItems`). Plain text items,
 * for now: the facets are also cells in the row above, which open the
 * dictionary.
 */
function mergedListHtml(id: string, merged: MergedBox, ownName: string): string {
  const items = merged.items.map((m) => `<li>${escapeHtml(m.caption)}</li>`).join("");
  return `<div id="${escapeHtml(id)}" popover class="${POPOVER_CLASS}"><p>${facetCount(merged.items.length)} seen together less often with <strong>${escapeHtml(ownName)}</strong>:</p><ul class="qb-merged-list">${items}</ul></div>`;
}

/**
 * The Seen together tab of `block`: its title and the square pie chart. A box
 * is a button with the same name as the cell of its facet, a roving tabindex
 * like the row's, and `data-facet-id` and `data-opens-docs` like a cell's (a
 * click opens the dictionary there). The merged box has neither: it is not
 * one facet; it opens the list of the facets it stands for (`mergedListHtml`).
 * `data-co-box` is what focus memory finds it by; the merged box's is empty,
 * which no facet id is. `ctx` is null while there is no data to show.
 */
export function seenTogetherHtml(ctx: CoCtx | null, block: FacetBlock, legendButton = ""): string {
  const own = ctx ? ownFacet(ctx, block) : null;
  const ownName = facetNameOrId(ctx?.facets ?? null, block.facetId);
  // The tab's own "?" sits on the title's line, as the chart uses the row's
  // colours; so does the chart's caption, laid over the title (styles.css).
  const head = (caption: string) =>
    `<div class="qb-seen-head"><h3 class="qb-seen-title">Seen together with ${escapeHtml(ownName)}</h3>${caption}${legendButton}</div>`;
  const note = (text: string) => `${head("")}<p class="qb-muted">${text}</p>`;
  if (!ctx) return note(CANNOT_SHOW);
  if (ctx.connected.length === 0) return note(NO_DATA);
  if (!own) return note(UNKNOWN_FACET);
  // No "?" here: it would explain colours that are not shown.
  if (own.coOccurrence === null) {
    return `<div class="qb-seen-head"><h3 class="qb-seen-title">Seen together with ${escapeHtml(ownName)}</h3></div><p class="qb-muted">${NO_DATA}</p>`;
  }
  const layout = seenLayout(ctx, own);
  if (layout.boxes.length === 0 && !layout.merged) return note(NEVER_WITH_ANY);

  const boxes = layout.boxes.map(({ mark, rect }, index) => {
    const name = escapeHtml(mark.name);
    const id = escapeHtml(mark.facet.id);
    // Every box gets its label; hideCutLabels hides those that do not fit.
    const text = `<span class="qb-seen-label">${escapeHtml(mark.facet.name)}</span>`;
    return `<button type="button" class="qb-seen-box" data-co-box="${id}" data-facet-id="${id}" data-opens-docs tabindex="${tabindexAt(index)}" aria-label="${name}"${captionAttr(mark)} style="${placeStyle(rect)};${colourStyle(mark)}">${text}</button>`;
  });
  let mergedList = "";
  if (layout.merged) {
    const merged = layout.merged;
    const name = escapeHtml(mergedName(merged));
    // Both labels: the browser shows the long one if it fits, else the
    // short one, else neither (hideCutLabels). A label can be hidden there,
    // not shortened, so the short one has to be drawn already.
    const count = merged.items.length;
    const text = `<span class="qb-seen-label">+ ${count} less often</span><span class="qb-seen-label is-short">+${count}</span>`;
    const listId = popoverId(block.id, "merged");
    boxes.push(
      `<button type="button" class="qb-seen-box is-merged" data-co-box="" popovertarget="${escapeHtml(listId)}" tabindex="${tabindexAt(boxes.length)}" aria-label="${name}" data-caption="${escapeHtml(mergedCaption(merged))}" style="${placeStyle(merged.rect)}">${text}</button>`,
    );
    mergedList = mergedListHtml(listId, merged, ownName);
  }
  return `${head(CAPTION)}<div class="qb-seen-chart" role="group" aria-label="Seen together with ${escapeHtml(ownName)}, by share of its events" data-roving>${boxes.join("")}</div>${mergedList}`;
}

// ---- Keyboard ------------------------------------------------------------

/** The part of a key press `rovingIndex` reads (a KeyboardEvent has it). */
export interface KeyPress {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Where the arrow keys move the focus in a row of cells or a chart's boxes
 * (one Tab stop, then arrows): Left / Right one step, Home / End to the
 * ends. The ends do not wrap round, so holding a key stops at the end.
 * Null for a key that does not move: also any key with Alt, Ctrl or Meta,
 * which belongs to the browser (Alt+Left is Back, Ctrl+Home scrolls).
 */
export function rovingIndex(press: KeyPress, index: number, count: number): number | null {
  if (press.altKey || press.ctrlKey || press.metaKey) return null;
  switch (press.key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Which item of a repainted row or chart is its Tab stop: the one the user
 * was last on (`remembered`, its `data-co-cell` / `data-co-box`), so Tab
 * comes back to it even after an edit somewhere else repainted the row; the
 * first item when nothing is remembered or that facet is no longer there.
 */
export function tabStopIndex(itemIds: string[], remembered: string | undefined): number {
  const index = remembered === undefined ? -1 : itemIds.indexOf(remembered);
  return index === -1 ? 0 : index;
}
