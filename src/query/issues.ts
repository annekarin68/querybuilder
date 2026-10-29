import type { StatsState } from "../state";
import type { Group, Issue, QueryNode } from "./types";

/** `issues` without repeats: the same kind and message on the same node is
 *  kept once, in the place of the first. If any of the repeats came from the
 *  server, the one kept is marked `fromServer`: that flag changes how it is
 *  drawn (a warning, not a hint), so a local twin must not hide it. */
function withoutRepeats(issues: Issue[]): Issue[] {
  const kept = new Map<string, Issue>();
  for (const issue of issues) {
    const key = JSON.stringify([issue.nodeId, issue.kind, issue.message]);
    const earlier = kept.get(key);
    if (!earlier) {
      kept.set(key, issue);
    } else if (issue.fromServer && !earlier.fromServer) {
      kept.set(key, { ...earlier, fromServer: true });
    }
  }
  return [...kept.values()];
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
      if (nodeId !== null) issues.push({ nodeId, message, kind, fromServer: true });
    }
  }
  return withoutRepeats(issues);
}

/**
 * For every group, block and field condition in `query`, the id of the node
 * that is drawn for it: itself, or — inside a folded group or block — the
 * outermost folded node around it. (A set field's row is always drawn while
 * its block is open: "+ N more fields" only hides unset rows.)
 */
function drawnNodeIds(query: Group): Map<string, string> {
  const drawn = new Map<string, string>();
  const visit = (node: QueryNode, hiddenIn: string | null) => {
    drawn.set(node.id, hiddenIn ?? node.id);
    const inside = hiddenIn ?? (node.collapsed ? node.id : null);
    if (node.kind === "group") {
      for (const child of node.children) visit(child, inside);
    } else {
      for (const c of node.conditions) drawn.set(c.id, inside ?? c.id);
    }
  };
  visit(query, null);
  return drawn;
}

/**
 * `issues`, each moved to a node that is on screen, so none is ever lost: an
 * issue inside a folded group or block goes to the outermost folded node
 * around it, and one whose node isn't in `query` goes to the root group.
 * Issues that end up the same on one node are kept once.
 */
export function placeIssues(query: Group, issues: Issue[]): Issue[] {
  const drawn = drawnNodeIds(query);
  return withoutRepeats(
    issues.map((issue) => ({ ...issue, nodeId: drawn.get(issue.nodeId) ?? query.id })),
  );
}

/** The node (group, block or field condition) with this id in `query`, or null. */
function nodeWithId(query: Group, id: string): object | null {
  let found: object | null = null;
  const visit = (node: QueryNode) => {
    if (found) return;
    if (node.id === id) found = node;
    else if (node.kind === "group") node.children.forEach(visit);
    else found = node.conditions.find((c) => c.id === id) ?? null;
  };
  visit(query);
  return found;
}

/**
 * The server's problems that still apply after an edit from `before` to
 * `after`: those on a node the edit did not touch. Tree edits never change a
 * node in place, they copy it (src/query/tree.ts), so "untouched" means "the
 * very same object in both trees". A problem on an edited, removed or
 * enclosing node is dropped: the new statistics will say whether it is still
 * there. Carrying the rest over means an unchanged problem never makes the
 * query builder repaint while the user types (issue #76).
 */
export function issuesOnUnchangedNodes(before: Group, after: Group, issues: Issue[]): Issue[] {
  return issues.filter((issue) => {
    const node = nodeWithId(before, issue.nodeId);
    return node !== null && node === nodeWithId(after, issue.nodeId);
  });
}

/** `a` and `b` together, each problem kept once (see withoutRepeats). */
export function mergeIssues(a: Issue[], b: Issue[]): Issue[] {
  return withoutRepeats([...a, ...b]);
}
