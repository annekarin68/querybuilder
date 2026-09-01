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

export interface QueryResponse {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
  page: number;
  pageSize: number;
  totalRows: number;
}

/** The databases the query can be scoped to (GET /api/databases). */
export interface DatabasesResponse {
  databases: { id: string; label: string }[];
}
