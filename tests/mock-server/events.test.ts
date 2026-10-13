import { describe, it, expect } from "vitest";
import { eventGuid, sampleOf, toEventResponse } from "../../mock-server/events";

describe("eventGuid", () => {
  it("is a GUID made from the numeric id, the same every time", () => {
    expect(eventGuid(26)).toBe("0000001a-0000-4000-8000-000000000000");
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

describe("sampleOf", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("takes at most `cap` items, all of them from the list and none twice", () => {
    const sample = sampleOf(items, 4, Math.random);
    expect(sample).toHaveLength(4);
    expect(new Set(sample).size).toBe(4);
    for (const item of sample) expect(items).toContain(item);
  });

  it("returns every item when there are no more than `cap`", () => {
    expect([...sampleOf(items, 10, Math.random)].sort((a, b) => a - b)).toEqual(items);
    expect(sampleOf(items, 2000, Math.random)).toHaveLength(items.length);
    expect(sampleOf([], 5, Math.random)).toEqual([]);
  });

  it("picks by the random source it is given, so a test can pin the outcome", () => {
    // A source that always answers 0 picks the first item still in play each
    // time; one that answers just under 1 picks the last.
    expect(sampleOf([1, 2, 3, 4], 2, () => 0)).toEqual([1, 2]);
    expect(sampleOf([1, 2, 3, 4], 2, () => 0.999)).toEqual([4, 1]);
  });

  it("does not change the list it is given", () => {
    const copy = [...items];
    sampleOf(items, 3, Math.random);
    expect(items).toEqual(copy);
  });
});
