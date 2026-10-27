import type { DragItem } from "../query/drop";

// What the dictionary item being dragged is. A browser hides a drag's data
// until the drop (only its types can be read while the pointer moves over a
// target), but the builder wants to know *which* item it is while the drag is
// over a block, to mark the block as the target when the item will land inside
// it. A drag starts and ends in this one page, so the dictionary says what it
// picked up here, and the builder asks.

let current: DragItem | null = null;

/** The dictionary picked an item up. */
export function rememberDrag(item: DragItem): void {
  current = item;
}

/** The drag ended (dropped or cancelled), or the builder started a drag of its own. */
export function forgetDrag(): void {
  current = null;
}

/** The dictionary item being dragged right now, or null (a drag from
 *  elsewhere, or none). */
export function draggedItem(): DragItem | null {
  return current;
}
