import type { Facet } from "../model";
import { findField, type FieldCatalog } from "./fieldCatalog";
import { newCondition } from "./tree";
import type { Condition, QueryNode } from "./types";

/** The drag-and-drop data type our own drags carry. Drags from elsewhere
 *  (files, text) lack it, so the query builder doesn't offer itself as a target. */
export const DRAG_MIME = "application/x-qb-item";

/** What is being dragged: something from the docs sidebar, or a node of the
 *  query being moved. Ids are the backend's (`Facet.id`, `Field.id`). */
export type DragItem =
  | { type: "facet"; facetId: string }
  | { type: "field"; facetId: string; fieldId: string }
  | { type: "value"; facetId: string; fieldId: string; value: string }
  | { type: "tag"; tag: string }
  | { type: "node"; nodeId: string };

const isString = (v: unknown): v is string => typeof v === "string";

/** Read drag data. It is untrusted (any page element can set it), so anything
 *  that isn't exactly one of the shapes above is null. */
export function parseDragItem(text: string): DragItem | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "facet":
      return isString(o.facetId) ? { type: "facet", facetId: o.facetId } : null;
    case "field":
      return isString(o.facetId) && isString(o.fieldId)
        ? { type: "field", facetId: o.facetId, fieldId: o.fieldId }
        : null;
    case "value":
      return isString(o.facetId) && isString(o.fieldId) && isString(o.value)
        ? { type: "value", facetId: o.facetId, fieldId: o.fieldId, value: o.value }
        : null;
    case "tag":
      return isString(o.tag) ? { type: "tag", tag: o.tag } : null;
    case "node":
      return isString(o.nodeId) ? { type: "node", nodeId: o.nodeId } : null;
    default:
      return null;
  }
}

/** What a drop creates, and what couldn't be created (and why, in words for the user). */
export interface DropResult {
  nodes: QueryNode[];
  problems: string[];
}

const NOT_LOADED =
  "it is not in the loaded data dictionary. The dictionary may be out of date; reload the page.";

function condition(over: Partial<Condition>): Condition {
  return { ...newCondition(), ...over };
}

/** A condition meaning "this facet is present, whatever its values". */
function facetPresent(facetId: string): Condition {
  return condition({ facetId, operatorId: "present" });
}

/**
 * The nodes a dragged docs item creates. Never throws and never ignores
 * anything silently: whatever can't be created is explained in `problems`.
 */
export function nodesForItem(
  item: Exclude<DragItem, { type: "node" }>,
  facets: Facet[],
  catalog: FieldCatalog,
): DropResult {
  switch (item.type) {
    case "facet": {
      if (!facets.some((f) => f.id === item.facetId)) {
        return { nodes: [], problems: [`Couldn't add “${item.facetId}”: ${NOT_LOADED}`] };
      }
      return { nodes: [facetPresent(item.facetId)], problems: [] };
    }
    case "field": {
      if (!findField(catalog, item.facetId, item.fieldId)) {
        return { nodes: [], problems: [`Couldn't add “${item.fieldId}”: ${NOT_LOADED}`] };
      }
      return {
        nodes: [condition({ facetId: item.facetId, fieldId: item.fieldId })],
        problems: [],
      };
    }
    case "value": {
      const field = findField(catalog, item.facetId, item.fieldId);
      if (!field) {
        return { nodes: [], problems: [`Couldn't add “${item.value}”: ${NOT_LOADED}`] };
      }
      if (!field.options?.includes(item.value)) {
        return {
          nodes: [],
          problems: [
            `Couldn't add “${item.value}”: it is not one of ${field.fieldName}'s known values.`,
          ],
        };
      }
      // The pick-list holds text; a number field's value goes out as a number.
      const value = field.valueType === "number" ? Number(item.value) : item.value;
      return {
        nodes: [
          condition({ facetId: item.facetId, fieldId: item.fieldId, operatorId: "eq", value }),
        ],
        problems: [],
      };
    }
    case "tag": {
      const tagged = facets.filter((f) => f.tags.includes(item.tag));
      if (tagged.length === 0) {
        return { nodes: [], problems: [`The tag “${item.tag}” has no facets.`] };
      }
      return { nodes: tagged.map((f) => facetPresent(f.id)), problems: [] };
    }
  }
}

/** The warning to show for a drop's problems, or null when there were none. */
export function dropNotice(problems: string[]): string | null {
  return problems.length > 0 ? problems.join(" ") : null;
}
