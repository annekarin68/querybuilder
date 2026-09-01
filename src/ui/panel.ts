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
