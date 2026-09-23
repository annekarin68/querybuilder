export interface DatabaseDef {
  /** A short summary of what this database contains or what makes it unique. */
  description: string;
  /** User-friendly display name. */
  name: string;
  /** The title of this database's owner — the company that reported the data. */
  owner: string;
  /** Mock-only pretend real size. Spans several orders of magnitude so the
   *  stats panel exercises billion-scale formatting. */
  totalEntrysets: number;
  /** This database's share of the combined totalEntrysets across all 7 —
   *  computed below so the set always sums to ~100%. */
  percentageOfTotal: number;
  /** API-friendly "ID", not meant to be displayed. */
  label: string;
}

interface DatabaseSeed {
  label: string;
  name: string;
  description: string;
  owner: string;
  totalEntrysets: number;
}

/**
 * Seven arbitrary, content-agnostic partitions — database identity carries
 * no meaning tied to entryset content (product decision: "the database
 * names do not really matter"). totalEntrysets values are hand-picked
 * constants spanning ~12K to ~5.6B, mirroring the old catalog's spread.
 */
const SEEDS: DatabaseSeed[] = [
  {
    label: "alpha",
    name: "ALPHA",
    description: "A small pilot fleet, recently onboarded.",
    owner: "Alpha Fleet Analytics",
    totalEntrysets: 12_345,
  },
  {
    label: "beta",
    name: "BETA",
    description: "Regional delivery and rideshare vehicles.",
    owner: "Beta Mobility Group",
    totalEntrysets: 88_000,
  },
  {
    label: "gamma",
    name: "GAMMA",
    description: "Municipal and emergency service vehicles.",
    owner: "Gamma Civic Systems",
    totalEntrysets: 4_600_000,
  },
  {
    label: "delta",
    name: "DELTA",
    description: "Long-haul freight and heavy trucking.",
    owner: "Delta Freight Networks",
    totalEntrysets: 41_000_000,
  },
  {
    label: "epsilon",
    name: "EPSILON",
    description: "National rental and leasing fleets.",
    owner: "Epsilon Rental Holdings",
    totalEntrysets: 892_000_000,
  },
  {
    label: "zeta",
    name: "ZETA",
    description: "Large-scale rideshare and taxi telemetry.",
    owner: "Zeta Rideshare Inc.",
    totalEntrysets: 1_234_000_000,
  },
  {
    label: "eta",
    name: "ETA",
    description: "The largest partner: nationwide logistics and transit.",
    owner: "Eta Logistics & Transit Co.",
    totalEntrysets: 5_600_000_000,
  },
];

const TOTAL_ENTRYSETS = SEEDS.reduce((s, d) => s + d.totalEntrysets, 0);

export const DATABASES: DatabaseDef[] = SEEDS.map((s) => ({
  ...s,
  percentageOfTotal: (s.totalEntrysets / TOTAL_ENTRYSETS) * 100,
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
