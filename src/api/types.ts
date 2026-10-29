/**
 * The backend's request and response types: the API contract, spelled exactly
 * as it goes over the wire (docs/ARCHITECTURE.md, "API contract"). Every key is
 * snake_case, in requests and responses alike; the frontend's own model
 * (src/model.ts) is camelCase, and src/api/response.ts and request.ts translate.
 * The backend team builds its response models from this file. Only
 * src/api/ may import this file (ESLint enforces it).
 *
 * TypeScript can't check what the server really sends, so response.ts reads
 * every response through src/api/contract.ts, which checks each value against
 * these types as it is read. A `?` here means the backend may leave the key
 * out: read it with an `optional…` read there.
 */

/**
 * Who's logged in, returned by GET /api/users/me. The backend accepts two
 * spellings of two keys (`user_id` is another name for `sub`, `username` for
 * `preferred_username`), so either may arrive. The app reads only
 * `display_name`, which the backend fills from the username, else the email,
 * else the user id, and falls back to the id itself only if that is blank.
 */
export interface UserResponse {
  /** The user's id. Also sent as `user_id`. */
  sub?: string;
  user_id?: string;
  /** Also sent as `username`. */
  preferred_username?: string | null;
  username?: string | null;
  email?: string | null;
  /** What the user may do. Not used by the frontend yet. */
  authorizations: string[];
  /** The text to show for the user. */
  display_name: string;
}

/**
 * The session's compliance log, returned by GET /api/log/status (200). A
 * structured message whose fields the backend owns: the frontend shows it
 * whole as formatted JSON and reads no field of it. The backend answers 403
 * when the session has no compliance log.
 */
export type ComplianceLogResponse = Record<string, unknown>;

/**
 * One database's result from the POST /api/filter/validate stream. The endpoint's
 * response body is newline-delimited JSON today (the backend may change the
 * streaming format later): one of these per selected database, written as
 * soon as that database's result is ready — some databases are slower than
 * others, or can fail independently.
 */
export interface StatsResponse {
  /** Database ID — matches DatabasesResponse.label. */
  label: string;
  /** Whether the query to this specific database succeeded. There is no
   *  per-database HTTP status in an NDJSON stream, so this is how failure
   *  is signaled instead. */
  success: boolean;
  /** Events matched by this query in this database. Only meaningful
   *  when `success` is true — optional rather than a fabricated 0, so a
   *  failed database can never be misread as "zero rows matched." */
  match_count?: number;
  /** Problems with the query itself — an operator this database no longer
   *  supports, a value it can't accept (a malformed date, a too-long text, …). */
  error_messages?: StatsErrorMessage[];
  /** Other information or error messages — a database timeout, an internal
   *  server error, or a non-blocking notice. */
  info_messages?: string[];
}

/** One problem with the query, found by the backend in one database. */
export interface StatsErrorMessage {
  /** The `id` of the group or condition from the request (RequestGroup.id,
   *  RequestCondition.id) that the problem is in. Left out when the problem
   *  is not in one place. */
  node_id?: string;
  message: string;
  /** "incomplete": something is missing. "invalid": something can't work. */
  kind: "incomplete" | "invalid";
}

/** The databases the query can be scoped to (GET /api/documentation/databases). Returns
 *  DatabasesResponse[] directly — no wrapper object. */
export interface DatabasesResponse {
  /** A short summary of what this database contains or what makes it unique. */
  description: string;
  /** User-friendly display name. */
  name: string;
  /** The title of this database's owner — the company that reported the data. */
  owner: string;
  /** Total events in this database. (The backend still calls them
   *  entrysets.) */
  total_entrysets: number;
  /** This database's share of the total data across all databases — sums
   *  to 100% across every database returned. */
  percentage_of_total: number;
  /** API-friendly "ID", not meant to be displayed. */
  label: string;
}

/** One field an individual can report a value for (GET /api/documentation/individuals). */
export interface IndividualFieldResponse {
  /** This field's locally unique, API-friendly "ID" within this facet. */
  label: string;
  /** The field's actual type, defined by the backend (e.g. VARCHAR, BIGINT,
   *  TIMESTAMP). Takes precedence over `format` when both are present. */
  type: string;
  /** A third-party technical description. May contain errors — present it
   *  visually distinct from `comment`. */
  description: string;
  /** The backend's own, always-correct description — present it visually
   *  distinct from `description`. */
  comment: string;
  /** Distinct values for this field across all databases, as of right now.
   *  Can be 0 to several billion. Informational only — the frontend never
   *  branches on it. */
  cardinality: number;
  /** The field's known distinct values, when the backend chooses to supply
   *  them; empty otherwise. A static list built ahead of time, so it can be
   *  out of date: the frontend only suggests these (a pick-list), always lets
   *  the user enter other values, and never takes the field's type from them. */
  values: string[];
  /** A third-party type hint, used only when `type` is empty. */
  format: string;
  /** Reserved for a future human-readable name; not populated by the backend
   *  yet. Anywhere this is displayed, fall back to `label` when absent/empty. */
  name?: string;
}

/**
 * One individual (a facet, in the frontend's words) — something an entryset
 * may hold a value for (GET /api/documentation/individuals). The frontend knows no facet by
 * name: everything it shows about facets comes from this response (or from
 * src/config.ts).
 */
export interface IndividualResponse {
  /** Unique "ID" for API requests — a permutation of `name` with special
   *  characters removed. */
  label: string;
  /** A third-party grouping tag. Less useful than our own `tags`. */
  group: string;
  /** Our own tags, from a limited reusable pool. More useful than `group`. */
  tags: string[];
  /** This facet's unique identification number. */
  id_number: number;
  /** Descriptive name, shown to the user in place of `label`. */
  name: string;
  /** A third-party technical description — present distinct from `comment`. */
  description: string;
  /** The backend's own, always-correct description. */
  comment: string;
  /** How many times this facet appears across ALL databases. No
   *  percentage is supplied — the frontend derives one from
   *  DatabasesResponse[].total_entrysets. */
  total_count: number;
  /** For each facet label (this one included): the percentage of THIS
   *  facet's events that also hold that facet, as text so that scientific
   *  notation works ("0.000123", "1.2e-20", "100"). Display data: the app
   *  works without it. */
  co_occurrence?: Record<string, string>;
  fields: IndividualFieldResponse[];
}

/**
 * An event matching the query (POST /api/filter/execute): one record, holding
 * values for some of the individuals returned by GET /api/documentation/individuals.
 */
export interface EventResponse {
  /** The event's unique id (a GUID), read by the backend from a metadata individual. */
  id: string;
  /** One item per individual the event holds values for. */
  items: EventItemResponse[];
}

export interface EventItemResponse {
  /** `IndividualResponse.label`. */
  facet_label: string;
  /** One object per occurrence of the individual in this event (usually
   *  one), each keyed by `IndividualFieldResponse.label`. The backend leaves a
   *  field without a value out of the object. The frontend also tolerates
   *  `null` there (it drops it), but the backend does not send it. */
  values: Record<string, string | number | boolean | null>[];
}

/** Up to 2,000 randomly sampled events matching the current query in the
 *  selected databases; the backend decides the number. No pagination. */
export interface EventsResponse {
  events: EventResponse[];
}

export type RequestScalar = string | number | boolean;
export type RequestValue = null | RequestScalar | RequestScalar[];

/** Like `RequestValue`, but a list may hold nulls (an unfinished from–to pair). */
export type SavedValue = null | RequestScalar | (RequestScalar | null)[];

// ---- the query tree with facet blocks (docs/superpowers/specs/2026-10-27-facet-blocks-design.md, section 4)

/**
 * The backend's word for each kind of node in a query tree (its `kind`).
 * The ONLY place they are spelled: request.ts writes them, response.ts
 * checks them, and the mock server answers with them. The backend may call
 * a facet block something else; change the text here and nothing else
 * needs to change. (The frontend's own `QueryNode.kind` in
 * src/query/types.ts is a separate word that never goes over the wire.)
 */
export const NODE_KIND = {
  group: "group",
  facet: "facet",
  condition: "condition",
} as const;

/** The body of POST {prefix}/filter/validate and /filter/execute. */
export interface QueryRequest {
  /** `DatabasesResponse.label` of each database to run against. Never empty. */
  databases: string[];
  query: RequestGroup;
}

export type RequestNode = RequestGroup | RequestFacet;

export interface RequestGroup {
  kind: typeof NODE_KIND.group;
  /** The frontend's id for this node: opaque, unique within the request.
   *  Quoted back as `StatsErrorMessage.node_id`. */
  id: string;
  operator: "AND" | "OR";
  /** Never empty. */
  children: RequestNode[];
}

/**
 * The event has (when `negated`: has no) occurrence of `facet_id` in which
 * ALL ("AND") / ANY ("OR") of `conditions` hold. No conditions: the facet is
 * present (absent). The backend interprets it.
 */
export interface RequestFacet {
  kind: typeof NODE_KIND.facet;
  id: string;
  /** `IndividualResponse.label`. */
  facet_id: string;
  negated: boolean;
  operator: "AND" | "OR";
  /** At most one per field; may be empty. */
  conditions: RequestFieldCondition[];
}

export interface RequestFieldCondition {
  kind: typeof NODE_KIND.condition;
  id: string;
  /** `IndividualFieldResponse.label`, within the facet of the block. */
  field_id: string;
  /** An operator label, e.g. "gt". */
  operator_id: string;
  value: RequestValue;
}

/** A saved query's tree: the request's shape without node ids (they only
 *  live for one page load) and with unfinished parts allowed. */
export type SavedNode = SavedGroup | SavedFacet;

export interface SavedGroup {
  kind: typeof NODE_KIND.group;
  operator: "AND" | "OR";
  /** May be empty. */
  children: SavedNode[];
}

export interface SavedFacet {
  kind: typeof NODE_KIND.facet;
  facet_id: string;
  negated: boolean;
  operator: "AND" | "OR";
  conditions: SavedFieldCondition[];
}

export interface SavedFieldCondition {
  kind: typeof NODE_KIND.condition;
  field_id: string;
  operator_id: string | null;
  value: SavedValue;
}

// ---- saved queries (GET/POST …/filter/saved, PUT/DELETE …/filter/saved/{id}) --

/**
 * A saved query as stored by the backend: the query as the user left it,
 * finished or not (docs/ARCHITECTURE.md, "Saved queries"). The backend checks
 * the shape only, never the meaning. Built by `toSavedQueryRequest`
 * (src/api/request.ts).
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
