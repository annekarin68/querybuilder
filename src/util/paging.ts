/** How many results one page of the Matching events table shows. */
export const PAGE_SIZE = 100;

/** One page of a list of `total` results. `page` is 0-based; `from` and `to`
 *  are the 1-based first and last result shown (0 and 0 when there is none). */
export interface Page {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/**
 * Page `page` of `total` results, with the page number clamped to the pages
 * that exist: a click on a page that is gone (the results changed) shows the
 * nearest page instead of nothing.
 */
export function pageOf(total: number, page: number, size = PAGE_SIZE): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const wanted = Number.isFinite(page) ? Math.floor(page) : 0;
  const p = Math.min(Math.max(0, wanted), pageCount - 1);
  return {
    page: p,
    pageCount,
    from: total === 0 ? 0 : p * size + 1,
    to: Math.min(total, (p + 1) * size),
    total,
  };
}
