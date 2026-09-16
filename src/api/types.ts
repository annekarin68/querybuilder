export interface SchemaResponse {
  fields: {
    id: string;
    label: string;
    valueType: "string" | "number" | "boolean" | "date" | "enum";
    description: string;
    options?: { value: string; label: string }[];
    operatorIds: string[];
  }[];
  operators: {
    id: string;
    label: string;
    description: string;
    arity: "none" | "one" | "two" | "many";
  }[];
}

/**
 * One statistic block per field referenced in the query. min/max/avg/buckets/earliest/latest
 * are computed over the query's matching rows; nullCount is dataset-wide (rows missing this
 * field across all records) — a data-quality indicator independent of the query.
 */
export type StatBlock =
  | {
      kind: "number-summary";
      fieldLabel: string;
      min: number;
      max: number;
      avg: number;
      /** Rows in the WHOLE dataset (not just query matches) that have no value for this field — a data-quality indicator. */
      nullCount: number;
    }
  | {
      kind: "distribution";
      fieldLabel: string;
      buckets: { label: string; count: number }[];
      /** Rows in the WHOLE dataset (not just query matches) that have no value for this field — a data-quality indicator. */
      nullCount: number;
    }
  | {
      kind: "date-range";
      fieldLabel: string;
      earliest: string;
      latest: string;
      /** Rows in the WHOLE dataset (not just query matches) that have no value for this field — a data-quality indicator. */
      nullCount: number;
    };

export interface StatsResponse {
  matchCount: number;
  totalCount: number;
  blocks: StatBlock[];
  /** One entry per selected database: its own match / total counts (counts only — cheap at any scale). */
  perDatabase: { id: string; label: string; matchCount: number; totalCount: number }[];
}

/** One field an individual's telemetry item can report (GET /api/individuals). */
export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
}

/**
 * One item in the vehicle telemetry data model — a signal, sensor, or piece of
 * metadata that an entryset may hold a value for. `stats` is aggregated across
 * the full (mock) 6-billion-entryset dataset, not just the sample the mock
 * server actually holds.
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
 * for a subset of `individual.json`'s items. `items` is keyed by an
 * Individual's `label`; each item's value object is keyed by one of that
 * item's field labels — see docs/ARCHITECTURE.md for the full shape.
 */
export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

/**
 * Transitional: POST /api/query currently always returns every entryset the
 * mock server has (capped at 25), regardless of the query/databases sent.
 */
export interface EntrysetsResponse {
  entrysets: Entryset[];
}

/** The databases the query can be scoped to (GET /api/databases). */
export interface DatabasesResponse {
  databases: { id: string; label: string }[];
}
