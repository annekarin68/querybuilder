import { describe, it, expect } from "vitest";
import type { EventRecord, Facet } from "../../src/model";
import { eventBadges, fieldValues, rowCell, rowGrid, shortId } from "../../src/ui/dataPreview";

function facet(id: string, group: string, tags: string[]): Facet {
  return {
    id,
    name: id,
    tags,
    group,
    comment: "",
    description: "",
    eventCount: 0,
    fields: [],
  };
}

const byId = new Map(
  [
    facet("observation_window", "metadata", ["rear", "front"]),
    facet("engine_rpm", "engine", ["high_frequency", "critical"]),
    facet("engine_oil_pressure", "engine", ["critical"]),
    facet("wheel_speed", "tires_wheels", []),
    facet("speeding_event", "", ["regulatory"]),
  ].map((f) => [f.id, f]),
);

const event = (...facetIds: string[]): EventRecord => ({
  id: "e-1",
  values: Object.fromEntries(facetIds.map((id) => [id, [{}]])),
});

const none = { tags: [], groups: [] };

describe("eventBadges", () => {
  it("collects distinct tags and groups, most common first", () => {
    expect(
      eventBadges(event("wheel_speed", "engine_rpm", "engine_oil_pressure"), byId, none),
    ).toEqual({ tags: ["critical", "high_frequency"], groups: ["engine", "tires_wheels"] });
  });

  it("breaks ties alphabetically", () => {
    expect(eventBadges(event("speeding_event", "engine_rpm"), byId, none)).toEqual({
      tags: ["critical", "high_frequency", "regulatory"],
      groups: ["engine"],
    });
  });

  it("hides listed tags and groups, ignoring case and whitespace, keeping the facet's others", () => {
    const hidden = { tags: [" Critical "], groups: ["METADATA"] };
    expect(eventBadges(event("observation_window", "engine_rpm"), byId, hidden)).toEqual({
      tags: ["front", "high_frequency", "rear"],
      groups: ["engine"],
    });
  });

  it("has nothing hard-coded: with no hidden values every group shows", () => {
    expect(eventBadges(event("observation_window"), byId, none)).toEqual({
      tags: ["front", "rear"],
      groups: ["metadata"],
    });
  });

  it("shows no group badge for a facet without a group, but keeps its tags", () => {
    expect(eventBadges(event("speeding_event"), byId, none)).toEqual({
      tags: ["regulatory"],
      groups: [],
    });
  });

  it("ignores facets the dictionary doesn't know", () => {
    expect(eventBadges(event("unknown_item"), byId, none)).toEqual({
      tags: [],
      groups: [],
    });
  });
});

describe("rowCell", () => {
  const e: EventRecord = {
    id: "e-7",
    values: { thing: [{ kind: "alpha", count: 3, on: false, blank: "", at: "not a date" }] },
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

  it("joins the values of several occurrences", () => {
    const twice = { id: "e", values: { thing: [{ kind: "a" }, { kind: "b" }] } };
    expect(rowCell(twice, { heading: "Kind", facet: "thing", field: "kind" })).toBe("a, b");
  });

  it("formats datetime columns, passing unparseable values through", () => {
    const at = { heading: "At", facet: "thing", field: "at", format: "datetime" as const };
    expect(rowCell(e, at)).toBe("not a date");
    const iso = { ...e, values: { thing: [{ at: "2024-11-07T08:15:00Z" }] } };
    expect(rowCell(iso, at)).not.toBe("2024-11-07T08:15:00Z");
    expect(rowCell(iso, at)).toMatch(/2024/);
  });
});

describe("fieldValues", () => {
  const event: EventRecord = {
    id: "e",
    values: { thing: [{ size: 5, color: "red" }, { size: 5 }, { size: 7, color: "" }] },
  };
  it("collects a field's values from every occurrence, without blanks or repeats", () => {
    expect(fieldValues(event, "thing", "size")).toEqual([5, 7]);
    expect(fieldValues(event, "thing", "color")).toEqual(["red"]);
  });
  it("is empty for a facet or field the event lacks", () => {
    expect(fieldValues(event, "other", "size")).toEqual([]);
    expect(fieldValues(event, "thing", "weight")).toEqual([]);
  });
});

describe("shortId", () => {
  it("cuts a GUID to its first 8 characters", () => {
    expect(shortId("6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10")).toBe("6f1c2a9e…");
  });
  it("keeps a short id as it is", () => {
    expect(shortId("e-12")).toBe("e-12");
  });
});

describe("rowGrid", () => {
  it("is id, badges, count with no configured columns", () => {
    expect(rowGrid([])).toBe("6rem minmax(0, 1fr) auto");
  });

  it("adds one track per column: fixed for dates, capped for text", () => {
    expect(
      rowGrid([
        { heading: "At", facet: "a", field: "b", format: "datetime" },
        { heading: "Kind", facet: "a", field: "c" },
      ]),
    ).toBe("6rem 12rem minmax(0, 10rem) minmax(0, 1fr) auto");
  });
});
