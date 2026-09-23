import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Code, config and the README cite docs/ARCHITECTURE.md by section title, e.g.
 * `docs/ARCHITECTURE.md, "Correctness invariant"`. Titles, not numbers, so
 * adding a section doesn't break them — and this test makes sure renaming or
 * removing a section doesn't either.
 */
const root = path.join(__dirname, "..");

const headings = new Set(
  readFileSync(path.join(root, "docs/ARCHITECTURE.md"), "utf8")
    .split("\n")
    .filter((line) => /^#{2,4} /.test(line))
    .map((line) => line.replace(/^#+\s+(\d+\.\s+)?/, "").trim()),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "data" ? [] : files(p);
    return /\.(ts|mjs|js|css|html|md)$/.test(name) ? [p] : [];
  });
}

const sources = [
  ...["src", "mock-server", "scripts", "tests"].flatMap((d) => files(path.join(root, d))),
  ...["README.md", "vite.config.ts", "eslint.config.js", "index.html"].map((f) =>
    path.join(root, f),
  ),
].filter((f) => f !== __filename); // this file's comments quote the pattern itself

/** Every title cited as `docs/ARCHITECTURE.md, "…"`, even when a comment wraps it. */
function citedTitles(text: string): string[] {
  const joined = text.replace(/\s*\n\s*(?:\*|\/\/)?\s*/g, " ");
  return [...joined.matchAll(/docs\/ARCHITECTURE\.md,\s*\\?"([^"\\]+)\\?"/g)].map((m) => m[1]!);
}

describe("docs/ARCHITECTURE.md section references", () => {
  it("the doc has the sections this test looks for", () => {
    expect(headings.has("Correctness invariant")).toBe(true);
  });

  for (const file of sources) {
    const titles = citedTitles(readFileSync(file, "utf8"));
    if (titles.length === 0) continue;
    it(`${path.relative(root, file)} cites only sections that exist`, () => {
      expect(titles.filter((t) => !headings.has(t))).toEqual([]);
    });
  }
});
