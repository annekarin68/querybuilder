import { describe, it, expect } from "vitest";
import { noticeHtml, restoredNoticeHtml, queryTitleHtml } from "../../src/ui/queryBuilder";
import { initialState, type AppState } from "../../src/state";
import { RESTORED_MESSAGE } from "../../src/util/keptQuery";
import { addChild, emptyQuery, newBlock } from "../../src/query/tree";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";

// The query card's own parts. The tree inside it (groups, facet blocks, field
// rows, the footer) is tested in blockHtml.test.ts and fieldRows.test.ts.

describe("drop warning", () => {
  it("renders nothing without a notice", () => {
    expect(noticeHtml(null)).toBe("");
  });
  it("renders a dismissible warning with the text escaped", () => {
    const html = noticeHtml("Couldn't add <x>");
    expect(html).toContain("ui warning message");
    expect(html).toContain("Couldn&#39;t add &lt;x&gt;");
    expect(html).toContain('data-action="dismiss-notice"');
    expect(html).not.toContain('role="status"');
  });
});

describe("Restored notice", () => {
  it("renders nothing when the query was not restored", () => {
    expect(restoredNoticeHtml(false)).toBe("");
  });

  it("says the query was restored and offers Start fresh and a ✕, both real buttons", () => {
    const html = restoredNoticeHtml(true);
    expect(html).toContain(RESTORED_MESSAGE);
    expect(html).toMatch(
      /<button type="button"[^>]*data-action="start-fresh"[^>]*>Start fresh<\/button>/,
    );
    expect(html).toMatch(
      /<button type="button"[^>]*data-action="dismiss-restored"[^>]*aria-label="Dismiss"/,
    );
  });

  // Information, not a problem: it must not look like the drop warning. And no
  // live-region role: the app already says the words through `announce`, and
  // a role would read them twice.
  it("is an information message without a live-region role", () => {
    const html = restoredNoticeHtml(true);
    expect(html).toContain("ui info message");
    expect(html).not.toContain("warning");
    expect(html).not.toMatch(/role="(status|alert)"/);
  });
});

describe("the query card's title", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const query = addChild(root, root.id, newBlock("thing"));
  const loaded: AppState = {
    ...initialState,
    catalog,
    databases: [{ id: "a", name: "A", description: "", owner: "", eventCount: 1 }],
    selectedDatabaseIds: ["a"],
    query,
  };
  const opened = (name: string): AppState => ({
    ...loaded,
    openSaved: { id: "sq-1", name, note: "", query, databaseIds: ["a"] },
  });
  /** The words on screen: tags dropped, spaces collapsed. */
  const text = (html: string) =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  it("says Query and offers Save… and Saved queries", () => {
    const html = queryTitleHtml(loaded);
    expect(text(html)).toBe("Query Save… Saved queries");
    expect(html).toMatch(/<button[^>]*data-action="open-save-dialog"[^>]*>Save…<\/button>/);
    expect(html).toMatch(/<button[^>]*data-action="open-saved-list"[^>]*>Saved queries<\/button>/);
  });

  it("names the open saved query", () => {
    expect(text(queryTitleHtml(opened("Weekly")))).toContain("Query · Weekly");
    expect(queryTitleHtml(opened("Weekly"))).not.toContain("(edited)");
  });

  it("says (edited) once the query differs from what was saved", () => {
    const edited = { ...opened("Weekly"), query: addChild(query, root.id, newBlock("other")) };
    expect(queryTitleHtml(edited)).toContain('<span class="qb-muted">(edited)</span>');
  });

  it("says (edited) once the database selection differs", () => {
    const edited = { ...opened("Weekly"), selectedDatabaseIds: [] };
    expect(queryTitleHtml(edited)).toContain("(edited)");
  });

  it("escapes the name", () => {
    const html = queryTitleHtml(opened("<b>x</b>"));
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  // A logged-out user who presses either button is asked in the saved-queries
  // dialog (savedQueries.ts), so the title row draws no note.
  describe("for a logged-out user", () => {
    const anonymous: AppState = { ...loaded, auth: { status: "anonymous" } };

    it("draws the buttons without any login note: the dialog asks instead", () => {
      const html = queryTitleHtml(anonymous);
      expect(html).toContain('data-action="open-save-dialog"');
      expect(html).not.toContain("log in");
      expect(html).not.toContain("aria-describedby");
    });
  });

  // Opening a saved query before start() has finished would be overwritten by
  // start() (it sets the query and selection when it ends).
  it("draws no buttons until the databases and the field catalog have loaded", () => {
    expect(queryTitleHtml({ ...loaded, databases: null })).not.toContain("<button");
    expect(queryTitleHtml({ ...loaded, catalog: null })).not.toContain("<button");
  });
});
