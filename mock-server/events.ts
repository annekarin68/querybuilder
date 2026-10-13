import type { EventResponse } from "../src/api/types";
import type { Entryset } from "./vehicleData";

/**
 * The GUID the mock gives an event. Made from its numeric id, so it is the
 * same on every run and in every test. (The real backend reads the id from a
 * metadata individual; the mock data has none, so it makes one up.)
 */
export function eventGuid(id: number): string {
  return `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`;
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
