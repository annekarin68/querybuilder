import { describe, it, expect } from "vitest";
import { buildFieldCatalog } from "../../src/query/fieldCatalog";
import { emptyQuery, newBlock } from "../../src/query/tree";
import { initialState, runBlocker, type AppState } from "../../src/state";
import {
  EVENT_JSON_HINT,
  EVENT_TITLE_ID,
  eventDialogHtml,
  openEventOf,
} from "../../src/ui/eventDialog";

const event = { id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10", values: { a: [{ x: "<b>" }] } };
// Results on screen and Run not blocked: a catalog, a database, one facet
// block and no issues (`runBlocker` is null).
const shown: AppState = {
  ...initialState,
  preview: { status: "ok", events: [event], page: 0 },
  catalog: buildFieldCatalog([]),
  selectedDatabaseIds: ["db"],
  query: { ...emptyQuery(), children: [newBlock("thing")] },
};

describe("openEventOf", () => {
  it("is the open result, or null when none is open or it is gone", () => {
    expect(openEventOf({ ...shown, openEventId: event.id })).toBe(event);
    expect(openEventOf({ ...shown, openEventId: null })).toBeNull();
    expect(openEventOf({ ...initialState, openEventId: event.id })).toBeNull();
  });

  // A late statistics line can reject the query while `preview` is still "ok";
  // the table is then replaced by the blocked message, so no dialog either.
  it("is null while Run is blocked, although the results are still in the state", () => {
    expect(runBlocker(shown)).toBeNull();
    const blocked: AppState = {
      ...shown,
      openEventId: event.id,
      serverIssues: [{ nodeId: "any", message: "A database refused it.", kind: "invalid" }],
    };
    expect(runBlocker(blocked)).toBe("rejected");
    expect(openEventOf(blocked)).toBeNull();
  });
});

describe("eventDialogHtml", () => {
  it("is empty while no event is open", () => {
    expect(eventDialogHtml(null)).toBe("");
  });

  it("titles the dialog with the short id, shows the whole id and the JSON, escaped", () => {
    const html = eventDialogHtml(event);
    expect(html).toContain(
      `<h2 class="qb-dialog-title" id="${EVENT_TITLE_ID}">Event 6f1c2a9e…</h2>`,
    );
    expect(html).toContain(event.id);
    expect(html).toContain(
      '<pre class="qb-event-json" tabindex="0" role="region" aria-label="The event as JSON">',
    );
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  // Issue #97: the JSON is the app's EventRecord, not the server's response.
  it("says the JSON is the app's reading of the event", () => {
    expect(eventDialogHtml(event)).toContain(`<p class="qb-dialog-hint">${EVENT_JSON_HINT}</p>`);
  });

  // The id comes from the backend: it must not be able to add markup.
  it("escapes an id that needs it, in the title and in the line under it", () => {
    const html = eventDialogHtml({ id: '<i>"&id</i>-of-a-result', values: {} });
    const title = /<h2[^>]*>(.*?)<\/h2>/.exec(html)![1]!;
    const hint = /<p class="qb-dialog-hint">(.*?)<\/p>/.exec(html)![1]!;
    expect(title).toBe("Event &lt;i&gt;&quot;&amp;id&lt;…");
    expect(hint).toBe("&lt;i&gt;&quot;&amp;id&lt;/i&gt;-of-a-result");
  });

  it("has a Close button that takes the focus first", () => {
    expect(eventDialogHtml(event)).toContain(
      '<button type="button" class="ui small basic button" data-action="close-event" data-initial-focus>Close</button>',
    );
  });
});
