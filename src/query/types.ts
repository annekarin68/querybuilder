export type LogicalOperator = "AND" | "OR";

export interface Condition {
  kind: "condition";
  id: string;
  /** Which individual.json item this condition targets — UI staging only; `fieldId` (below) is the authoritative target once chosen. */
  individualId: string | null;
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}

export interface Group {
  kind: "group";
  id: string;
  operator: LogicalOperator;
  children: (Group | Condition)[];
  collapsed?: boolean;
}

export type QueryNode = Group | Condition;

export interface Issue {
  nodeId: string;
  message: string;
  severity: "error" | "warning";
}
