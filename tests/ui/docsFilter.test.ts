import { describe, it, expect } from "vitest";
import type { Individual } from "../../src/api/types";
import { groupByTag, matchDocs, tagsOf, UNTAGGED } from "../../src/ui/docsFilter";

function ind(
  label: string,
  tags: string[],
  name: string,
  fields: string[],
  group = "",
): Individual {
  return {
    label,
    group,
    name,
    tags,
    idNumber: 0,
    description: "",
    comment: "",
    totalCount: 0,
    fields: fields.map((f) => ({
      label: f,
      type: "DOUBLE",
      description: "",
      comment: "",
      cardinality: 0,
      values: [],
      format: "",
    })),
  };
}

const items = [
  ind("tire_pressure_front_left", ["wheels"], "Tire pressure (front left)", [
    "pressure_psi",
    "tread_depth_mm",
  ]),
  ind("engine_oil_pressure", ["engine", "fluids"], "Engine oil pressure", ["value_kpa"]),
  ind("engine_rpm", ["engine"], "Engine RPM", ["value_rpm", "redline_rpm"]),
  ind("brake_pressure", [], "Brake pressure", ["value_kpa", "pedal_position_percentage"], "brakes"),
];

describe("tagsOf", () => {
  it("drops blank and duplicate tags, trimming the rest", () => {
    expect(tagsOf(ind("x", [" engine ", "", "engine", "  "], "X", []))).toEqual(["engine"]);
  });

  it("puts an item with no usable tags under UNTAGGED", () => {
    expect(tagsOf(ind("x", [], "X", []))).toEqual([UNTAGGED]);
    expect(tagsOf(ind("x", ["", " "], "X", []))).toEqual([UNTAGGED]);
  });
});

describe("groupByTag", () => {
  it("sections by tag, alphabetically, with untagged items last", () => {
    const sections = groupByTag(items);
    expect([...sections.keys()]).toEqual(["engine", "fluids", "wheels", UNTAGGED]);
    expect(sections.get("engine")!.map((i) => i.label)).toEqual([
      "engine_oil_pressure",
      "engine_rpm",
    ]);
    expect(sections.get(UNTAGGED)!.map((i) => i.label)).toEqual(["brake_pressure"]);
  });

  it("lists an item under every one of its tags", () => {
    const sections = groupByTag(items);
    expect(sections.get("fluids")!.map((i) => i.label)).toEqual(["engine_oil_pressure"]);
  });

  it("ignores the third-party group, blank or not", () => {
    const blank = ind("a", ["engine"], "A", [], "");
    const other = ind("b", ["engine"], "B", [], "powertrain");
    expect([...groupByTag([blank, other]).keys()]).toEqual(["engine"]);
  });

  it("has no UNTAGGED section when every item is tagged", () => {
    expect(groupByTag(items.slice(0, 3)).has(UNTAGGED)).toBe(false);
  });
});

describe("matchDocs", () => {
  it("returns null for a blank filter", () => {
    expect(matchDocs(items, "")).toBeNull();
    expect(matchDocs(items, "   ")).toBeNull();
  });

  it("matches item names case-insensitively and counts matches per tag", () => {
    const m = matchDocs(items, "PRESSURE")!;
    expect([...m.items].sort()).toEqual([
      "brake_pressure",
      "engine_oil_pressure",
      "tire_pressure_front_left",
    ]);
    expect(m.groups).toEqual(
      new Map([
        ["wheels", 1],
        ["engine", 1],
        ["fluids", 1],
        [UNTAGGED, 1],
      ]),
    );
  });

  it("matches field labels", () => {
    const m = matchDocs(items, "redline")!;
    expect([...m.items]).toEqual(["engine_rpm"]);
    expect(m.groups).toEqual(new Map([["engine", 1]]));
  });

  it("matches a field's display name when the backend supplies one", () => {
    const base = items[1]!;
    const named = { ...base, fields: [{ ...base.fields[0]!, name: "Oil pressure (kPa)" }] };
    expect([...matchDocs([named], "(kpa)")!.items]).toEqual(["engine_oil_pressure"]);
  });

  it("counts several matches under the same tag", () => {
    const m = matchDocs(items, "engine")!;
    expect(m.groups.get("engine")).toBe(2);
  });

  it("returns empty sets when nothing matches", () => {
    const m = matchDocs(items, "zzz")!;
    expect(m.items.size).toBe(0);
    expect(m.groups.size).toBe(0);
  });
});
