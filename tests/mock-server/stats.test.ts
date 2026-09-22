import { describe, it, expect } from "vitest";
import { buildStatsLine } from "../../mock-server/evaluate";

describe("buildStatsLine", () => {
  it("builds a successful line with matchCount", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3 })).toEqual({
      label: "alpha",
      success: true,
      matchCount: 3,
    });
  });

  it("carries through infoMessages on a successful line", () => {
    expect(
      buildStatsLine({ label: "alpha", matchCount: 3, infoMessages: ["slow"] }),
    ).toEqual({ label: "alpha", success: true, matchCount: 3, infoMessages: ["slow"] });
  });

  it("builds a failure line when fail is given, omitting matchCount entirely", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999, // must be ignored/dropped
      fail: { errorMessages: ["bad field"], infoMessages: [] },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      errorMessages: ["bad field"],
      infoMessages: [],
    });
    expect(line).not.toHaveProperty("matchCount");
  });
});
