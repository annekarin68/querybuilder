import type { Facet } from "../model";

export type ValueType = "string" | "number" | "boolean" | "date";
export type Arity = "none" | "one" | "two" | "many";

/** One queryable field: a (facet, field) pair from the loaded facets. */
export interface CatalogField {
  /** The facet's `Facet.id` — what a condition stores as `facetId`. */
  facetId: string;
  /** The field's own `Field.id`, within that facet — what a condition stores
   *  as `fieldId`. A field is named by this pair, never by one joined string:
   *  an id may itself contain a ".". */
  fieldId: string;
  /** Display name, "Facet name: field name" — used in summaries. */
  name: string;
  /** The field's own `Field.name` — used in the Field dropdown, where the
   *  facet is already chosen. */
  fieldName: string;
  valueType: ValueType;
  /** Known values to suggest, from the field's `values` (see `pickListFor`).
   *  Only string and number fields have one. Suggestions only: the list can be
   *  out of date, so the user may always enter another value. */
  options?: string[];
  operatorIds: string[];
}

export interface CatalogOperator {
  /** What a condition stores as `operatorId`, and what goes on the wire. */
  id: string;
  name: string;
  arity: Arity;
}

/** What the query builder can offer: every queryable field. The operators are
 *  the fixed `OPERATORS` list below, the same for every backend. */
export interface FieldCatalog {
  fields: CatalogField[];
}

export const OPERATORS: CatalogOperator[] = [
  { id: "eq", name: "Equals", arity: "one" },
  { id: "neq", name: "Not equals", arity: "one" },
  { id: "gt", name: "Greater than", arity: "one" },
  { id: "gte", name: "Greater than or equal", arity: "one" },
  { id: "lt", name: "Less than", arity: "one" },
  { id: "lte", name: "Less than or equal", arity: "one" },
  { id: "before", name: "Before", arity: "one" },
  { id: "after", name: "After", arity: "one" },
  { id: "contains", name: "Contains", arity: "one" },
  { id: "between", name: "Between", arity: "two" },
  { id: "in", name: "Is any of", arity: "many" },
  { id: "isEmpty", name: "Is empty", arity: "none" },
  { id: "isNotEmpty", name: "Is not empty", arity: "none" },
];

export function findField(
  catalog: FieldCatalog,
  facetId: string | null,
  fieldId: string | null,
): CatalogField | undefined {
  return facetId && fieldId
    ? catalog.fields.find((f) => f.facetId === facetId && f.fieldId === fieldId)
    : undefined;
}

/** The fields of one facet, in catalog order — what the Field dropdown lists
 *  once a facet is chosen. */
export function fieldsOfFacet(catalog: FieldCatalog, facetId: string | null): CatalogField[] {
  return facetId ? catalog.fields.filter((f) => f.facetId === facetId) : [];
}

export function findOperator(id: string | null): CatalogOperator | undefined {
  return id ? OPERATORS.find((o) => o.id === id) : undefined;
}

/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is, nor by whether it has a pick-list.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "in", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
};

/**
 * SQL-ish type names -> valueType, after normalisation (see `valueTypeFor`).
 * Deliberately broader than any one backend's vocabulary: the backend's
 * type names are its own, and a type we fail to recognise
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
 * A field's `typeName` (as the backend spells it) -> this catalog's valueType.
 * Never inferred from a field's name or its values. Case-insensitive, ignores
 * size/precision parameters (`DECIMAL(10,2)`, `VARCHAR(255)`), and treats any
 * `TIMESTAMP …` variant (`TIMESTAMP WITH TIME ZONE`) as a date.
 */
export function valueTypeFor(typeName: string): ValueType {
  const declared = typeName
    .toUpperCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (declared.startsWith("TIMESTAMP")) return "date";
  return TYPE_NAMES[declared] ?? "string";
}

/** Whether `text` is a number as entered: not blank, and finite. */
export function isNumberText(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

/**
 * The pick-list for a field of `valueType`, from the field's `values`: every
 * value for a string field; for a number field, the values that are numbers,
 * written the way JavaScript writes them ("3.0" → "3") and without repeats.
 * None for boolean and date fields — a toggle and a typed (partial) timestamp
 * serve those better — nor when no value is left.
 *
 * `values` is a static list built ahead of time and can be out of date, so it
 * only ever suggests: it never decides a field's type or which values are allowed.
 */
export function pickListFor(valueType: ValueType, values: string[]): string[] | undefined {
  const list =
    valueType === "string"
      ? [...values]
      : valueType === "number"
        ? [...new Set(values.filter(isNumberText).map((v) => String(Number(v))))]
        : [];
  return list.length > 0 ? list : undefined;
}

/**
 * One queryable field per (facet, field) pair, derived purely from
 * already-fetched Facet[] data — the real API has no schema endpoint.
 * Each field is named by the pair (`facetId`, `fieldId`), matching how
 * an event nests its values.
 *
 * A field's type always comes from its declared `typeName`; its `values`
 * only feed the pick-list (`pickListFor`).
 */
export function buildFieldCatalog(facets: Facet[]): FieldCatalog {
  const fields: CatalogField[] = [];
  for (const facet of facets) {
    for (const f of facet.fields) {
      const valueType = valueTypeFor(f.typeName);
      fields.push({
        facetId: facet.id,
        fieldId: f.id,
        name: `${facet.name}: ${f.name}`,
        fieldName: f.name,
        valueType,
        options: pickListFor(valueType, f.values),
        operatorIds: OPERATOR_PROFILE[valueType],
      });
    }
  }
  return { fields };
}
