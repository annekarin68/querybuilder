import { describe, it, expect } from "vitest";
import { escapeAction, focusAfterRepaint, savedDialogHtml } from "../../src/ui/savedQueries";
import { initialState, type AppState } from "../../src/state";
import type { SavedQuery } from "../../src/model";
import { unfinishedDraft } from "../savedQueryFixtures";

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" };

/** The words on screen: tags dropped, entities read, spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(lt|gt|amp|quot|#39);/g, (_m, name: string) => ENTITIES[name]!)
    .replace(/\s+/g, " ")
    .trim();

const saveDialog = (patch: Partial<AppState> = {}): AppState => ({
  ...initialState,
  savedDialog: "save",
  ...patch,
});

describe("the save dialog", () => {
  it("is a dialog form with a labelled, required Name and an optional Note", () => {
    const html = savedDialogHtml(saveDialog());
    expect(html).toContain('<form method="dialog"');
    expect(html).toMatch(/<h2[^>]*id="qb-saved-title"[^>]*>Save query<\/h2>/);
    expect(html).toMatch(/<label for="qb-save-name">Name<\/label>/);
    expect(html).toMatch(/<input[^>]*id="qb-save-name"[^>]*required[^>]*maxlength="80"/);
    expect(html).toMatch(/<label for="qb-save-note">Note<\/label>/);
    expect(html).toMatch(/<input[^>]*id="qb-save-note"[^>]*maxlength="80"/);
    expect(html).not.toMatch(/<input[^>]*id="qb-save-note"[^>]*required/);
    expect(html).toContain("A few words to recognise it later");
    expect(html).toMatch(/<button type="submit"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button type="button"[^>]*data-action="close-saved-dialog"[^>]*>Cancel/);
  });

  it("is empty for a query that was never saved", () => {
    expect(savedDialogHtml(saveDialog())).toMatch(/id="qb-save-name"[^>]*value=""/);
  });

  // Saving again under the same name updates the open query, and its note
  // would be wiped if the box started empty.
  it("starts with the open saved query's name and note, escaped", () => {
    const html = savedDialogHtml(
      saveDialog({
        openSaved: {
          id: "1",
          name: 'A "b" <c>',
          note: "n&n",
          query: initialState.query,
          databaseIds: [],
        },
      }),
    );
    expect(html).toMatch(/id="qb-save-name"[^>]*value="A &quot;b&quot; &lt;c&gt;"/);
    expect(html).toMatch(/id="qb-save-note"[^>]*value="n&amp;n"/);
  });

  // A repaint (saving, an error) must not throw away what the user typed.
  it("keeps what the user typed over the open query's name", () => {
    const html = savedDialogHtml(
      saveDialog({
        openSaved: { id: "1", name: "Old", note: "", query: initialState.query, databaseIds: [] },
      }),
      { name: "Typed", note: "too" },
    );
    expect(html).toMatch(/id="qb-save-name"[^>]*value="Typed"/);
    expect(html).toMatch(/id="qb-save-note"[^>]*value="too"/);
  });

  it("while saving, Save shows a loader and is disabled", () => {
    const html = savedDialogHtml(saveDialog({ save: { status: "saving" } }));
    expect(html).toMatch(/<button type="submit" class="[^"]*\bloading\b[^"]*"[^>]*disabled/);
  });

  it("shows an error, escaped, in the dialog", () => {
    const html = savedDialogHtml(saveDialog({ save: { status: "error", error: "No <way>" } }));
    expect(html).toContain("ui small negative message");
    expect(html).toContain("No &lt;way&gt;");
    expect(html).toMatch(/<button type="submit"[^>]*>Save<\/button>/);
  });

  it("asks before replacing another saved query of that name, escaped", () => {
    const html = savedDialogHtml(
      saveDialog({ save: { status: "conflict", name: "We<ek>", note: "" } }),
    );
    expect(text(html)).toContain("A saved query called “We<ek>” exists. Replace it?");
    expect(html).toContain("We&lt;ek&gt;");
    expect(html).toMatch(/data-action="confirm-replace"[^>]*>Replace<\/button>/);
    expect(html).toMatch(/data-action="cancel-replace"[^>]*>Cancel<\/button>/);
    // The question is about the name in the box: it cannot change meanwhile.
    expect(html).toMatch(/id="qb-save-name"[^>]*readonly/);
  });
});

const weekly: SavedQuery = {
  id: "sq-1",
  name: "Weekly <check>",
  note: "for the & team",
  databaseIds: ["a", "b", "c"],
  query: initialState.query,
  updatedAt: "2026-10-08T09:30:00.000Z",
};
const other: SavedQuery = { ...weekly, id: "sq-2", name: "Other", note: "", databaseIds: ["a"] };

const listDialog = (patch: Partial<AppState> = {}): AppState => ({
  ...initialState,
  savedDialog: "list",
  savedList: { status: "ok", queries: [weekly, other] },
  ...patch,
});

describe("the saved queries list", () => {
  it("has its own heading", () => {
    expect(savedDialogHtml(listDialog())).toMatch(
      /<h2[^>]*id="qb-saved-title"[^>]*>Saved queries<\/h2>/,
    );
  });

  it.each(["idle", "loading"] as const)("says it is loading (%s)", (status) => {
    const html = savedDialogHtml(listDialog({ savedList: { status } }));
    expect(text(html)).toContain("Loading saved queries…");
  });

  it("says how to save one when there are none", () => {
    const html = savedDialogHtml(listDialog({ savedList: { status: "ok", queries: [] } }));
    expect(text(html)).toContain("No saved queries yet. Build a query and press Save…");
  });

  it("shows an error, escaped, with Try again", () => {
    const html = savedDialogHtml(
      listDialog({ savedList: { status: "error", error: "Down <now>" } }),
    );
    expect(html).toContain("Down &lt;now&gt;");
    expect(html).toMatch(/data-action="retry-saved-list"[^>]*>Try again<\/button>/);
  });

  it("lists name, note, number of databases and date, escaped", () => {
    const html = savedDialogHtml(listDialog());
    expect(html).toContain("Weekly &lt;check&gt;");
    expect(html).toContain("for the &amp; team");
    expect(text(html)).toContain("3 databases");
    expect(text(html)).toContain("1 database");
    expect(html).toContain('<time datetime="2026-10-08T09:30:00.000Z">');
  });

  it("gives every item an Open and a labelled Delete", () => {
    const html = savedDialogHtml(listDialog());
    expect(html).toMatch(/data-action="open-saved" data-id="sq-1"[^>]*>Open<\/button>/);
    expect(html).toMatch(
      /data-action="delete-saved" data-id="sq-1" aria-label="Delete Weekly &lt;check&gt;"[^>]*>Delete<\/button>/,
    );
    expect(html).toMatch(/data-action="open-saved" data-id="sq-2"/);
  });

  it("starts the keyboard at the first Open", () => {
    const html = savedDialogHtml(listDialog());
    expect(html).toMatch(/data-action="open-saved" data-id="sq-1"[^>]*data-initial-focus/);
    expect(html.match(/data-initial-focus/g)).toHaveLength(1);
  });

  // Decided by the maintainers (2026-10-08): queries can be sensitive.
  it("never shows the saved query itself", () => {
    const saved: SavedQuery = { ...unfinishedDraft, id: "sq-1", updatedAt: weekly.updatedAt };
    const html = savedDialogHtml(listDialog({ savedList: { status: "ok", queries: [saved] } }));
    expect(html).toContain("Slow trips");
    // The fixture's facet, field and operator ids, and the summary's words.
    for (const part of ["thing", "size", "between", "present", "Between", "alpha"]) {
      expect(html).not.toContain(part);
    }
  });

  it("asks before opening over unsaved changes, on that item only", () => {
    const html = savedDialogHtml(listDialog({ savedConfirm: { action: "open", id: "sq-1" } }));
    expect(text(html)).toContain("Replace the current query? Its changes are not saved.");
    expect(html).toMatch(/data-action="confirm-saved-action"[^>]*>Replace<\/button>/);
    expect(html).toMatch(/data-action="cancel-saved-action"[^>]*>Cancel<\/button>/);
    expect(html).not.toMatch(/data-action="open-saved" data-id="sq-1"/);
    // The other items stay usable: pressing one replaces the question.
    expect(html).toMatch(/data-action="open-saved" data-id="sq-2"/);
    expect(html).toMatch(/data-action="delete-saved" data-id="sq-2"/);
  });

  it("asks before deleting, naming the query", () => {
    const html = savedDialogHtml(listDialog({ savedConfirm: { action: "delete", id: "sq-1" } }));
    expect(text(html)).toContain("Delete “Weekly <check>”?");
    // Red: it deletes something.
    expect(html).toMatch(
      /class="[^"]*negative[^"]*" data-action="confirm-saved-action"[^>]*>Delete<\/button>/,
    );
    expect(html).toMatch(/data-action="cancel-saved-action"[^>]*>Cancel<\/button>/);
  });

  it("offers a Close button", () => {
    expect(savedDialogHtml(listDialog())).toMatch(
      /data-action="close-saved-dialog"[^>]*>Close<\/button>/,
    );
  });
});

describe("a closed dialog", () => {
  it("is empty", () => {
    expect(savedDialogHtml(initialState)).toBe("");
  });
});

describe("focusAfterRepaint (where the keyboard focus goes)", () => {
  const view = (patch: Partial<AppState>) => ({ ...listDialog(), ...patch });

  it("a dialog that just opened starts at its first control", () => {
    expect(focusAfterRepaint(null, listDialog())).toBe("initial");
    expect(focusAfterRepaint(initialState, saveDialog())).toBe("initial");
  });

  it("a closed dialog leaves the focus alone (the opener gets it back)", () => {
    expect(focusAfterRepaint(listDialog(), initialState)).toBeNull();
  });

  it("a question in the list takes the focus to its yes button", () => {
    expect(
      focusAfterRepaint(listDialog(), view({ savedConfirm: { action: "delete", id: "sq-1" } })),
    ).toEqual({ action: "confirm-saved-action" });
  });

  it("a question moved to another item follows it", () => {
    expect(
      focusAfterRepaint(
        view({ savedConfirm: { action: "delete", id: "sq-1" } }),
        view({ savedConfirm: { action: "open", id: "sq-2" } }),
      ),
    ).toEqual({ action: "confirm-saved-action" });
  });

  it("a cancelled question gives the focus back to the button that asked", () => {
    expect(
      focusAfterRepaint(view({ savedConfirm: { action: "delete", id: "sq-1" } }), listDialog()),
    ).toEqual({ action: "delete-saved", id: "sq-1" });
    expect(
      focusAfterRepaint(view({ savedConfirm: { action: "open", id: "sq-2" } }), listDialog()),
    ).toEqual({ action: "open-saved", id: "sq-2" });
  });

  it("a name clash takes the focus to Replace", () => {
    expect(
      focusAfterRepaint(
        saveDialog({ save: { status: "saving" } }),
        saveDialog({ save: { status: "conflict", name: "x", note: "" } }),
      ),
    ).toEqual({ action: "confirm-replace" });
  });

  it("otherwise leaves it where paint() put it", () => {
    expect(focusAfterRepaint(saveDialog(), saveDialog({ save: { status: "saving" } }))).toBeNull();
  });
});

describe("escapeAction (what Escape does)", () => {
  it("cancels the 'Replace it?' question, keeping the dialog and what was typed", () => {
    expect(escapeAction(saveDialog({ save: { status: "conflict", name: "W", note: "" } }))).toBe(
      "cancel-replace",
    );
  });

  it("cancels a question in the list ('Delete …?' or 'Replace the current query?')", () => {
    expect(escapeAction(listDialog({ savedConfirm: { action: "delete", id: "sq-1" } }))).toBe(
      "cancel-saved-action",
    );
    expect(escapeAction(listDialog({ savedConfirm: { action: "open", id: "sq-1" } }))).toBe(
      "cancel-saved-action",
    );
  });

  it("closes the dialog when no question is showing", () => {
    expect(escapeAction(saveDialog())).toBe("close-saved-dialog");
    expect(escapeAction(saveDialog({ save: { status: "saving" } }))).toBe("close-saved-dialog");
    expect(escapeAction(saveDialog({ save: { status: "error", error: "x" } }))).toBe(
      "close-saved-dialog",
    );
    expect(escapeAction(listDialog())).toBe("close-saved-dialog");
  });
});
