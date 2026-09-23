import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbIndexForEntrysetId } from "../../mock-server/databases";

import type {
  EventRecord as Entryset,
  Facet as Individual,
  FacetField as IndividualField,
} from "../../src/api/types";

const dataDir = path.join(__dirname, "../../mock-server/data");

const individualsRaw = JSON.parse(
  readFileSync(path.join(dataDir, "individual.json"), "utf8"),
) as Record<string, Individual>[];
const individualsByLabel = new Map(
  individualsRaw.map((wrapper) => {
    const ind = Object.values(wrapper)[0]!;
    return [ind.label, ind] as const;
  }),
);

const entrysets = JSON.parse(readFileSync(path.join(dataDir, "entrysets.json"), "utf8")) as Record<
  string,
  Entryset
>;

const EXPECTED_DB_INDEX: Record<number, number> = {
  1: 6,
  2: 6,
  3: 0,
  4: 5,
  5: 6,
  6: 0,
  7: 5,
  8: 1,
  9: 0,
  10: 5,
  11: 1,
  12: 4,
  13: 5,
  14: 1,
  15: 4,
  16: 2,
  17: 1,
  18: 4,
  19: 2,
  20: 3,
  21: 3,
};

function typeMatches(field: IndividualField, value: unknown): boolean {
  const declared = field.type || field.format;
  if (declared === "VARCHAR" || declared === "TIMESTAMP") return typeof value === "string";
  if (declared === "BIGINT" || declared === "DOUBLE") return typeof value === "number";
  if (declared === "BOOLEAN") return typeof value === "boolean";
  return false;
}

describe("entrysets.json sample data", () => {
  it("has ids 1 through 21, each present exactly once", () => {
    const ids = Object.values(entrysets)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
  });

  it("every item label used is a real individual.json item", () => {
    for (const entryset of Object.values(entrysets)) {
      for (const individualLabel of Object.keys(entryset.items)) {
        expect(individualsByLabel.has(individualLabel)).toBe(true);
      }
    }
  });

  it("every field used is a real field of its individual, with a matching type", () => {
    for (const entryset of Object.values(entrysets)) {
      for (const [individualLabel, fields] of Object.entries(entryset.items)) {
        const individual = individualsByLabel.get(individualLabel)!;
        const fieldsByLabel = new Map(individual.fields.map((f) => [f.label, f]));
        for (const [fieldLabel, value] of Object.entries(fields)) {
          const fieldDef = fieldsByLabel.get(fieldLabel);
          expect(fieldDef, `${individualLabel}.${fieldLabel} is not a declared field`).toBeTruthy();
          expect(typeMatches(fieldDef!, value)).toBe(true);
        }
      }
    }
  });

  it("every entryset has observation_window and a vehicle_identity.vehicle_type", () => {
    for (const entryset of Object.values(entrysets)) {
      expect(entryset.items.observation_window).toBeTruthy();
      expect(entryset.items.vehicle_identity?.vehicle_type).toBeTruthy();
    }
  });

  it("entrysets 1-21 distribute across databases per the precomputed hash table", () => {
    for (const [idStr, expectedIdx] of Object.entries(EXPECTED_DB_INDEX)) {
      const id = Number(idStr);
      expect(dbIndexForEntrysetId(id)).toBe(expectedIdx);
      expect(entrysets[idStr]?.id).toBe(id);
    }
  });

  it("every one of the 7 databases has at least one sample entryset", () => {
    const dbIndexes = new Set(Object.values(entrysets).map((e) => dbIndexForEntrysetId(e.id)));
    expect(dbIndexes.size).toBe(7);
  });

  it("vehicle_identity.vehicle_type declares values covering every value used in the sample data", () => {
    const vehicleIdentity = individualsByLabel.get("vehicle_identity")!;
    const vehicleType = vehicleIdentity.fields.find((f) => f.label === "vehicle_type") as
      { values?: string[] } | undefined;
    expect(vehicleType?.values?.length).toBeGreaterThan(0);
    const declared = new Set(vehicleType!.values);
    const used = new Set(
      Object.values(entrysets)
        .map((e) => e.items.vehicle_identity?.vehicle_type)
        .filter((v): v is string => typeof v === "string"),
    );
    for (const v of used) expect(declared.has(v)).toBe(true);
  });

  it("every field has cardinality, values, and format after migration", () => {
    for (const ind of individualsByLabel.values()) {
      for (const f of ind.fields) {
        expect(typeof f.cardinality).toBe("number");
        expect(Array.isArray(f.values)).toBe(true);
        expect(typeof f.format).toBe("string");
      }
    }
  });

  it("observation_window.from_timestamp exercises the type-empty/format-fallback path", () => {
    const observationWindow = individualsByLabel.get("observation_window")!;
    const fromTimestamp = observationWindow.fields.find((f) => f.label === "from_timestamp")!;
    expect(fromTimestamp.type).toBe("");
    expect(fromTimestamp.format).toBe("TIMESTAMP");
  });
});
