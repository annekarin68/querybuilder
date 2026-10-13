import { describe, it, expect } from "vitest";
import { pathBelow } from "../../mock-server/paths";

describe("pathBelow: the part of a path below the API prefix", () => {
  const api = "/api/v1";

  it("returns what follows the prefix", () => {
    expect(pathBelow("/api/v1/filter/saved", api)).toBe("/filter/saved");
    expect(pathBelow("/api/v1/", api)).toBe("/");
  });

  it("returns an empty path for the prefix itself", () => {
    expect(pathBelow("/api/v1", api)).toBe("");
  });

  // "/api/v10" starts with "/api/v1" but is another prefix: without the "/"
  // boundary its routes were read as "0/…".
  it("is null for a path that only starts with the same letters", () => {
    expect(pathBelow("/api/v10/filter/saved", api)).toBeNull();
    expect(pathBelow("/api/v1x", api)).toBeNull();
  });

  it("is null for a path outside the prefix", () => {
    expect(pathBelow("/elsewhere", api)).toBeNull();
  });
});
