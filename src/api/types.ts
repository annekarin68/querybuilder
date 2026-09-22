export interface SchemaResponse {
  fields: {
    label: string;
    name: string;
    valueType: "string" | "number" | "boolean" | "date" | "enum";
    description: string;
    options?: { value: string; label: string }[];
    operatorIds: string[];
  }[];
  operators: {
    label: string;
    name: string;
    description: string;
    arity: "none" | "one" | "two" | "many";
  }[];
}

/**
 * One database's result from the POST /api/stats stream. The endpoint's
 * response body is newline-delimited JSON: one of these per selected
 * database, written as soon as that database's result is ready — some
 * databases are slower than others, or can fail independently — never one
 * combined response after every database finishes.
 *
 * There is no `name` field: it was already returned once by
 * GET /api/databases and is loaded into AppState.databases at startup, so
 * repeating it on every line would be redundant network traffic — look it up
 * by `label` instead.
 *
 * Discriminated on `success` rather than a `matchCount: 0` sentinel, so a
 * database that couldn't be queried can never be silently misread as "zero
 * rows matched."
 */
export type StatsResponse =
  | {
      label: string; // matches DatabasesResponse.databases[].label
      success: true;
      matchCount: number;
      /** Entrysets in THIS database, regardless of the query. A real per-database
       *  row count — NOT derived from Individual.stats.count, which is a different,
       *  coarser thing: how many entrysets across the WHOLE dataset contain a value
       *  for one particular Individual (item) at all. That says nothing about a
       *  single database's row count, and nothing about a specific IndividualField. */
      totalCount: number;
      /** Non-blocking notices, e.g. "this database is running slower than usual". */
      infoMessages: string[];
    }
  | {
      label: string;
      success: false;
      /** Why the query couldn't be evaluated for this database — a malformed query. */
      validationErrors: string[];
      /** Why the database itself couldn't be reached/handle the request. */
      infoMessages: string[];
    };

/** One field an individual's telemetry item can report (GET /api/individuals). */
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
  /** Reserved for a future human-readable name; not populated by the backend
   *  yet. Anywhere this is displayed, fall back to `label` when absent/empty
   *  so the UI already works once the backend starts sending real values. */
  name?: string;
  /** The field's valid values, when it has a fixed domain. Absent = not an enum. */
  values?: string[];
}

/**
 * One item in the vehicle telemetry data model — a signal, sensor, or piece of
 * metadata that an entryset may hold a value for. `stats` is aggregated across
 * the full dataset the server tracks, not just the entrysets it actually
 * returns for browsing/preview.
 */
export interface Individual {
  label: string;
  group: string;
  tags: string[];
  id_number: number;
  name: string;
  description: string;
  comment: string;
  stats: { percentage: number; count: number };
  fields: IndividualField[];
}

export interface IndividualsResponse {
  individuals: Individual[];
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

/** The databases the query can be scoped to (GET /api/databases). */
export interface DatabasesResponse {
  databases: { label: string; name: string }[];
}
