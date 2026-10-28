import { defineConfig } from "vitest/config";

// Two projects (docs/ARCHITECTURE.md, "Testing and tooling"): `npm test` runs
// "app" only, so CI passes whatever state the mock server is in, even when it
// has been deleted. `npm run test:mock` runs "mock", the mock server's own
// tests, which live inside mock-server/ so that deleting the folder takes them
// along.
export default defineConfig({
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "app", include: ["tests/**/*.test.ts"] } },
      { extends: true, test: { name: "mock", include: ["mock-server/**/*.test.ts"] } },
    ],
  },
});
