import { describe, it, expect } from "vitest";
import type { Database, DatabaseResult } from "../../src/model";
import {
  failureRowHtml,
  notRunRowHtml,
  pendingRowHtml,
  pendingHeadlineHtml,
  headlineHtml,
  showProblemButton,
  splitLabel,
  splitResults,
  statsPanelHtml,
  type Failed,
} from "../../src/ui/statsPanel";
import { initialState, type AppState } from "../../src/state";
import {
  addChild,
  emptyQuery,
  newBlock,
  newFieldCondition,
  newGroup,
  updateNode,
} from "../../src/query/tree";
import type { FacetBlock } from "../../src/query/types";
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

const selectedIds = ["a", "b"];

const headline = (status: "loading" | "ok", results: DatabaseResult[]) =>
  headlineHtml({ status, results }, databases, selectedIds);

describe("pendingRowHtml", () => {
  it("shows the database's name and a quiet ellipsis, escaped", () => {
    const html = pendingRowHtml(db("a", 1), "a");
    expect(html).toContain('class="qb-db-row is-pending"');
    expect(html).toContain("…");
    expect(html).toContain('<span class="qb-sr-only">still counting</span>');
    expect(html).not.toContain("title=");
    expect(pendingRowHtml({ ...db("a", 1), name: "<b>" }, "a")).not.toContain("<b>");
    expect(pendingRowHtml(undefined, "zz")).toContain("zz");
  });
});

describe("pendingHeadlineHtml", () => {
  it("has the headline's parts, so the first answer keeps the height", () => {
    const html = pendingHeadlineHtml();
    for (const part of ["qb-stat-big", "qb-stat-label", "qb-stat-sub", "qb-bar"]) {
      expect(html).toContain(part);
    }
  });
});

describe("splitResults", () => {
  it("counts matches, sets failed databases apart, and sizes the whole selection", () => {
    expect(
      splitResults([ok("a", 10), failed("b", dbError(null, "down"))], databases, selectedIds),
    ).toEqual({ matched: 10, counted: 1000, notCounted: 1000, selected: 2000, failedDatabases: 1 });
  });

  it("counts a selected database that has not answered yet in the selection", () => {
    expect(splitResults([ok("a", 10)], databases, selectedIds).selected).toBe(2000);
  });
});

describe("splitLabel", () => {
  const split = { matched: 10, counted: 1000, notCounted: 0, selected: 2000, failedDatabases: 0 };

  it("gives the share of ALL selected events that match (users, 2026-10-13)", () => {
    expect(splitLabel(split)).toBe("0,5 % of the selected events match.");
  });

  it("says how many databases failed and are not counted", () => {
    expect(splitLabel({ ...split, notCounted: 1000, failedDatabases: 1 })).toBe(
      "0,5 % of the selected events match. 1 database failed and is not counted.",
    );
    expect(
      splitLabel({ ...split, matched: 0, counted: 0, notCounted: 2000, failedDatabases: 2 }),
    ).toBe("2 databases failed and are not counted.");
  });
});

describe("headlineHtml", () => {
  it("sums matches and totals over successful databases only", () => {
    const html = headline("ok", [ok("a", 10), ok("b", 30)]);
    expect(html).toContain('<span class="qb-stat-big">40</span>');
    expect(html).toContain("of 2\u00a0000");
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
    expect(html).toContain('style="width:max(50%, 2px)"');
    expect(html).toContain(
      'aria-label="0,25 % of the selected events match. 1 database failed and is not counted."',
    );
    expect(html).not.toContain("Excludes");
  });

  // The share is of every selected database, failed ones included, so the
  // number and the green part of the bar always agree (users, 2026-10-13).
  it("gives the percentage of all selected events, and the green part matches it", () => {
    const html = headline("ok", [ok("a", 5), failed("b", dbError(null, "timeout"))]);
    expect(html).toContain('<div class="qb-stat-sub">0,25 % of 2\u00a0000</div>');
    expect(html).toContain('<i style="width:max(0.25%, 2px)"></i>');
  });

  it("counts databases still loading in the selection too", () => {
    const html = headline("loading", [ok("a", 10)]);
    expect(html).toContain('<div class="qb-stat-sub">0,5 % of 2\u00a0000</div>');
  });

  it("a bar that is all red when every database failed", () => {
    const html = headline("ok", [failed("a"), failed("b")]);
    expect(html).toContain("No database returned a result");
    expect(html).toContain('class="qb-bar-failed" style="width:max(100%, 2px)"');
  });

  // Every database refused the query because of a problem in it: the databases
  // did not fail, so nothing is red (users, 2026-10-13).
  it("draws no red when the query itself is at fault", () => {
    const html = headline("ok", [failed("a", dbError("c1")), failed("b", dbError("c1"))]);
    expect(html).toContain("No database returned a result");
    expect(html).not.toContain("qb-bar");
  });

  it("labels the headline number", () => {
    const html = headline("ok", [ok("a", 10)]);
    expect(html).toContain("matching events");
  });
});

describe("statsPanelHtml", () => {
  const root = emptyQuery();
  // The node a database's error points at: a set field of a block.
  const condition = newFieldCondition("size", "gt", 3);
  const block: FacetBlock = { ...newBlock("thing"), conditions: [condition] };
  const ready: AppState = {
    ...initialState,
    catalog: buildFieldCatalog([]),
    databases,
    selectedDatabaseIds: ["a", "b"],
    query: addChild(root, root.id, block),
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
    expect(statsPanelHtml({ ...ready, query: emptyQuery() })).toContain(
      "Add a facet to see statistics.",
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
      // The databases did not fail, the query did: no red rows, as the
      // database picker marks no pill (queryIsAtFault).
      expect(html).not.toContain("is-failed");
      expect(html.match(/class="qb-bar is-not-run"/g)).toHaveLength(2);
    });

    it("counts the problems in the button's label", () => {
      const other = { ...issue, nodeId: "other" };
      const html = statsPanelHtml(withNodeError({ serverIssues: [issue, other] }));
      // The accessible name starts with the visible text (WCAG 2.5.3, label in name).
      expect(html).toContain('aria-label="Show problem (the first of 2 in the query)"');
    });

    it("draws one row per selected database while loading, answered or not", () => {
      const loading = (results: DatabaseResult[]) =>
        statsPanelHtml({ ...ready, stats: { status: "loading", results } });
      const rowCount = (html: string) => html.match(/class="qb-db-row/g)?.length ?? 0;
      expect(rowCount(loading([]))).toBe(2);
      const half = loading([ok("a", 5)]);
      expect(rowCount(half)).toBe(2);
      expect(half.match(/is-pending/g)).toHaveLength(1);
      // The wait before the fetch starts holds the same layout.
      const idle = statsPanelHtml({ ...ready, stats: { status: "idle", results: [] } });
      expect(rowCount(idle)).toBe(2);
      expect(idle).toContain("Counting matches…");
      // The headline's place is held too, and the card says it is busy.
      expect(loading([])).toContain("qb-stat-headline is-pending");
      expect(half).toContain('aria-busy="true"');
      // Done: the placeholders are gone.
      const done = statsPanelHtml({ ...ready, stats: { status: "ok", results: [ok("a", 5)] } });
      expect(done).not.toContain("is-pending");
      expect(done).toContain('aria-busy="false"');
    });

    it("explains a database's own failure in one line under its red bar", () => {
      const html = statsPanelHtml({
        ...ready,
        stats: { status: "ok", results: [ok("a", 5), failed("b", dbError(null, "Timed out."))] },
      });
      expect(html).toContain('<span class="qb-db-reason">Timed out.</span>');
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
      const query = addChild(addChild(root, root.id, inner), inner.id, block);
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
  it("is a red bar with the reason on one line under it, and all of it on hover", () => {
    const result = failed("b", dbError(null, "Unreachable.")) as Failed;
    const html = failureRowHtml(result, databases[1]);
    // The bar says what happened; the visible line says why, so a screen
    // reader does not hear the name or the reason twice.
    expect(html).toContain(
      '<span class="qb-bar is-failed" role="img" aria-label="Failed and not counted."',
    );
    expect(html).toContain('<span class="qb-db-reason">Unreachable.</span>');
    expect(html).toContain('title="B failed and is not counted: Unreachable."');
    expect(html).not.toContain("Not counted");
  });

  it("escapes the reason", () => {
    const html = failureRowHtml(failed("b", dbError(null, "<down>")) as Failed, databases[1]);
    expect(html).toContain('<span class="qb-db-reason">&lt;down&gt;</span>');
  });
});

describe("notRunRowHtml", () => {
  it("is a neutral row pointing at Show problem: no red, no reason text", () => {
    const html = notRunRowHtml(databases[1]!, "b");
    expect(html).not.toContain("is-failed");
    expect(html).not.toContain("qb-db-reason");
    expect(html).toContain(
      '<span class="qb-bar is-not-run" role="img" aria-label="Not run: the query has a problem (see Show problem)."',
    );
    expect(html).toContain('title="B did not run the query: it has a problem (see Show problem)."');
    expect(html).toContain(
      '<i class="exclamation triangle icon qb-db-not-run-icon" aria-hidden="true">',
    );
  });
});
