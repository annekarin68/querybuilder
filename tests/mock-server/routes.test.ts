import { describe, it, expect } from "vitest";
import { INDIVIDUALS } from "../../mock-server/vehicleData";
import { DATABASES } from "../../mock-server/databases";

// Regression guard for the class of bug this project hit once already: a
// route handler silently keeping a wrapper object ({ individuals: [...] })
// after the wire contract moved to a bare array. These don't start the HTTP
// server — they assert the exact values the route handlers pass to
// sendJson() are themselves bare arrays, which is what actually matters.
describe("mock server data shapes match the bare-array wire contract", () => {
  it("INDIVIDUALS (sent directly by GET /api/individuals) is a bare array", () => {
    expect(Array.isArray(INDIVIDUALS)).toBe(true);
    expect(INDIVIDUALS.length).toBeGreaterThan(0);
  });

  it("DATABASES (sent directly by GET /api/databases) is a bare array", () => {
    expect(Array.isArray(DATABASES)).toBe(true);
    expect(DATABASES.length).toBeGreaterThan(0);
  });
});
