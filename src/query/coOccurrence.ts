// The maths behind "Seen together": which facets are connected, the colour
// scale, the legend's text and the square pie chart's layout. Pure, no DOM.
// The values are display data: nothing here changes a query.

import type { Facet } from "../model";
import { mixOklab } from "../util/colour";

export interface CoRange {
  min: number;
  max: number;
}

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
    for (const [otherId, value] of facet.coOccurrence) {
      if (otherId === facet.id) continue;
      if (value.percent > 0 || value.tooRare) {
        seen.add(facet.id);
        seen.add(otherId);
      }
    }
  }
  return facets.filter((facet) => seen.has(facet.id));
}

/** Smallest and largest positive value in the whole matrix, so every block
 *  uses the same colours. Own entries, zeros and too-rare values are left out
 *  (a value of 1e-300 would stretch the scale and squash all the others). */
export function coOccurrenceRange(facets: Facet[]): CoRange | null {
  let min = Infinity;
  let max = 0;
  for (const facet of facets) {
    for (const [otherId, value] of facet.coOccurrence) {
      if (otherId === facet.id || value.tooRare || !(value.percent > 0)) continue;
      min = Math.min(min, value.percent);
      max = Math.max(max, value.percent);
    }
  }
  return max > 0 ? { min, max } : null;
}

/** 0 to 1 along the range. Log scale, because the values span many powers of
 *  ten and a linear scale would show almost everything as "nearly nothing". */
export function scalePosition(percent: number, range: CoRange): number {
  if (Number.isNaN(percent)) return 0;
  if (range.min === range.max) return 1;
  const t =
    (Math.log10(percent) - Math.log10(range.min)) / (Math.log10(range.max) - Math.log10(range.min));
  return Math.min(1, Math.max(0, t));
}

/** The colour for a value: blended between the two designer stops around it. */
export function coOccurrenceColour(percent: number, range: CoRange, stops: string[]): string {
  const n = stops.length;
  if (n < 2) throw new Error("coOccurrenceColour needs at least two stops");
  const t = scalePosition(percent, range);
  const segment = Math.min(Math.floor(t * (n - 1)), n - 2);
  const local = t * (n - 1) - segment;
  return mixOklab(stops[segment] as string, stops[segment + 1] as string, local);
}

function stopValue(range: CoRange, stopCount: number, k: number): number {
  if (stopCount < 2) throw new Error("A legend needs at least two stops");
  const lo = Math.log10(range.min);
  const hi = Math.log10(range.max);
  return 10 ** (lo + (k * (hi - lo)) / (stopCount - 1));
}

/** The smallest tick written as a plain decimal: below it a decimal would
 *  be a row of zeros ("0.0000001 %"). */
const SMALLEST_DECIMAL = 0.001;

/** A tick's label: "48 %", "0.5 %", or "1e-12 %" for a very small value
 *  (the exponent as the backend writes it, so it reads like the captions).
 *  `String(0.0001)` would already say "0.0001", hence the explicit limit. */
function tickLabel(value: number): string {
  if (value >= 1) return `${Number(value.toPrecision(2))} %`;
  const rounded = Number(value.toPrecision(1));
  return rounded >= SMALLEST_DECIMAL ? `${rounded} %` : `${value.toExponential(0)} %`;
}

/** One legend label per colour stop, at the stop's position on the bar. */
export function legendTicks(range: CoRange, stopCount: number): { at: number; label: string }[] {
  return Array.from({ length: stopCount }, (_, k) => ({
    at: k / (stopCount - 1),
    label: tickLabel(stopValue(range, stopCount, k)),
  }));
}

/** From this factor on, a step is written as a power of ten: "about
 *  100000000000000 times" cannot be read at a glance. */
const POWER_FORM_FROM = 1e6;

/** The superscript digits, by value: "⁰" is SUPERSCRIPT_DIGITS[0]. */
const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** "10¹⁴", or "3.2 × 10¹⁴": `value` (at least 1) with two significant
 *  digits. `toExponential(1)` gives "3.2e+14". */
function powerOfTen(value: number): string {
  const [mantissa = "", exponent = ""] = value.toExponential(1).split("e+");
  const power = `10${[...exponent].map((d) => SUPERSCRIPT_DIGITS[Number(d)]).join("")}`;
  const m = Number(mantissa);
  return m === 1 ? power : `${m} × ${power}`;
}

/** "about 100 times": how much more often one legend step is than the one before. */
export function stepFactorText(range: CoRange, stopCount: number): string {
  const factor = Number((stopValue(range, stopCount, 1) / range.min).toPrecision(2));
  return `about ${factor >= POWER_FORM_FROM ? powerOfTen(factor) : factor} times`;
}

/** The backend's text with its unit; never re-formatted, so nothing is rounded. */
export function formatPercent(text: string): string {
  return text + " %";
}

/** Square pie chart layout (squarified treemap, Bruls et al.): rectangles with
 *  area proportional to value, filling width x height, as square as possible.
 *  Returned in the order of `values`; a zero value gets an empty rect. */
export function squarify(values: number[], width: number, height: number): Rect[] {
  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const order = values
    .map((value, index) => ({ value, index }))
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value);
  // Sizes relative to the largest (1 and below): the sum of the values
  // themselves can overflow to Infinity (1e308 + 1e308), the shares cannot.
  const largest = order[0]?.value ?? 0;
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
