// The jQuery airlock: the only file that uses jQuery (src/setup-jquery.ts
// merely publishes the global for Fomantic). See docs/ARCHITECTURE.md,
// "The Fomantic discipline".
import $ from "jquery";

/** Settings for every dropdown. A free-entry one (`data-free-entry`, set by
 *  valueControl.ts) also accepts values that aren't among its options, and
 *  shows an "Add" hint while the user types one. */
const DROPDOWN = { fullTextSearch: true };
const FREE_ENTRY_DROPDOWN = { ...DROPDOWN, allowAdditions: true, hideAdditions: false };

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
