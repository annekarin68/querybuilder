import type { AppState, SavedConfirm } from "../state";
import type { SavedQuery } from "../model";
import type { createApp } from "../app";
import { escapeHtml, paint } from "./panel";
import { countLabel, formatDate } from "./format";

/**
 * The **Save…** and **Saved queries** dialogs (docs/ARCHITECTURE.md, "Saved
 * queries — `savedQueries.ts`"). Both are drawn in ONE native `<dialog>` that
 * the shell creates once (`Shell.savedDialog`): `showModal()` keeps the focus
 * inside it, greys out the page and closes on Escape, all without a Fomantic
 * plugin (so without jQuery). Everything the dialogs do happens in app.ts;
 * this file only draws `savedDialog`, `save`, `savedList`, `savedConfirm` and
 * `openSaved` (the save form starts with its name and note).
 */

/** The heading's id: the `<dialog>` in layout.ts is labelled by it. */
export const SAVED_TITLE_ID = "qb-saved-title";

/** The query card button that opens each dialog, by its `data-action`: the
 *  focus goes back to it when the dialog closes. */
const OPENER_ACTION = { save: "open-save-dialog", list: "open-saved-list" } as const;

/** What the user typed in the save form, carried over a repaint. */
export interface TypedDraft {
  name: string;
  note: string;
}

/** A question in the dialog: its text (already escaped) and its two buttons. */
interface Question {
  /** The text's element id: the group is labelled by it. */
  id: string;
  text: string;
  /** The yes button's label and `data-action`; Cancel's `data-action`. */
  yes: string;
  yesAction: string;
  cancelAction: string;
  /** Yes deletes something: a red button rather than the usual green. */
  destructive?: boolean;
}

/** A question with its yes and Cancel, read out as a group when the focus enters it. */
function questionHtml(q: Question): string {
  const colour = q.destructive ? "negative" : "primary";
  return `<div class="qb-dialog-question" role="group" aria-labelledby="${q.id}">
      <p id="${q.id}">${q.text}</p>
      <button type="button" class="ui small ${colour} button" data-action="${q.yesAction}">${q.yes}</button>
      <button type="button" class="ui small basic button" data-action="${q.cancelAction}">Cancel</button>
    </div>`;
}

/**
 * The save form. The boxes start with the open saved query's name and note (a
 * re-save updates it, and an empty note box would wipe its note) unless the
 * user has typed something (`typed`). While saving, or while asking "Replace
 * it?", they are read-only: what is asked about is what is in the box.
 */
function saveFormHtml(state: AppState, typed: TypedDraft | null): string {
  const { save, openSaved } = state;
  const name = typed?.name ?? openSaved?.name ?? "";
  const note = typed?.note ?? openSaved?.note ?? "";
  const saving = save.status === "saving";
  const locked = saving || save.status === "conflict" ? " readonly" : "";
  const error =
    save.status === "error"
      ? `<div class="ui small negative message" role="alert"><p>${escapeHtml(save.error)}</p></div>`
      : "";
  const actions =
    save.status === "conflict"
      ? questionHtml({
          id: "qb-replace-question",
          text: `A saved query called “${escapeHtml(save.name)}” exists. Replace it?`,
          yes: "Replace",
          yesAction: "confirm-replace",
          cancelAction: "cancel-replace",
        })
      : `<div class="qb-dialog-actions">
          <button type="submit" class="ui small primary button${saving ? " loading" : ""}" data-action="save"${saving ? " disabled" : ""}>Save</button>
          <button type="button" class="ui small basic button" data-action="close-saved-dialog">Cancel</button>
        </div>`;
  // `method="dialog"`: should the submit listener ever not run, the browser
  // closes the dialog instead of loading another page.
  return `<form method="dialog" class="ui form" data-save-form>
      <div class="required field">
        <label for="qb-save-name">Name</label>
        <input type="text" id="qb-save-name" name="name" required maxlength="80" autocomplete="off" data-initial-focus value="${escapeHtml(name)}"${locked} />
      </div>
      <div class="field">
        <label for="qb-save-note">Note</label>
        <input type="text" id="qb-save-note" name="note" maxlength="80" autocomplete="off" aria-describedby="qb-save-note-hint" value="${escapeHtml(note)}"${locked} />
        <p class="qb-dialog-hint" id="qb-save-note-hint">A few words to recognise it later</p>
      </div>
      ${error}
      ${actions}
    </form>`;
}

/**
 * One saved query in the list: name, note, how many databases and the date.
 * **Never the query or its summary**: queries can be sensitive (decided by the
 * maintainers, 2026-10-08). The item waiting for a yes (`confirm`) shows the
 * question in place of its buttons; the other items keep theirs, and pressing
 * one of those asks about that item instead. The first item's **Open** is
 * where the keyboard starts (`first`).
 */
function savedItemHtml(q: SavedQuery, confirm: SavedConfirm, first: boolean): string {
  const name = escapeHtml(q.name);
  const id = escapeHtml(q.id);
  const asking = confirm?.id === q.id ? confirm.action : null;
  const actions =
    asking === "open"
      ? questionHtml({
          id: "qb-open-question",
          text: "Replace the current query? Its changes are not saved.",
          yes: "Replace",
          yesAction: "confirm-saved-action",
          cancelAction: "cancel-saved-action",
        })
      : asking === "delete"
        ? questionHtml({
            id: "qb-delete-question",
            text: `Delete “${name}”?`,
            yes: "Delete",
            yesAction: "confirm-saved-action",
            cancelAction: "cancel-saved-action",
            destructive: true,
          })
        : `<div class="qb-saved-actions">
            <button type="button" class="ui mini basic button" data-action="open-saved" data-id="${id}" aria-label="Open ${name}"${first ? " data-initial-focus" : ""}>Open</button>
            <button type="button" class="ui mini basic button" data-action="delete-saved" data-id="${id}" aria-label="Delete ${name}">Delete</button>
          </div>`;
  const note = q.note ? `<p class="qb-saved-note">${escapeHtml(q.note)}</p>` : "";
  return `<li class="qb-saved-item">
      <div class="qb-saved-info">
        <p class="qb-saved-name">${name}</p>
        ${note}
        <p class="qb-saved-meta">${countLabel(q.databaseIds.length, "database")} · <time datetime="${escapeHtml(q.updatedAt)}">${escapeHtml(formatDate(q.updatedAt))}</time></p>
      </div>
      ${actions}
    </li>`;
}

/** A status text that takes the focus when it is all there is (`tabindex="-1"`:
 *  focusable by script, not a Tab stop). */
function statusHtml(text: string): string {
  return `<p class="qb-dialog-status" tabindex="-1" data-initial-focus>${text}</p>`;
}

/** The list, or what to show instead of it. */
function savedListBodyHtml(state: AppState): string {
  const list = state.savedList;
  switch (list.status) {
    // "idle" too: the list dialog is drawn once before its request starts.
    case "idle":
    case "loading":
      return statusHtml(
        `<span class="ui active mini inline loader"></span> Loading saved queries…`,
      );
    case "error":
      return `<div class="ui small negative message" role="alert">
          <div class="header">Could not load saved queries</div>
          <p>${escapeHtml(list.error)}</p>
          <button type="button" class="ui mini basic button" data-action="retry-saved-list" data-initial-focus>Try again</button>
        </div>`;
    case "ok": {
      if (list.queries.length === 0) {
        return statusHtml("No saved queries yet. Build a query and press Save…");
      }
      const items = list.queries
        .map((q, i) => savedItemHtml(q, state.savedConfirm, i === 0))
        .join("");
      return `<ul class="qb-saved-list" aria-labelledby="${SAVED_TITLE_ID}">${items}</ul>`;
    }
  }
}

/** The list dialog's body and its Close button. */
function savedListHtml(state: AppState): string {
  return `${savedListBodyHtml(state)}
    <div class="qb-dialog-actions">
      <button type="button" class="ui small basic button" data-action="close-saved-dialog">Close</button>
    </div>`;
}

/**
 * The open dialog's contents, or "" while it is closed. `typed`: what the user
 * had typed in the save form before this repaint (see `renderSavedDialog`).
 * Every text from the server is escaped.
 */
export function savedDialogHtml(state: AppState, typed: TypedDraft | null = null): string {
  if (state.savedDialog === null) return "";
  const title = state.savedDialog === "save" ? "Save query" : "Saved queries";
  const body = state.savedDialog === "save" ? saveFormHtml(state, typed) : savedListHtml(state);
  return `<h2 class="qb-dialog-title" id="${SAVED_TITLE_ID}">${title}</h2>${body}`;
}

/** The part of the state that decides where the focus goes. */
export type DialogView = Pick<AppState, "savedDialog" | "save" | "savedConfirm">;

/** Where the focus goes after a repaint: the dialog's first control
 *  (`data-initial-focus`), a button by its `data-action` (and `data-id`), or
 *  null to leave it where paint() put it. */
export type FocusTarget = null | "initial" | { action: string; id?: string };

/**
 * Where the keyboard focus goes after the dialog repaints from `before` to
 * `after` (`before` is null on the first paint). paint() keeps the focus on a
 * control that is still there; this moves it on purpose when the dialog opens
 * or a question appears or goes. A question's buttons replace the ones that
 * asked it, so without this the focus would fall to the page.
 */
export function focusAfterRepaint(before: DialogView | null, after: DialogView): FocusTarget {
  if (after.savedDialog === null) return null;
  if (before?.savedDialog !== after.savedDialog) return "initial";
  if (after.save.status === "conflict" && before.save.status !== "conflict") {
    return { action: "confirm-replace" };
  }
  const was = before.savedConfirm;
  const now = after.savedConfirm;
  if (now && (now.id !== was?.id || now.action !== was.action)) {
    return { action: "confirm-saved-action" };
  }
  if (was && !now) {
    return { action: was.action === "open" ? "open-saved" : "delete-saved", id: was.id };
  }
  return null;
}

// ---- The browser part (needs a DOM, so it is checked in a browser) --------

/** What each dialog element showed at its last render: the close listener
 *  and the focus rules compare against it. */
const shown = new WeakMap<HTMLDialogElement, DialogView>();

/** The save form's boxes as the user left them, or null if the form is not on screen. */
function readTyped(dialog: HTMLDialogElement): TypedDraft | null {
  const form = dialog.querySelector<HTMLFormElement>("form[data-save-form]");
  if (!form) return null;
  const value = (name: string) =>
    form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";
  return { name: value("name"), note: value("note") };
}

/** The `data-action` button (with `data-id`, if given) in `scope`. */
function buttonFor(scope: ParentNode, target: { action: string; id?: string }): HTMLElement | null {
  const all = scope.querySelectorAll<HTMLElement>(`[data-action="${target.action}"]`);
  return (
    Array.from(all).find((el) => target.id === undefined || el.dataset.id === target.id) ?? null
  );
}

/** The focused element's `data-action` and `data-id`, if it is a list item's
 *  button: paint() cannot tell one item's Open from another's (they share
 *  their `data-action`), so these are put back here. */
function focusedItemButton(dialog: HTMLDialogElement): { action: string; id: string } | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !dialog.contains(el)) return null;
  const { action, id } = el.dataset;
  return action && id !== undefined ? { action, id } : null;
}

/** Focus the dialog's first control (`data-initial-focus`). Every view marks
 *  one, except a list whose first item is asking a question: then its first
 *  button. */
function focusFirstControl(dialog: HTMLDialogElement): void {
  const first =
    dialog.querySelector<HTMLElement>("[data-initial-focus]") ??
    dialog.querySelector<HTMLElement>("button");
  first?.focus();
}

/**
 * Paint the dialog from the state and open or close it to match
 * `state.savedDialog`. The `<dialog>` itself is never replaced, only its
 * contents (paint()).
 */
export function renderSavedDialog(dialog: HTMLDialogElement, state: AppState): void {
  const before = shown.get(dialog) ?? null;
  const view: DialogView = {
    savedDialog: state.savedDialog,
    save: state.save,
    savedConfirm: state.savedConfirm,
  };
  shown.set(dialog, view);

  if (state.savedDialog === null) {
    // Closed by the state: the close listener sees `shown` say null and does
    // nothing more.
    if (dialog.open) dialog.close();
    paint(dialog, "");
    // The opener may have been repainted since (the query card repaints on
    // every edit, and opening a saved query is one), so it is looked up again.
    if (before?.savedDialog) {
      buttonFor(document, { action: OPENER_ACTION[before.savedDialog] })?.focus();
    }
    return;
  }

  // A repaint of the save form keeps what the user typed. A dialog that just
  // opened has no form yet, so it starts from the open saved query.
  const typed = before?.savedDialog === "save" ? readTyped(dialog) : null;
  const itemButton = focusedItemButton(dialog);
  paint(dialog, savedDialogHtml(state, typed));
  if (!dialog.open) dialog.showModal();

  const target = focusAfterRepaint(before, view) ?? itemButton;
  if (target === "initial") {
    focusFirstControl(dialog);
  } else if (target) {
    buttonFor(dialog, target)?.focus();
  }
  // The control that had the focus is gone (Save turned into a loader, the
  // list finished loading): start again at the dialog's first control rather
  // than leave the focus on nothing.
  const focus = document.activeElement;
  if (!focus || focus === dialog || !dialog.contains(focus)) focusFirstControl(dialog);
}

/** The actions the dialogs call (all in app.ts). */
export type SavedDialogActions = Pick<
  ReturnType<typeof createApp>,
  | "closeSavedDialog"
  | "saveQuery"
  | "confirmReplace"
  | "cancelReplace"
  | "retrySavedList"
  | "askOpenSaved"
  | "askDeleteSaved"
  | "confirmSavedAction"
  | "cancelSavedAction"
>;

/** Delegated listeners on the persistent `<dialog>`. Call once at startup. */
export function wireSavedDialog(dialog: HTMLDialogElement, app: SavedDialogActions): void {
  dialog.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const id = btn?.dataset.id ?? "";
    switch (btn?.dataset.action) {
      case "close-saved-dialog":
        return app.closeSavedDialog();
      case "confirm-replace":
        return app.confirmReplace();
      case "cancel-replace":
        return app.cancelReplace();
      case "retry-saved-list":
        return app.retrySavedList();
      case "open-saved":
        return app.askOpenSaved(id);
      case "delete-saved":
        return app.askDeleteSaved(id);
      case "confirm-saved-action":
        return app.confirmSavedAction();
      case "cancel-saved-action":
        return app.cancelSavedAction();
    }
  });

  // The browser has already checked `required` and `maxlength` when "submit"
  // fires, so a blank or too long name never gets here (app.saveQuery still
  // refuses a name of only spaces).
  dialog.addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = readTyped(dialog);
    if (typed) app.saveQuery(typed.name, typed.note);
  });

  // Escape. The state closes the dialog, not the browser, so the two never
  // disagree.
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    app.closeSavedDialog();
  });

  // A close the state did not ask for (a browser may close the dialog on a
  // second Escape even though "cancel" was prevented): tell the state.
  dialog.addEventListener("close", () => {
    if (!dialog.open && shown.get(dialog)?.savedDialog) app.closeSavedDialog();
  });
}
