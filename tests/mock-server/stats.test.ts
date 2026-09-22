import { describe, it, expect } from "vitest";
import { buildStatsLine } from "../../mock-server/evaluate";

describe("buildStatsLine", () => {
  it("builds a successful line from match/total counts", () => {
    expect(buildStatsLine({ label: "alpha", matchCount: 3, totalCount: 10 })).toEqual({
      label: "alpha",
      success: true,
      matchCount: 3,
      totalCount: 10,
      infoMessages: [],
    });
  });

  it("carries through infoMessages on a successful line", () => {
    expect(
      buildStatsLine({ label: "alpha", matchCount: 3, totalCount: 10, infoMessages: ["slow"] }),
    ).toMatchObject({ success: true, infoMessages: ["slow"] });
  });

  it("builds a failure line when fail is given, ignoring matchCount/totalCount", () => {
    const line = buildStatsLine({
      label: "beta",
      matchCount: 999,
      totalCount: 999,
      fail: { validationErrors: ["bad field"], infoMessages: [] },
    });
    expect(line).toEqual({
      label: "beta",
      success: false,
      validationErrors: ["bad field"],
      infoMessages: [],
    });
  });
});
