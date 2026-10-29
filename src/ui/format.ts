import { NUMBER_LOCALE } from "../config";
import type { Database } from "../model";

/**
 * Display formatting shared by the panels: numbers and proportions for the
 * statistics (a real backend can return counts from a handful to billions and
 * percentages down to ~1e-10), plus labels, counts and timestamps.
 *
 * Every word is English, whatever the viewer's browser says (WORDS_LOCALE:
 * "1,2 billion", not "1,2 mrd."), and every number has the digit grouping
 * and decimal mark of `NUMBER_LOCALE` (src/config.ts, Norwegian: "12 345",
 * "28,86"). `locale` is that second one; tests pass it so that assertions
 * do not depend on the machine.
 */

/** The language of the words in numbers and dates. */
const WORDS_LOCALE = "en-GB";

/** `separatorsOf`'s answers, by locale: building an `Intl.NumberFormat` is
 *  slow, and the builder asks once for every co-occurrence cell it draws. */
const separatorCache = new Map<string, { group: string; decimal: string }>();

/** The digit grouping and decimal mark of `locale`: "\u00a0" and "," in Norwegian. */
function separatorsOf(locale: string): { group: string; decimal: string } {
  let marks = separatorCache.get(locale);
  if (!marks) {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    marks = {
      group: parts.find((p) => p.type === "group")?.value ?? ",",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
    separatorCache.set(locale, marks);
  }
  return marks;
}

/** The decimal mark of every number on screen: "," in Norwegian. */
export function decimalMark(locale = NUMBER_LOCALE): string {
  return separatorsOf(locale).decimal;
}

/** `n` written by `options` with English words, then with the separators of
 *  `locale` in place of the English ones. */
function englishWithSeparators(
  n: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const { group, decimal } = separatorsOf(locale);
  return new Intl.NumberFormat(WORDS_LOCALE, options)
    .formatToParts(n)
    .map((p) => (p.type === "group" ? group : p.type === "decimal" ? decimal : p.value))
    .join("");
}

/** Compact for anything ≥ 100 000, in English words ("1,2 billion",
 *  "988 million", "100 thousand"), exact with grouping below ("12 345",
 *  "28,86"). */
export function compact(n: number, locale = NUMBER_LOCALE): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 100_000) return exact(n, locale);
  return englishWithSeparators(n, locale, {
    notation: "compact",
    compactDisplay: "long",
    maximumFractionDigits: 1,
  });
}

/** Exact value with digit grouping, for `title=` tooltips: "1 234 567 890". */
export function exact(n: number, locale = NUMBER_LOCALE): string {
  return Number.isFinite(n) ? englishWithSeparators(n, locale) : String(n);
}

/** A share with its unit: "6,2 %". `digits`: decimals after the mark. */
function percentText(pct: number, digits: number, locale: string): string {
  const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return `${englishWithSeparators(pct, locale, options)} %`;
}

/**
 * A readable proportion of `match` / `total`, choosing the form by magnitude:
 *  - no rows or no matches   → "none"
 *  - every row matches        → "all"
 *  - ≥ 10 %                    → "62 %"       (integer; "99,9 %" rather than a rounded "100 %")
 *  - 1 %–10 %                  → "6,2 %"
 *  - 0.05 %–1 %                → "0,34 %"      (2 significant digits)
 *  - < 0.05 % (some matches)   → "1 in 2,9 billion" — the only sane form for e.g. 3.4e-10 %
 *  - 99.95 %–<100 %            → ">99,9 %"
 */
export function matchRatio(match: number, total: number, locale = NUMBER_LOCALE): string {
  if (!total || !match) return "none";
  if (match >= total) return "all";
  const pct = (match / total) * 100;
  if (pct < 0.05) return `1 in ${compact(Math.round(total / match), locale)}`;
  if (pct < 1) {
    // Two significant digits: 0.34, 0.056.
    const digits = Math.max(0, 1 - Math.floor(Math.log10(pct)));
    const rounded = Number(pct.toPrecision(2));
    return `${englishWithSeparators(rounded, locale, { maximumFractionDigits: digits })} %`;
  }
  if (pct >= 99.95) return `>${percentText(99.9, 1, locale)}`;
  if (pct >= 10) {
    const r = Math.round(pct);
    return r >= 100 ? percentText(pct, 1, locale) : percentText(r, 0, locale);
  }
  return percentText(pct, 1, locale);
}

/**
 * Progress-bar width as a CSS value. A nonzero match always shows at least a 2px
 * sliver via `max()`, so "a few in a billion" is visibly distinct from zero.
 * The percentage is rounded to 2 decimals and never sub-0.01% — enough since the
 * 2px floor dominates below ~1% anyway — which also keeps it out of scientific
 * notation (`1e-7%`), which some CSS engines reject inside `max()`.
 */
export function barWidth(match: number, total: number): string {
  if (match <= 0 || total <= 0) return "0";
  const pct = (match / total) * 100;
  const pctStr = pct >= 0.01 ? String(Math.round(pct * 100) / 100) : "0.01";
  return `max(${pctStr}%, 2px)`;
}

/** A backend identifier shown as text (a group name, a tag): the backend's own
 *  casing, with underscores shown as spaces. "some_label" → "some label". */
export function displayLabel(s: string): string {
  return s.replace(/_/g, " ");
}

/** A database pill's hover text: "Owner: description", or whichever of the
 *  two is non-blank, or "" when both are. */
export function databaseTitle({
  owner,
  description,
}: Pick<Database, "owner" | "description">): string {
  return owner && description ? `${owner}: ${description}` : owner || description;
}

/** "1 event" / "9 events" / "12 345 events". */
export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}s`,
  locale = NUMBER_LOCALE,
): string {
  return `${exact(n, locale)} ${n === 1 ? singular : plural}`;
}

/** A timestamp short enough to stay on one line, with the month in English:
 *  "7 Nov 2024, 08:15". Missing → "—"; unparseable → returned unchanged. */
export function formatWhen(
  iso: string | undefined,
  locale = WORDS_LOCALE,
  timeZone?: string,
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
}

/** The day only, in digits ("08.10.2026" in Norwegian): a saved query's
 *  date. Unparseable → returned unchanged, so nothing is hidden. */
export function formatDate(iso: string, locale = NUMBER_LOCALE, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

/**
 * The hover title that shows the full text of a dropdown's choice or a value
 * box, which is cut off with "…" when it is longer than the box: the text,
 * trimmed. null means "no title attribute at all": there is nothing to show,
 * or the text is only a placeholder ("Choose…"), which is not a choice.
 */
export function hoverTitle(text: string | null | undefined, placeholder = false): string | null {
  const trimmed = (text ?? "").trim();
  return placeholder || trimmed === "" ? null : trimmed;
}
