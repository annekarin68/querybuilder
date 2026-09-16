import { activate, destroy } from "./fomantic";

/** Replace a panel's contents: tear down old Fomantic plugins, swap markup, init new ones. */
export function paint(container: HTMLElement, html: string): void {
  destroy(container);
  container.innerHTML = html;
  activate(container);
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
 * by every field/operator/item/enum dropdown in the query builder and value control. */
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
