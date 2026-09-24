import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

// The wire types are the frontend's own contract (type-only import: erased at
// build time, so the mock still shares no runtime code with src/). The mock
// speaks the backend's vocabulary: the frontend's events and facets are its
// entrysets and individuals.
export type {
  EntrysetResponse as Entryset,
  IndividualResponse as Individual,
} from "../src/api/types";
import type {
  EntrysetResponse as Entryset,
  IndividualResponse as Individual,
} from "../src/api/types";

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

export const INDIVIDUALS: Individual[] = loadIndividuals();
export const ENTRYSETS: Record<string, Entryset> = loadEntrysets();
