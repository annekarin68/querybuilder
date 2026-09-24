import { describe, it, expect } from "vitest";
import { dbIndexForEntrysetId } from "../../mock-server/databases";
import { ENTRYSETS, INDIVIDUALS } from "../../mock-server/vehicleData";
import type { IndividualFieldResponse } from "../../src/api/types";

// The mock's sample data files (mock-server/data/*.json), as loaded by
// vehicleData.ts: individual.json (the facets) and entrysets.json (the events).
// Which database each event lands in is tested in databases.test.ts.

const individualsByLabel = new Map(INDIVIDUALS.map((ind) => [ind.label, ind]));
const entrysets = Object.values(ENTRYSETS);

/** The JavaScript type a value of this field must have, by the field's declared type. */
function expectedJsType(field: IndividualFieldResponse): string {
  const declared = field.type || field.format;
  switch (declared) {
    case "VARCHAR":
    case "TIMESTAMP":
      return "string";
    case "BIGINT":
    case "DOUBLE":
      return "number";
    case "BOOLEAN":
      return "boolean";
    default:
      throw new Error(
        `Field ${field.label} has type "${declared}", which this test doesn't know — add it to expectedJsType.`,
      );
  }
}

describe("entrysets.json sample data", () => {
  it("has ids 1 through 21, each present exactly once, keyed by its own id", () => {
    const ids = entrysets.map((e) => e.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    for (const [key, e] of Object.entries(ENTRYSETS)) expect(e.id).toBe(Number(key));
  });

  it("every facet an event uses is declared in individual.json", () => {
    for (const entryset of entrysets) {
      for (const label of Object.keys(entryset.items)) {
        expect(individualsByLabel.has(label), `entryset ${entryset.id}: ${label}`).toBe(true);
      }
    }
  });

  it("every field an event uses is declared on its facet, with a value of the declared type", () => {
    for (const entryset of entrysets) {
      for (const [label, fields] of Object.entries(entryset.items)) {
        const individual = individualsByLabel.get(label)!;
        const fieldsByLabel = new Map(individual.fields.map((f) => [f.label, f]));
        for (const [fieldLabel, value] of Object.entries(fields)) {
          const where = `entryset ${entryset.id}: ${label}.${fieldLabel}`;
          const field = fieldsByLabel.get(fieldLabel);
          expect(field, `${where} is not a declared field`).toBeTruthy();
          expect(typeof value, where).toBe(expectedJsType(field!));
        }
      }
    }
  });

  it("every event has observation_window and a vehicle_identity.vehicle_type", () => {
    for (const entryset of entrysets) {
      expect(entryset.items.observation_window).toBeTruthy();
      expect(entryset.items.vehicle_identity?.vehicle_type).toBeTruthy();
    }
  });

  it("every one of the 7 databases has at least one sample event", () => {
    const dbIndexes = new Set(entrysets.map((e) => dbIndexForEntrysetId(e.id)));
    expect(dbIndexes.size).toBe(7);
  });
});

describe("individual.json sample data", () => {
  it("vehicle_identity.vehicle_type declares values covering every value used in the events", () => {
    const vehicleType = individualsByLabel
      .get("vehicle_identity")!
      .fields.find((f) => f.label === "vehicle_type");
    expect(vehicleType?.values.length).toBeGreaterThan(0);
    const declared = new Set(vehicleType!.values);
    const used = new Set(
      entrysets
        .map((e) => e.items.vehicle_identity?.vehicle_type)
        .filter((v): v is string => typeof v === "string"),
    );
    for (const v of used) expect(declared.has(v)).toBe(true);
  });

  it("every field has cardinality, values and format", () => {
    for (const ind of INDIVIDUALS) {
      for (const f of ind.fields) {
        expect(typeof f.cardinality).toBe("number");
        expect(Array.isArray(f.values)).toBe(true);
        expect(typeof f.format).toBe("string");
      }
    }
  });

  it("observation_window.from_timestamp exercises the type-empty/format-fallback path", () => {
    const fromTimestamp = individualsByLabel
      .get("observation_window")!
      .fields.find((f) => f.label === "from_timestamp")!;
    expect(fromTimestamp.type).toBe("");
    expect(fromTimestamp.format).toBe("TIMESTAMP");
  });

  it("transmission_gear.current_gear's values are deliberately out of date: an event holds a gear not in them", () => {
    const gear = individualsByLabel
      .get("transmission_gear")!
      .fields.find((f) => f.label === "current_gear")!;
    expect(gear.type).toBe("BIGINT");
    expect(gear.values.length).toBeGreaterThan(0);
    const used = entrysets
      .map((e) => e.items.transmission_gear?.current_gear)
      .filter((v) => v !== undefined)
      .map(String);
    expect(used.some((v) => !gear.values.includes(v))).toBe(true);
  });

  it("transmission_gear.is_in_manual_mode is a BOOLEAN field that lists its values", () => {
    const manual = individualsByLabel
      .get("transmission_gear")!
      .fields.find((f) => f.label === "is_in_manual_mode")!;
    expect(manual.type).toBe("BOOLEAN");
    expect(manual.values).toEqual(["false", "true"]);
  });
});
