// The maths behind "Seen together": which facets are connected, the colour
// scale, the legend's text and the square pie chart's layout. Pure, no DOM.
// The values are display data: nothing here changes a query.

import type { Facet } from "../model";
import { mixOklab } from "../util/colour";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Facets seen together with at least one other facet, in either direction,
 *  in the order given (the dictionary's). A facet's own entry (100) says
 *  nothing about others, so it is skipped. "Too rare to colour" still counts
 *  as seen. */
export function connectedFacets(facets: Facet[]): Facet[] {
  const seen = new Set<string>();
  for (const facet of facets) {
    // A facet without data names nobody; others may still name it.
    for (const [otherId, value] of facet.coOccurrence ?? []) {
      if (otherId === facet.id) continue;
      if (value.percent > 0 || value.tooRare) {
        seen.add(facet.id);
        seen.add(otherId);
      }
    }
  }
  return facets.filter((facet) => seen.has(facet.id));
}

/** The share that means "in every event": the top of the colour scale, and
 *  the only value whose cell has a dot. */
export const FULL_PERCENT = 100;

/** Whether a value is "in every event" (100 %): the backend's 100. */
export function isFull(percent: number): boolean {
  return percent >= FULL_PERCENT;
}

/** Whether `facet`'s own map says it is seen with some other facet: a
 *  facet without data (`null`), or one no event holds (all zeros), is not. */
function seesOthers(facet: Facet): boolean {
  for (const [otherId, value] of facet.coOccurrence ?? []) {
    if (otherId !== facet.id && (value.percent > 0 || value.tooRare)) return true;
  }
  return false;
}

/**
 * The facets seen in every event of every other facet: 100 % in the map of
 * each facet that is seen with any other. In production a few facets are in
 * every event, and in every chart they would take half the room from the
 * facets that say something, so the chart gathers them in one box
 * (seenLayout). A facet without data, or one that no event holds, has no
 * say (its map is all zeros); when no facet has a say, none qualifies.
 */
export function alwaysTogetherIds(facets: Facet[]): Set<string> {
  const withData = facets.filter(seesOthers);
  const always = new Set<string>();
  for (const candidate of facets) {
    const others = withData.filter((facet) => facet.id !== candidate.id);
    if (others.length === 0) continue;
    const inEveryEvent = others.every((facet) =>
      isFull(facet.coOccurrence?.get(candidate.id)?.percent ?? 0),
    );
    if (inEveryEvent) always.add(candidate.id);
  }
  return always;
}

/** 0 to 1 along the colour scale: the share itself, from 0 % to 100 %.
 *  Linear, so the facets seen most often stand out (the data analysts'
 *  wish, 2026-10-29: the valuable data is in the highest values); the
 *  smallest values all look alike, and the merged box gathers them. */
export function scalePosition(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.min(1, Math.max(0, percent / FULL_PERCENT));
}

/** The colour for a value: blended between the two designer stops around it. */
export function coOccurrenceColour(percent: number, stops: string[]): string {
  const n = stops.length;
  if (n < 2) throw new Error("coOccurrenceColour needs at least two stops");
  const t = scalePosition(percent);
  const segment = Math.min(Math.floor(t * (n - 1)), n - 2);
  const local = t * (n - 1) - segment;
  return mixOklab(stops[segment] as string, stops[segment + 1] as string, local);
}

/** The legend's labels, at their places on the bar. Always these five,
 *  however many colour stops the stylesheet has: one label per stop could
 *  not be read with 100 stops. */
export const LEGEND_TICKS: { at: number; label: string }[] = [0, 25, 50, 75, 100].map(
  (percent) => ({ at: percent / FULL_PERCENT, label: `${percent} %` }),
);

/** The backend's text with its unit; never rounded. Only its decimal point
 *  becomes `decimal`, the mark every other number on screen has. */
export function formatPercent(text: string, decimal = "."): string {
  return text.replace(".", decimal) + " %";
}

/** How many significant digits a value shown on screen keeps. Three keep
 *  every value within 0.5 % of itself and fit one short line; one digit would
 *  show 76.19 as 80. */
const SHOWN_DIGITS = 3;

/** The parts of a number written as text: digits before the point, digits
 *  after it, and the exponent (letter, then sign and digits). */
const NUMBER_TEXT = /^(\d*)(?:\.(\d*))?(?:([eE])([+-]?)(\d+))?$/;

/**
 * The backend's percentage text cut to `digits` significant digits, for what
 * sighted users read (captions, lists); the accessible names keep the full
 * text. It works on the text, not on a number, so "1e-400" (too small for a
 * number) works too. Text with at most `digits` significant digits is kept
 * as it is; longer text is rounded half up, in its own form ("1.23456e-20"
 * becomes "1.23e-20", a plain decimal stays plain) without trailing zeros
 * after the point. Digits before the point are never dropped. Text that is
 * not a plain number is returned unchanged.
 */
export function roundPercentText(text: string, digits = SHOWN_DIGITS): string {
  const match = NUMBER_TEXT.exec(text);
  if (!match) return text;
  const [, whole = "", fraction = "", expLetter, expSign = "", expDigits] = match;
  const all = whole + fraction;
  const first = all.search(/[1-9]/);
  if (first === -1 || all.length - first <= digits) return text;

  let pointAt = whole.length; // how many digits are before the point
  const keep = Math.max(first + digits, pointAt);
  if (keep >= all.length) return text;
  let kept = all.slice(0, keep);
  let exponent = expDigits === undefined ? null : Number(expSign + expDigits);
  if (Number(all[keep]) >= 5) {
    // Add one in the last kept place, carrying leftwards.
    const incremented = (BigInt("1" + kept) + 1n).toString();
    if (incremented.startsWith("2")) {
      // "999" became "1000": one more digit before the point, or in a number
      // with an exponent a larger exponent ("9.996e-5" is "1e-4").
      kept = "1" + "0".repeat(keep);
      if (exponent === null) pointAt += 1;
      else {
        kept = kept.slice(0, keep);
        exponent += 1;
      }
    } else {
      kept = incremented.slice(1);
    }
  }
  const mantissaWhole = kept.slice(0, pointAt);
  const mantissaFraction = kept.slice(pointAt).replace(/0+$/, "");
  const mantissa = mantissaWhole + (mantissaFraction ? "." + mantissaFraction : "");
  if (exponent === null) return mantissa || "0";
  const sign = exponent < 0 ? "-" : expSign === "+" ? "+" : "";
  return `${mantissa || "0"}${expLetter}${sign}${Math.abs(exponent)}`;
}

/** Which values `squarify` does not sort in by size: with `first`, the
 *  first value is laid out first, top-left (the "in every event" box); with
 *  `last`, the last value is laid out last, bottom-right (the merged box). */
export interface Pinned {
  first?: boolean;
  last?: boolean;
}

/** Square pie chart layout (squarified treemap, Bruls et al.): rectangles with
 *  area proportional to value, filling width x height, as square as possible.
 *  Returned in the order of `values`; a zero value gets an empty rect.
 *  `pinned` keeps the first or last value in its corner whatever its size. */
export function squarify(
  values: number[],
  width: number,
  height: number,
  pinned: Pinned = {},
): Rect[] {
  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const drawn = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0);
  const lastIndex = values.length - 1;
  const head = pinned.first ? drawn.filter((item) => item.index === 0) : [];
  const tail = pinned.last
    ? drawn.filter((item) => item.index === lastIndex && !head.includes(item))
    : [];
  const order = [
    ...head,
    ...drawn
      .filter((item) => !head.includes(item) && !tail.includes(item))
      .sort((a, b) => b.value - a.value),
    ...tail,
  ];
  // Sizes relative to the largest (1 and below): the sum of the values
  // themselves can overflow to Infinity (1e308 + 1e308), the shares cannot.
  const largest = Math.max(0, ...order.map((item) => item.value));
  const share = (value: number) => value / largest;
  const total = order.reduce((sum, item) => sum + share(item.value), 0);
  if (total === 0 || width <= 0 || height <= 0) return rects;

  const areaPerShare = (width * height) / total;
  let free: Rect = { x: 0, y: 0, w: width, h: height };
  let row: { index: number; area: number }[] = [];

  // The worst (largest) aspect ratio in a row laid along a side of `side` length.
  const worst = (areas: number[], side: number) => {
    const sum = areas.reduce((s, a) => s + a, 0);
    return Math.max(
      (side * side * Math.max(...areas)) / (sum * sum),
      (sum * sum) / (side * side * Math.min(...areas)),
    );
  };

  const flushRow = () => {
    if (row.length === 0) return;
    const sum = row.reduce((s, item) => s + item.area, 0);
    const alongWidth = free.w >= free.h; // lay the row down the shorter side
    // Never thicker than the free space: after rounding, a tiny last row can
    // otherwise be laid in a sliver of almost zero width and come out huge.
    const thickness = Math.min(sum / (alongWidth ? free.h : free.w), alongWidth ? free.w : free.h);
    let offset = 0;
    const side = alongWidth ? free.h : free.w;
    row.forEach((item, position) => {
      // The last item takes exactly what is left: with very unequal values
      // the rounded lengths would otherwise overshoot the box.
      const isLast = position === row.length - 1;
      const length = isLast
        ? Math.max(0, side - offset)
        : Math.min(item.area / thickness, side - offset);
      rects[item.index] = alongWidth
        ? { x: free.x, y: free.y + offset, w: thickness, h: length }
        : { x: free.x + offset, y: free.y, w: length, h: thickness };
      offset += length;
    });
    free = alongWidth
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    row = [];
  };

  for (const item of order) {
    const next = { index: item.index, area: share(item.value) * areaPerShare };
    const side = Math.min(free.w, free.h);
    const areas = row.map((r) => r.area);
    if (row.length > 0 && worst([...areas, next.area], side) > worst(areas, side)) flushRow();
    row.push(next);
  }
  flushRow();
  return rects;
}
