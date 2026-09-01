import { getOperatorById } from "./operators.js";
import type { ConditionNode, ConditionValue, ExpressionNode, GroupNode } from "./types.js";

/**
 * Turns a validated expression tree into some output representation.
 * Keeping this behind an interface means the UI never needs to know or
 * care what format the backend actually consumes — a SQL, GraphQL, or
 * OData serializer can be dropped in later without touching a single
 * component.
 */
export interface ExpressionSerializer<TOutput> {
  serialize(root: GroupNode): TOutput;
}

/**
 * Serializes the tree to the compact string DSL:
 *
 *   (branches gte 20 AND foliage eq true) OR (flowering range april,july)
 *
 * Rules:
 *  - A condition never gets its own parens.
 *  - A group is wrapped in parens whenever it is NOT the root, regardless
 *    of how many children it has. This is what lets a lone condition
 *    read as "(flowering range april,july)" once it's inside an explicit
 *    group, while a bare top-level condition prints unparenthesized.
 *  - Children are joined with the group's own logical operator.
 */
export class DslSerializer implements ExpressionSerializer<string> {
  serialize(root: GroupNode): string {
    return this.#serializeGroup(root, true);
  }

  #serializeGroup(group: GroupNode, isRoot: boolean): string {
    const content = group.children.map((child) => this.#serializeChild(child)).join(` ${group.operator} `);
    return isRoot ? content : `(${content})`;
  }

  #serializeChild(node: ExpressionNode): string {
    return node.kind === "condition" ? this.#serializeCondition(node) : this.#serializeGroup(node, false);
  }

  #serializeCondition(condition: ConditionNode): string {
    const operator = getOperatorById(condition.operatorId);
    const field = condition.fieldId ?? "<field>";
    const operatorId = condition.operatorId ?? "<operator>";
    if (!operator || operator.arity === "none") {
      return `${field} ${operatorId}`;
    }
    return `${field} ${operatorId} ${this.#formatValue(condition.value, operator.arity)}`;
  }

  #formatValue(value: ConditionValue, arity: "single" | "range" | "multi" | "none"): string {
    if (value === null || value === undefined) return "<value>";
    if (arity === "range" && Array.isArray(value)) {
      return value.map((part) => this.#formatScalar(part)).join(",");
    }
    if (arity === "multi" && Array.isArray(value)) {
      return `[${value.map((part) => this.#formatScalar(part)).join(",")}]`;
    }
    return this.#formatScalar(value as string | number | boolean);
  }

  #formatScalar(value: string | number | boolean): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string" && /\s/.test(value)) return `"${value}"`;
    return String(value);
  }
}

/**
 * A plain-JSON serializer, included to demonstrate that the tree is not
 * coupled to the string DSL: any number of serializers can share the same
 * expression tree and UI. Useful for sending the raw structure to a
 * backend that would rather parse JSON than a bespoke grammar.
 */
export interface JsonCondition {
  readonly fieldId: string | null;
  readonly operatorId: string | null;
  readonly value: ConditionValue;
}
export interface JsonGroup {
  readonly operator: "AND" | "OR";
  readonly children: readonly (JsonCondition | JsonGroup)[];
}

export class JsonSerializer implements ExpressionSerializer<JsonGroup> {
  serialize(root: GroupNode): JsonGroup {
    return this.#serializeGroup(root);
  }

  #serializeGroup(group: GroupNode): JsonGroup {
    return {
      operator: group.operator,
      children: group.children.map((child) =>
        child.kind === "condition"
          ? { fieldId: child.fieldId, operatorId: child.operatorId, value: child.value }
          : this.#serializeGroup(child),
      ),
    };
  }
}
