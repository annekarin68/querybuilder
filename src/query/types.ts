export type LogicalOperator = "AND" | "OR";

export interface Condition {
  kind: "condition";
  id: string;
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
