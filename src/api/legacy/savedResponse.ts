import type { SavedCondition, SavedGroup, SavedNode, SavedQueryResponse } from "./types";
import type { ResponseObject } from "../contract";
import type { SavedQuery } from "../../model";
import { groupOf, newCondition } from "../../query/legacy/tree";
import type { Condition, Group, QueryNode } from "../../query/legacy/types";

/**
 * A saved query. The tree is required data (a malformed one throws a
 * ContractError naming the node, e.g. "query.children[0].kind"): loading half
 * of a user's query would be worse than saying it cannot be read. The note is
 * only shown, so a missing one becomes ""; the database ids are required like
 * every id. The tree comes back exactly as it was saved, unfinished parts
 * included (the backend never rewrites it), with fresh node ids.
 */
export function toSavedQuery(q: ResponseObject<SavedQueryResponse>): SavedQuery {
  const root = q.object<SavedGroup>("query");
  root.oneOf("kind", ["group"]); // a saved query's root is always a group
  return {
    id: q.id("id"),
    name: q.id("name").trim(),
    note: q.text("note"),
    databaseIds: q.ids("databases"),
    query: toSavedGroup(root),
    updatedAt: q.id("updated_at"),
  };
}

function toSavedNode(n: ResponseObject<SavedNode>): QueryNode {
  return n.oneOf("kind", ["group", "condition"]) === "group"
    ? toSavedGroup(n)
    : toSavedCondition(n);
}

// A saved tree has no node ids. Each node gets a fresh one, as any new node
// does, which lives until the page is left. An `id` saved by an older build is
// ignored, so it can neither clash with the query on screen nor break the read.

function toSavedGroup(g: ResponseObject<SavedGroup>): Group {
  const operator = g.oneOf("operator", ["AND", "OR"]);
  return groupOf(g.list<SavedNode>("children").map(toSavedNode), operator);
}

function toSavedCondition(c: ResponseObject<SavedCondition>): Condition {
  return {
    ...newCondition(),
    facetId: c.nullableId("facet_id"),
    fieldId: c.nullableId("field_id"),
    operatorId: c.nullableId("operator_id"),
    value: c.savedValue("value"),
  };
}
