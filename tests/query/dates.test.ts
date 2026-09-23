import { describe, it, expect } from "vitest";
import { isUtcTimestamp } from "../../src/query/dates";

describe("isUtcTimestamp: a full or partial ISO 8601 UTC timestamp", () => {
  it.each([
    "2024",
    "2024-11",
    "2024-11-06",
    "2024-11-06T14",
    "2024-11-06T14Z",
    "2024-11-06T14:32",
    "2024-11-06T14:32Z",
    "2024-11-06T14:32:05",
    "2024-11-06T14:32:05Z",
    "2024-11-06T14:32:05.1Z",
    "2024-11-06T14:32:05.123Z",
    "2024-02-29",
    "2024-12-31T23:59:59.999Z",
  ])("accepts %s", (v) => {
    expect(isUtcTimestamp(v)).toBe(true);
  });

  it.each([
    "",
    "24",
    "2024-1",
    "2024-13",
    "2024-00",
    "2023-02-29",
    "2024-11-31",
    "2024-11-06T",
    "2024-11-06T24",
    "2024-11-06T14:60",
    "2024-11-06T14:32:60",
    "2024-11-06T14:32:05.1234Z",
    "2024-11-06Z",
    "2024-11-06T14:32+02:00",
    "2024-11-06 14:32",
    " 2024-11-06",
    "06/11/2024",
  ])("rejects %j", (v) => {
    expect(isUtcTimestamp(v)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isUtcTimestamp(2024)).toBe(false);
    expect(isUtcTimestamp(null)).toBe(false);
  });
});
