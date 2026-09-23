import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { INDIVIDUALS } from "../mock-server/vehicleData";
import { DATABASES } from "../mock-server/databases";

/**
 * The mock dataset is fictional, and the real backend's names differ, so the
 * frontend must never name anything from it — deployment-specific names go in
 * src/config.ts, which ships empty. This scans src/ and index.html for every
 * mock facet, database and owner name, and every multi-word (underscored)
 * field, tag and group name. Short single words ("front", "count") are left
 * out: they are ordinary English and would match unrelated code.
 */
const root = path.join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const names = new Set<string>();
for (const ind of INDIVIDUALS) {
  names.add(ind.label);
  for (const s of [ind.group, ...ind.tags, ...ind.fields.map((f) => f.label)]) {
    if (s.includes("_")) names.add(s);
  }
}
for (const db of DATABASES) {
  for (const s of [db.label, db.name, db.owner]) if (s) names.add(s);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("src/ names nothing from the mock dataset", () => {
  const sources = [...files(path.join(root, "src")), path.join(root, "index.html")];
  for (const file of sources) {
    it(path.relative(root, file), () => {
      const body = readFileSync(file, "utf8");
      const found = [...names].filter((n) => new RegExp(`\\b${escape(n)}\\b`, "i").test(body));
      expect(found).toEqual([]);
    });
  }
});
