import { describe, it, expect } from "vitest";
import type { Database, DatabaseResult } from "../../src/model";
import {
  failureRowHtml,
  headlineHtml,
  showProblemButton,
  splitLabel,
  splitResults,
  statsPanelHtml,
  type Failed,
} from "../../src/ui/statsPanel";
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

describe("splitResults", () => {
  it("counts matches over the databases that answered, and sets failed ones apart", () => {
    expect(splitResults([ok("a", 10), failed("b", dbError(null, "down"))], databases)).toEqual({
      matched: 10,
      counted: 1000,
      notCounted: 1000,
      failedDatabases: 1,
    });
  });
});

describe("splitLabel", () => {
  it("says the ratio, and how many databases are not counted", () => {
    expect(splitLabel({ matched: 10, counted: 1000, notCounted: 0, failedDatabases: 0 })).toBe(
      "1.0% of the counted events match.",
    );
    expect(splitLabel({ matched: 10, counted: 1000, notCounted: 1000, failedDatabases: 1 })).toBe(
      "1.0% of the counted events match. 1 database failed and is not counted.",
    );
    expect(splitLabel({ matched: 0, counted: 0, notCounted: 2000, failedDatabases: 2 })).toBe(
      "2 databases failed and are not counted.",
    );
  });
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

  it("shows failed databases as a red end of the bar instead of words", () => {
    const html = headline("ok", [ok("a", 5), failed("b", dbError(null, "timeout"))]);
    expect(html).toContain('<span class="qb-stat-big">5</span>');
    expect(html).toContain("of 1,000");
    expect(html).toContain('class="qb-bar-failed" style="width:max(50%, 2px)"');
    expect(html).toContain(
      'aria-label="0.5% of the counted events match. 1 database failed and is not counted."',
    );
    expect(html).not.toContain("Excludes");
  });

  it("a bar that is all red when every database failed", () => {
    const html = headline("ok", [failed("a"), failed("b")]);
    expect(html).toContain("No database returned a result");
    expect(html).toContain('class="qb-bar-failed" style="width:max(100%, 2px)"');
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
    expect(html).toContain("Show problem</button>");
    expect(html).toContain("1 database failed and is not counted.");
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

    it("shows a query problem once, as a Show problem button, not per database", () => {
      const html = statsPanelHtml(withNodeError());
      // The message is only in tooltips and labels, never as text of a row.
      expect(html.replace(/(title|aria-label)="[^"]*"/g, "")).not.toContain(message);
      expect(html).toContain(`data-action="show-issue" data-target-id="${condition.id}"`);
      // Not data-node-id: that marks query nodes, and focus memory would take
      // the button for one (closest("[data-node-id]")).
      expect(html).not.toContain("data-node-id");
      expect(html).not.toContain("Not counted");
      expect(html.match(/class="qb-bar is-failed"/g)).toHaveLength(2);
    });

    it("counts the problems in the button's label", () => {
      const other = { ...issue, nodeId: "other" };
      const html = statsPanelHtml(withNodeError({ serverIssues: [issue, other] }));
      // The accessible name starts with the visible text (WCAG 2.5.3, label in name).
      expect(html).toContain('aria-label="Show problem (the first of 2 in the query)"');
    });

    it("explains a database's own failure in its row's label and tooltip, not in text", () => {
      const html = statsPanelHtml({
        ...ready,
        stats: { status: "ok", results: [ok("a", 5), failed("b", dbError(null, "Timed out."))] },
      });
      expect(html).toContain('title="B failed and is not counted: Timed out."');
      expect(html).not.toContain("qb-db-error");
      expect(html).not.toContain("Show problem");
      expect(html).not.toContain("Not counted");
    });

    it("says only the node-less messages in a row that has both kinds", () => {
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
      expect(html).toContain("B failed and is not counted: Timed out.");
      expect(html).not.toContain(message);
      expect(html).toContain("Show problem</button>");
    });

    it("keeps 'Failed.' for a failed database that gave no error", () => {
      const html = statsPanelHtml({
        ...ready,
        stats: { status: "ok", results: [ok("a", 5), failed("b")] },
      });
      expect(html).toContain("B failed and is not counted: Failed.");
    });

    it("points Show problem at the collapsed group that hides the problem", () => {
      const inner = newGroup();
      const query = addChild(addChild(root, root.id, inner), inner.id, condition);
      const collapsed = updateNode(query, inner.id, { collapsed: true }) as typeof query;
      const html = statsPanelHtml(withNodeError({ query: collapsed }));
      const placed = placeIssues(collapsed, [issue])[0]!.nodeId;
      expect(placed).toBe(inner.id);
      expect(html).toContain(`data-target-id="${placed}"`);
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

describe("showProblemButton", () => {
  const root = emptyQuery();
  const problem = (message: string) => ({ nodeId: root.id, message, kind: "invalid" as const });

  it("is empty when the databases found no problem in the query", () => {
    expect(showProblemButton({ ...initialState, query: root })).toBe("");
  });

  it("points at the first problem, with no 'Not counted' text", () => {
    const html = showProblemButton({
      ...initialState,
      query: root,
      serverIssues: [problem("Too long."), problem("Bad date.")],
    });
    expect(html).toContain(`data-action="show-issue" data-target-id="${root.id}"`);
    expect(html).toContain(">Show problem</button>");
    expect(html).toContain('aria-label="Show problem (the first of 2 in the query)"');
    expect(html).not.toContain("Not counted");
  });

  it("with one problem, the name still starts with the visible text", () => {
    const html = showProblemButton({
      ...initialState,
      query: root,
      serverIssues: [problem("Too long.")],
    });
    expect(html).toContain('aria-label="Show problem in the query"');
  });
});

describe("failureRowHtml", () => {
  it("is a red bar whose label and tooltip say why, with no text on the row", () => {
    const result = failed("b", dbError(null, "Unreachable.")) as Failed;
    const html = failureRowHtml(result, databases[1]);
    expect(html).toContain(
      '<span class="qb-bar is-failed" role="img" aria-label="B failed and is not counted: Unreachable."',
    );
    expect(html).toContain('title="B failed and is not counted: Unreachable."');
    expect(html).not.toContain("Not counted");
  });
});
