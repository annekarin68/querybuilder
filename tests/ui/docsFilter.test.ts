import { describe, it, expect } from "vitest";
import type { Facet } from "../../src/model";
import { filterStatus, groupByTag, matchDocs, tagsOf, UNTAGGED } from "../../src/ui/docsFilter";

function facet(id: string, tags: string[], name: string, fields: string[], group = ""): Facet {
  return {
    id,
    name,
    tags,
    group,
    comment: "",
    description: "",
    eventCount: 0,
    fields: fields.map((f) => ({
      id: f,
      name: f,
      typeName: "DOUBLE",
      comment: "",
      description: "",
      values: [],
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
  it("is the facet's tags", () => {
    expect(tagsOf(facet("x", ["engine", "fluids"], "X", []))).toEqual(["engine", "fluids"]);
  });

  it("puts a facet with no tags under UNTAGGED", () => {
    expect(tagsOf(facet("x", [], "X", []))).toEqual([UNTAGGED]);
  });
});

describe("groupByTag", () => {
  it("sections by tag, alphabetically, with untagged facets last", () => {
    const sections = groupByTag(facets);
    expect([...sections.keys()]).toEqual(["engine", "fluids", "wheels", UNTAGGED]);
    expect(sections.get("engine")!.map((i) => i.id)).toEqual(["engine_oil_pressure", "engine_rpm"]);
    expect(sections.get(UNTAGGED)!.map((i) => i.id)).toEqual(["brake_pressure"]);
  });

  it("lists a facet under every one of its tags", () => {
    const sections = groupByTag(facets);
    expect(sections.get("fluids")!.map((i) => i.id)).toEqual(["engine_oil_pressure"]);
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

  it("matches field ids", () => {
    const m = matchDocs(facets, "redline")!;
    expect([...m.facets]).toEqual(["engine_rpm"]);
    expect(m.groups).toEqual(new Map([["engine", 1]]));
  });

  it("matches a field's name", () => {
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
    expect(m.openFacets.size).toBe(0);
    expect(m.fields.size).toBe(0);
  });

  it("does not open a facet that matches only by name", () => {
    const nameOnly = matchDocs(facets, "front left")!;
    expect(nameOnly.facets.has("tire_pressure_front_left")).toBe(true);
    expect(nameOnly.openFacets.has("tire_pressure_front_left")).toBe(false);
    expect(nameOnly.fields.size).toBe(0);
  });

  it("opens a facet that matches because of a field, and lists the matching fields", () => {
    const m = matchDocs(facets, "redline")!;
    expect([...m.openFacets]).toEqual(["engine_rpm"]);
    expect(m.fields).toEqual(new Map([["engine_rpm", new Set(["redline_rpm"])]]));
  });

  it("lists every matching field of a facet", () => {
    const m = matchDocs(facets, "_rpm")!;
    expect(m.fields.get("engine_rpm")).toEqual(new Set(["value_rpm", "redline_rpm"]));
  });
});

describe("filterStatus", () => {
  const facetNamed = (id: string, name: string): Facet => ({
    id,
    name,
    tags: [],
    group: "",
    comment: "",
    description: "",
    eventCount: 1,
    fields: [],
  });
  const all = [facetNamed("a", "Alpha"), facetNamed("b", "Alphabet"), facetNamed("c", "Gamma")];

  it("says nothing when nothing is being filtered", () => {
    expect(filterStatus(matchDocs(all, ""), "")).toBe("");
  });

  it("counts the matching facets", () => {
    expect(filterStatus(matchDocs(all, "alpha"), "alpha")).toBe("2 facets match.");
  });

  it("uses the singular for one facet", () => {
    expect(filterStatus(matchDocs(all, "gamma"), "gamma")).toBe("1 facet matches.");
  });

  it("says when nothing matches, quoting what was typed without the padding", () => {
    expect(filterStatus(matchDocs(all, " zzz "), " zzz ")).toBe("No facets match “zzz”.");
  });
});
