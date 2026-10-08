import { describe, it, expect } from "vitest";
import type { Database, DatabaseResult } from "../../src/model";
import { initialState, type AppState } from "../../src/state";
import {
  databasePickerHtml,
  deselectFailingIds,
  failedDatabases,
} from "../../src/ui/databasePicker";
import { dbError, failed, ok } from "../statsFixtures";

const db = (id: string, description = ""): Database => ({
  id,
  name: id.toUpperCase(),
  description,
  owner: "",
  eventCount: 100,
});

describe("failedDatabases", () => {
  it("maps each failed database to its reasons: errors first, then notes, then 'Failed.'", () => {
    const results: DatabaseResult[] = [
      ok("a", 1),
      { ...failed("b", dbError("c1", "Too long")), notes: ["n"] },
      { ...failed("c"), notes: ["Could not be reached."] },
      failed("d"),
    ];
    expect(failedDatabases(results)).toEqual(
      new Map([
        ["b", ["Too long"]],
        ["c", ["Could not be reached."]],
        ["d", ["Failed."]],
      ]),
    );
  });
});

describe("deselectFailingIds", () => {
  const failing = new Map([["b", ["x"]]]);

  it("drops the failed ones when some selected databases still work", () => {
    expect(deselectFailingIds(["a", "b"], failing)).toEqual(["a"]);
  });

  it("is null when nothing selected failed, or everything selected did", () => {
    expect(deselectFailingIds(["a"], failing)).toBeNull();
    expect(deselectFailingIds(["b"], failing)).toBeNull();
  });

  it("is null for an empty selection", () => {
    expect(deselectFailingIds([], failing)).toBeNull();
  });
});

describe("databasePickerHtml", () => {
  const base: AppState = {
    ...initialState,
    databases: [db("a", "Plain one"), db("b", "Second <one>"), db("c")],
    selectedDatabaseIds: ["a", "b"],
  };
  const withResults = (results: DatabaseResult[], status: "loading" | "ok" = "ok"): AppState => ({
    ...base,
    stats: { status, results },
  });

  it("marks a selected database that failed, with its reasons in the title", () => {
    const html = databasePickerHtml(
      withResults([ok("a", 1), failed("b", dbError(null, "Too <long>"), dbError(null, "Odd"))]),
    );
    const pillB = html.split("<label").find((p) => p.includes('data-db-id="b"'))!;
    expect(pillB).toContain("qb-db-pill is-failed");
    // The description stays; the reasons follow on a new line, escaped.
    expect(pillB).toContain('title="Second &lt;one&gt;\nToo &lt;long&gt; · Odd"');
    expect(pillB).toContain('<i class="exclamation circle icon" aria-hidden="true"></i>');
    expect(pillB).toContain('<span class="qb-sr-only">failed for this query</span>');
    const pillA = html.split("<label").find((p) => p.includes('data-db-id="a"'))!;
    expect(pillA).not.toContain("is-failed");
    expect(pillA).not.toContain("failed for this query");
  });

  it("uses the reasons alone as the title when the database has no description", () => {
    const html = databasePickerHtml({
      ...withResults([failed("b")]),
      selectedDatabaseIds: ["a", "b", "c"],
      databases: [db("a"), db("b"), db("c")],
    });
    expect(html).toContain('title="Failed."');
  });

  it("does not mark an unselected database that failed earlier", () => {
    const html = databasePickerHtml(withResults([ok("a", 1), ok("b", 1), failed("c")]));
    expect(html).not.toContain("is-failed");
    expect(html).not.toContain("Deselect failing");
  });

  it("marks nothing when the statistics request itself failed", () => {
    const html = databasePickerHtml({ ...base, stats: { status: "error", error: "Offline" } });
    expect(html).not.toContain("is-failed");
  });

  it("marks nothing while a new query is loading and has no results yet", () => {
    expect(databasePickerHtml(withResults([], "loading"))).not.toContain("is-failed");
  });

  it("offers 'Deselect failing (N)' only when some, not all, selected databases failed", () => {
    const some = databasePickerHtml(withResults([ok("a", 1), failed("b")]));
    expect(some).toContain("data-db-deselect-failing");
    expect(some).toContain("Deselect failing (1)");

    const all = databasePickerHtml(withResults([failed("a"), failed("b")]));
    expect(all).toContain("is-failed");
    expect(all).not.toContain("data-db-deselect-failing");

    const none = databasePickerHtml(withResults([ok("a", 1), ok("b", 1)]));
    expect(none).not.toContain("data-db-deselect-failing");
  });
});
