import { runBlocker, type AppState, type RunBlocker } from "../state";
import { FIRST_COLUMNS } from "../config";
import { pageOf } from "../util/paging";
import { escapeHtml, paint } from "./panel";
import { exact } from "./format";
import { blockedText } from "./databasePicker";
import { eventTableHtml, pagingHtml, scrollAfterRepaint, tableColumns } from "./eventTable";

/**
 * How many events the Run query panel promises. The backend decides the real
 * size of the sample (up to this many, picked at random); this constant only
 * words the panel's text, so change it when the backend's limit changes.
 */
export const EVENT_SAMPLE_SIZE = 2000;

/** What the idle Run query panel says; `locale` is for tests ("2,000" vs "2.000"). */
export function idleMessage(locale?: string): string {
  return `Fetch a random sample of up to ${exact(EVENT_SAMPLE_SIZE, locale)} events this query matches.`;
}

/** The panel's card. It is its `data-focus-landing` (not in the Tab
 *  order, tabindex -1, but can be given the focus by script; a mouse click also
 *  focuses it): Run turns into a loader, then into the result, and a
 *  keyboard user who pressed it stays in this card instead of dropping to the
 *  page (paint(), focusMemory.ts). app.ts announces what happened. */
function card(body: string): string {
  return `<div class="qb-card qb-preview" tabindex="-1" data-focus-landing><h2 class="qb-card-title">Matching events</h2>${body}</div>`;
}

/**
 * The Run control — the only one in the app: an optional `message` above the
 * button, an optional `note` below it. Its enabled state is decided by the same
 * checks renderDataPreview makes before calling it.
 */
function runBlock({
  message = "",
  enabled,
  note = "",
  label = "Run query",
}: {
  message?: string;
  enabled: boolean;
  note?: string;
  label?: string;
}): string {
  return `<div class="qb-run">
    ${message ? `<p class="qb-run-msg">${escapeHtml(message)}</p>` : ""}
    <button type="button" class="ui primary button" data-action="run"${enabled ? "" : " disabled"}><i class="play icon"></i>${escapeHtml(label)}</button>
    ${note ? `<p class="qb-run-note">${escapeHtml(note)}</p>` : ""}
  </div>`;
}

/** Said next to Run query, the one button that sends a logged-out user to log
 *  in without asking first (Save… and Saved queries ask in a dialog,
 *  savedQueries.ts). */
const LOGIN_FIRST_NOTE = "You'll be asked to log in first.";

/** Advisory only (docs/ARCHITECTURE.md, "Auth"): Run always attempts the
 *  request; src/app.ts reacts to the real 401/403 by redirecting into
 *  login/compliance and back. */
function runNote(state: AppState): string {
  if (state.auth.status === "anonymous") return LOGIN_FIRST_NOTE;
  if (state.auth.status === "authenticated" && state.compliance.status === "required") {
    return "You'll be asked to confirm compliance first.";
  }
  return "";
}

/** Why Run is disabled (see `runBlocker`). */
const BLOCKED_MESSAGES: Record<Exclude<RunBlocker, "loading">, string> = {
  "no-database": "Select at least one database, then run the query.",
  "no-facet": "Add a facet, then run the query.",
  unfinished: "Finish the query to run it.",
  rejected: "A database found a problem in the query (shown above). Change the query to run it.",
};

// ---- Keeping the table's scroll position (needs a DOM, so it is checked in a browser) ----

/** Which page of the table each panel last painted: a repaint of the same
 *  page keeps the scroll position, another page starts at the top. */
const shownPage = new WeakMap<HTMLElement, number>();

/** The scroll box's offsets now, or null when no table is on screen. */
function scrollOf(el: HTMLElement): { left: number; top: number } | null {
  const box = el.querySelector<HTMLElement>(".qb-et-scroll");
  return box ? { left: box.scrollLeft, top: box.scrollTop } : null;
}

/** Put the new scroll box where `scrollAfterRepaint` says. paint() has
 *  replaced the old box, so without this every repaint would jump to the top left. */
function restoreScroll(
  el: HTMLElement,
  before: { left: number; top: number } | null,
  samePage: boolean,
): void {
  const box = el.querySelector<HTMLElement>(".qb-et-scroll");
  if (!box) return;
  const { left, top } = scrollAfterRepaint(before, samePage);
  box.scrollLeft = left;
  box.scrollTop = top;
}

export function renderDataPreview(el: HTMLElement, state: AppState): void {
  const p = state.preview;

  // This panel never shows anything that does not belong to the query on
  // screen, and it says WHY it is empty (docs/ARCHITECTURE.md, "Correctness
  // invariant").
  const blocker = runBlocker(state);
  if (blocker === "loading") {
    paint(el, "");
    return;
  }
  if (blocker) {
    const message = blockedText(blocker, state, BLOCKED_MESSAGES);
    paint(el, card(runBlock({ message, enabled: false })));
    return;
  }
  // app.ts resets preview to "idle" (changeScope) in the same
  // setState that changes the query, so one run always belongs to one query.
  if (p.status === "idle") {
    paint(
      el,
      card(
        runBlock({
          message: idleMessage(),
          enabled: true,
          note: runNote(state),
        }),
      ),
    );
    return;
  }
  if (p.status === "loading") {
    paint(
      el,
      card(
        `<div class="qb-run"><div class="ui active inline loader"></div><p class="qb-run-msg">Fetching events…</p></div>`,
      ),
    );
    return;
  }
  if (p.status === "error") {
    paint(
      el,
      card(
        `<div class="ui small negative message"><div class="header">Couldn't load events</div><p>${escapeHtml(p.error)}</p></div>
         ${runBlock({ enabled: true, label: "Try again" })}`,
      ),
    );
    return;
  }
  const { events } = p;
  if (events.length === 0) {
    paint(el, card(`<p class="qb-placeholder">No events match this query.</p>`));
    return;
  }
  // One page of the results as a table: columns from the whole sample, so
  // they stay put while paging (docs/ARCHITECTURE.md, "Under the query —
  // `dataPreview.ts` (Matching events)").
  const page = pageOf(events.length, p.page);
  const columns = tableColumns(events, state.facets ?? [], FIRST_COLUMNS);
  // The paging line already says how many results there are, so the title
  // carries no count of its own.
  const before = scrollOf(el);
  paint(el, card(pagingHtml(page) + eventTableHtml(events, columns, page)));
  restoreScroll(el, before, shownPage.get(el) === p.page);
  shownPage.set(el, p.page);
}

/** One delegated listener for the card's buttons: Run / Try again, Previous /
 *  Next, and each result's id. Call once at startup. */
export function wireDataPreview(
  container: HTMLElement,
  hooks: { onRun(): void; onPage(page: number): void; onOpenEvent(id: string): void },
): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    // aria-disabled: the paging buttons at the ends stay focusable (eventTable.ts).
    if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
    const action = btn.dataset.action;
    if (action === "run") hooks.onRun();
    else if (action === "previous-event-page" || action === "next-event-page") {
      hooks.onPage(Number(btn.dataset.page));
    } else if (action === "open-event" && btn.dataset.eventId) {
      hooks.onOpenEvent(btn.dataset.eventId);
    }
  });
}
