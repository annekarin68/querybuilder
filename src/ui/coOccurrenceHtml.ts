// "Seen together" on screen (spec, section 6): the row of small cells above
// every facet block, and the square pie chart of the Seen together tab. Pure
// strings, so the Node-only tests can reach them; queryBuilder.ts paints
// them and coOccurrenceWiring.ts wires their arrow keys. The maths is in src/query/coOccurrence.ts.

import type { CoValue, Facet } from "../model";
import {
  alwaysTogetherIds,
  coOccurrenceColour,
  connectedFacets,
  formatPercent,
  FULL_PERCENT,
  isFull,
  roundPercentText,
  squarify,
  type Rect,
} from "../query/coOccurrence";
import type { FacetBlock } from "../query/types";
import { betterOn } from "../util/colour";
import type { CoTokens } from "./coTokens";
import { facetNameOrId, UNKNOWN_FACET } from "./facetWords";
import { decimalMark } from "./format";
import { escapeHtml } from "./panel";
import { POPOVER_CLASS, popoverId } from "./popover";

/** What the row and the chart of every block need. Worked out once per
 *  paint (`coCtxOf`), because the connected facets and the colours are the
 *  same in every block. */
export interface CoCtx {
  /** The dictionary. */
  facets: Facet[];
  /** The facets of the row: seen with at least one other, dictionary order. */
  connected: Facet[];
  /** The facets seen in every event of every other facet
   *  (`alwaysTogetherIds`): the chart gathers them in one box. */
  always: Set<string>;
  tokens: CoTokens;
  /** Whether the rows show each cell's facet name above it (the legend's
   *  "Show names"). */
  showNames: boolean;
  /** What was drawn already for this dictionary (`MatrixMemo`). */
  memo: MatrixMemo;
}

/**
 * What is worked out once per dictionary and kept: the builder repaints
 * every block on every edit, but a row and a chart depend only on the
 * dictionary, the colours and the block's facet, never on the query. With
 * hundreds of facets, drawing them again on each edit took about half a
 * second. The keys of `rows` and `layouts` start with the colour tokens
 * (`tokensKey`), so a changed theme draws them again.
 */
interface MatrixMemo {
  connected: Facet[];
  always: Set<string>;
  /** A row's HTML, by tokens, names on or off and the block's facet id. */
  rows: Map<string, string>;
  /** A chart's layout, by tokens and the block's facet id. */
  layouts: Map<string, SeenLayout>;
}

/** The memo of each dictionary: it changes only when it is loaded again
 *  (a new array), and then the old memo goes with the old array. */
const matrixCache = new WeakMap<Facet[], MatrixMemo>();

/** The part of a memo key that says which colours were used. */
const tokensKey = (tokens: CoTokens) => JSON.stringify(tokens);

/** `memo.get(key)`, worked out by `make` the first time. */
function remembered<T>(memo: Map<string, T>, key: string, make: () => T): T {
  let value = memo.get(key);
  if (value === undefined) {
    value = make();
    memo.set(key, value);
  }
  return value;
}

/** The context for one paint, or null when there is nothing to colour with:
 *  without two colour stops (the stylesheet did not load) the row and the
 *  chart are left out. Co-occurrence is display data and never blocks the
 *  builder. */
export function coCtxOf(facets: Facet[], tokens: CoTokens, showNames = false): CoCtx | null {
  if (tokens.stops.length < 2) return null;
  let memo = matrixCache.get(facets);
  if (!memo) {
    memo = {
      connected: connectedFacets(facets),
      always: alwaysTogetherIds(facets),
      rows: new Map(),
      layouts: new Map(),
    };
    matrixCache.set(facets, memo);
  }
  return { facets, connected: memo.connected, always: memo.always, tokens, showNames, memo };
}

/** Whether the Seen together tab is offered at all: only when some facet is
 *  seen together with another. Without any co-occurrence data the tab
 *  would only ever say so (maintainers, 2026-10-29). */
export function offersSeenTogether(ctx: CoCtx | null): boolean {
  return ctx !== null && ctx.connected.length > 0;
}

/** Said (hover and screen readers) by a block whose facet is seen with no
 *  other facet; its row is a row of never-seen cells. */
const NEVER_WITH_ANY = "Never seen together with another facet.";
const NO_DATA = "No co-occurrence data for this facet.";

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
  /** Only for "seen" and "too-rare": the heat colour and the dot (or
   *  label) on it. A too-rare value has the colour of 0 %, like every
   *  value too small to tell from it on a linear scale. */
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
  const worded = (text: string) =>
    `${other.name}: ${formatPercent(text, decimalMark())} of ${ownName}'s events`;
  const both = (words: (text: string) => string) => ({
    name: words(value?.text ?? ""),
    caption: words(roundPercentText(value?.text ?? "")),
  });
  switch (kind) {
    case "own": {
      const name = `${other.name} (this facet)`;
      return { ...mark, name, caption: name };
    }
    case "too-rare": {
      // Still the backend's text ("1e-400 %"): it is all there is to say
      // about a value too small for a number, and hover must never lose it.
      const { stops, dotDark, dotLight } = ctx.tokens;
      const background = coOccurrenceColour(0, stops);
      return { ...mark, ...both(worded), background, ink: betterOn(background, dotDark, dotLight) };
    }
    case "never": {
      const name = `${other.name}: never seen together`;
      return { ...mark, name, caption: name };
    }
    case "seen": {
      const { stops, dotDark, dotLight } = ctx.tokens;
      const background = coOccurrenceColour(value!.percent, stops);
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
  const key = `${tokensKey(ctx.tokens)}\n${ctx.showNames}\n${block.facetId}`;
  return remembered(ctx.memo.rows, key, () => drawRow(ctx, block));
}

/** `coRowHtml`'s work, done once per facet (see `MatrixMemo`). */
function drawRow(ctx: CoCtx, block: FacetBlock): string {
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
      // Only a value of 100 % gets a dot (the designer, 2026-10-29): it
      // marks "in every event", the one value a colour cannot pin down.
      const full = mark.kind === "seen" && isFull(mark.percent) ? " is-full" : "";
      // The name above the cell, while "Show names" is on. Hidden from
      // screen readers: it is the start of the cell's accessible name.
      const label = ctx.showNames
        ? `<span class="qb-co-name" aria-hidden="true">${escapeHtml(other.name)}</span>`
        : "";
      return `<button type="button" class="qb-co-cell is-${mark.kind}${full}" data-co-cell="${id}" data-facet-id="${id}" data-opens-docs tabindex="${tabindexAt(index)}" aria-label="${name}"${captionAttr(mark)}${style ? ` style="${style}"` : ""}>${label}</button>`;
    })
    .join("");
  // A title on the group itself: the browser shows it on the gaps and reads
  // it to screen readers as the group's description.
  const title = isolated ? ` title="${NEVER_WITH_ANY}"` : "";
  const names = ctx.showNames ? " shows-names" : "";
  return `<div class="qb-co-row${names}" role="group" aria-label="Seen together with ${escapeHtml(ownName)}"${title} data-roving>${cells}</div>`;
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
/** The two gathered boxes, "+ N in every event" and "+ N less often", stand
 *  for a list, not one value, so they are not drawn to scale: each starts
 *  at this share of the chart and grows (GATHERED_GROWTH) until it, too, is
 *  at least MIN_BOX_PX thick, so it can be seen and pressed (the merged box
 *  also needs a size when it only holds values too rare to have one). */
const GATHERED_MIN_SHARE = 0.02;
const GATHERED_MAX_SHARE = 0.5;
const GATHERED_GROWTH = 1.5;

export interface SeenBox {
  mark: CoMark;
  rect: Rect;
}

/** A box that stands for several facets: "+ N in every event" or
 *  "+ N less often". */
export interface GatheredBox {
  /** The facets it stands for: for the merged box largest first, the
   *  too-rare ones last; for the "in every event" box in dictionary order. */
  items: CoMark[];
  rect: Rect;
}

export interface SeenLayout {
  /** Largest first. */
  boxes: SeenBox[];
  /** The facets seen in every event of every facet (`CoCtx.always`),
   *  top-left: at 100 % in every chart they would take most of its room
   *  from the facets that say something (maintainers, 2026-10-29). */
  always: GatheredBox | null;
  /** The rarest facets, bottom-right. */
  merged: GatheredBox | null;
}

const isTiny = (rect: Rect) => Math.min(rect.w, rect.h) * PX_PER_UNIT < MIN_BOX_PX;

/**
 * The square pie chart of facet `own`: one box per facet it is seen with,
 * area proportional to the value; never-seen facets are absent. The facets
 * in every event of every facet go into one "+ N in every event" box.
 * Values too rare to have a size, and boxes too small to see, go into one
 * "+ N less often" box, always the rarest ones. Merging gives the other
 * boxes more room, so it is repeated until no box is too small.
 */
export function seenLayout(ctx: CoCtx, own: Facet): SeenLayout {
  const key = `${tokensKey(ctx.tokens)}\n${own.id}`;
  return remembered(ctx.memo.layouts, key, () => layOut(ctx, own));
}

/** `seenLayout`'s work, done once per facet (see `MatrixMemo`). */
function layOut(ctx: CoCtx, own: Facet): SeenLayout {
  const marks = ctx.connected
    .map((other) => markOf(ctx, own, own.name, other))
    .filter((mark) => mark.kind === "seen" || mark.kind === "too-rare");
  const percentOf = (mark: CoMark) => mark.percent;
  // A stable sort keeps the dictionary order between equal values.
  const bySize = (a: CoMark, b: CoMark) => percentOf(b) - percentOf(a);
  const isAlways = (mark: CoMark) => ctx.always.has(mark.facet.id);
  const always = marks.filter((m) => m.kind === "seen" && isAlways(m));
  let shown = marks.filter((m) => m.kind === "seen" && !isAlways(m)).sort(bySize);
  let merged = marks.filter((m) => m.kind === "too-rare");

  let alwaysShare = GATHERED_MIN_SHARE;
  let mergedShare = GATHERED_MIN_SHARE;
  const grown = (share: number) => Math.min(GATHERED_MAX_SHARE, share * GATHERED_GROWTH);
  for (;;) {
    const values = shown.map(percentOf);
    // The "in every event" box, if any, is the first value: squarify lays
    // it out first (top-left); the merged box is the last (bottom-right).
    const lead = always.length > 0 ? [gatheredValue(values, alwaysShare)] : [];
    const rects = squarify(
      [...lead, ...values, mergedValue(values, merged, mergedShare)],
      CHART_WIDTH,
      CHART_HEIGHT,
      // Pinned whatever their sizes: they are aggregates, not values, and in
      // production the merged one is often the largest.
      { first: lead.length > 0, last: true },
    );
    const shownRects = rects.slice(lead.length, lead.length + shown.length);
    const tiny = shown.filter((_, index) => isTiny(shownRects[index] as Rect));
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
    const alwaysRect = lead.length > 0 ? (rects[0] as Rect) : null;
    const mergedRect = rects[rects.length - 1] as Rect;
    const growAlways =
      alwaysRect !== null && isTiny(alwaysRect) && alwaysShare < GATHERED_MAX_SHARE;
    const growMerged = merged.length > 0 && isTiny(mergedRect) && mergedShare < GATHERED_MAX_SHARE;
    if (growAlways || growMerged) {
      if (growAlways) alwaysShare = grown(alwaysShare);
      if (growMerged) mergedShare = grown(mergedShare);
      continue;
    }
    const boxes = shown.map((mark, index) => ({ mark, rect: shownRects[index] as Rect }));
    return {
      boxes,
      always: alwaysRect ? { items: always, rect: alwaysRect } : null,
      merged: merged.length ? { items: merged, rect: mergedRect } : null,
    };
  }
}

/** The size `squarify` gets for a gathered box: `share` of the whole chart
 *  (share = value / (shownTotal + value), solved for value). When no facet
 *  has its own box, the gathered box is the whole chart. */
function gatheredValue(shownValues: number[], share: number): number {
  const shownTotal = shownValues.reduce((sum, v) => sum + v, 0);
  if (shownTotal === 0) return 1;
  return (share * shownTotal) / (1 - share);
}

/** The size `squarify` gets for "+ N less often": the merged values, but at
 *  least `share` of the whole chart (0 when nothing is merged). */
function mergedValue(shownValues: number[], merged: CoMark[], share: number): number {
  if (merged.length === 0) return 0;
  // A too-rare value's percent is 0: its real size is below what a number holds.
  const mergedSum = merged.reduce((sum, m) => sum + m.percent, 0);
  return Math.max(mergedSum, gatheredValue(shownValues, share));
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

/** What tells the two gathered boxes apart: their words, class and focus
 *  memory id (`data-co-box`). Neither id can be a facet's id, as the
 *  dictionary has no blank ids: the merged box's is "", the other's " ". */
interface Gathered {
  where: "always" | "merged";
  boxId: string;
  className: string;
  /** The long label, e.g. "+ 3 in every event"; the short one is "+3". */
  label(count: number): string;
  /** How its accessible name starts, before the list: "3 in every event". */
  name(count: number): string;
  /** The caption: what it is, in one short line. */
  caption(count: number): string;
  /** The first words of its accessible name and list (escaped HTML). */
  listLead(count: number, ownName: string): string;
}

const ALWAYS: Gathered = {
  where: "always",
  boxId: " ",
  className: "is-always",
  label: (count) => `+ ${count} in every event`,
  name: (count) => `${count} in every event`,
  caption: (count) => `${facetCount(count)} in every event of every facet`,
  listLead: (count, ownName) =>
    `${facetCount(count)} in every event of every facet, so in every event of <strong>${escapeHtml(ownName)}</strong> too:`,
};

const MERGED: Gathered = {
  where: "merged",
  boxId: "",
  className: "is-merged",
  label: (count) => `+ ${count} less often`,
  name: (count) => `${count} less often`,
  caption: (count) => `${facetCount(count)}, each less often than the boxes shown`,
  listLead: (count, ownName) =>
    `${facetCount(count)} seen together less often with <strong>${escapeHtml(ownName)}</strong>:`,
};

/**
 * A gathered box and the popover it opens (click or Enter;
 * `popovertarget`): sighted users see only "+N" on a small box, and a box
 * that does nothing when pressed would be a dead control. The list has each
 * facet in the words of its cell, in the order of `GatheredBox.items`. It
 * is a popover like the legend (`POPOVER_CLASS`), so coOccurrenceWiring.ts
 * places it by its box, follows the scroll and reopens it after a repaint
 * as it does a legend. The popover goes after the chart, not inside it: the
 * chart's arrow keys go through the chart's own buttons only
 * (`rovingItems`). The box has no `data-facet-id` or `data-opens-docs`: it
 * is not one facet. Its accessible name lists what it stands for, since it
 * has no label for each; that can be thousands of characters, too long for
 * the caption, which gets the short `caption` instead (`data-caption`).
 */
function gatheredHtml(
  kind: Gathered,
  box: GatheredBox,
  blockId: string,
  ownName: string,
  index: number,
  colour: string,
): { button: string; list: string } {
  const count = box.items.length;
  const name = `${kind.name(count)}: ${box.items.map((m) => m.name).join("; ")}`;
  // Both labels: the browser shows the long one if it fits, else the
  // short one, else neither (hideCutLabels). A label can be hidden there,
  // not shortened, so the short one has to be drawn already.
  const text = `<span class="qb-seen-label">${kind.label(count)}</span><span class="qb-seen-label is-short">+${count}</span>`;
  const listId = escapeHtml(popoverId(blockId, kind.where));
  const button = `<button type="button" class="qb-seen-box ${kind.className}" data-co-box="${kind.boxId}" popovertarget="${listId}" tabindex="${tabindexAt(index)}" aria-label="${escapeHtml(name)}" data-caption="${escapeHtml(kind.caption(count))}" style="${placeStyle(box.rect)}${colour ? `;${colour}` : ""}">${text}</button>`;
  const items = box.items.map((m) => `<li>${escapeHtml(m.caption)}</li>`).join("");
  const list = `<div id="${listId}" popover class="${POPOVER_CLASS}"><p>${kind.listLead(count, ownName)}</p><ul class="qb-merged-list">${items}</ul></div>`;
  return { button, list };
}

/**
 * The Seen together tab of `block`: its title and the square pie chart. A box
 * is a button with the same name as the cell of its facet, a roving tabindex
 * like the row's, and `data-facet-id` and `data-opens-docs` like a cell's (a
 * click opens the dictionary there). The two gathered boxes have neither:
 * each opens the list of the facets it stands for (`gatheredHtml`).
 * `data-co-box` is what focus memory finds a box by. Only drawn when the
 * tab is offered (`offersSeenTogether`): some facet is seen with another.
 */
export function seenTogetherHtml(ctx: CoCtx, block: FacetBlock, legendButton = ""): string {
  const own = ownFacet(ctx, block);
  const ownName = facetNameOrId(ctx.facets, block.facetId);
  // The tab's own "?" sits on the title's line, as the chart uses the row's
  // colours; so does the chart's caption, laid over the title (styles.css).
  const head = (caption: string) =>
    `<div class="qb-seen-head"><h3 class="qb-seen-title">Seen together with ${escapeHtml(ownName)}</h3>${caption}${legendButton}</div>`;
  const note = (text: string) => `${head("")}<p class="qb-muted">${text}</p>`;
  if (!own) return note(UNKNOWN_FACET);
  // No "?" here: it would explain colours that are not shown.
  if (own.coOccurrence === null) {
    return `<div class="qb-seen-head"><h3 class="qb-seen-title">Seen together with ${escapeHtml(ownName)}</h3></div><p class="qb-muted">${NO_DATA}</p>`;
  }
  const layout = seenLayout(ctx, own);
  if (layout.boxes.length === 0 && !layout.always && !layout.merged) return note(NEVER_WITH_ANY);

  const buttons: string[] = [];
  const lists: string[] = [];
  const addGathered = (kind: Gathered, box: GatheredBox, colour: string) => {
    const { button, list } = gatheredHtml(kind, box, block.id, ownName, buttons.length, colour);
    buttons.push(button);
    lists.push(list);
  };
  // In the order they are laid out, which is also the arrow keys' order.
  if (layout.always) {
    // The colour of 100 %, as each of its facets would have.
    const { stops, dotDark, dotLight } = ctx.tokens;
    const top = coOccurrenceColour(FULL_PERCENT, stops);
    addGathered(
      ALWAYS,
      layout.always,
      `background-color:${top};color:${betterOn(top, dotDark, dotLight)}`,
    );
  }
  for (const { mark, rect } of layout.boxes) {
    const name = escapeHtml(mark.name);
    const id = escapeHtml(mark.facet.id);
    // Every box gets its label; hideCutLabels hides those that do not fit.
    const text = `<span class="qb-seen-label">${escapeHtml(mark.facet.name)}</span>`;
    buttons.push(
      `<button type="button" class="qb-seen-box" data-co-box="${id}" data-facet-id="${id}" data-opens-docs tabindex="${tabindexAt(buttons.length)}" aria-label="${name}"${captionAttr(mark)} style="${placeStyle(rect)};${colourStyle(mark)}">${text}</button>`,
    );
  }
  if (layout.merged) addGathered(MERGED, layout.merged, "");
  return `${head(CAPTION)}<div class="qb-seen-chart" role="group" aria-label="Seen together with ${escapeHtml(ownName)}, by share of its events" data-roving>${buttons.join("")}</div>${lists.join("")}`;
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
