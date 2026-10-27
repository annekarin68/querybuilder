// The query-tree types of the wire format before facet blocks
// (docs/superpowers/specs/2026-10-27-facet-blocks-design.md). The app still
// sends none of them any more (plan A2, Task 3); only the mock's shim for old
// condition nodes reads them, until Task 4 deletes this file. The saved-query
// types moved to ../types.ts.
import type { RequestValue } from "../types";

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
