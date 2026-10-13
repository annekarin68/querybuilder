import { describe, it, expect } from "vitest";
import { PAGE_SIZE, pageOf } from "../../src/util/paging";

describe("pageOf", () => {
  it("pages hold 100 results", () => {
    expect(PAGE_SIZE).toBe(100);
  });

  it("gives the rows of a page, 1-based, last row included", () => {
    expect(pageOf(1987, 1)).toEqual({ page: 1, pageCount: 20, from: 101, to: 200, total: 1987 });
    expect(pageOf(1987, 19)).toEqual({
      page: 19,
      pageCount: 20,
      from: 1901,
      to: 1987,
      total: 1987,
    });
  });

  it("is one page for 100 results or fewer", () => {
    expect(pageOf(42, 0)).toEqual({ page: 0, pageCount: 1, from: 1, to: 42, total: 42 });
    expect(pageOf(100, 0).pageCount).toBe(1);
  });

  it("clamps a page out of range or not a number (a stale click), rows included", () => {
    const last = { page: 1, pageCount: 2, from: 101, to: 150, total: 150 };
    const first = { page: 0, pageCount: 2, from: 1, to: 100, total: 150 };
    expect(pageOf(150, 5)).toEqual(last);
    expect(pageOf(150, -1)).toEqual(first);
    expect(pageOf(150, Number.NaN)).toEqual(first);
  });

  // Past the end like any other page that is too high: the nearest page is
  // the last one. Only NaN has no nearest page, so it gives the first.
  it("clamps Infinity to the last page and -Infinity to the first", () => {
    expect(pageOf(150, Infinity).page).toBe(1);
    expect(pageOf(150, -Infinity).page).toBe(0);
  });

  it("has no rows for no results", () => {
    expect(pageOf(0, 0)).toEqual({ page: 0, pageCount: 1, from: 0, to: 0, total: 0 });
  });
});
