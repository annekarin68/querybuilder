import { describe, it, expect } from "vitest";
import { eventGuid, toEventResponse } from "../../mock-server/events";

describe("eventGuid", () => {
  it("is a GUID made from the numeric id, the same every time", () => {
    expect(eventGuid(26)).toBe("00000000-0000-4000-8000-00000000001a");
    expect(eventGuid(26)).toBe(eventGuid(26));
  });
});

describe("toEventResponse", () => {
  it("lists one item per individual, each with one occurrence", () => {
    expect(toEventResponse({ id: 1, items: { thing: { size: 5 }, other: { on: true } } })).toEqual({
      id: eventGuid(1),
      items: [
        { facet_label: "thing", values: [{ size: 5 }] },
        { facet_label: "other", values: [{ on: true }] },
      ],
    });
  });
});
