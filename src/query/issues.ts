import type { StatsState } from "../state";
import type { Group, Issue, QueryNode } from "./types";

/** `issues` without repeats: the same kind and message on the same node is
 *  kept once. */
function withoutRepeats(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([issue.nodeId, issue.kind, issue.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The problems the backend found in the query: every error a database's stats
 * line points at a node with (`DatabaseError.nodeId`), as an `Issue`. app.ts
 * keeps the result in `AppState.serverIssues`.
 *
 * Several databases often report the same problem; it is kept once. The
 * statistics panel says which databases reported it. Errors that point at no
 * node are shown there only.
 */
export function serverIssues(stats: StatsState): Issue[] {
  if (stats.status === "error") return [];
  const issues: Issue[] = [];
  for (const result of stats.results) {
    if (result.status !== "failed") continue;
    for (const { nodeId, message, kind } of result.errors) {
      if (nodeId !== null) issues.push({ nodeId, message, kind });
    }
  }
  return withoutRepeats(issues);
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
 * Issues that end up the same on one node — say, two hidden conditions both
 * missing a field — are kept once.
 */
export function placeIssues(query: Group, issues: Issue[]): Issue[] {
  const drawn = drawnNodeIds(query);
  return withoutRepeats(
    issues.map((issue) => ({ ...issue, nodeId: drawn.get(issue.nodeId) ?? query.id })),
  );
}
