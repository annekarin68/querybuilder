import { describe, it, expect } from "vitest";
import { mascotFor } from "../../src/ui/mascot";

const base = {
  issues: [],
  stats: { status: "idle" as const, results: [] },
  preview: { status: "idle" as const },
};

describe("mascotFor", () => {
  it("is neutral by default", () => expect(mascotFor(base)).toBe("neutral"));
  it("is loading while statistics load", () => {
    expect(mascotFor({ ...base, stats: { status: "loading", results: [] } })).toBe("loading");
  });
  it("is loading while the events load", () => {
    expect(mascotFor({ ...base, preview: { status: "loading" } })).toBe("loading");
  });
  it("is disappointed for an invalid query", () => {
    expect(mascotFor({ ...base, issues: [{ nodeId: "c", message: "x", kind: "invalid" }] })).toBe(
      "disappointed",
    );
  });
  it("an unfinished query is not a reason to be sad", () => {
    expect(
      mascotFor({ ...base, issues: [{ nodeId: "c", message: "x", kind: "incomplete" }] }),
    ).toBe("neutral");
  });
});
