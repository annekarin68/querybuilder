/**
 * Keeping the keyboard focus across a repaint (docs/ARCHITECTURE.md,
 * "Keyboard focus across repaints"). `paint()` replaces a panel's whole markup, so the element
 * that had focus is gone and the browser drops focus to the page: a keyboard
 * user would have to Tab from the top again after every click. So paint()
 * remembers which control had focus (`rememberFocus`) and puts focus on the
 * same control in the new markup (`restoreFocus`).
 *
 * "The same control" is found by what the control IS, not by where it is:
 * its node (the `data-node-id` of the condition row or group it sits in) and
 * one identifying attribute (`controlOf`). When that control is gone (a row
 * was removed, Run turned into a loader), focus goes to the nearest element
 * marked `data-focus-landing`: first in the control's own node, then in each
 * group around it, then one outside every node (a panel's card).
 */

/** The attributes that say which control an element is, most telling first.
 *  `aria-label` comes last: a label can change with the state ("Collapse
 *  group" / "Expand group"), but it is the only name a Fomantic dropdown's
 *  typing box has (fomantic.ts copies it from the <select>). */
const IDENTIFYING_ATTRIBUTES = [
  "data-action",
  "data-db-id",
  "data-db-all",
  "data-db-none",
  "data-range",
  "data-part",
  "aria-label",
] as const;

/** The part of an element `controlOf` reads: an HTMLElement in the browser,
 *  a plain object in the tests. */
export interface AttributeSource {
  tagName: string;
  getAttribute(name: string): string | null;
}

/** Which control an element is, in words that survive a repaint. */
export interface Control {
  /** "BUTTON", "INPUT", …: a folded group's header line has the same
   *  `data-action` as its collapse button, but only the button takes focus. */
  tag: string;
  /** The first of IDENTIFYING_ATTRIBUTES the element has, and its value. */
  attribute: string;
  value: string;
}

/** Which control `el` is, or null if it has none of the identifying attributes. */
export function controlOf(el: AttributeSource): Control | null {
  for (const attribute of IDENTIFYING_ATTRIBUTES) {
    const value = el.getAttribute(attribute);
    if (value !== null) return { tag: el.tagName, attribute, value };
  }
  return null;
}

/** Whether two descriptions name the same control. Nothing (null) matches nothing. */
export function sameControl(a: Control | null, b: Control | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.tag === b.tag &&
    a.attribute === b.attribute &&
    a.value === b.value
  );
}

// ---- The browser part (needs a DOM, so it is checked in a browser) --------

/** What `rememberFocus` noted about the focused element. */
export interface FocusMemory {
  control: Control | null;
  /** The rows and groups the control sat in, innermost first; empty when it
   *  sat outside the query tree. */
  nodeIds: string[];
  /** Where the caret was in a text box, so typing carries on where it was. */
  selection: [number, number] | null;
}

/** The id of the condition row or group `el` sits in (or is), or null. */
function nodeIdOf(el: Element): string | null {
  return el.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
}

/** The ids of every row and group around `el`, innermost first. */
function nodeIdsAround(el: Element): string[] {
  const ids: string[] = [];
  let node = el.closest("[data-node-id]");
  while (node) {
    ids.push(node.getAttribute("data-node-id")!);
    node = node.parentElement?.closest("[data-node-id]") ?? null;
  }
  return ids;
}

/** Note which control in `container` has focus, or null if focus is elsewhere
 *  (another panel, or nothing): then the repaint must not move it. */
export function rememberFocus(container: HTMLElement): FocusMemory | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === container || !container.contains(el)) return null;
  // selectionStart is null for boxes without a caret (number, checkbox).
  const hasCaret = el instanceof HTMLInputElement && el.selectionStart !== null;
  return {
    control: controlOf(el),
    nodeIds: nodeIdsAround(el),
    selection: hasCaret ? [el.selectionStart!, el.selectionEnd ?? el.selectionStart!] : null,
  };
}

/** Focus `el` and say whether it worked: a disabled button or one inside a
 *  closed <details> cannot take focus. */
function tryFocus(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
}

/** The elements in `container` matching `selector` whose row or group is
 *  `nodeId` (null: outside every row and group). */
function ownedBy(container: HTMLElement, selector: string, nodeId: string | null): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => nodeIdOf(el) === nodeId,
  );
}

/** Put focus back on the remembered control in the new markup, or on the
 *  nearest landing spot (see the top of this file). */
export function restoreFocus(container: HTMLElement, memory: FocusMemory | null): void {
  if (!memory) return;
  const { control, nodeIds, selection } = memory;
  const ownNode = nodeIds[0] ?? null;
  const same = control
    ? ownedBy(container, control.tag, ownNode).find((el) => sameControl(controlOf(el), control))
    : undefined;
  if (tryFocus(same)) {
    if (same instanceof HTMLInputElement && selection) same.setSelectionRange(...selection);
    // A number box hides its caret from scripts, and focus() puts it before
    // the digits, where typing would prepend ("7000" -> "17000"). Selecting
    // the number instead shows what typing will replace, as Tab does.
    else if (same instanceof HTMLInputElement && same.type === "number") same.select();
    return;
  }
  for (const nodeId of [...nodeIds, null]) {
    for (const landing of ownedBy(container, "[data-focus-landing]", nodeId)) {
      if (tryFocus(landing)) return;
    }
  }
}
