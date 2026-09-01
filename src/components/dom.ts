/**
 * A tiny hyperscript-style helper for building DOM trees imperatively,
 * without a virtual DOM or a templating dependency. Event handlers are
 * attached directly during construction, which sidesteps the classic
 * "innerHTML wipes my listeners" problem of naive re-rendering.
 */
export type Child = Node | string | number | null | undefined | false | Child[];

type EventHandlers = { [K in `on${string}`]?: (event: Event) => void };
export type ElementProps = Partial<{
  class: string;
  value: string | number | readonly string[];
  checked: boolean;
  disabled: boolean;
  selected: boolean;
  placeholder: string;
  type: string;
  min: number | string;
  max: number | string;
  step: number | string;
  title: string;
  ariaLabel: string;
}> &
  EventHandlers &
  Record<string, unknown>;

const DIRECT_PROPERTIES = new Set(["value", "checked", "disabled", "selected"]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  for (const [key, raw] of Object.entries(props)) {
    if (raw === undefined || raw === null || raw === false) continue;
    if (key.startsWith("on") && typeof raw === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), raw as EventListener);
    } else if (key === "class") {
      el.className = String(raw);
    } else if (key === "ariaLabel") {
      el.setAttribute("aria-label", String(raw));
    } else if (DIRECT_PROPERTIES.has(key)) {
      // Set as a live DOM property (not an attribute) so it behaves
      // correctly for form controls, e.g. checkbox.checked = true.
      (el as unknown as Record<string, unknown>)[key] = raw;
    } else {
      el.setAttribute(key, String(raw));
    }
  }

  for (const child of children) {
    appendChild(el, child);
  }

  return el;
}

function appendChild(parent: HTMLElement, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const nested of child) appendChild(parent, nested as Child);
    return;
  }
  parent.append(child instanceof Node ? child : String(child));
}

export function clear(el: Element): void {
  el.replaceChildren();
}
