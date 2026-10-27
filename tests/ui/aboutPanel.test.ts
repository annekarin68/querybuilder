import { describe, it, expect } from "vitest";
import {
  ABOUT_PANEL_KEYS,
  aboutPanelHtml,
  aboutTitle,
  type AboutCtx,
} from "../../src/ui/aboutPanel";
import { QUERY_BUILDER_KEYS } from "../../src/ui/queryBuilder";
import { newBlock } from "../../src/query/tree";
import type { Facet } from "../../src/model";

// Made-up facets: src/ never names backend data, and neither do the tests.
const facets: Facet[] = [
  {
    id: "thing",
    name: "Thing <b>",
    number: 1,
    tags: ["shapes"],
    group: "",
    comment: "Our note on things",
    description: "Their note on things",
    eventCount: 4,
    coOccurrence: new Map(),
    fields: [
      {
        id: "size",
        name: "size",
        typeName: "BIGINT",
        comment: "How big",
        description: "",
        values: [],
      },
      { id: "bare", name: "bare", typeName: "VARCHAR", comment: "", description: "", values: [] },
    ],
  },
];
const block = newBlock("thing");
const ctx = (selectedField: AboutCtx["selectedField"]): AboutCtx => ({
  facets,
  totalEvents: 8,
  selectedField,
});

describe("aboutPanelHtml", () => {
  it("shows the facet's details while no field of this block is selected", () => {
    const html = aboutPanelHtml(ctx(null), block);
    expect(html).toContain("About Thing &lt;b&gt;");
    expect(html).toContain("Our note on things");
    expect(html).toContain("Their note on things");
    expect(html).toContain("In 4 events");
    expect(html).not.toContain('data-action="about-facet"');
    // It tells a first-time user how to get a field's details.
    expect(html).toContain("to read about it");
  });

  it("shows the facet when the selected field is in another block", () => {
    const html = aboutPanelHtml(ctx({ blockId: "elsewhere", fieldId: "size" }), block);
    expect(html).toContain("About Thing &lt;b&gt;");
    expect(html).not.toContain("How big");
  });

  it("shows the selected field's details, with a way back to the facet", () => {
    const html = aboutPanelHtml(ctx({ blockId: block.id, fieldId: "size" }), block);
    expect(html).toContain("How big");
    expect(html).toContain("BIGINT");
    expect(html).not.toContain("Our note on things");
    expect(html).toContain(
      '<button type="button" class="ui mini basic button qb-about-back" data-action="about-facet"><span aria-hidden="true">←</span> About Thing &lt;b&gt;</button>',
    );
  });

  it("says so when a field has no description", () => {
    const html = aboutPanelHtml(ctx({ blockId: block.id, fieldId: "bare" }), block);
    expect(html).toContain("No description in the data dictionary.");
  });

  // A stray row (a field the dictionary no longer has) can be selected too.
  it("says so when the dictionary does not know the field or the facet", () => {
    const field = aboutPanelHtml(ctx({ blockId: block.id, fieldId: "gone" }), block);
    expect(field).toContain("gone");
    expect(field).toContain("This field is not in the data dictionary.");
    expect(field).toContain('data-action="about-facet"');
    const odd = newBlock("missing");
    const facet = aboutPanelHtml(ctx(null), odd);
    expect(facet).toContain("About missing");
    expect(facet).toContain("This facet is not in the data dictionary.");
  });

  it("titles the panel with the dictionary's name, or the facet id", () => {
    expect(aboutTitle(ctx(null), block)).toBe("About Thing <b>");
    expect(aboutTitle({ ...ctx(null), facets: null }, block)).toBe("About thing");
  });

  it("waits for the dictionary while it loads", () => {
    const html = aboutPanelHtml({ ...ctx(null), facets: null }, block);
    expect(html).toContain("About thing");
    expect(html).toContain("This facet is not in the data dictionary.");
  });
});

// Selecting a field for About (focusing a row) must never repaint the rows:
// a repaint would close an open dropdown and drop a value being typed. So the
// builder does not listen to `selectedField`; only the About painter does.
describe("who repaints for the selected field", () => {
  it("the builder's painter does not listen to selectedField, but to panelTab", () => {
    expect(QUERY_BUILDER_KEYS).not.toContain("selectedField");
    expect(QUERY_BUILDER_KEYS).toContain("panelTab");
  });

  it("the About painter listens only to selectedField", () => {
    expect(ABOUT_PANEL_KEYS).toEqual(["selectedField"]);
  });
});
