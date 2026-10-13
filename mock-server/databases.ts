import type { DatabasesResponse } from "../src/api/types";

/** A database as written below; `percentage_of_total` is computed from the sizes. */
type DatabaseSeed = Omit<DatabasesResponse, "percentage_of_total">;

/**
 * Seven arbitrary, content-agnostic partitions — database identity carries
 * no meaning tied to entryset content (product decision: "the database
 * names do not really matter"). total_entrysets values are hand-picked
 * constants spanning ~12K to ~5.6B, so the UI sees realistic magnitudes.
 */
const SEEDS: DatabaseSeed[] = [
  {
    label: "alpha",
    name: "ALPHA",
    description: "A small pilot fleet, recently onboarded.",
    owner: "Alpha Fleet Analytics",
    total_entrysets: 12_345,
  },
  {
    label: "beta",
    name: "BETA",
    description: "Regional delivery and rideshare vehicles.",
    owner: "Beta Mobility Group",
    total_entrysets: 88_000,
  },
  {
    label: "gamma",
    name: "GAMMA",
    description: "Municipal and emergency service vehicles.",
    owner: "Gamma Civic Systems",
    total_entrysets: 4_600_000,
  },
  {
    label: "delta",
    name: "DELTA",
    description: "Long-haul freight and heavy trucking.",
    owner: "Delta Freight Networks",
    total_entrysets: 41_000_000,
  },
  {
    label: "epsilon",
    name: "EPSILON",
    description: "National rental and leasing fleets.",
    owner: "Epsilon Rental Holdings",
    total_entrysets: 892_000_000,
  },
  {
    label: "zeta",
    name: "ZETA",
    description: "Large-scale rideshare and taxi telemetry.",
    owner: "Zeta Rideshare Inc.",
    total_entrysets: 1_234_000_000,
  },
  {
    label: "eta",
    name: "ETA",
    description: "The largest partner: nationwide logistics and transit.",
    owner: "Eta Logistics & Transit Co.",
    total_entrysets: 5_600_000_000,
  },
];

const TOTAL_ENTRYSETS = SEEDS.reduce((s, d) => s + d.total_entrysets, 0);

/** Every field here is the wire contract, so GET /api/documentation/databases sends this as-is. */
export const DATABASES: DatabasesResponse[] = SEEDS.map((s) => ({
  ...s,
  percentage_of_total: (s.total_entrysets / TOTAL_ENTRYSETS) * 100,
}));

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
