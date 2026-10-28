import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// `npm run dev:app` and `npm run build:app` must work whatever state the mock
// server is in (docs/ARCHITECTURE.md, "Testing and tooling"): the mock is a
// dev stand-in, and a mock that has drifted from src/api/types.ts must not
// stop anyone from running or building the app itself.
const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("dev:app and build:app don't depend on the mock server", () => {
  it("dev:app runs Vite alone: no type-check, no mock", () => {
    expect(scripts["dev:app"]).toMatch(/^vite\b/);
    expect(scripts["dev:app"]).not.toMatch(/\btsc\b|mock-server/);
  });

  it("vite.config.ts doesn't import the mock server", () => {
    expect(read("vite.config.ts")).not.toMatch(/from\s+["'][^"']*mock-server/);
  });

  it("build:app type-checks neither the mock server nor the tests", () => {
    expect(scripts["build:app"]).toContain("tsc --noEmit -p tsconfig.app.json");
    const appConfig = JSON.parse(read("tsconfig.app.json")) as { include: string[] };
    expect(appConfig.include).not.toContain("mock-server");
    expect(appConfig.include).not.toContain("tests");
  });
});

// The checks CI runs must pass even with mock-server/ deleted: the mock's own
// tests and type-check are the separate `test:mock` and `typecheck:mock`.
describe("typecheck, test and build work without the mock server", () => {
  it.each(["typecheck", "test", "test:watch", "build", "build:app"])("%s names no mock", (name) => {
    expect(scripts[name]).not.toMatch(/mock/);
  });

  it("tsconfig.json leaves mock-server/ to tsconfig.mock.json", () => {
    expect(read("tsconfig.json")).toMatch(/"include": \[[^\]]*"tests"/);
    expect(read("tsconfig.json")).not.toMatch(/"include": \[[^\]]*mock-server/);
    expect(read("tsconfig.mock.json")).toMatch(/"include": \["mock-server"\]/);
  });

  // tsc follows imports, so one test in tests/ importing the mock would pull
  // mock-server/ back into `typecheck`. Such a test belongs in mock-server/tests/.
  it.each(files(path.join(root, "tests")).map((f) => path.relative(root, f)))(
    "%s doesn't import the mock server",
    (file) => {
      expect(read(file)).not.toMatch(/^import\s[^;]*?from\s+["'][^"']*mock-server/m);
    },
  );
});

describe("src/ is checked as browser code", () => {
  // tsconfig.json gives everything Node's types (the mock server, the tests and
  // vite.config.ts need them). src/ runs in the browser, where `process`,
  // `Buffer` and `node:fs` don't exist, so build:app checks it without them.
  it("tsconfig.app.json covers only src/, with Vite's browser types", () => {
    const appConfig = JSON.parse(read("tsconfig.app.json")) as {
      include: string[];
      compilerOptions?: { types?: string[] };
    };
    expect(appConfig.include).toEqual(["src"]);
    expect(appConfig.compilerOptions?.types).toEqual(["vite/client"]);
  });
});
