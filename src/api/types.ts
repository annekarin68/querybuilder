/** Who's logged in, returned by GET /api/auth/me. */
export interface AuthUser {
  name: string;
}

/**
 * One database's result from the POST /api/stats stream. The endpoint's
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
  /** Individuals matched by this query in this database. Only meaningful
   *  when `success` is true — optional rather than a fabricated 0, so a
   *  failed database can never be misread as "zero rows matched." */
  matchCount?: number;
  /** Errors from the query itself — malformed dates, too-large numbers,
   *  too-long strings, etc. */
  errorMessages?: string[];
  /** Other information or error messages — a database timeout, an internal
   *  server error, or a non-blocking notice. */
  infoMessages?: string[];
}

/** The databases the query can be scoped to (GET /api/databases). Returns
 *  DatabasesResponse[] directly — no wrapper object. */
export interface DatabasesResponse {
  /** A short summary of what this database contains or what makes it unique. */
  description: string;
  /** User-friendly display name. */
  name: string;
  /** The title of this database's owner — the company that reported the data. */
  owner: string;
  /** Total entrysets in this database. */
  totalEntrysets: number;
  /** This database's share of the total data across all databases — sums
   *  to 100% across every database returned. */
  percentageOfTotal: number;
  /** API-friendly "ID", not meant to be displayed. */
  label: string;
}

/** One field an individual's telemetry item can report (GET /api/individuals). */
export interface IndividualField {
  /** This field's locally unique, API-friendly "ID" within this individual. */
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
   *  Can be 0 to several billion. Informational only — NEVER branch on this
   *  to decide whether a field is enum-like; check `values.length` instead. */
  cardinality: number;
  /** The field's actual distinct values, when the backend chooses to supply
   *  them. Empty when not supplied — that emptiness, not `cardinality`, is
   *  what determines whether a field is treated as an enum. */
  values: string[];
  /** A third-party type hint, used only when `type` is empty. */
  format: string;
  /** Reserved for a future human-readable name; not populated by the backend
   *  yet. Anywhere this is displayed, fall back to `label` when absent/empty. */
  name?: string;
}

/**
 * One item in the vehicle telemetry data model — a signal, sensor, or piece
 * of metadata that an entryset may hold a value for.
 */
export interface Individual {
  /** Unique "ID" for API requests — a permutation of `name` with special
   *  characters removed. */
  label: string;
  /** A third-party grouping tag. Less useful than our own `tags`. */
  group: string;
  /** Our own tags, from a limited reusable pool. More useful than `group`. */
  tags: string[];
  /** This individual's unique identification number. */
  idNumber: number;
  /** Descriptive name, shown to the user in place of `label`. */
  name: string;
  /** A third-party technical description — present distinct from `comment`. */
  description: string;
  /** The backend's own, always-correct description. */
  comment: string;
  /** How many times this individual appears across ALL databases. No
   *  percentage is supplied — the frontend derives one from
   *  DatabasesResponse[].totalEntrysets (see docsSidebar.ts). */
  totalCount: number;
  fields: IndividualField[];
}

/**
 * A telemetry entryset: a snapshot of one vehicle event, holding actual values
 * for a subset of the items returned by GET /api/individuals. `items` is keyed
 * by an Individual's `label`; each item's value object is keyed by one of
 * that item's field labels — see docs/ARCHITECTURE.md for the full shape.
 */
export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

/**
 * The entrysets matching the current query, scoped to the selected
 * databases, capped at 25. No pagination.
 */
export interface EntrysetsResponse {
  entrysets: Entryset[];
}
