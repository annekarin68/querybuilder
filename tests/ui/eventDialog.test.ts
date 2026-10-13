import { describe, it, expect } from "vitest";
import { initialState } from "../../src/state";
import { EVENT_TITLE_ID, eventDialogHtml, openEventOf } from "../../src/ui/eventDialog";

const event = { id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10", values: { a: [{ x: "<b>" }] } };
const shown = { ...initialState, preview: { status: "ok" as const, events: [event], page: 0 } };

describe("openEventOf", () => {
  it("is the open result, or null when none is open or it is gone", () => {
    expect(openEventOf({ ...shown, openEventId: event.id })).toBe(event);
    expect(openEventOf({ ...shown, openEventId: null })).toBeNull();
    expect(openEventOf({ ...initialState, openEventId: event.id })).toBeNull();
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
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("has a Close button that takes the focus first", () => {
    expect(eventDialogHtml(event)).toContain(
      '<button type="button" class="ui small basic button" data-action="close-event" data-initial-focus>Close</button>',
    );
  });
});
