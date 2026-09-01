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

export type StatBlock =
  | {
      kind: "number-summary";
      fieldLabel: string;
      min: number;
      max: number;
      avg: number;
      nullCount: number;
    }
  | {
      kind: "distribution";
      fieldLabel: string;
      buckets: { label: string; count: number }[];
      nullCount: number;
    }
  | { kind: "date-range"; fieldLabel: string; earliest: string; latest: string; nullCount: number };

export interface StatsResponse {
  matchCount: number;
  totalCount: number;
  blocks: StatBlock[];
}

export interface QueryResponse {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
  page: number;
  pageSize: number;
  totalRows: number;
}
