import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dbIndexForEntrysetId } from "../../mock-server/databases";

interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
}
interface Individual {
  label: string;
  fields: IndividualField[];
  [key: string]: unknown;
}
interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}

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

function typeMatches(declared: string, value: unknown): boolean {
  if (declared === "str") return typeof value === "string";
  if (declared === "int" || declared === "float") return typeof value === "number";
  if (declared === "bool") return typeof value === "boolean";
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
          expect(typeMatches(fieldDef!.type, value)).toBe(true);
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
});
