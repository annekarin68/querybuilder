// The ONLY file allowed to import jQuery. See docs/ARCHITECTURE.md §3.
import $ from "jquery";

export function activate(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown({ fullTextSearch: true });
  $(container).find(".ui.checkbox").checkbox();
  $(container).find(".ui.accordion").accordion();
}

export function destroy(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown("destroy");
  $(container).find(".ui.checkbox").checkbox("destroy");
  $(container).find(".ui.accordion").accordion("destroy");
}

/**
 * Bind Fomantic dropdowns' onChange within `container`. Fomantic dropdowns do not
 * emit a native "change" event, so panels cannot rely on delegated listeners for them.
 * Call this AFTER activate(). `el` is the .ui.dropdown element; read data-node-id / data-part off it.
 */
export function onDropdownChange(
  container: HTMLElement,
  handler: (el: HTMLElement, value: string) => void,
): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown("setting", "onChange", (value: string) =>
        handler(node as HTMLElement, value),
      );
    });
}
