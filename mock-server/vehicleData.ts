import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

export interface IndividualField {
  label: string;
  type: string;
  description: string;
  comment: string;
}

export interface Individual {
  label: string;
  group: string;
  tags: string[];
  id_number: number;
  name: string;
  description: string;
  comment: string;
  stats: { percentage: number; count: number };
  fields: IndividualField[];
}

export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
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

export const INDIVIDUALS: Individual[] = loadIndividuals();
export const ENTRYSETS: Record<string, Entryset> = loadEntrysets();
