import type {
  QueryRequest,
  RequestFacet,
  RequestFieldCondition,
  RequestGroup,
  RequestNode,
  RequestScalar,
  RequestValue,
  SavedFacet,
  SavedFieldCondition,
  SavedGroup,
  SavedNode,
  SavedQueryRequest,
  SavedValue,
} from "./types";
import type { SavedQueryDraft } from "../model";
import type { FacetBlock, FieldCondition, Group, QueryNode } from "../query/types";

// The builders below write the wire's snake_case keys (`facet_id`) from the
// model's camelCase properties (`facetId`): this file is where the two meet.

/**
 * The body of POST …/filter/validate and …/filter/execute, built from the
 * query on screen (docs/ARCHITECTURE.md, "Wire format of the query"). A
 * projection, never a rewrite: every operator and value goes out as the user
 * built it. Unset fields are not in the query, so they are not sent; only
 * display state (`collapsed`) is left out.
 *
 * Call it only for a query that can run (`runBlocker` in src/state.ts). An
 * unfinished condition, or a value that isn't JSON scalars, throws: a bug.
 */
export function toQueryRequest(query: Group, databases: string[]): QueryRequest {
  return { databases: [...databases], query: groupOf(query) };
}

function nodeOf(node: QueryNode): RequestNode {
  return node.kind === "group" ? groupOf(node) : facetOf(node);
}

function groupOf(g: Group): RequestGroup {
  return { kind: "group", id: g.id, operator: g.operator, children: g.children.map(nodeOf) };
}

function facetOf(b: FacetBlock): RequestFacet {
  return {
    kind: "facet",
    id: b.id,
    facet_id: b.facetId,
    negated: b.negated,
    operator: b.operator,
    conditions: b.conditions.map(conditionOf),
  };
}

function conditionOf(c: FieldCondition): RequestFieldCondition {
  if (c.operatorId === null) throw new Error(`Condition ${c.id} is unfinished and cannot be sent.`);
  return {
    kind: "condition",
    id: c.id,
    field_id: c.fieldId,
    operator_id: c.operatorId,
    value: valueOf(c),
  };
}

const isScalar = (v: unknown): v is RequestScalar =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function valueOf(c: FieldCondition): RequestValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every(isScalar)) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}

/**
 * The body of POST …/filter/saved and PUT …/filter/saved/{id}: the query as
 * the user left it, finished or not (docs/ARCHITECTURE.md, "Saved queries").
 * The backend checks the shape only, so a bug in our own validation can never
 * stop a user saving their work. Name and note are trimmed.
 */
export function toSavedQueryRequest(draft: SavedQueryDraft): SavedQueryRequest {
  return {
    name: draft.name.trim(),
    note: draft.note.trim(),
    databases: [...draft.databaseIds],
    query: toSavedTree(draft.query),
  };
}

/**
 * A saved query's tree (docs/ARCHITECTURE.md, "Saved queries"): unfinished
 * parts kept, node ids and `collapsed` left out (ids only live for one page
 * load). Throws only on a value that is not JSON scalars and nulls (a bug).
 */
export function toSavedTree(query: Group): SavedGroup {
  return savedGroupOf(query);
}

function savedNodeOf(node: QueryNode): SavedNode {
  return node.kind === "group" ? savedGroupOf(node) : savedFacetOf(node);
}

function savedGroupOf(g: Group): SavedGroup {
  return { kind: "group", operator: g.operator, children: g.children.map(savedNodeOf) };
}

function savedFacetOf(b: FacetBlock): SavedFacet {
  return {
    kind: "facet",
    facet_id: b.facetId,
    negated: b.negated,
    operator: b.operator,
    conditions: b.conditions.map(savedConditionOf),
  };
}

function savedConditionOf(c: FieldCondition): SavedFieldCondition {
  return {
    kind: "condition",
    field_id: c.fieldId,
    operator_id: c.operatorId,
    value: savedValueOf(c),
  };
}

function savedValueOf(c: FieldCondition): SavedValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every((item) => item === null || isScalar(item))) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}
