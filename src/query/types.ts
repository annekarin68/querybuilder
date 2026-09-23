export type LogicalOperator = "AND" | "OR";

export interface Condition {
  kind: "condition";
  id: string;
  /** Which facet (from GET /api/individuals) this condition targets — UI staging only; `fieldId` (below) is the authoritative target once chosen. */
  facetId: string | null;
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
  /**
   * "incomplete": something the user simply hasn't filled in yet — shown as a
   * quiet hint. "invalid": the query refers to something that cannot work —
   * shown in red. Both block running when severity is "error".
   */
  kind: "incomplete" | "invalid";
}
