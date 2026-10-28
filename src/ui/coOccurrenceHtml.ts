// "Seen together" on screen (spec, section 6): the row of small cells above
// every facet block, and the square pie chart of the Seen together tab. Pure
// strings, so the Node-only tests can reach them; queryBuilder.ts paints
// them and wires their arrow keys. The maths is in src/query/coOccurrence.ts.

import type { CoValue, Facet } from "../model";
import {
  coOccurrenceColour,
  coOccurrenceRange,
  connectedFacets,
  formatPercent,
  labelFits,
  squarify,
  type CoRange,
  type Rect,
} from "../query/coOccurrence";
import type { FacetBlock } from "../query/types";
import { betterOn } from "../util/colour";
import type { CoTokens } from "./coTokens";
import { escapeHtml } from "./panel";

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
const UNKNOWN_FACET = "This facet is not in the data dictionary.";
const NO_DATA = "No co-occurrence data for this facet.";

/** What a cell (or a box) shows about another facet. */
export type CellKind = "own" | "seen" | "too-rare" | "never";

/** One facet as seen from a block's facet: what it is, its name for hover
 *  and screen readers, and its colours (only a seen one has any). */
export interface CoMark {
  facet: Facet;
  kind: CellKind;
  name: string;
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

function kindOf(own: Facet | null, other: Facet, value: CoValue | undefined): CellKind {
  if (own && other.id === own.id) return "own";
  if (value?.tooRare) return "too-rare";
  return value && value.percent > 0 ? "seen" : "never";
}

/** How `other` is seen from `own` (null: a facet the dictionary does not
 *  know, which is drawn as seen with nobody). `ownName` names the block. */
function markOf(ctx: CoCtx, own: Facet | null, ownName: string, other: Facet): CoMark {
  const value = own?.coOccurrence.get(other.id);
  const kind = kindOf(own, other, value);
  const percent = kind === "seen" ? value!.percent : 0;
  const mark = { facet: other, kind, percent, background: null, ink: null };
  switch (kind) {
    case "own":
      return { ...mark, name: `${other.name} (this facet)` };
    case "too-rare":
      return { ...mark, name: `${other.name}: seen together, too rare to colour` };
    case "never":
      return { ...mark, name: `${other.name}: never seen together` };
    case "seen": {
      const { stops, dotDark, dotLight } = ctx.tokens;
      // A seen value is always inside the range, which is built from them all.
      const range = ctx.range ?? { min: value!.percent, max: value!.percent };
      const background = coOccurrenceColour(value!.percent, range, stops);
      return {
        ...mark,
        // The backend's own text, never re-formatted (formatPercent).
        name: `${other.name}: ${formatPercent(value!.text)} of ${ownName}'s events`,
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

/** The roving tabindex: only the first item of a row or chart is a Tab stop;
 *  the arrow keys move inside it (queryBuilder.ts). */
const tabindexAt = (index: number) => (index === 0 ? "0" : "-1");

/**
 * The co-occurrence row above a block's head: one cell per connected facet,
 * in dictionary order, the same cells in every block. A cell is a button
 * (task 7 makes it open the dictionary at its facet, by `data-facet-id`);
 * `data-co-cell` is what focus memory finds it by after a repaint (a box in
 * the chart has the same facet id, so `data-facet-id` alone would mix them
 * up). Empty when no facet is seen with any other: there is no data.
 */
export function coRowHtml(ctx: CoCtx, block: FacetBlock): string {
  if (ctx.connected.length === 0) return "";
  const own = ownFacet(ctx, block);
  const ownName = own?.name ?? block.facetId;
  const isolated = !own || !ctx.connected.includes(own);
  const cells = ctx.connected
    .map((other, index) => {
      const mark = markOf(ctx, own, ownName, other);
      const name = escapeHtml(mark.name);
      const style = colourStyle(mark);
      const id = escapeHtml(other.id);
      return `<button type="button" class="qb-co-cell is-${mark.kind}" data-co-cell="${id}" data-facet-id="${id}" tabindex="${tabindexAt(index)}" aria-label="${name}" title="${name}"${style ? ` style="${style}"` : ""}></button>`;
    })
    .join("");
  // A title on the group itself: the browser shows it on the gaps and reads
  // it to screen readers as the group's description.
  const title = isolated ? ` title="${NEVER_WITH_ANY}"` : "";
  return `<div class="qb-co-row" role="group" aria-label="Seen together with ${escapeHtml(ownName)}"${title} data-roving>${cells}</div>`;
}

// ---- The square pie chart -------------------------------------------------

/** The chart's box, in the units `squarify` lays out in. The HTML turns them
 *  into percentages, so the chart stretches with the panel. */
const CHART_WIDTH = 100;
const CHART_HEIGHT = 60;
/** The panel's typical width is about 300 px: one unit is about 3 px. The
 *  12 px rule and the labels are worked out at that size; a label that does
 *  not fit in the real panel is hidden after the paint (hideCutLabels, queryBuilder.ts). */
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
  /** Whether the whole name fits at the reference size (`labelFits`). */
  label: boolean;
}

export interface MergedBox {
  /** The facets it stands for, largest first, the too-rare ones last. */
  items: CoMark[];
  rect: Rect;
  /** "+ N less often", or the short "+N", or nothing: whichever fits. */
  label: string | null;
}

export interface SeenLayout {
  /** Largest first. */
  boxes: SeenBox[];
  merged: MergedBox | null;
}

/** A rect in reference pixels, for the 12 px rule and `labelFits`. */
function inPx(rect: Rect): Rect {
  return {
    x: rect.x * PX_PER_UNIT,
    y: rect.y * PX_PER_UNIT,
    w: rect.w * PX_PER_UNIT,
    h: rect.h * PX_PER_UNIT,
  };
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
    const boxes = shown.map((mark, index) => {
      const rect = rects[index] as Rect;
      return { mark, rect, label: labelFits(mark.facet.name, inPx(rect)) };
    });
    return { boxes, merged: merged.length ? mergedBox(merged, mergedRect) : null };
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

function mergedBox(items: CoMark[], rect: Rect): MergedBox {
  const long = `+ ${items.length} less often`;
  const short = `+${items.length}`;
  const label = labelFits(long, inPx(rect)) ? long : labelFits(short, inPx(rect)) ? short : null;
  return { items, rect, label };
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

/** The merged box's name lists what it stands for, since it has no label
 *  for each. */
function mergedName(merged: MergedBox): string {
  return `${merged.items.length} less often: ${merged.items.map((m) => m.name).join("; ")}`;
}

/**
 * The Seen together tab of `block`: its title and the square pie chart. A box
 * is a button with the same name as the cell of its facet, a roving tabindex
 * like the row's, and `data-facet-id` (task 7 opens the dictionary there).
 * `data-co-box` is what focus memory finds it by; the merged box's is empty,
 * which no facet id is. `ctx` is null while there is no data to show.
 */
export function seenTogetherHtml(ctx: CoCtx | null, block: FacetBlock): string {
  const own = ctx ? ownFacet(ctx, block) : null;
  const ownName = own?.name ?? block.facetId;
  const title = `<h3 class="qb-seen-title">Seen together with ${escapeHtml(ownName)}</h3>`;
  const note = (text: string) => `${title}<p class="qb-muted">${text}</p>`;
  if (!ctx || ctx.connected.length === 0) return note(NO_DATA);
  if (!own) return note(UNKNOWN_FACET);
  const layout = seenLayout(ctx, own);
  if (layout.boxes.length === 0 && !layout.merged) return note(NEVER_WITH_ANY);

  const boxes = layout.boxes.map(({ mark, rect, label }, index) => {
    const name = escapeHtml(mark.name);
    const id = escapeHtml(mark.facet.id);
    const text = label ? `<span class="qb-seen-label">${escapeHtml(mark.facet.name)}</span>` : "";
    return `<button type="button" class="qb-seen-box" data-co-box="${id}" data-facet-id="${id}" tabindex="${tabindexAt(index)}" aria-label="${name}" title="${name}" style="${placeStyle(rect)};${colourStyle(mark)}">${text}</button>`;
  });
  if (layout.merged) {
    const merged = layout.merged;
    const name = escapeHtml(mergedName(merged));
    const text = merged.label
      ? `<span class="qb-seen-label">${escapeHtml(merged.label)}</span>`
      : "";
    boxes.push(
      `<button type="button" class="qb-seen-box is-merged" data-co-box="" tabindex="${tabindexAt(boxes.length)}" aria-label="${name}" title="${name}" style="${placeStyle(merged.rect)}">${text}</button>`,
    );
  }
  return `${title}<div class="qb-seen-chart" role="group" aria-label="Seen together with ${escapeHtml(ownName)}, by share of its events" data-roving>${boxes.join("")}</div>`;
}

// ---- Keyboard ------------------------------------------------------------

/**
 * Where the arrow keys move the focus in a row of cells or a chart's boxes
 * (one Tab stop, then arrows): Left / Right one step, Home / End to the
 * ends. The ends do not wrap round, so holding a key stops at the end.
 * Null for a key that does not move.
 */
export function rovingIndex(key: string, index: number, count: number): number | null {
  switch (key) {
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
