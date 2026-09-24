import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The API prefix lives in .env and nowhere else (docs/ARCHITECTURE.md, "API
// contract"): client.ts has no fallback, and vite.config.ts stops without it.
describe(".env", () => {
  const env = readFileSync(path.join(__dirname, "..", ".env"), "utf8");

  it("sets VITE_API_BASE: versioned, without a trailing slash", () => {
    expect(env).toMatch(/^VITE_API_BASE=\/api\/v\d+$/m);
  });

  it("sets DEV_BACKEND_URL: the mock's URL, with the port it listens on", () => {
    expect(env).toMatch(/^DEV_BACKEND_URL=http:\/\/localhost:\d+$/m);
  });

  it("is what import.meta.env holds in tests", () => {
    expect(import.meta.env.VITE_API_BASE).toBe("/api/v1");
  });
});
