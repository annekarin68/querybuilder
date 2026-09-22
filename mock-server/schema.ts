import type { Individual } from "./vehicleData";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface FieldDef {
  label: string;
  name: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface OperatorDef {
  label: string;
  name: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: OperatorDef[] = [
  { label: "eq", name: "Equals", description: "The field exactly matches the value.", arity: "one" },
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
  { label: "contains", name: "Contains", description: "The text includes the value.", arity: "one" },
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
  { label: "isNotEmpty", name: "Is not empty", description: "The field has a value.", arity: "none" },
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
 * individual.json's declared shape. Field label is the dotted
 * "individualLabel.fieldLabel" path, matching how an entryset nests its
 * values (see mock-server/rows.ts) so it doubles as the flattened lookup key.
 * A field with a declared `values` list becomes an enum field, with options
 * built directly from that list.
 */
export function buildFields(individuals: Individual[]): FieldDef[] {
  const fields: FieldDef[] = [];
  for (const ind of individuals) {
    for (const f of ind.fields) {
      const isEnum = !!f.values && f.values.length > 0;
      const valueType = isEnum ? "enum" : valueTypeFor(f.type);
      fields.push({
        label: `${ind.label}.${f.label}`,
        name: `${ind.name}: ${f.label}`,
        valueType,
        description: f.description || ind.description,
        options: isEnum ? f.values!.map((v) => ({ value: v, label: v })) : undefined,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return fields;
}
