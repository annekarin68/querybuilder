import type { AppState } from "../state";
import { serverIssues } from "../query/issues";

/**
 * Two ways to paint a panel that reads `stats` only for the backend's issues
 * (src/query/issues.ts) — the query builder and the Matching events panel
 * (its Run button). `paint` always renders. `paintIfIssuesChanged` is for a
 * `stats` change: it renders only when those issues differ from the last
 * paint. Stats lines stream in one by one, and repainting for each would
 * close an open dropdown and drop a value the user is typing.
 */
export function issueAwareRender(render: (state: AppState) => void) {
  let painted = "[]";
  const issuesOf = (state: AppState) => JSON.stringify(serverIssues(state.stats));
  const paint = (state: AppState): void => {
    painted = issuesOf(state);
    render(state);
  };
  const paintIfIssuesChanged = (state: AppState): void => {
    if (issuesOf(state) !== painted) paint(state);
  };
  return { paint, paintIfIssuesChanged };
}
