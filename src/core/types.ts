/**
 * Domain types for the query builder.
 *
 * Naming is kept deliberately generic (Field, Operator, Condition, Group,
 * Expression) rather than tied to any particular backend or business
 * vocabulary, so this module can be reused against any API that can be
 * described by this shape.
 */

/** The primitive kinds of value a field can hold. */
export type ValueType = "string" | "number" | "boolean" | "date" | "enum";

/** The logical operator used to combine the children of a Group. */
export type LogicalOperator = "AND" | "OR";

/**
 * How many values an operator needs from the user.
 *  - "none":   no value (e.g. "is empty")
 *  - "single": exactly one value (e.g. "equals", "greater than")
 *  - "range":  exactly two values, an inclusive [start, end] pair
 *  - "multi":  an arbitrary-length list of values (e.g. "is any of")
 */
export type OperatorArity = "none" | "single" | "range" | "multi";

/** A single selectable value, used for enum-typed fields. */
export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Describes one field the user can build conditions against. This is the
 * shape the backend's schema endpoint is expected to return.
 */
export interface FieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly valueType: ValueType;
  /** Required when valueType is "enum"; ignored otherwise. */
  readonly options?: readonly FieldOption[];
  /**
   * Restricts which operators this field may use, by operator id. When
   * omitted, every operator applicable to the field's valueType is offered.
   */
  readonly allowedOperatorIds?: readonly string[];
}

/** Describes one comparison operator available to the builder. */
export interface OperatorDefinition {
  readonly id: string;
  readonly label: string;
  readonly arity: OperatorArity;
  readonly applicableTypes: readonly ValueType[];
}

/** The value held by a Condition. Shape depends on the operator's arity. */
export type ConditionValue =
  | string
  | number
  | boolean
  | readonly [string | number, string | number] // "range"
  | readonly (string | number)[] // "multi"
  | null;

/** A leaf node: one field/operator/value comparison. */
export interface ConditionNode {
  readonly kind: "condition";
  readonly id: string;
  readonly fieldId: string | null;
  readonly operatorId: string | null;
  readonly value: ConditionValue;
}

/** A branch node: a logical combination of child expressions. */
export interface GroupNode {
  readonly kind: "group";
  readonly id: string;
  readonly operator: LogicalOperator;
  readonly children: readonly ExpressionNode[];
}

/** Any node in the expression tree. */
export type ExpressionNode = ConditionNode | GroupNode;

/** Severity of a validation finding. */
export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  readonly nodeId: string;
  readonly message: string;
  readonly severity: ValidationSeverity;
}
