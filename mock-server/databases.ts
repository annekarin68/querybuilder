export interface DatabaseDef {
  label: string;
  name: string;
  /**
   * Mock-only: the pretend real size of this database. Spans several orders
   * of magnitude so the stats panel exercises billion-scale formatting, the
   * same way the old plant-species catalog's sizes did. Not sent on
   * GET /api/databases.
   */
  size: number;
}

/**
 * Seven arbitrary, content-agnostic partitions — database identity carries
 * no meaning tied to entryset content (product decision: "the database
 * names do not really matter"). Sizes are hand-picked constants spanning
 * ~12K to ~5.6B, mirroring the old catalog's spread.
 */
export const DATABASES: DatabaseDef[] = [
  { label: "alpha", name: "ALPHA", size: 12_345 },
  { label: "beta", name: "BETA", size: 88_000 },
  { label: "gamma", name: "GAMMA", size: 4_600_000 },
  { label: "delta", name: "DELTA", size: 41_000_000 },
  { label: "epsilon", name: "EPSILON", size: 892_000_000 },
  { label: "zeta", name: "ZETA", size: 1_234_000_000 },
  { label: "eta", name: "ETA", size: 5_600_000_000 },
];

/**
 * Deterministic partition of an entryset into one of the 7 databases, keyed
 * ONLY by its numeric id — never by anything inside its `items`. This is
 * the decoupling move: a production entryset of the same general shape but
 * completely different field content still partitions correctly, because
 * nothing here looks inside the entryset at all.
 */
export function dbIndexForEntrysetId(entrysetId: number): number {
  return Math.abs(Math.imul(entrysetId, 2654435761)) % DATABASES.length;
}

export function databaseIdForEntrysetId(entrysetId: number): string {
  return DATABASES[dbIndexForEntrysetId(entrysetId)]!.label;
}
