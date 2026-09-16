import { describe, it, expect } from "vitest";
import { flattenEntryset } from "../../mock-server/rows";
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
