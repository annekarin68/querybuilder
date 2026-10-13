import type { EventResponse } from "../src/api/types";
import type { Entryset } from "./vehicleData";

/**
 * The GUID the mock gives an event. Made from its numeric id, so it is the
 * same on every run and in every test. The id leads: the panel shows only the
 * first 8 characters, and this way they tell mock rows apart, like the random
 * start of a real GUID. (The real backend reads the id from a metadata
 * individual; the mock data has none, so it makes one up.)
 */
export function eventGuid(id: number): string {
  return `${id.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** An event in the shape POST …/filter/execute answers with. The sample data
 *  holds each individual once, so every item has one occurrence. */
export function toEventResponse(e: Entryset): EventResponse {
  return {
    id: eventGuid(e.id),
    items: Object.entries(e.items).map(([facet_label, values]) => ({
      facet_label,
      values: [values],
    })),
  };
}

/**
 * Up to `cap` items of `items`, picked at random without repeats, in random
 * order: what the backend does for POST …/filter/execute (a random sample, not
 * the first N). A partial Fisher–Yates shuffle: each step swaps a random
 * not-yet-picked item into the next place. `random` is a parameter (like
 * `Math.random`: a number from 0 up to, not including, 1) so a test can pin
 * the outcome. The list passed in is not changed.
 */
export function sampleOf<T>(items: readonly T[], cap: number, random: () => number): T[] {
  const pool = [...items];
  const size = Math.min(cap, pool.length);
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, size);
}
