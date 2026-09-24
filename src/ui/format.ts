import type { Database, Field } from "../model";

/**
 * Display formatting shared by the panels: numbers and proportions for the
 * statistics (a real backend can return counts from a handful to billions and
 * percentages down to ~1e-10), plus labels, counts and timestamps.
 *
 * `locale` is optional and defaults to the viewer's locale; tests pass an
 * explicit locale so assertions are deterministic.
 */

/** Compact for anything ≥ 100,000 ("1.2B", "988M", "100K"), exact-with-grouping below ("12,345", "28.86"). */
export function compact(n: number, locale?: string): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 100_000) return n.toLocaleString(locale);
  return n.toLocaleString(locale, { notation: "compact", maximumFractionDigits: 1 });
}

/** Exact value with digit grouping, for `title=` tooltips: "1,234,567,890". */
export function exact(n: number, locale?: string): string {
  return Number.isFinite(n) ? n.toLocaleString(locale) : String(n);
}

/**
 * A readable proportion of `match` / `total`, choosing the form by magnitude:
 *  - no rows or no matches   → "none"
 *  - every row matches        → "all"
 *  - ≥ 10%                     → "62%"        (integer; "99.9%" rather than a rounded "100%")
 *  - 1%–10%                    → "6.2%"
 *  - 0.05%–1%                  → "0.34%"       (2 significant digits)
 *  - < 0.05% (some matches)    → "1 in 2.9B"   — the only sane form for e.g. 3.4e-10 %
 *  - 99.95%–<100%              → ">99.9%"
 */
export function matchRatio(match: number, total: number, locale?: string): string {
  if (!total || !match) return "none";
  if (match >= total) return "all";
  const pct = (match / total) * 100;
  if (pct < 0.05) return `1 in ${compact(Math.round(total / match), locale)}`;
  if (pct < 1) return `${Number(pct.toPrecision(2))}%`;
  if (pct >= 99.95) return ">99.9%";
  if (pct >= 10) {
    const r = Math.round(pct);
    return r >= 100 ? `${pct.toFixed(1)}%` : `${r}%`;
  }
  return `${pct.toFixed(1)}%`;
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

/** A field's hover text: the backend's always-correct `comment` first, then
 *  the third-party `description`, labelled so the two stay distinct. Either
 *  may be blank; "" when both are. */
export function fieldTitle({
  comment,
  description,
}: Pick<Field, "comment" | "description">): string {
  return [comment, description && `Third-party: ${description}`].filter(Boolean).join("\n");
}

/** "1 event" / "9 events" / "12,345 events". */
export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}s`,
  locale?: string,
): string {
  return `${n.toLocaleString(locale)} ${n === 1 ? singular : plural}`;
}

/** A timestamp short enough to stay on one line: "7 Nov 2024, 08:15" (en-GB).
 *  Missing → "—"; unparseable → returned unchanged. */
export function formatWhen(iso: string | undefined, locale?: string, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
}
