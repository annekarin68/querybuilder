// The jQuery airlock: the only file that uses jQuery (src/setup-jquery.ts
// merely publishes the global for Fomantic). See docs/ARCHITECTURE.md,
// "The Fomantic discipline".
import $ from "jquery";
import { hoverTitle } from "./format";

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

/**
 * Two things Fomantic does not do for a dropdown it builds from a <select>:
 * - Its typing box (`input.search`) is what has the keyboard focus, and it has
 *   no accessible name, so a screen reader says only "edit text". Give it the
 *   <select>'s aria-label.
 * - The shown choice, and in a multi-select each chosen label, is cut off with
 *   "…" when it is longer than the dropdown. showFullChoice puts the full text
 *   in a `title` on what the pointer is over, and removes it from a placeholder.
 */
function describeDropdown(node: HTMLElement): void {
  // `node` was the <select> carrying the `ui dropdown` classes; Fomantic wraps
  // it in a <div class="ui dropdown"> and moves the classes there.
  const dropdown = node.closest<HTMLElement>(".ui.dropdown") ?? node;
  const label = dropdown.querySelector("select")?.getAttribute("aria-label");
  if (label) dropdown.querySelector("input.search")?.setAttribute("aria-label", label);
  showFullChoice(dropdown);
}

/**
 * (Re)write the hover title that shows a dropdown's full choice: the shown text
 * is cut off with "…" when it is longer than the box. Called on activation and
 * after every change.
 *
 * In a search dropdown the typing box (`input.search`) lies on top of the
 * shown text, so the pointer is always over the box: the title must be there
 * too (a title on the text alone never showed). A placeholder ("Choose…") gets
 * no title: it is not a choice. In a multi-select each chosen value is a
 * label, cut off the same way, so each label gets its own.
 */
function showFullChoice(node: HTMLElement): void {
  const shown = node.querySelector<HTMLElement>(":scope > .text");
  const title = hoverTitle(shown?.textContent, !shown || shown.classList.contains("default"));
  setTitle(shown, title);
  setTitle(node.querySelector<HTMLElement>(":scope > input.search"), title);
  node.querySelectorAll<HTMLElement>(":scope > a.ui.label").forEach((label) => {
    // The shown text, not data-value: Fomantic stores data-value HTML-escaped
    // (`"` becomes the literal `&quot;`), while the label shows it decoded.
    setTitle(label, hoverTitle(label.textContent));
  });
}

/** Set `el`'s title, or remove the attribute for null (`hoverTitle`). */
function setTitle(el: HTMLElement | null, title: string | null): void {
  if (!el) return;
  if (title) el.title = title;
  else el.removeAttribute("title");
}

export function activate(container: HTMLElement): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown(node.hasAttribute("data-free-entry") ? FREE_ENTRY_DROPDOWN : DROPDOWN);
      describeDropdown(node);
    });
  $(container).find(".ui.checkbox").checkbox();
}

export function destroy(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown("destroy");
  $(container).find(".ui.checkbox").checkbox("destroy");
}

/**
 * Put the cursor in dropdown `el` (in its typing box, if it has one) and open
 * its menu. Does nothing if it is disabled. Focus alone doesn't open a
 * Fomantic dropdown (`showOnFocus` is off, so Tab doesn't pop menus open).
 */
export function openDropdown(el: HTMLElement): void {
  if (el.classList.contains("disabled")) return;
  (el.querySelector<HTMLElement>("input.search") ?? el).focus();
  $(el).dropdown("show");
}

/**
 * Bind Fomantic dropdowns' onChange within `container`. Fomantic also dispatches a
 * native "change" on the <select>, but just BEFORE onChange, and a panel must
 * handle each dropdown in one place only (queryBuilder.ts's change listener
 * explains why): that place is here. Call this AFTER activate(). `el` is the
 * .ui.dropdown element that changed.
 */
export function onDropdownChange(container: HTMLElement, handler: (el: HTMLElement) => void): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown("setting", "onChange", () => {
        showFullChoice(node);
        handler(node);
      });
    });
}

/** A small, self-dismissing message at the top of the page. `kind` sets its
 *  colour: green for good news, red for a failure. */
export function showToast(message: string, kind: "success" | "error" = "success"): void {
  // preserveHTML: false shows the message as plain text, never as markup.
  $("body").toast({
    message,
    class: kind,
    // An error stays longer: it has to be read, not just noticed.
    displayTime: kind === "error" ? 6000 : 3000,
    showProgress: false,
    preserveHTML: false,
  });
}
