import type { Individual } from "../api/types";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface CatalogField {
  label: string;
  name: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface CatalogOperator {
  label: string;
  name: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: CatalogOperator[] = [
  {
    label: "eq",
    name: "Equals",
    description: "The field exactly matches the value.",
    arity: "one",
  },
  {
    label: "neq",
    name: "Not equals",
    description: "The field is anything other than the value.",
    arity: "one",
  },
  {
    label: "gt",
    name: "Greater than",
    description: "The field is strictly greater than the value.",
    arity: "one",
  },
  {
    label: "gte",
    name: "Greater than or equal",
    description: "The field is at least the value.",
    arity: "one",
  },
  {
    label: "lt",
    name: "Less than",
    description: "The field is strictly less than the value.",
    arity: "one",
  },
  {
    label: "lte",
    name: "Less than or equal",
    description: "The field is at most the value.",
    arity: "one",
  },
  {
    label: "before",
    name: "Before",
    description: "The date is earlier than the value.",
    arity: "one",
  },
  { label: "after", name: "After", description: "The date is later than the value.", arity: "one" },
  {
    label: "contains",
    name: "Contains",
    description: "The text includes the value.",
    arity: "one",
  },
  {
    label: "between",
    name: "Between",
    description: "The field is within the inclusive range [from, to].",
    arity: "two",
  },
  {
    label: "in",
    name: "Is any of",
    description: "The field matches one of several values.",
    arity: "many",
  },
  { label: "isEmpty", name: "Is empty", description: "The field has no value.", arity: "none" },
  {
    label: "isNotEmpty",
    name: "Is not empty",
    description: "The field has a value.",
    arity: "none",
  },
];

/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  enum: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
};

/**
 * Backend `type` (or, when `type` is empty, `format`) -> this catalog's
 * valueType. Never inferred from a field's name or its values.
 */
function valueTypeFor(field: { type: string; format: string }): ValueType {
  const declared = field.type || field.format;
  switch (declared) {
    case "BIGINT":
    case "DOUBLE":
      return "number";
    case "BOOLEAN":
      return "boolean";
    case "TIMESTAMP":
      return "date";
    default:
      return "string";
  }
}

/**
 * One queryable field per (individual, field) pair, derived purely from
 * already-fetched Individual[] data — the real API has no schema/operators
 * endpoint. Field label is the dotted "individualLabel.fieldLabel" path,
 * matching how an entryset nests its values, so it doubles as the flattened
 * lookup key.
 *
 * Enum detection is `values.length > 0` — deliberately NEVER `cardinality`.
 * The backend's own rule for when it populates `values` is an implementation
 * detail that can change at any time; this catalog only reacts to whether
 * `values` actually has entries.
 */
export function buildFieldCatalog(individuals: Individual[]): {
  fields: CatalogField[];
  operators: CatalogOperator[];
} {
  const fields: CatalogField[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const isEnum = f.values.length > 0;
      const valueType = isEnum ? "enum" : valueTypeFor(f);
      fields.push({
        label: `${ind.label}.${f.label}`,
        name: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        options: isEnum ? f.values.map((v) => ({ value: v, label: v })) : undefined,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return { fields, operators: OPERATORS };
}
