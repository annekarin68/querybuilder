import { describe, it, expect, vi } from "vitest";
import { issueAwareRender } from "../../src/ui/issueRepaint";
import { initialState, type AppState, type StatsState } from "../../src/state";

const withStats = (stats: StatsState): AppState => ({ ...initialState, stats });
const rejecting = (nodeId: string): StatsState => ({
  status: "loading",
  results: [
    {
      databaseId: "a",
      status: "failed",
      errors: [{ nodeId, message: "Too long.", kind: "invalid" }],
      notes: [],
    },
  ],
});

describe("issueAwareRender", () => {
  it("paint always renders", () => {
    const render = vi.fn();
    const panel = issueAwareRender(render);
    panel.paint(withStats({ status: "idle", results: [] }));
    panel.paint(withStats({ status: "idle", results: [] }));
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("a stats change repaints only when the backend's issues change", () => {
    const render = vi.fn();
    const panel = issueAwareRender(render);
    panel.paint(withStats({ status: "idle", results: [] }));
    // A successful line: no issues, so no repaint.
    panel.paintIfIssuesChanged(
      withStats({
        status: "loading",
        results: [{ databaseId: "b", status: "ok", matchCount: 1, notes: [] }],
      }),
    );
    expect(render).toHaveBeenCalledTimes(1);
    // A line that points at a node: repaint once.
    panel.paintIfIssuesChanged(withStats(rejecting("c1")));
    panel.paintIfIssuesChanged(withStats(rejecting("c1")));
    expect(render).toHaveBeenCalledTimes(2);
    // A different issue: repaint again.
    panel.paintIfIssuesChanged(withStats(rejecting("c2")));
    expect(render).toHaveBeenCalledTimes(3);
  });
});
