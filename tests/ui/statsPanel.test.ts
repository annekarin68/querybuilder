import { describe, it, expect } from "vitest";
import { initialState, type AppState } from "../../src/state";
import type { DatabasesResponse, StatsResponse } from "../../src/api/types";
import { headlineHtml } from "../../src/ui/statsPanel";

const db = (label: string, totalEntrysets: number): DatabasesResponse => ({
  label,
  name: label.toUpperCase(),
  description: "",
  owner: "",
  totalEntrysets,
  percentageOfTotal: 0,
});

function stateWith(status: AppState["stats"]["status"], lines: StatsResponse[]): AppState {
  return {
    ...initialState,
    databases: [db("a", 1000), db("b", 1000)],
    selectedDatabaseIds: ["a", "b"],
    stats: { status, lines, error: null },
  };
}

describe("headlineHtml", () => {
  it("sums matches and totals over successful databases only", () => {
    const html = headlineHtml(
      stateWith("ok", [
        { label: "a", success: true, matchCount: 10 },
        { label: "b", success: true, matchCount: 30 },
      ]),
    );
    expect(html).toContain('<span class="qb-stat-big">40</span>');
    expect(html).toContain("of 2,000");
    expect(html).not.toContain("failed");
  });

  it("never shows a zero count when every database failed", () => {
    const html = headlineHtml(stateWith("ok", [{ label: "a", success: false }]));
    expect(html).not.toContain("qb-stat-big");
    expect(html).toContain("No database returned a result");
  });

  it("says 'no results yet' while only failures have streamed in", () => {
    const html = headlineHtml(stateWith("loading", [{ label: "a", success: false }]));
    expect(html).toContain("No results yet.");
  });

  it("notes how many databases the total excludes when some failed", () => {
    const html = headlineHtml(
      stateWith("ok", [
        { label: "a", success: true, matchCount: 5 },
        { label: "b", success: false, errorMessages: ["timeout"] },
      ]),
    );
    expect(html).toContain('<span class="qb-stat-big">5</span>');
    expect(html).toContain("of 1,000");
    expect(html).toContain("Excludes 1 database that failed");
  });

  it("labels the headline number", () => {
    const html = headlineHtml(stateWith("ok", [{ label: "a", success: true, matchCount: 10 }]));
    expect(html).toContain("matching events");
  });
});
