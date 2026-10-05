import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// `npm run dev:app` and `npm run build:app` must work whatever state the mock
// server is in (docs/ARCHITECTURE.md, "Testing and tooling"): the mock is a
// dev stand-in, and a mock that has drifted from src/api/types.ts must not
// stop anyone from running or building the app itself.
const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

describe("dev:app and build:app don't depend on the mock server", () => {
  it("dev:app runs Vite alone: no type-check, no mock", () => {
    expect(scripts["dev:app"]).toMatch(/^vite\b/);
    expect(scripts["dev:app"]).not.toMatch(/\btsc\b|mock-server/);
  });

  it("vite.config.ts doesn't import the mock server", () => {
    expect(read("vite.config.ts")).not.toMatch(/from\s+["'][^"']*mock-server/);
  });

  it("build:app type-checks only what goes into dist/", () => {
    expect(scripts["build:app"]).toMatch(/^tsc --noEmit -p tsconfig\.app\.json && vite build/);
    const appConfig = JSON.parse(read("tsconfig.app.json")) as { include: string[] };
    expect(appConfig.include).toEqual(["src", "vite.config.ts"]);
  });

  it("build:app still runs the offline check, like build", () => {
    expect(scripts["build:app"]).toMatch(/npm run check:offline$/);
  });
});
