import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Code, config and the docs cite docs/ARCHITECTURE.md by section title, e.g.
 * `docs/ARCHITECTURE.md, "Correctness invariant"`. Titles, not numbers, so
 * adding a section doesn't break them — and this test makes sure renaming or
 * removing a section doesn't either.
 *
 * Several spellings are accepted because the files differ: a comma after the
 * file name (`docs/ARCHITECTURE.md, "Title"`), the file name in backticks
 * (Markdown), a parenthesised title (`docs/ARCHITECTURE.md ("Title")`) and a
 * title inside a string literal (`\"Title\"`). A citation may also wrap onto
 * the next line behind a `*`, `//` or `#` comment prefix.
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

// Files at the repository root (and the CI workflow) that may cite a section.
// `.env` and CLAUDE.md are listed by hand because `files()` only walks the
// directories above and only knows code and Markdown extensions.
const ROOT_FILES = [
  "README.md",
  "CLAUDE.md",
  ".env",
  ".github/workflows/ci.yml",
  "vite.config.ts",
  "vitest.config.ts",
  "eslint.config.js",
  "index.html",
];

const sources = [
  ...["src", "mock-server", "scripts", "tests"].flatMap((d) => files(path.join(root, d))),
  ...ROOT_FILES.map((f) => path.join(root, f)),
].filter((f) => f !== __filename); // this file's comments quote the pattern itself

/** Every title cited after `docs/ARCHITECTURE.md` (see the spellings above), even when a comment wraps it. */
function citedTitles(text: string): string[] {
  // Fold a line break and its comment prefix (`*`, `//` or `#`) into one space.
  const joined = text.replace(/\s*\n\s*(?:\*|\/\/|#)?\s*/g, " ");
  // After the file name: optional closing backtick, optional comma, optional
  // opening parenthesis, then the quoted title (quotes may be escaped).
  const citation = /docs\/ARCHITECTURE\.md`?,?\s*\(?\\?"([^"\\]+)\\?"/g;
  return [...joined.matchAll(citation)].map((m) => m[1]!);
}

describe("docs/ARCHITECTURE.md section references", () => {
  it("the doc has the sections this test looks for", () => {
    expect(headings.has("Correctness invariant")).toBe(true);
  });

  it("checks the files whose citations used to slip through", () => {
    // If a spelling stops matching, a file silently drops out of the loop
    // below (it has no titles, so it gets no test). Pin the known cases.
    for (const f of ["README.md", ".env"]) {
      expect(citedTitles(readFileSync(path.join(root, f), "utf8")).length).toBeGreaterThan(0);
    }
  });

  for (const file of sources) {
    const titles = citedTitles(readFileSync(file, "utf8"));
    if (titles.length === 0) continue;
    it(`${path.relative(root, file)} cites only sections that exist`, () => {
      expect(titles.filter((t) => !headings.has(t))).toEqual([]);
    });
  }
});
