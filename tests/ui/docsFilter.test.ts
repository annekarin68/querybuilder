import { describe, it, expect } from "vitest";
import type { Facet } from "../../src/api/types";
import { groupByTag, matchDocs, tagsOf, UNTAGGED } from "../../src/ui/docsFilter";

function facet(label: string, tags: string[], name: string, fields: string[], group = ""): Facet {
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

const facets = [
  facet("tire_pressure_front_left", ["wheels"], "Tire pressure (front left)", [
    "pressure_psi",
    "tread_depth_mm",
  ]),
  facet("engine_oil_pressure", ["engine", "fluids"], "Engine oil pressure", ["value_kpa"]),
  facet("engine_rpm", ["engine"], "Engine RPM", ["value_rpm", "redline_rpm"]),
  facet(
    "brake_pressure",
    [],
    "Brake pressure",
    ["value_kpa", "pedal_position_percentage"],
    "brakes",
  ),
];

describe("tagsOf", () => {
  it("drops blank and duplicate tags, trimming the rest", () => {
    expect(tagsOf(facet("x", [" engine ", "", "engine", "  "], "X", []))).toEqual(["engine"]);
  });

  it("puts a facet with no usable tags under UNTAGGED", () => {
    expect(tagsOf(facet("x", [], "X", []))).toEqual([UNTAGGED]);
    expect(tagsOf(facet("x", ["", " "], "X", []))).toEqual([UNTAGGED]);
  });
});

describe("groupByTag", () => {
  it("sections by tag, alphabetically, with untagged facets last", () => {
    const sections = groupByTag(facets);
    expect([...sections.keys()]).toEqual(["engine", "fluids", "wheels", UNTAGGED]);
    expect(sections.get("engine")!.map((i) => i.label)).toEqual([
      "engine_oil_pressure",
      "engine_rpm",
    ]);
    expect(sections.get(UNTAGGED)!.map((i) => i.label)).toEqual(["brake_pressure"]);
  });

  it("lists a facet under every one of its tags", () => {
    const sections = groupByTag(facets);
    expect(sections.get("fluids")!.map((i) => i.label)).toEqual(["engine_oil_pressure"]);
  });

  it("ignores the third-party group, blank or not", () => {
    const blank = facet("a", ["engine"], "A", [], "");
    const other = facet("b", ["engine"], "B", [], "powertrain");
    expect([...groupByTag([blank, other]).keys()]).toEqual(["engine"]);
  });

  it("has no UNTAGGED section when every facet is tagged", () => {
    expect(groupByTag(facets.slice(0, 3)).has(UNTAGGED)).toBe(false);
  });
});

describe("matchDocs", () => {
  it("returns null for a blank filter", () => {
    expect(matchDocs(facets, "")).toBeNull();
    expect(matchDocs(facets, "   ")).toBeNull();
  });

  it("matches facet names case-insensitively and counts matches per tag", () => {
    const m = matchDocs(facets, "PRESSURE")!;
    expect([...m.facets].sort()).toEqual([
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
    const m = matchDocs(facets, "redline")!;
    expect([...m.facets]).toEqual(["engine_rpm"]);
    expect(m.groups).toEqual(new Map([["engine", 1]]));
  });

  it("matches a field's display name when the backend supplies one", () => {
    const base = facets[1]!;
    const named = { ...base, fields: [{ ...base.fields[0]!, name: "Oil pressure (kPa)" }] };
    expect([...matchDocs([named], "(kpa)")!.facets]).toEqual(["engine_oil_pressure"]);
  });

  it("counts several matches under the same tag", () => {
    const m = matchDocs(facets, "engine")!;
    expect(m.groups.get("engine")).toBe(2);
  });

  it("returns empty sets when nothing matches", () => {
    const m = matchDocs(facets, "zzz")!;
    expect(m.facets.size).toBe(0);
    expect(m.groups.size).toBe(0);
  });
});
