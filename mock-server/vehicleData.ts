import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { coOccurrenceOf } from "./coOccurrence";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

// The wire types are the frontend's own contract (type-only import: erased at
// build time, so the mock still shares no runtime code with src/). The mock
// speaks the backend's vocabulary: the frontend's events and facets are its
// entrysets and individuals.
export type { IndividualResponse as Individual } from "../src/api/types";
import type { IndividualResponse as Individual } from "../src/api/types";

/** One occurrence of a facet in an event: its fields' values. */
export type Occurrence = Record<string, string | number | boolean>;

/** One event as stored in data/entrysets.json: the mock's own format. A facet
 *  that occurs more than once in the event is stored as a list. The API
 *  answers with `EventResponse` (src/api/types.ts), built by `toEventResponse`
 *  (events.ts). */
export interface Entryset {
  id: number;
  items: Record<string, Occurrence | Occurrence[]>;
}

/** A facet's occurrences in an event: none, one, or several. */
export function occurrencesOf(e: Entryset, facetLabel: string): Occurrence[] {
  const stored = e.items[facetLabel];
  if (stored === undefined) return [];
  return Array.isArray(stored) ? stored : [stored];
}

function loadIndividuals(): Individual[] {
  const raw = JSON.parse(readFileSync(path.join(dataDir, "individual.json"), "utf8")) as Record<
    string,
    Individual
  >[];
  return raw.map((wrapper) => Object.values(wrapper)[0]!);
}

function loadEntrysets(): Record<string, Entryset> {
  return JSON.parse(readFileSync(path.join(dataDir, "entrysets.json"), "utf8")) as Record<
    string,
    Entryset
  >;
}

export const ENTRYSETS: Record<string, Entryset> = loadEntrysets();

/** The individuals, each answering with the co-occurrence worked out from the sample events. */
function withCoOccurrence(individuals: Individual[]): Individual[] {
  const table = coOccurrenceOf(
    Object.values(ENTRYSETS),
    individuals.map((i) => i.label),
  );
  return individuals.map((i) => ({ ...i, co_occurrence: table[i.label]! }));
}

export const INDIVIDUALS: Individual[] = withCoOccurrence(loadIndividuals());
