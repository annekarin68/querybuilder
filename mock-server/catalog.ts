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

export interface DatabaseDef {
  id: string;
  label: string;
}

/**
 * "Each kind of plant has its own database": the selectable databases are the
 * species. A query runs only against rows whose species is a selected database.
 */
export const DATABASES: DatabaseDef[] = [
  { id: "fern", label: "Fern" },
  { id: "oak", label: "Oak" },
  { id: "rose", label: "Rose" },
  { id: "cactus", label: "Cactus" },
  { id: "bamboo", label: "Bamboo" },
];

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

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
].map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }));

export const FIELDS: FieldDef[] = [
  {
    id: "species",
    label: "Species",
    valueType: "enum",
    description: "The kind of plant. One of a fixed list.",
    options: [
      { value: "fern", label: "Fern" },
      { value: "oak", label: "Oak" },
      { value: "rose", label: "Rose" },
      { value: "cactus", label: "Cactus" },
      { value: "bamboo", label: "Bamboo" },
    ],
    operatorIds: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
  },
  {
    id: "branches",
    label: "Branch count",
    valueType: "number",
    description: "How many branches the plant has. Whole number.",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  },
  {
    id: "heightCm",
    label: "Height (cm)",
    valueType: "number",
    description: "Height above soil in centimetres.",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"],
  },
  {
    id: "foliage",
    label: "Has foliage",
    valueType: "boolean",
    description: "Whether the plant currently has leaves.",
    operatorIds: ["eq", "neq"],
  },
  {
    id: "flowering",
    label: "Flowering month",
    valueType: "enum",
    options: MONTHS,
    description: "The month the plant flowers, if any.",
    operatorIds: ["eq", "neq", "between", "in", "isEmpty", "isNotEmpty"],
  },
  {
    id: "plantedOn",
    label: "Planted on",
    valueType: "date",
    description: "Calendar date the plant was put in the ground (YYYY-MM-DD).",
    operatorIds: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
  },
  {
    id: "notes",
    label: "Notes",
    valueType: "string",
    description: "Free-text notes from the gardener.",
    operatorIds: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"],
  },
];
