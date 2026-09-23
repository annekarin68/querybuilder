import { describe, it, expect } from "vitest";
import { isUtcTimestamp } from "../../src/query/dates";
import { MALFORMED, OUT_OF_RANGE, WELL_FORMED } from "../dateCases";

describe("isUtcTimestamp: a full or partial ISO 8601 UTC timestamp", () => {
  it.each(WELL_FORMED)("accepts %s", (v) => {
    expect(isUtcTimestamp(v)).toBe(true);
  });

  it.each(MALFORMED)("rejects %j", (v) => {
    expect(isUtcTimestamp(v)).toBe(false);
  });

  it.each(OUT_OF_RANGE)("rejects %j (no such date or time)", (v) => {
    expect(isUtcTimestamp(v)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isUtcTimestamp(2024)).toBe(false);
    expect(isUtcTimestamp(null)).toBe(false);
  });
});
