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

describe("entrysetBadges", () => {
  it("collects distinct tags and groups, most common first", () => {
    expect(
      entrysetBadges(entryset("wheel_speed", "engine_rpm", "engine_oil_pressure"), byLabel),
    ).toEqual({ tags: ["critical", "high_frequency"], groups: ["engine", "tires_wheels"] });
  });

  it("breaks ties alphabetically", () => {
    expect(entrysetBadges(entryset("speeding_event", "engine_rpm"), byLabel)).toEqual({
      tags: ["critical", "high_frequency", "regulatory"],
      groups: ["engine"],
    });
  });

  it("skips metadata items entirely, tags included", () => {
    expect(entrysetBadges(entryset("observation_window", "wheel_speed"), byLabel)).toEqual({
      tags: [],
      groups: ["tires_wheels"],
    });
  });

  it("drops a blank group but keeps that item's tags", () => {
    expect(entrysetBadges(entryset("speeding_event"), byLabel)).toEqual({
      tags: ["regulatory"],
      groups: [],
    });
  });

  it("ignores items the dictionary doesn't know", () => {
    expect(entrysetBadges(entryset("unknown_item"), byLabel)).toEqual({ tags: [], groups: [] });
  });
});
