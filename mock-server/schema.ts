import type { Individual } from "./vehicleData";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface FieldDef {
  id: string;
  label: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface OperatorDef {
  id: string;
  label: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: OperatorDef[] = [
  { id: "eq", label: "Equals", description: "The field exactly matches the value.", arity: "one" },
  {
    id: "neq",
    label: "Not equals",
    description: "The field is anything other than the value.",
    arity: "one",
  },
  {
    id: "gt",
    label: "Greater than",
    description: "The field is strictly greater than the value.",
    arity: "one",
  },
  {
    id: "gte",
    label: "Greater than or equal",
    description: "The field is at least the value.",
    arity: "one",
  },
  {
    id: "lt",
    label: "Less than",
    description: "The field is strictly less than the value.",
    arity: "one",
  },
  {
    id: "lte",
    label: "Less than or equal",
    description: "The field is at most the value.",
    arity: "one",
  },
  {
    id: "before",
    label: "Before",
    description: "The date is earlier than the value.",
    arity: "one",
  },
  { id: "after", label: "After", description: "The date is later than the value.", arity: "one" },
  { id: "contains", label: "Contains", description: "The text includes the value.", arity: "one" },
  {
    id: "between",
    label: "Between",
    description: "The field is within the inclusive range [from, to].",
    arity: "two",
  },
  {
    id: "in",
    label: "Is any of",
    description: "The field matches one of several values.",
    arity: "many",
  },
  { id: "isEmpty", label: "Is empty", description: "The field has no value.", arity: "none" },
  { id: "isNotEmpty", label: "Is not empty", description: "The field has a value.", arity: "none" },
];

/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is. This is what lets the catalog generalize to a
 * production individual.json with entirely different item/field names.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  enum: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
};

/** individual.json's declared field `type` -> the schema's valueType. Never
 * inferred from a field's name or its values. */
function valueTypeFor(declaredType: string): ValueType {
  switch (declaredType) {
    case "int":
    case "float":
      return "number";
    case "bool":
      return "boolean";
    default:
      return "string";
  }
}

/**
 * One queryable field per (individual, field) pair, derived purely from
 * individual.json's declared shape. Field id is the dotted
 * "individualLabel.fieldLabel" path, matching how an entryset nests its
 * values (see mock-server/rows.ts) so it doubles as the flattened lookup key.
 */
export function buildFields(individuals: Individual[]): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const valueType = valueTypeFor(f.type);
      fields.push({
        id: `${ind.label}.${f.label}`,
        label: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return fields;
}
