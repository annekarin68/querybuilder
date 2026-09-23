import { describe, it, expect } from "vitest";
import type { EventRecord, Facet } from "../../src/api/types";
import { eventBadges, rowCell, rowGrid } from "../../src/ui/dataPreview";

function facet(label: string, group: string, tags: string[]): Facet {
  return {
    label,
    group,
    tags,
    name: label,
    idNumber: 0,
    description: "",
    comment: "",
    totalCount: 0,
    fields: [],
  };
}

const byLabel = new Map(
  [
    facet("observation_window", "metadata", ["rear", "front"]),
    facet("engine_rpm", "engine", ["high_frequency", "critical"]),
    facet("engine_oil_pressure", "engine", ["critical", " "]),
    facet("wheel_speed", "tires_wheels", []),
    facet("speeding_event", "", ["regulatory"]),
  ].map((i) => [i.label, i]),
);

const event = (...labels: string[]): EventRecord => ({
  id: 1,
  items: Object.fromEntries(labels.map((l) => [l, {}])),
});

const none = { tags: [], groups: [] };

describe("eventBadges", () => {
  it("collects distinct tags and groups, most common first", () => {
    expect(
      eventBadges(event("wheel_speed", "engine_rpm", "engine_oil_pressure"), byLabel, none),
    ).toEqual({ tags: ["critical", "high_frequency"], groups: ["engine", "tires_wheels"] });
  });

  it("breaks ties alphabetically", () => {
    expect(eventBadges(event("speeding_event", "engine_rpm"), byLabel, none)).toEqual({
      tags: ["critical", "high_frequency", "regulatory"],
      groups: ["engine"],
    });
  });

  it("hides listed tags and groups, ignoring case and whitespace, keeping the facet's others", () => {
    const hidden = { tags: [" Critical "], groups: ["METADATA"] };
    expect(eventBadges(event("observation_window", "engine_rpm"), byLabel, hidden)).toEqual({
      tags: ["front", "high_frequency", "rear"],
      groups: ["engine"],
    });
  });

  it("has nothing hard-coded: with no hidden values every group shows", () => {
    expect(eventBadges(event("observation_window"), byLabel, none)).toEqual({
      tags: ["front", "rear"],
      groups: ["metadata"],
    });
  });

  it("drops a blank group but keeps that facet's tags", () => {
    expect(eventBadges(event("speeding_event"), byLabel, none)).toEqual({
      tags: ["regulatory"],
      groups: [],
    });
  });

  it("ignores facets the dictionary doesn't know", () => {
    expect(eventBadges(event("unknown_item"), byLabel, none)).toEqual({
      tags: [],
      groups: [],
    });
  });
});

describe("rowCell", () => {
  const e: EventRecord = {
    id: 7,
    items: { thing: { kind: "alpha", count: 3, on: false, blank: "", at: "not a date" } },
  };

  it("shows the configured facet.field value as text", () => {
    expect(rowCell(e, { heading: "Kind", facet: "thing", field: "kind" })).toBe("alpha");
    expect(rowCell(e, { heading: "N", facet: "thing", field: "count" })).toBe("3");
    expect(rowCell(e, { heading: "On", facet: "thing", field: "on" })).toBe("false");
  });

  it("shows — for a missing facet, field or blank value", () => {
    expect(rowCell(e, { heading: "X", facet: "nope", field: "kind" })).toBe("—");
    expect(rowCell(e, { heading: "X", facet: "thing", field: "nope" })).toBe("—");
    expect(rowCell(e, { heading: "X", facet: "thing", field: "blank" })).toBe("—");
  });

  it("formats datetime columns, passing unparseable values through", () => {
    const at = { heading: "At", facet: "thing", field: "at", format: "datetime" as const };
    expect(rowCell(e, at)).toBe("not a date");
    const iso = { ...e, items: { thing: { at: "2024-11-07T08:15:00Z" } } };
    expect(rowCell(iso, at)).not.toBe("2024-11-07T08:15:00Z");
    expect(rowCell(iso, at)).toMatch(/2024/);
  });
});

describe("rowGrid", () => {
  it("is id, badges, count with no configured columns", () => {
    expect(rowGrid([])).toBe("3rem minmax(0, 1fr) auto");
  });

  it("adds one track per column: fixed for dates, capped for text", () => {
    expect(
      rowGrid([
        { heading: "At", facet: "a", field: "b", format: "datetime" },
        { heading: "Kind", facet: "a", field: "c" },
      ]),
    ).toBe("3rem 12rem minmax(0, 10rem) minmax(0, 1fr) auto");
  });
});
