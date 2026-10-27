import { describe, it, expect } from "vitest";
import { flattenEntryset, toMockEvent } from "../../mock-server/rows";
import { databaseIdForEntrysetId } from "../../mock-server/databases";
import type { Entryset } from "../../mock-server/vehicleData";

describe("flattenEntryset", () => {
  it("turns nested items into dotted keys", () => {
    const entryset: Entryset = {
      id: 3,
      items: {
        vehicle_identity: { vin: "ABC123", vehicle_type: "sedan" },
        engine_rpm: { value_rpm: 750 },
      },
    };
    const row = flattenEntryset(entryset);
    expect(row["vehicle_identity.vin"]).toBe("ABC123");
    expect(row["vehicle_identity.vehicle_type"]).toBe("sedan");
    expect(row["engine_rpm.value_rpm"]).toBe(750);
  });

  it("keeps the entryset's id", () => {
    const entryset: Entryset = { id: 7, items: {} };
    expect(flattenEntryset(entryset).id).toBe(7);
  });

  it("attaches __db from databaseIdForEntrysetId(id)", () => {
    const entryset: Entryset = { id: 3, items: {} };
    expect(flattenEntryset(entryset).__db).toBe(databaseIdForEntrysetId(3));
  });
});

describe("flattenEntryset with a facet that occurs twice", () => {
  const entryset: Entryset = { id: 3, items: { thing: [{ size: 1 }, { size: 2 }] } };

  it("keeps the first occurrence, as the old condition nodes read it", () => {
    expect(flattenEntryset(entryset)["thing.size"]).toBe(1);
  });
});

describe("toMockEvent", () => {
  it("keeps every occurrence of every facet, one or several", () => {
    const event = toMockEvent({
      id: 3,
      items: { thing: [{ size: 1 }, { size: 2 }], other: { on: true } },
    });
    expect(event.occurrences).toEqual({ thing: [{ size: 1 }, { size: 2 }], other: [{ on: true }] });
    expect(event.id).toBe(3);
    expect(event.db).toBe(String(databaseIdForEntrysetId(3)));
  });
});
