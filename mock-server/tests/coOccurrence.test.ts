import { describe, it, expect } from "vitest";
import { coOccurrenceOf } from "../coOccurrence";
import { FACET_WITHOUT_CO_OCCURRENCE, INDIVIDUALS } from "../vehicleData";
import type { Entryset } from "../vehicleData";

const event = (id: number, ...facets: string[]): Entryset => ({
  id,
  items: Object.fromEntries(facets.map((f) => [f, { x: 1 }])),
});

describe("coOccurrenceOf", () => {
  const events = [
    event(1, "a", "b"),
    event(2, "a"),
    event(3, "a", "b"),
    event(4, "a"),
    event(5, "c"),
  ];
  const map = coOccurrenceOf(events, ["a", "b", "c", "d"]);

  it("is the share of A's events that also hold B, as text", () => {
    expect(map["a"]!["b"]).toBe("50");
    expect(map["b"]!["a"]).toBe("100");
  });

  it("is 100 for the facet itself and 0 for never seen together", () => {
    expect(map["a"]!["a"]).toBe("100");
    expect(map["a"]!["c"]).toBe("0");
    expect(map["c"]!["a"]).toBe("0");
  });

  it("gives a facet that no event holds zeros, and itself 100", () => {
    expect(map["d"]).toEqual({ a: "0", b: "0", c: "0", d: "100" });
  });

  it("counts events, not occurrences", () => {
    const twice: Entryset = { id: 9, items: { a: [{ x: 1 }, { x: 2 }], b: { x: 1 } } };
    const plain = event(10, "a");
    const counted = coOccurrenceOf([twice, plain], ["a", "b"]);
    expect(counted["a"]!["b"]).toBe("50");
    expect(counted["b"]!["a"]).toBe("100");
  });

  it("is on every individual the mock answers, except the one left out on purpose", () => {
    for (const individual of INDIVIDUALS) {
      if (individual.label === FACET_WITHOUT_CO_OCCURRENCE) {
        expect(individual).not.toHaveProperty("co_occurrence");
      } else {
        expect(Object.keys(individual.co_occurrence ?? {})).toHaveLength(INDIVIDUALS.length);
      }
    }
  });

  it("still names the facet left out in the other facets' maps", () => {
    const other = INDIVIDUALS.find((i) => i.label !== FACET_WITHOUT_CO_OCCURRENCE)!;
    expect(other.co_occurrence).toHaveProperty(FACET_WITHOUT_CO_OCCURRENCE);
  });
});
