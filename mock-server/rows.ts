import { ENTRYSETS, occurrencesOf, type Entryset, type Occurrence } from "./vehicleData";
import { databaseIdForEntrysetId } from "./databases";

/** One event as the mock's matcher sees it (evaluate.ts, `eventMatches`). */
export interface MockEvent {
  id: number;
  /** The database it belongs to (databases.ts, by its numeric id only). */
  db: string;
  /** Every occurrence of every facet the event holds. */
  occurrences: Record<string, Occurrence[]>;
}

export function toMockEvent(e: Entryset): MockEvent {
  const occurrences: Record<string, Occurrence[]> = {};
  for (const facet of Object.keys(e.items)) occurrences[facet] = occurrencesOf(e, facet);
  return {
    id: e.id,
    db: String(databaseIdForEntrysetId(e.id)),
    occurrences,
  };
}

/** Every event the mock server has, prepared once at startup. */
export const EVENTS: MockEvent[] = Object.values(ENTRYSETS).map(toMockEvent);
