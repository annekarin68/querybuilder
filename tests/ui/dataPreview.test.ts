import { describe, it, expect } from "vitest";
import type { Entryset, Individual } from "../../src/api/types";
import { entrysetBadges } from "../../src/ui/dataPreview";

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
