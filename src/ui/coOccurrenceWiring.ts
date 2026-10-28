// The behaviour of "Seen together" in the builder (docs/ARCHITECTURE.md,
// "Centre — `queryBuilder.ts`"): the arrow keys in a row of cells or a chart, their Tab
// stops across repaints, the caption, the popovers (the legends and the
// "+ N less often" list) and the chart's labels. The HTML is drawn by
// coOccurrenceHtml.ts, legendHtml.ts and blockHtml.ts; queryBuilder.ts
// paints it and calls the hooks below around every paint. Kept apart from
// queryBuilder.ts so each file stays small enough to read in one go.

import { captionText, rovingIndex, tabStopIndex } from "./coOccurrenceHtml";
import { isRestoringFocus } from "./focusMemory";
import { POPOVER_CLASS, popoverPlacement } from "./popover";

/** The buttons of a row of co-occurrence cells or of a Seen together chart
 *  (`data-roving`): one Tab stop, the arrow keys move between them. */
function rovingItems(group: Element): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>(":scope > button"));
}

/** The id a row's cell or a chart's box is remembered by: its
 *  `data-co-cell` or `data-co-box` (the merged box's is ""). */
function rovingIdOf(item: HTMLElement): string {
  return item.dataset.coCell ?? item.dataset.coBox ?? "";
}

/** Which row or chart `group` is, in words that survive a repaint: its
 *  block's id and whether it is the row or the chart. Null outside a block. */
function rovingGroupKey(group: Element): string | null {
  const blockId = group.closest<HTMLElement>(".qb-block[data-node-id]")?.dataset.nodeId;
  if (!blockId) return null;
  return `${blockId} ${group.classList.contains("qb-co-row") ? "row" : "chart"}`;
}

/** The cell or box `itemId` of the row or chart `groupKey` (rovingGroupKey),
 *  as it is on screen now (a repaint replaces them), or null if it is gone. */
function rovingItemOf(
  container: HTMLElement,
  groupKey: string,
  itemId: string,
): HTMLElement | null {
  for (const group of container.querySelectorAll("[data-roving]")) {
    if (rovingGroupKey(group) !== groupKey) continue;
    return rovingItems(group).find((item) => rovingIdOf(item) === itemId) ?? null;
  }
  return null;
}

/** The caption a row or chart shows its items in (`CAPTION`): the row's is
 *  at the end of its block's first head line (blockHtml.ts), the chart's in
 *  the title line above the chart (coOccurrenceHtml.ts). */
function captionOf(group: Element): Element | null {
  if (group.classList.contains("qb-co-row")) {
    return (
      group.closest(".qb-block")?.querySelector(":scope > .qb-block-head .qb-co-caption") ?? null
    );
  }
  return group.parentElement?.querySelector(".qb-co-caption") ?? null;
}

/** Fills the caption of a row or chart with the item under the pointer,
 *  else the focused one: its short `data-caption` if it has one, else its
 *  accessible name. Either may be null, or an item of another group (then it
 *  does not count). */
function showCaption(group: Element, hovered: Element | null, focused: Element | null): void {
  const caption = captionOf(group);
  if (!caption) return;
  const nameIn = (item: Element | null) =>
    item && group.contains(item)
      ? (item.getAttribute("data-caption") ?? item.getAttribute("aria-label"))
      : null;
  caption.textContent = captionText(nameIn(hovered), nameIn(focused));
}

/**
 * Puts a popover by the button that opens it (`popoverPlacement`): without
 * this the browser opens it in the middle of the window. It is fixed in the
 * window, so its place is worked out from the button's place on screen.
 */
function placePopover(container: HTMLElement, popover: HTMLElement): void {
  const button = container.querySelector(`[popovertarget="${CSS.escape(popover.id)}"]`);
  if (!button) return;
  const place = popoverPlacement(button.getBoundingClientRect(), {
    // The window without its scrollbar, as for the floating dictionary.
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  });
  const px = (n: number | null) => (n === null ? "auto" : `${n}px`);
  Object.assign(popover.style, {
    left: px(place.left),
    width: px(place.width),
    top: px(place.top),
    bottom: px(place.bottom),
    maxHeight: px(place.maxHeight),
  });
}

/** The open co-occurrence popover in `container`, or null. Null too where
 *  the browser has no popovers: the selector would throw there (and break
 *  every Escape in the builder), and no popover can be open anyway. */
function openPopoverOf(container: HTMLElement): HTMLElement | null {
  if (!("showPopover" in HTMLElement.prototype)) return null;
  return container.querySelector<HTMLElement>(`.${POPOVER_CLASS}:popover-open`);
}

/** Make item `index` of `group` its one Tab stop. */
function setTabStop(group: Element, index: number): void {
  rovingItems(group).forEach((item, i) => (item.tabIndex = i === index ? 0 : -1));
}

/**
 * Which of a box's labels to show, from whether each would fit uncut, in the
 * order the box prefers them: the first that fits, or -1 for none. A facet's
 * box has one label; the merged box has "+ N less often", then "+N".
 */
export function labelToShow(fits: boolean[]): number {
  return fits.indexOf(true);
}

/**
 * Hides the chart's labels that do not fit: every box gets its labels
 * (`seenTogetherHtml`), and only the browser knows the real size. A label
 * that would be cut is hidden instead (a cut name is never shown; the name
 * is still the box's accessible name and its caption). Of the merged box's
 * two, the long one is shown if it fits, else the short one.
 * Hiding a label changes no size, so this cannot loop.
 */
function hideCutLabels(chart: Element): void {
  for (const box of chart.querySelectorAll(".qb-seen-box")) {
    const labels = Array.from(box.querySelectorAll<HTMLElement>(".qb-seen-label"));
    // Measured whether hidden or not: `visibility: hidden` keeps the layout.
    const fits = labels.map(
      (label) => label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight,
    );
    const shown = labelToShow(fits);
    labels.forEach((label, i) => label.classList.toggle("is-cut", i !== shown));
  }
}

/** What queryBuilder.ts calls to fit "Seen together" into its own handlers. */
export interface CoOccurrenceWiring {
  /** A click: if it is on a cell or a facet's box (`data-opens-docs`), open
   *  the dictionary there and return true; otherwise false. */
  handleClick(target: Element): boolean;
  /** The open popover, if any: an Escape is then the popover's (the browser
   *  closes it), and the builder leaves the field row and About alone. */
  openPopover(): HTMLElement | null;
  /** Escape puts the captions away until the pointer or focus moves to an
   *  item again. */
  dismissCaptions(): void;
  /** Call just before a paint: the id of the open popover, if any. */
  beforePaint(): string | undefined;
  /** Call just after a paint, with what `beforePaint` returned. */
  afterPaint(openPopoverId: string | undefined): void;
}

/**
 * Install the behaviour of the co-occurrence rows and charts on `container`
 * (the builder). Call ONCE, from `wireQueryBuilder`. `showFacetInDictionary`
 * opens the dictionary at a facet; its second argument finds the pressed cell
 * or box again (null when it is gone), for when the user closes it.
 */
export function wireCoOccurrence(
  container: HTMLElement,
  showFacetInDictionary: (facetId: string, returnFocusTo: () => HTMLElement | null) => void,
): CoOccurrenceWiring {
  /** A cell or box (`data-opens-docs`) pressed, by a click or Enter: open
   *  the dictionary at its facet. It is found again by the words the Tab
   *  stops are remembered by, since a repaint may replace it meanwhile. */
  function openInDictionary(item: HTMLElement): void {
    const group = item.parentElement;
    const groupKey = group ? rovingGroupKey(group) : null;
    const facetId = item.dataset.facetId;
    if (!groupKey || !facetId) return;
    const itemId = rovingIdOf(item);
    showFacetInDictionary(facetId, () => rovingItemOf(container, groupKey, itemId));
  }

  function handleClick(target: Element): boolean {
    // A button's Enter and Space arrive here as a click too.
    const opener = target.closest<HTMLElement>("[data-roving] > [data-opens-docs]");
    if (!opener) return false;
    openInDictionary(opener);
    return true;
  }

  // The co-occurrence row and the Seen together chart: Left / Right / Home /
  // End move the focus between their buttons (`rovingIndex`).
  container.addEventListener("keydown", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-roving] > button");
    if (!item?.parentElement) return;
    const items = rovingItems(item.parentElement);
    // Keys with Alt, Ctrl or Meta are left to the browser (rovingIndex).
    const next = rovingIndex(e, items.indexOf(item), items.length);
    if (next === null) return;
    e.preventDefault(); // Home / End would scroll the page
    items[next]?.focus();
  });

  // Each row's and chart's Tab stop is the item the user was last on. The
  // markup always makes the first item the stop, so it is remembered here,
  // per block, and put back after every paint (`restoreTabStops`): otherwise
  // an edit elsewhere would send Shift+Tab back to the first cell. (Entries
  // of removed blocks stay; they are a few short strings.)
  const tabStops = new Map<string, string>();
  container.addEventListener("focusin", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-roving] > button");
    const group = item?.parentElement;
    const key = group ? rovingGroupKey(group) : null;
    if (!item || !group || !key) return;
    tabStops.set(key, rovingIdOf(item));
    setTabStop(group, rovingItems(group).indexOf(item));
  });
  function restoreTabStops(): void {
    for (const group of container.querySelectorAll("[data-roving]")) {
      const key = rovingGroupKey(group);
      const ids = rovingItems(group).map(rovingIdOf);
      setTabStop(group, tabStopIndex(ids, key ? tabStops.get(key) : undefined));
    }
  }

  // The caption of a row or chart follows the pointer and the focus
  // (`showCaption`). The item under the pointer is kept here: a `mouseout`
  // must know whether the pointer left the item or moved within it.
  let hovered: Element | null = null;
  // A caption lies over the page, so Escape puts it away (content shown on
  // hover or focus must be dismissible: `dismissCaptions`) until the user
  // points at or moves the focus to an item again. A repaint putting the
  // focus back (`isRestoringFocus`) is not such a move: the Escape itself
  // often repaints. Escape is not used up by this: the caption is hidden
  // from screen readers, so for them that Escape would do nothing.
  let captionsDismissed = false;
  function dismissCaptions(): void {
    captionsDismissed = true;
    for (const line of container.querySelectorAll(".qb-co-caption")) line.textContent = "";
  }
  const caption = (group: Element, hoveredItem: Element | null, focused: Element | null) => {
    if (!captionsDismissed) showCaption(group, hoveredItem, focused);
  };
  const rovingItemAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest("[data-roving] > button") : null;
  const focusedItem = () => rovingItemAt(document.activeElement);
  container.addEventListener("mouseover", (e) => {
    const item = rovingItemAt(e.target);
    if (!item?.parentElement || item === hovered) return;
    hovered = item;
    captionsDismissed = false;
    caption(item.parentElement, item, focusedItem());
  });
  container.addEventListener("mouseout", (e) => {
    const item = rovingItemAt(e.target);
    if (!item?.parentElement || item.contains(e.relatedTarget as Node | null)) return;
    hovered = null;
    caption(item.parentElement, null, focusedItem());
  });
  container.addEventListener("focusin", (e) => {
    const item = rovingItemAt(e.target);
    if (!item?.parentElement) return;
    if (!isRestoringFocus()) captionsDismissed = false;
    caption(item.parentElement, hovered, item);
  });
  container.addEventListener("focusout", (e) => {
    const item = rovingItemAt(e.target);
    // `relatedTarget`: where the focus goes (the next cell, or outside).
    if (item?.parentElement) caption(item.parentElement, hovered, rovingItemAt(e.relatedTarget));
  });

  // A popover opening is placed by its button (`placePopover`), and placed
  // again while it is open whenever the page scrolls or the window changes
  // size: it is fixed in the window, and its button moves with the page. Only
  // one popover can be open at a time (the browser closes the other).
  let followed: HTMLElement | null = null;
  const placeFollowed = () => {
    // A repaint removes an open popover without a closing event: stop then.
    if (followed?.isConnected && followed.matches(":popover-open")) {
      placePopover(container, followed);
    } else {
      stopFollowing();
    }
  };
  const scrollOptions = { capture: true, passive: true };
  function stopFollowing(): void {
    followed = null;
    window.removeEventListener("scroll", placeFollowed, scrollOptions);
    window.removeEventListener("resize", placeFollowed);
  }
  // `beforetoggle` does not bubble, so it is caught on the way down (capture).
  container.addEventListener(
    "beforetoggle",
    (e) => {
      const popover = e.target;
      if (!(popover instanceof HTMLElement) || !popover.classList.contains(POPOVER_CLASS)) return;
      stopFollowing();
      if ((e as ToggleEvent).newState !== "open") return;
      placePopover(container, popover);
      followed = popover;
      // Capture: a scroll inside a panel does not bubble to the window.
      window.addEventListener("scroll", placeFollowed, scrollOptions);
      window.addEventListener("resize", placeFollowed);
    },
    true,
  );

  // Re-checks the chart's labels whenever a chart changes size, and once
  // when it is first observed (after each paint, below).
  const chartSizes =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => entries.forEach((entry) => hideCutLabels(entry.target)));

  return {
    handleClick,
    openPopover: () => openPopoverOf(container),
    dismissCaptions,
    // A repaint replaces an open popover, and the browser hides a popover
    // that leaves the page: afterPaint opens the new one again, so a repaint
    // the user did not cause (statistics' issues arriving, the dictionary
    // reloading) does not take it away while it is being read. The focus
    // comes back to its button through focus memory, as for any button.
    beforePaint: () => openPopoverOf(container)?.id,
    afterPaint(openPopoverId) {
      if (openPopoverId) document.getElementById(openPopoverId)?.showPopover();
      restoreTabStops();
      // The old charts are gone with the repaint: watch the new ones.
      chartSizes?.disconnect();
      container.querySelectorAll(".qb-seen-chart").forEach((chart) => chartSizes?.observe(chart));
    },
  };
}
