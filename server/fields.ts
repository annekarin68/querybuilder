import type { FieldDefinition } from "./types.js";

const MONTHS: FieldDefinition["options"] = [
  { value: "january", label: "January" },
  { value: "february", label: "February" },
  { value: "march", label: "March" },
  { value: "april", label: "April" },
  { value: "may", label: "May" },
  { value: "june", label: "June" },
  { value: "july", label: "July" },
  { value: "august", label: "August" },
  { value: "september", label: "September" },
  { value: "october", label: "October" },
  { value: "november", label: "November" },
  { value: "december", label: "December" },
];

/**
 * The schema this example backend exposes at GET /api/fields. In a real
 * system this would likely be generated from the same source of truth as
 * validation on the write path (a database schema, an OpenAPI spec, etc.)
 * rather than hand-maintained twice.
 */
export const FIELDS: readonly FieldDefinition[] = [
  { id: "species", label: "Species", valueType: "enum", options: [
    { value: "fern", label: "Fern" },
    { value: "oak", label: "Oak" },
    { value: "rose", label: "Rose" },
    { value: "cactus", label: "Cactus" },
    { value: "bamboo", label: "Bamboo" },
  ] },
  { id: "branches", label: "Branch count", valueType: "number" },
  { id: "heightCm", label: "Height (cm)", valueType: "number" },
  { id: "foliage", label: "Has foliage", valueType: "boolean" },
  { id: "flowering", label: "Flowering month", valueType: "enum", options: MONTHS, allowedOperatorIds: ["eq", "neq", "range", "in", "isEmpty", "isNotEmpty"] },
  { id: "plantedOn", label: "Planted on", valueType: "date" },
  { id: "notes", label: "Notes", valueType: "string" },
];
