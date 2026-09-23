import type { Facet } from "../api/types";

export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

/** One queryable field: a (facet, field) pair from GET /api/individuals. */
export interface CatalogField {
  /** The dotted "itemLabel.fieldLabel" id a condition stores as `fieldId`. */
  label: string;
  /** Display name, "Facet name: field name" — used in summaries. */
  name: string;
  /** The field's own display name (its `name`, else its `label`) — used in
   *  the Field dropdown, where the item is already chosen. */
  fieldName: string;
  valueType: ValueType;
  /** The allowed values of an enum field. */
  options?: string[];
  operatorIds: string[];
}

export interface CatalogOperator {
  label: string;
  name: string;
  arity: Arity;
}

/** What the query builder can offer: every queryable field. The operators are
 *  the fixed `OPERATORS` list below, the same for every backend. */
export interface FieldCatalog {
  fields: CatalogField[];
}

export const OPERATORS: CatalogOperator[] = [
  { label: "eq", name: "Equals", arity: "one" },
  { label: "neq", name: "Not equals", arity: "one" },
  { label: "gt", name: "Greater than", arity: "one" },
  { label: "gte", name: "Greater than or equal", arity: "one" },
  { label: "lt", name: "Less than", arity: "one" },
  { label: "lte", name: "Less than or equal", arity: "one" },
  { label: "before", name: "Before", arity: "one" },
  { label: "after", name: "After", arity: "one" },
  { label: "contains", name: "Contains", arity: "one" },
  { label: "between", name: "Between", arity: "two" },
  { label: "in", name: "Is any of", arity: "many" },
  { label: "isEmpty", name: "Is empty", arity: "none" },
  { label: "isNotEmpty", name: "Is not empty", arity: "none" },
];

export function findField(catalog: FieldCatalog, label: string | null): CatalogField | undefined {
  return label ? catalog.fields.find((f) => f.label === label) : undefined;
}

export function findOperator(label: string | null): CatalogOperator | undefined {
  return label ? OPERATORS.find((o) => o.label === label) : undefined;
}

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
 * SQL-ish type names -> valueType, after normalisation (see `valueTypeFor`).
 * Deliberately broader than any one backend's vocabulary: the backend's
 * `type`/`format` strings are its own, and a type we fail to recognise
 * silently degrades to "string" (text input, no comparison operators) — so
 * cover the common spellings rather than just the ones seen so far.
 */
const TYPE_NAMES: Record<string, ValueType> = {
  TINYINT: "number",
  SMALLINT: "number",
  INT: "number",
  INTEGER: "number",
  BIGINT: "number",
  REAL: "number",
  FLOAT: "number",
  DOUBLE: "number",
  "DOUBLE PRECISION": "number",
  DECIMAL: "number",
  NUMERIC: "number",
  NUMBER: "number",
  BOOLEAN: "boolean",
  BOOL: "boolean",
  DATE: "date",
  DATETIME: "date",
  TIMESTAMP: "date",
};

/**
 * Backend `type` (or, when `type` is empty, `format`) -> this catalog's
 * valueType. Never inferred from a field's name or its values. Case-insensitive,
 * ignores size/precision parameters (`DECIMAL(10,2)`, `VARCHAR(255)`), and
 * treats any `TIMESTAMP …` variant (`TIMESTAMP WITH TIME ZONE`) as a date.
 */
export function valueTypeFor(field: { type: string; format: string }): ValueType {
  const declared = (field.type || field.format)
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (declared.startsWith("TIMESTAMP")) return "date";
  return TYPE_NAMES[declared] ?? "string";
}

/**
 * One queryable field per (facet, field) pair, derived purely from
 * already-fetched Facet[] data — the real API has no schema endpoint.
 * Field label is the dotted "facetLabel.fieldLabel" path, matching how an
 * event nests its values.
 *
 * Enum detection is `values.length > 0` — deliberately NEVER `cardinality`.
 * The backend's own rule for when it populates `values` is an implementation
 * detail that can change at any time.
 */
export function buildFieldCatalog(facets: Facet[]): FieldCatalog {
  const fields: CatalogField[] = [];
  for (const facet of facets) {
    for (const f of facet.fields) {
      const isEnum = f.values.length > 0;
      const valueType = isEnum ? "enum" : valueTypeFor(f);
      const fieldName = f.name || f.label;
      fields.push({
        label: `${facet.label}.${f.label}`,
        name: `${facet.name}: ${fieldName}`,
        fieldName,
        valueType,
        options: isEnum ? [...f.values] : undefined,
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return { fields };
}
