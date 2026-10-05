import type { AppState, StatsState } from "../state";
import type { Group, Issue, QueryNode } from "./types";

/**
 * The problems the backend found in the query on screen: every error a
 * database's stats line points at a node with (`DatabaseError.nodeId`), as an
 * `Issue`. Derived from `stats` on every render, never stored: any edit or
 * database change resets `stats` (app.ts, changeScope), so these disappear
 * exactly when they stop being true.
 *
 * Several databases often report the same problem; it is shown once. The
 * statistics panel says which databases reported it. Errors that point at no
 * node are shown there only.
 */
export function serverIssues(stats: StatsState): Issue[] {
  if (stats.status === "error") return [];
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const result of stats.results) {
    if (result.status !== "failed") continue;
    for (const { nodeId, message, kind } of result.errors) {
      if (nodeId === null) continue;
      const key = JSON.stringify([nodeId, kind, message]);
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ nodeId, message, kind });
    }
  }
  return issues;
}

/**
 * For every node in `query`, the id of the node that is drawn for it: itself,
 * or — inside a collapsed group — the outermost collapsed group around it.
 */
function drawnNodeIds(query: Group): Map<string, string> {
  const drawn = new Map<string, string>();
  const visit = (node: QueryNode, hiddenIn: string | null) => {
    drawn.set(node.id, hiddenIn ?? node.id);
    if (node.kind === "group") {
      const childrenHiddenIn = hiddenIn ?? (node.collapsed ? node.id : null);
      for (const child of node.children) visit(child, childrenHiddenIn);
    }
  };
  visit(query, null);
  return drawn;
}

/**
 * `issues`, each moved to a node that is on screen, so none is ever lost: an
 * issue inside a collapsed group goes to the outermost collapsed group around
 * it, and an issue whose node isn't in `query` goes to the root group. (Only a
 * backend bug sends an unknown id: results for an older query are dropped.)
 */
export function placeIssues(query: Group, issues: Issue[]): Issue[] {
  const drawn = drawnNodeIds(query);
  return issues.map((issue) => ({ ...issue, nodeId: drawn.get(issue.nodeId) ?? query.id }));
}

/** Every issue the query builder shows — the local ones (validate.ts) and the
 *  backend's — each on the node it is shown on. */
export function shownIssues(state: Pick<AppState, "query" | "issues" | "stats">): Issue[] {
  return placeIssues(state.query, [...state.issues, ...serverIssues(state.stats)]);
}
