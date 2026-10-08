import type {
  QueryRequest,
  RequestCondition,
  RequestGroup,
  RequestNode,
  RequestScalar,
  RequestValue,
  SavedCondition,
  SavedGroup,
  SavedNode,
  SavedQueryRequest,
  SavedValue,
} from "./types";
import type { SavedQueryDraft } from "../model";
import type { Condition, Group, QueryNode } from "../query/types";

/**
 * The body of POST …/stats and POST …/query, built from the query on screen
 * (docs/ARCHITECTURE.md, "Wire format of the query"). A projection, never a
 * rewrite: every operator and value goes out exactly as the user built it, and
 * the backend interprets them. Only display state (`collapsed`) is left out.
 *
 * Call it only for a query that can run (`runBlocker` in src/state.ts returns
 * null). An unfinished condition, or a value that isn't JSON scalars, throws:
 * that is a bug, not a user mistake.
 */
export function toQueryRequest(query: Group, databases: string[]): QueryRequest {
  return { databases: [...databases], query: groupOf(query) };
}

function nodeOf(node: QueryNode): RequestNode {
  return node.kind === "group" ? groupOf(node) : conditionOf(node);
}

function groupOf(g: Group): RequestGroup {
  return { kind: "group", id: g.id, operator: g.operator, children: g.children.map(nodeOf) };
}

function conditionOf(c: Condition): RequestCondition {
  if (c.facetId === null || c.operatorId === null) {
    throw new Error(`Condition ${c.id} is unfinished and cannot be sent.`);
  }
  return {
    kind: "condition",
    id: c.id,
    facetId: c.facetId,
    fieldId: c.fieldId,
    operatorId: c.operatorId,
    value: valueOf(c),
  };
}

const isScalar = (v: unknown): v is RequestScalar =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function valueOf(c: Condition): RequestValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every(isScalar)) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}

// ---- saved queries ------------------------------------------------------------

/**
 * The body of POST/PUT …/saved-queries (docs/ARCHITECTURE.md, "Saved queries").
 * Unlike `toQueryRequest` it accepts a half-built query: blank conditions, a
 * missing operator, a from–to pair with one end empty, an empty group. The
 * backend checks the shape only, so a bug in our own validation can never stop
 * a user saving their work. Only display state (`collapsed`) is left out, and
 * name and note are trimmed. It still throws on a value that is not JSON
 * (text, numbers, true/false, nulls): that is a bug, not a user mistake.
 */
export function toSavedQueryRequest(draft: SavedQueryDraft): SavedQueryRequest {
  return {
    name: draft.name.trim(),
    note: draft.note.trim(),
    databases: [...draft.databaseIds],
    query: savedGroupOf(draft.query),
  };
}

function savedNodeOf(node: QueryNode): SavedNode {
  return node.kind === "group" ? savedGroupOf(node) : savedConditionOf(node);
}

function savedGroupOf(g: Group): SavedGroup {
  return { kind: "group", id: g.id, operator: g.operator, children: g.children.map(savedNodeOf) };
}

function savedConditionOf(c: Condition): SavedCondition {
  return {
    kind: "condition",
    id: c.id,
    facetId: c.facetId,
    fieldId: c.fieldId,
    operatorId: c.operatorId,
    value: savedValueOf(c),
  };
}

function savedValueOf(c: Condition): SavedValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every((item) => item === null || isScalar(item))) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}
