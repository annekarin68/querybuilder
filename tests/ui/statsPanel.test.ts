import { describe, it, expect } from "vitest";
import type { Database, DatabaseResult } from "../../src/model";
import { headlineHtml, statsPanelHtml } from "../../src/ui/statsPanel";
import { initialState, type AppState } from "../../src/state";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";
import { placeIssues } from "../../src/query/issues";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { dbError, failed, ok } from "../statsFixtures";

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
    const html = headline("ok", [ok("a", 5), failed("b", dbError(null, "timeout"))]);
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

  it("keeps showing the results, and where the problem is, while it blocks Run", () => {
    const html = statsPanelHtml({
      ...ready,
      stats: {
        status: "ok",
        results: [ok("a", 5), failed("b", dbError(condition.id, "Too long."))],
      },
      serverIssues: [{ nodeId: condition.id, message: "Too long.", kind: "invalid" }],
    });
    expect(html).toContain("Not counted: 1 problem is marked in the query.");
    expect(html).toContain("Excludes 1 database that failed");
    expect(html).not.toContain("qb-placeholder");
  });

  it("explains every other blocker instead of showing results", () => {
    expect(statsPanelHtml({ ...ready, selectedDatabaseIds: [] })).toContain(
      "Select at least one database to see statistics.",
    );
  });

  describe("errors, each where they can be fixed", () => {
    const message = "Text is too long (at most 100 characters).";
    const issue = { nodeId: condition.id, message, kind: "invalid" as const };
    const withNodeError = (state: Partial<AppState> = {}): AppState => ({
      ...ready,
      stats: {
        status: "ok",
        results: [
          failed("a", dbError(condition.id, message)),
          failed("b", dbError(condition.id, message)),
        ],
      },
      serverIssues: [issue],
      ...state,
    });

    it("shows a query problem once, as a summary with a Show button, not per database", () => {
      const html = statsPanelHtml(withNodeError());
      expect(html).not.toContain(message);
      expect(html).toContain("Not counted: 1 problem is marked in the query.");
      expect(html).toContain(
        `<button type="button" class="ui mini basic button" data-action="show-issue" data-target-id="${condition.id}">Show</button>`,
      );
      // Not data-node-id: that marks query nodes, and focus memory would take
      // the button for one (closest("[data-node-id]")).
      expect(html).not.toContain("data-node-id");
      expect(html.match(/Not counted<\/span>/g)).toHaveLength(2);
    });

    it("counts the problems", () => {
      const other = { ...issue, nodeId: "other" };
      const html = statsPanelHtml(withNodeError({ serverIssues: [issue, other] }));
      expect(html).toContain("Not counted: 2 problems are marked in the query.");
    });

    it("keeps a database error without a node in that database's row, in red", () => {
      const html = statsPanelHtml({
        ...ready,
        stats: { status: "ok", results: [ok("a", 5), failed("b", dbError(null, "Timed out."))] },
      });
      expect(html).toContain('<span class="qb-db-msg qb-db-error">Timed out.</span>');
      expect(html).not.toContain("qb-stat-problems");
      expect(html).not.toContain("Not counted");
    });

    it("shows only the node-less messages in a row that has both kinds", () => {
      const html = statsPanelHtml(
        withNodeError({
          stats: {
            status: "ok",
            results: [
              ok("a", 5),
              failed("b", dbError(condition.id, message), dbError(null, "Timed out.")),
            ],
          },
        }),
      );
      expect(html).toContain("Timed out.");
      expect(html).not.toContain(message);
      expect(html).toContain("Not counted: 1 problem is marked in the query.");
    });

    it("keeps 'Failed.' for a failed database that gave no error", () => {
      const html = statsPanelHtml({
        ...ready,
        stats: { status: "ok", results: [ok("a", 5), failed("b")] },
      });
      expect(html).toContain("Failed.");
    });

    it("points Show at the collapsed group that hides the problem", () => {
      const inner = newGroup();
      const query = addChild(addChild(root, root.id, inner), inner.id, condition);
      const collapsed = updateNode(query, inner.id, { collapsed: true }) as typeof query;
      const html = statsPanelHtml(withNodeError({ query: collapsed }));
      const placed = placeIssues(collapsed, [issue])[0]!.nodeId;
      expect(placed).toBe(inner.id);
      expect(html).toContain(`data-target-id="${placed}">Show</button>`);
    });

    it("offers Try again when the statistics request itself failed", () => {
      const html = statsPanelHtml({ ...ready, stats: { status: "error", error: "<down>" } });
      expect(html).toContain("Couldn't get statistics");
      expect(html).toContain("&lt;down&gt;");
      expect(html).toContain(
        '<button type="button" class="ui mini basic button" data-action="retry-stats">Try again</button>',
      );
      expect(html).not.toContain("Statistics failed");
    });
  });
});
