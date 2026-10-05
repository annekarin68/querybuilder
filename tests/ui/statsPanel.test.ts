import { describe, it, expect } from "vitest";
import type { Database, DatabaseError, DatabaseResult } from "../../src/model";
import { headlineHtml, statsPanelHtml } from "../../src/ui/statsPanel";
import { initialState, type AppState } from "../../src/state";
import { addChild, emptyQuery, newCondition } from "../../src/query/tree";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";

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
const failed = (databaseId: string, errors: DatabaseError[] = []): DatabaseResult => ({
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
    const html = headline("ok", [
      ok("a", 5),
      failed("b", [{ message: "timeout", kind: "invalid", nodeId: null }]),
    ]);
    expect(html).toContain('<span class="qb-stat-big">5</span>');
    expect(html).toContain("of 1,000");
    expect(html).toContain("Excludes 1 database that failed");
  });

  it("labels the headline number", () => {
    const html = headline("ok", [ok("a", 10)]);
    expect(html).toContain("matching events");
  });
});

describe("statsPanelHtml", () => {
  const root = emptyQuery();
  const condition = newCondition();
  const ready: AppState = {
    ...initialState,
    catalog: buildFieldCatalog([]),
    databases,
    selectedDatabaseIds: ["a", "b"],
    query: addChild(root, root.id, condition),
  };

  it("keeps showing each database's errors while they block Run", () => {
    const html = statsPanelHtml({
      ...ready,
      stats: {
        status: "ok",
        results: [
          ok("a", 5),
          failed("b", [{ nodeId: condition.id, message: "Too long.", kind: "invalid" }]),
        ],
      },
    });
    expect(html).toContain("Too long.");
    expect(html).toContain("Excludes 1 database that failed");
    expect(html).not.toContain("qb-placeholder");
  });

  it("explains every other blocker instead of showing results", () => {
    expect(statsPanelHtml({ ...ready, selectedDatabaseIds: [] })).toContain(
      "Select at least one database to see statistics.",
    );
  });
});
