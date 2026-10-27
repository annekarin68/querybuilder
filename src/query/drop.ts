import type { Facet } from "../model";
import { findField, type FieldCatalog } from "./fieldCatalog";
import {
  countBlocks,
  findNode,
  groupOf,
  insertNodes,
  newBlock,
  newFieldCondition,
  setFieldCondition,
  type Direction,
} from "./tree";
import type { FacetBlock, Group, QueryNode } from "./types";

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

/** A field row of one block: what a drop asks the builder to focus. */
export interface FieldRef {
  blockId: string;
  fieldId: string;
}

/** What a dropped dictionary item did to the query. */
export interface DropOutcome {
  /** The new query; the same object when nothing changed. */
  query: Group;
  /** New blocks or a new group, for the announcement. Empty when the drop
   *  only focused or filled a row of an existing block. */
  added: QueryNode[];
  /** The row to focus afterwards, or null. */
  select: FieldRef | null;
  /** What couldn't be added, in words for the user. */
  problems: string[];
}

const NOT_LOADED =
  "it is not in the loaded data dictionary. The dictionary may be out of date; reload the page.";

/**
 * What dropping a dictionary item on `targetId` (a group or a block) does.
 * Never throws and never ignores anything silently: whatever can't be added
 * is explained in `problems`. Never overwrites a field the user has set.
 */
export function dropItem(
  query: Group,
  item: Exclude<DragItem, { type: "node" }>,
  targetId: string,
  facets: Facet[],
  catalog: FieldCatalog,
): DropOutcome {
  const target = findNode(query, targetId);
  // A stale drop (the target was removed meanwhile) adds at the root.
  const at = target ? targetId : query.id;
  const targetBlock = target?.kind === "facet" ? target : null;
  const refused = (problem: string): DropOutcome => ({
    query,
    added: [],
    select: null,
    problems: [problem],
  });
  const inserted = (nodes: QueryNode[], select: FieldRef | null): DropOutcome => ({
    query: insertNodes(query, at, nodes),
    added: nodes,
    select,
    problems: [],
  });

  switch (item.type) {
    case "facet": {
      if (!facets.some((f) => f.id === item.facetId)) {
        return refused(`Couldn't add “${item.facetId}”: ${NOT_LOADED}`);
      }
      return inserted([newBlock(item.facetId)], null);
    }
    case "field": {
      if (!findField(catalog, item.facetId, item.fieldId)) {
        return refused(`Couldn't add “${item.fieldId}”: ${NOT_LOADED}`);
      }
      // The block already has a row for every field of its facet: focus it.
      if (targetBlock?.facetId === item.facetId) {
        return {
          query,
          added: [],
          select: { blockId: targetBlock.id, fieldId: item.fieldId },
          problems: [],
        };
      }
      const block = newBlock(item.facetId);
      return inserted([block], { blockId: block.id, fieldId: item.fieldId });
    }
    case "value": {
      const field = findField(catalog, item.facetId, item.fieldId);
      if (!field) return refused(`Couldn't add “${item.value}”: ${NOT_LOADED}`);
      if (!field.options?.includes(item.value)) {
        return refused(
          `Couldn't add “${item.value}”: it is not one of ${field.fieldName}'s known values.`,
        );
      }
      // The pick-list holds text; a number field's value goes out as a number.
      const value = field.valueType === "number" ? Number(item.value) : item.value;
      const condition = newFieldCondition(item.fieldId, "eq", value);
      const rowIsUnset =
        targetBlock?.facetId === item.facetId &&
        !targetBlock.conditions.some((c) => c.fieldId === item.fieldId);
      if (targetBlock && rowIsUnset) {
        return {
          query: setFieldCondition(query, targetBlock.id, condition),
          added: [],
          select: { blockId: targetBlock.id, fieldId: item.fieldId },
          problems: [],
        };
      }
      // The row is set already (or the drop is elsewhere): a new block, so
      // nothing the user chose is overwritten.
      const block: FacetBlock = { ...newBlock(item.facetId), conditions: [condition] };
      return inserted([block], { blockId: block.id, fieldId: item.fieldId });
    }
    case "tag": {
      const tagged = facets.filter((f) => f.tags.includes(item.tag));
      if (tagged.length === 0) return refused(`The tag “${item.tag}” has no facets.`);
      const blocks = tagged.map((f) => newBlock(f.id));
      // Two or more facets arrive as one ALL group (2026-10-13), so a
      // misplaced "Add all" is moved or removed in one go.
      return inserted(blocks.length > 1 ? [groupOf(blocks)] : blocks, null);
    }
  }
}

/** The warning to show for a drop's problems, or null when there were none. */
export function dropNotice(problems: string[]): string | null {
  return problems.length > 0 ? problems.join(" ") : null;
}

/** "1 facet", "3 facets". (Not ui/format's countLabel: the query layer does
 *  not import from the UI.) */
function facetCount(count: number): string {
  return `${count} ${count === 1 ? "facet" : "facets"}`;
}

/** What a screen reader hears after a drop or "+ Facet" added `nodes`: the
 *  builder repaints, so nothing on screen says that something happened. */
export function addedNodesMessage(nodes: QueryNode[]): string {
  const [only] = nodes;
  if (nodes.length === 1 && only?.kind === "group") {
    return `Added a group of ${facetCount(countBlocks(only))} to the query.`;
  }
  return `Added ${facetCount(nodes.length)} to the query.`;
}

/** What a screen reader hears after the builder's own "+ Group". */
export const ADDED_GROUP_MESSAGE = "Added a group to the query.";

/** What a screen reader hears after "Group contents". */
export function groupedMessage(count: number): string {
  return count === 1 ? "Grouped 1 item." : `Grouped ${count} items.`;
}

/** What a screen reader hears after "Ungroup". */
export const UNGROUPED_MESSAGE = "Ungrouped.";

/** What a screen reader hears after a group or block was moved. */
export function movedMessage(kind: QueryNode["kind"]): string {
  return `Moved the ${kind}.`;
}

/** What a screen reader hears after Move up / Move down. */
export function reorderedMessage(
  kind: QueryNode["kind"],
  direction: Direction,
  position: { index: number; count: number },
): string {
  return `Moved the ${kind} ${direction}, to position ${position.index} of ${position.count}.`;
}
