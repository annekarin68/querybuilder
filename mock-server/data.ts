import { FIELDS } from "./catalog";

type Row = Record<string, string | number | boolean | null>;

const SPECIES = ["fern", "oak", "rose", "cactus", "bamboo"];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const NOTE_WORDS = [
  "healthy",
  "needs water",
  "repotted",
  "pest damage",
  "new growth",
  "leggy",
  "dormant",
];

// Deterministic pseudo-random so tests and the UI are stable across restarts.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export const RECORDS: Row[] = (() => {
  const rand = rng(42);
  const rows: Row[] = [];
  for (let i = 0; i < 200; i++) {
    const missing = rand() < 0.08; // ~8% of some fields are null, so isEmpty/nullCount are meaningful
    rows.push({
      id: i + 1,
      species: SPECIES[Math.floor(rand() * SPECIES.length)]!,
      branches: missing ? null : Math.floor(rand() * 40),
      heightCm: Math.floor(rand() * 300),
      foliage: rand() < 0.7,
      flowering: rand() < 0.5 ? null : MONTHS[Math.floor(rand() * MONTHS.length)]!,
      plantedOn: `20${10 + Math.floor(rand() * 15)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
      notes: NOTE_WORDS[Math.floor(rand() * NOTE_WORDS.length)]!,
    });
  }
  return rows;
})();

// Guard: every field id (except the synthetic "id") exists on every row.
for (const f of FIELDS) {
  if (!(f.id in RECORDS[0]!)) throw new Error(`data.ts is missing column "${f.id}"`);
}
