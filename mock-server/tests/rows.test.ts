import { describe, it, expect } from "vitest";
import { toMockEvent } from "../rows";
import { databaseIdForEntrysetId } from "../databases";

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
