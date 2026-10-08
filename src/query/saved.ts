import { isBlankCondition, sameSemantics } from "./tree";
import type { Group, QueryNode } from "./types";

/** What the saved query on screen held when it was last opened or saved. */
export interface OpenSaved {
  id: string;
  name: string;
  note: string;
  query: Group;
  databaseIds: string[];
}

/** Names match ignoring case and surrounding spaces (the backend's rule). */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether two selections hold the same databases, in any order. */
function sameDatabases(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Whether the query or the database selection differs from `open`. Folding a
 * group is not an edit (it is not saved), so the comparison ignores `collapsed`.
 */
export function isEdited(open: OpenSaved, query: Group, databaseIds: string[]): boolean {
  return !sameSemantics(open.query, query) || !sameDatabases(open.databaseIds, databaseIds);
}

/** Whether any condition in `node` has something chosen: a blank row is nothing to lose. */
function hasChosenCondition(node: QueryNode): boolean {
  if (node.kind === "condition") return !isBlankCondition(node);
  return node.children.some(hasChosenCondition);
}

/**
 * Whether opening another saved query would lose work: the query on screen is
 * edited (or was never saved) and holds a condition with anything chosen. The
 * starting query's blank row, or a query left as saved, can be replaced silently.
 */
export function hasUnsavedWork(
  open: OpenSaved | null,
  query: Group,
  databaseIds: string[],
): boolean {
  if (!hasChosenCondition(query)) return false;
  return open === null || isEdited(open, query, databaseIds);
}

/**
 * Saving `name`: update the open query when the name is its own (a re-save),
 * else create a new one. A name that clashes with a *different* saved query
 * comes back from the backend as a 409, which the app turns into "Replace it?".
 */
export function saveTarget(
  name: string,
  open: OpenSaved | null,
): { kind: "update"; id: string } | { kind: "create" } {
  return open && sameName(name, open.name) ? { kind: "update", id: open.id } : { kind: "create" };
}
