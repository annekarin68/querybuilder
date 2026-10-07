import { activate, destroy } from "./fomantic";

/**
 * What `focusSelectorFor` needs to know about the focused element. A plain
 * object (not an `Element`) so the Node-only tests can build one.
 */
export interface FocusDescription {
  /** `element.tagName`, upper case. */
  tagName: string;
  /** `element.dataset`: the `data-*` attributes, camel-cased (`data-db-id` is `dbId`). */
  data: Record<string, string | undefined>;
  /** `data-node-id` of the nearest query node (group or condition) around it. */
  nodeId: string | null;
  id: string;
  /** Whether it sits inside a Fomantic `.ui.dropdown`. */
  inDropdown: boolean;
}

/**
 * Make `value` safe inside a double-quoted CSS attribute selector. Only the
 * quote, the backslash and a line break can break out of the quotes;
 * `CSS.escape` would do more but does not exist in the Node-only tests.
 */
export function quoteForCssString(value: string): string {
  return value.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\a ");
}

/**
 * A CSS selector that finds the control `focused` describes again after its
 * panel was repainted, or null when it should not be restored: either because
 * the control cannot be told apart from its neighbours, or because other code
 * owns its focus (see `paint`).
 *
 * When a selector can match several elements (a group's own "+ Condition" and
 * the ones of groups nested in it), the first in document order is the one
 * wanted: a group's own buttons come before its children in the markup.
 */
export function focusSelectorFor(focused: FocusDescription): string | null {
  // Dropdowns and value boxes: the query builder puts the cursor back itself
  // (focusPart, focusFieldDropdown), judging by what the user just did.
  if (focused.inDropdown) return null;
  const { data } = focused;
  if (focused.tagName === "INPUT") {
    return data.dbId === undefined ? null : `input[data-db-id="${quoteForCssString(data.dbId)}"]`;
  }
  if (data.dbAll !== undefined) return "[data-db-all]";
  if (data.dbNone !== undefined) return "[data-db-none]";
  if (data.action !== undefined) {
    const action = `[data-action="${quoteForCssString(data.action)}"]`;
    if (focused.nodeId !== null)
      return `[data-node-id="${quoteForCssString(focused.nodeId)}"] ${action}`;
    // The dictionary's Add buttons all share this action and even their items
    // repeat (a facet is listed under every tag it has), so no selector can
    // say which one it was: better to restore none than to jump to another.
    if (data.action === "add-item") return null;
    return action;
  }
  return focused.id === "" ? null : `[id="${quoteForCssString(focused.id)}"]`;
}

/** Describe `el` for `focusSelectorFor`. */
function describeFocus(el: HTMLElement): FocusDescription {
  return {
    tagName: el.tagName,
    data: { ...el.dataset },
    nodeId: el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null,
    id: el.id,
    inDropdown: el.closest(".ui.dropdown") !== null,
  };
}

/** Whether the browser would draw a focus ring on `el`, i.e. focus got there by keyboard. */
function isKeyboardFocus(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true; // an engine without :focus-visible: keep the focus rather than lose it
  }
}

/**
 * Replace a panel's contents: tear down old Fomantic plugins, swap markup, init new ones.
 *
 * A repaint destroys the focused button, and the browser then drops focus to
 * the page, so a keyboard user would have to Tab from the top after every
 * action. So when focus was inside the panel, on a control that
 * `focusSelectorFor` can find again, it is put back on the new copy. A mouse
 * click is left alone (`:focus-visible` is false), because focusing the new
 * button would draw a ring the user never asked for. Callers that need the
 * cursor somewhere else focus it after `paint`, which then wins.
 */
export function paint(container: HTMLElement, html: string): void {
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && container.contains(active) && isKeyboardFocus(active)
      ? active
      : null;
  const selector = focused ? focusSelectorFor(describeFocus(focused)) : null;
  destroy(container);
  container.innerHTML = html;
  activate(container);
  if (selector) container.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
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
