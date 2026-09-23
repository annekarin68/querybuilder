import { describe, it, expect } from "vitest";
import type { Entryset, Individual } from "../../src/api/types";
import { entrysetBadges, rowCell, rowGrid } from "../../src/ui/dataPreview";

function ind(label: string, group: string, tags: string[]): Individual {
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
    ind("observation_window", "metadata", ["rear", "front"]),
    ind("engine_rpm", "engine", ["high_frequency", "critical"]),
    ind("engine_oil_pressure", "engine", ["critical", " "]),
    ind("wheel_speed", "tires_wheels", []),
    ind("speeding_event", "", ["regulatory"]),
  ].map((i) => [i.label, i]),
);

const entryset = (...labels: string[]): Entryset => ({
  id: 1,
  items: Object.fromEntries(labels.map((l) => [l, {}])),
});

const none = { tags: [], groups: [] };

describe("entrysetBadges", () => {
  it("collects distinct tags and groups, most common first", () => {
    expect(
      entrysetBadges(entryset("wheel_speed", "engine_rpm", "engine_oil_pressure"), byLabel, none),
    ).toEqual({ tags: ["critical", "high_frequency"], groups: ["engine", "tires_wheels"] });
  });

  it("breaks ties alphabetically", () => {
    expect(entrysetBadges(entryset("speeding_event", "engine_rpm"), byLabel, none)).toEqual({
      tags: ["critical", "high_frequency", "regulatory"],
      groups: ["engine"],
    });
  });

  it("hides listed tags and groups, ignoring case and whitespace, keeping the item's others", () => {
    const hidden = { tags: [" Critical "], groups: ["METADATA"] };
    expect(entrysetBadges(entryset("observation_window", "engine_rpm"), byLabel, hidden)).toEqual({
      tags: ["front", "high_frequency", "rear"],
      groups: ["engine"],
    });
  });

  it("has nothing hard-coded: with no hidden values every group shows", () => {
    expect(entrysetBadges(entryset("observation_window"), byLabel, none)).toEqual({
      tags: ["front", "rear"],
      groups: ["metadata"],
    });
  });

  it("drops a blank group but keeps that item's tags", () => {
    expect(entrysetBadges(entryset("speeding_event"), byLabel, none)).toEqual({
      tags: ["regulatory"],
      groups: [],
    });
  });

  it("ignores items the dictionary doesn't know", () => {
    expect(entrysetBadges(entryset("unknown_item"), byLabel, none)).toEqual({
      tags: [],
      groups: [],
    });
  });
});

describe("rowCell", () => {
  const e: Entryset = {
    id: 7,
    items: { thing: { kind: "alpha", count: 3, on: false, blank: "", at: "not a date" } },
  };

  it("shows the configured item.field value as text", () => {
    expect(rowCell(e, { heading: "Kind", item: "thing", field: "kind" })).toBe("alpha");
    expect(rowCell(e, { heading: "N", item: "thing", field: "count" })).toBe("3");
    expect(rowCell(e, { heading: "On", item: "thing", field: "on" })).toBe("false");
  });

  it("shows — for a missing item, field or blank value", () => {
    expect(rowCell(e, { heading: "X", item: "nope", field: "kind" })).toBe("—");
    expect(rowCell(e, { heading: "X", item: "thing", field: "nope" })).toBe("—");
    expect(rowCell(e, { heading: "X", item: "thing", field: "blank" })).toBe("—");
  });

  it("formats datetime columns, passing unparseable values through", () => {
    const at = { heading: "At", item: "thing", field: "at", format: "datetime" as const };
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
        { heading: "At", item: "a", field: "b", format: "datetime" },
        { heading: "Kind", item: "a", field: "c" },
      ]),
    ).toBe("3rem 12rem minmax(0, 10rem) minmax(0, 1fr) auto");
  });
});
