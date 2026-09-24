// The jQuery airlock: the only file that uses jQuery (src/setup-jquery.ts
// merely publishes the global for Fomantic). See docs/ARCHITECTURE.md,
// "The Fomantic discipline".
import $ from "jquery";

/**
 * Settings for every dropdown. A search dropdown shows only the items
 * containing the typed text as one piece, anywhere in the item ("exact").
 * `true` would also match the typed letters spread out in order, which with
 * many facets buries the real matches under loose ones.
 *
 * `selectOnKeydown: false`: the arrow keys only move the highlight and Enter
 * picks. Fomantic's default selects on every arrow press, which fires
 * onChange, and the repaint that follows replaces the open dropdown with a
 * closed one — so the first ↓ picked the next item and closed the menu.
 */
const DROPDOWN = { fullTextSearch: "exact", selectOnKeydown: false };

/**
 * A free-entry dropdown (`data-free-entry`, set by valueControl.ts) also
 * accepts values that aren't among its options. Two Fomantic defaults are
 * kept or overridden on purpose (docs/ARCHITECTURE.md, "Centre —
 * `queryBuilder.ts`"):
 * - `hideAdditions` stays at its default (true): with `false`, Fomantic 2.9
 *   clears the search on Enter before selecting, so Enter picks nothing.
 * - `delimiter` is a character no key can type, so a comma is part of the
 *   value instead of splitting "Is any of" entries.
 */
const FREE_ENTRY_DROPDOWN = { ...DROPDOWN, allowAdditions: true, delimiter: "\u0000" };

export function activate(container: HTMLElement): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown(node.hasAttribute("data-free-entry") ? FREE_ENTRY_DROPDOWN : DROPDOWN);
    });
  $(container).find(".ui.checkbox").checkbox();
}

export function destroy(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown("destroy");
  $(container).find(".ui.checkbox").checkbox("destroy");
}

/**
 * Bind Fomantic dropdowns' onChange within `container`. Fomantic dropdowns do not
 * emit a native "change" event, so panels cannot rely on delegated listeners for them.
 * Call this AFTER activate(). `el` is the .ui.dropdown element that changed.
 */
export function onDropdownChange(container: HTMLElement, handler: (el: HTMLElement) => void): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown("setting", "onChange", () => handler(node as HTMLElement));
    });
}
