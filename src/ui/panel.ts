import { activate, destroy } from "./fomantic";
import { rememberFocus, restoreFocus } from "./focusMemory";

/**
 * Replace a panel's contents: tear down old Fomantic plugins, swap markup, init
 * new ones. If the keyboard focus was inside the panel, it is put back on the
 * same control (or the nearest `data-focus-landing`, see focusMemory.ts): the
 * old element is gone, and without this the focus would drop to the page.
 */
export function paint(container: HTMLElement, html: string): void {
  const focus = rememberFocus(container);
  destroy(container);
  container.innerHTML = html;
  activate(container);
  // After activate: a dropdown's typing box only exists once Fomantic built it.
  restoreFocus(container, focus);
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

/** One `<option>` per item, for any `<select>` built from a list — the shape shared
 * by every facet/field/operator/value dropdown in the query builder and value control. */
export function optionsHtml<T>(
  items: readonly T[],
  toValue: (item: T) => string,
  toLabel: (item: T) => string,
  isSelected: (item: T) => boolean,
): string {
  return items
    .map(
      (item) =>
        `<option value="${escapeHtml(toValue(item))}"${isSelected(item) ? " selected" : ""}>${escapeHtml(toLabel(item))}</option>`,
    )
    .join("");
}
