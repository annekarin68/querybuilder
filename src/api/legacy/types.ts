// The query-tree types of the wire format before facet blocks
// (docs/superpowers/specs/2026-10-27-facet-blocks-design.md). The app still
// sends these; plan A2 switches it to the new ones in ../types.ts and deletes
// this file.
import type { RequestValue, SavedValue } from "../types";

// ---- the body of POST …/filter/validate and POST …/filter/execute ---------------------

/**
 * The query and where to run it — the body of POST {prefix}/filter/validate and POST
 * {prefix}/filter/execute (docs/ARCHITECTURE.md, "Wire format of the query"). Built by
 * `toQueryRequest` (src/api/legacy/request.ts) from the query on screen.
 */
export interface QueryRequest {
  /** `DatabasesResponse.label` of each database to run against. Never empty. */
  databases: string[];
  /** The query. Its root is always a group. */
  query: RequestGroup;
}

export type RequestNode = RequestGroup | RequestCondition;

export interface RequestGroup {
  kind: "group";
  /** The frontend's id for this node: opaque, unique within the request.
   *  Quoted back as `StatsErrorMessage.node_id` when a database finds a problem
   *  in this node. */
  id: string;
  operator: "AND" | "OR";
  /** Never empty. */
  children: RequestNode[];
}

export interface RequestCondition {
  kind: "condition";
  id: string;
  /** `IndividualResponse.label`. */
  facet_id: string;
  /** `IndividualFieldResponse.label`, within that individual — or `null` for a
   *  condition about the individual (facet) itself, e.g. "is present". What a
   *  null field means is the backend's to interpret. */
  field_id: string | null;
  /** An operator label, e.g. "gt". */
  operator_id: string;
  /** Shaped by the operator's arity: `null` (none), one value (one),
   *  `[from, to]` (two) or a non-empty list (many). */
  value: RequestValue;
}

// ---- saved queries (GET/POST …/filter/saved, PUT/DELETE …/filter/saved/{id}) --

/**
 * A saved query as stored by the backend: the query as the user left it,
 * finished or not (docs/ARCHITECTURE.md, "Saved queries"). The backend checks
 * the shape only, never the meaning. Built by `toSavedQueryRequest`
 * (src/api/legacy/request.ts).
 */
export interface SavedQueryRequest {
  /** 1–80 characters after trimming; unique per user, ignoring case. */
  name: string;
  /** 0–80 characters; "" for none. A few words to recognise the query by. */
  note: string;
  /** `DatabasesResponse.label` of each selected database. May be empty. */
  databases: string[];
  /** The draft tree. Its root is always a group. */
  query: SavedGroup;
}

export interface SavedQueryResponse extends SavedQueryRequest {
  /** Made by the server. Not a `label`: it names a user's own record, not backend data. */
  id: string;
  /** ISO 8601 UTC. */
  updated_at: string;
}

export type SavedNode = SavedGroup | SavedCondition;

/**
 * Like `RequestGroup`, but `children` may be empty, and with no `id`: node ids
 * only live for one page load, so the frontend makes fresh ones when it reads
 * a saved query. An `id` saved by an older build is ignored.
 */
export interface SavedGroup {
  kind: "group";
  operator: "AND" | "OR";
  children: SavedNode[];
}

/** Like `RequestCondition`, but unfinished (each of the four may be `null`) and with no `id`. */
export interface SavedCondition {
  kind: "condition";
  facet_id: string | null;
  field_id: string | null;
  operator_id: string | null;
  value: SavedValue;
}
