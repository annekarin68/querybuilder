import { runBlocker, type AppState, type RunInputs } from "../state";
import type { EventRecord } from "../model";
import { escapeHtml, paint } from "./panel";
import { shortId } from "./eventTable";

/**
 * One result's JSON, in a native <dialog> (docs/ARCHITECTURE.md, "Under the
 * query — `dataPreview.ts` (Matching events)"). An expanded row would sit far
 * off to the left inside the wide, sideways-scrolled table; a dialog does not,
 * and it is where a later Event viewer can plug in. Built like the saved-
 * queries dialog: created once by the shell, painted from the state, opened
 * and closed to match `openEventId`, closed by Escape, and the focus goes back
 * to the id button that opened it.
 */

/** The heading's id: the <dialog> in layout.ts is labelled by it. */
export const EVENT_TITLE_ID = "qb-event-title";

/** The open result, or null: none is open, or it is not among the results
 *  on screen any more. While Run is blocked the table is replaced by the
 *  blocked message (a late statistics line can reject the query although
 *  `preview` is still "ok"), so no result is on screen then either. */
export function openEventOf(
  state: Pick<AppState, "openEventId" | "preview"> & RunInputs,
): EventRecord | null {
  const { openEventId, preview } = state;
  if (openEventId === null || preview.status !== "ok" || runBlocker(state) !== null) return null;
  return preview.events.find((e) => e.id === openEventId) ?? null;
}

export function eventDialogHtml(event: EventRecord | null): string {
  if (!event) return "";
  return `<h2 class="qb-dialog-title" id="${EVENT_TITLE_ID}">Event ${escapeHtml(shortId(event.id))}</h2>
    <p class="qb-dialog-hint">${escapeHtml(event.id)}</p>
    <pre class="qb-event-json" tabindex="0" role="region" aria-label="The event as JSON">${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    <div class="qb-dialog-actions">
      <button type="button" class="ui small basic button" data-action="close-event" data-initial-focus>Close</button>
    </div>`;
}

// ---- The browser part (needs a DOM, so it is checked in a browser) --------

/** Which event each dialog showed at its last render: closing gives the
 *  focus back to that event's id button. */
const shownId = new WeakMap<HTMLDialogElement, string>();

export function renderEventDialog(dialog: HTMLDialogElement, state: AppState): void {
  const event = openEventOf(state);
  const before = shownId.get(dialog);
  if (!event) {
    shownId.delete(dialog);
    if (dialog.open) dialog.close();
    paint(dialog, "");
    // The table may have been repainted meanwhile, so the button is looked up again.
    if (before) {
      const doc = dialog.ownerDocument;
      // The id button is gone when the results are (a blocked Run replaced
      // the table): the card is the nearest place to land.
      (
        doc.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(before)}"]`) ??
        doc.querySelector<HTMLElement>(".qb-preview[data-focus-landing]")
      )?.focus();
    }
    return;
  }
  shownId.set(dialog, event.id);
  paint(dialog, eventDialogHtml(event));
  if (!dialog.open) dialog.showModal();
  if (before !== event.id) dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
}

/** Close, Escape, and a close the state did not ask for all tell the state.
 *  Call once at startup. */
export function wireEventDialog(dialog: HTMLDialogElement, onClose: () => void): void {
  dialog.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='close-event']")) onClose();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    onClose();
  });
  dialog.addEventListener("close", () => {
    if (shownId.has(dialog)) onClose();
  });
}
