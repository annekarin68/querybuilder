import { ENTRYSETS, occurrencesOf, type Entryset, type Occurrence } from "./vehicleData";
import { databaseIdForEntrysetId } from "./databases";
import { rowKey, type Row } from "./evaluate";

/**
 * Flattens one entryset into `rowKey(individualLabel, fieldLabel)` keys plus
 * the synthetic `__db` key (mock-server/databases.ts). Only for the old
 * condition nodes, which the app sends until plan A2: they look at the first
 * occurrence of a facet. Facet blocks use `MockEvent.occurrences`.
 */
export function flattenEntryset(entryset: Entryset): Row {
  const row: Row = { id: entryset.id, __db: databaseIdForEntrysetId(entryset.id) };
  for (const individualLabel of Object.keys(entryset.items)) {
    const [first] = occurrencesOf(entryset, individualLabel);
    for (const [fieldLabel, value] of Object.entries(first ?? {})) {
      row[rowKey(individualLabel, fieldLabel)] = value;
    }
  }
  return row;
}

/** One event as the mock's matcher sees it (evaluate.ts, `eventMatches`). */
export interface MockEvent {
  id: number;
  /** The database it belongs to (databases.ts, by its numeric id only). */
  db: string;
  /** The flattened form the old condition nodes are matched against. */
  row: Row;
  /** Every occurrence of every facet the event holds. */
  occurrences: Record<string, Occurrence[]>;
}

export function toMockEvent(e: Entryset): MockEvent {
  const occurrences: Record<string, Occurrence[]> = {};
  for (const facet of Object.keys(e.items)) occurrences[facet] = occurrencesOf(e, facet);
  return {
    id: e.id,
    db: String(databaseIdForEntrysetId(e.id)),
    row: flattenEntryset(e),
    occurrences,
  };
}

/** Every event the mock server has, prepared once at startup. */
export const EVENTS: MockEvent[] = Object.values(ENTRYSETS).map(toMockEvent);
