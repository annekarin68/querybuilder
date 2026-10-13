/**
 * The backend's request and response types: the API contract, spelled exactly
 * as it goes over the wire (docs/ARCHITECTURE.md, "API contract"). Every key is
 * snake_case, in requests and responses alike; the frontend's own model
 * (src/model.ts) is camelCase, and src/api/response.ts and request.ts translate.
 * The backend team builds its response models from this file. Only
 * src/api/ may import this file (ESLint enforces it). The rest of the app uses
 * its own model (src/model.ts); src/api/response.ts and src/api/request.ts
 * translate between the two.
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

// ---- the body of POST …/filter/validate and POST …/filter/execute ---------------------

/**
 * The query and where to run it — the body of POST {prefix}/filter/validate and POST
 * {prefix}/filter/execute (docs/ARCHITECTURE.md, "Wire format of the query"). Built by
 * `toQueryRequest` (src/api/request.ts) from the query on screen.
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

export type RequestScalar = string | number | boolean;
export type RequestValue = null | RequestScalar | RequestScalar[];

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

export type SavedNode = SavedGroup | SavedCondition;

/** Like `RequestGroup`, but `children` may be empty. */
export interface SavedGroup {
  kind: "group";
  id: string;
  operator: "AND" | "OR";
  children: SavedNode[];
}

/** Like `RequestCondition`, but unfinished: each of the four may be `null`. */
export interface SavedCondition {
  kind: "condition";
  id: string;
  facet_id: string | null;
  field_id: string | null;
  operator_id: string | null;
  value: SavedValue;
}

/** Like `RequestValue`, but a list may hold nulls (an unfinished from–to pair). */
export type SavedValue = null | RequestScalar | (RequestScalar | null)[];
