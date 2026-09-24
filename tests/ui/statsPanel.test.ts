import { describe, it, expect } from "vitest";
import type { Database, DatabaseResult } from "../../src/model";
import { headlineHtml } from "../../src/ui/statsPanel";

const db = (id: string, eventCount: number): Database => ({
  id,
  name: id.toUpperCase(),
  description: "",
  owner: "",
  eventCount,
});

const databases = [db("a", 1000), db("b", 1000)];

const headline = (status: "loading" | "ok", results: DatabaseResult[]) =>
  headlineHtml({ status, results }, databases);

const ok = (databaseId: string, matchCount: number): DatabaseResult => ({
  databaseId,
  status: "ok",
  matchCount,
  notes: [],
});
const failed = (databaseId: string, errors: string[] = []): DatabaseResult => ({
  databaseId,
  status: "failed",
  errors,
  notes: [],
});

describe("headlineHtml", () => {
  it("sums matches and totals over successful databases only", () => {
    const html = headline("ok", [ok("a", 10), ok("b", 30)]);
    expect(html).toContain('<span class="qb-stat-big">40</span>');
    expect(html).toContain("of 2,000");
    expect(html).not.toContain("failed");
  });

  it("never shows a zero count when every database failed", () => {
    const html = headline("ok", [failed("a")]);
    expect(html).not.toContain("qb-stat-big");
    expect(html).toContain("No database returned a result");
  });

  it("says 'no results yet' while only failures have streamed in", () => {
    const html = headline("loading", [failed("a")]);
    expect(html).toContain("No results yet.");
  });

  it("notes how many databases the total excludes when some failed", () => {
    const html = headline("ok", [ok("a", 5), failed("b", ["timeout"])]);
    expect(html).toContain('<span class="qb-stat-big">5</span>');
    expect(html).toContain("of 1,000");
    expect(html).toContain("Excludes 1 database that failed");
  });

  it("labels the headline number", () => {
    const html = headline("ok", [ok("a", 10)]);
    expect(html).toContain("matching events");
  });
});
