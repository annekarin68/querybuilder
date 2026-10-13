import { describe, it, expect } from "vitest";
import { mascotFor } from "../../src/ui/mascot";
import { dbError, failed, ok } from "../statsFixtures";

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

  it("is disappointed when the query matches nothing", () => {
    expect(mascotFor({ ...base, stats: { status: "ok", results: [ok("a", 0), ok("b", 0)] } })).toBe(
      "disappointed",
    );
    expect(mascotFor({ ...base, preview: { status: "ok", events: [], page: 0 } })).toBe(
      "disappointed",
    );
  });

  it("is disappointed when a database failed or found a problem in the query", () => {
    const results = [ok("a", 5), failed("b", dbError(null, "Unreachable."))];
    expect(mascotFor({ ...base, stats: { status: "ok", results } })).toBe("disappointed");
    const rejected = [failed("a", dbError("c1", "Too long."))];
    expect(mascotFor({ ...base, stats: { status: "ok", results: rejected } })).toBe("disappointed");
  });

  it("is disappointed when a request failed", () => {
    expect(mascotFor({ ...base, stats: { status: "error", error: "x" } })).toBe("disappointed");
    expect(mascotFor({ ...base, preview: { status: "error", error: "x" } })).toBe("disappointed");
  });

  it("is neutral when there are matches", () => {
    expect(mascotFor({ ...base, stats: { status: "ok", results: [ok("a", 3)] } })).toBe("neutral");
    expect(
      mascotFor({ ...base, preview: { status: "ok", events: [{ id: "e", values: {} }], page: 0 } }),
    ).toBe("neutral");
  });

  it("is neutral when statistics are ok but no database answered", () => {
    expect(mascotFor({ ...base, stats: { status: "ok", results: [] } })).toBe("neutral");
  });

  it("loading wins over everything", () => {
    expect(
      mascotFor({
        ...base,
        stats: { status: "loading", results: [failed("a")] },
        preview: { status: "error", error: "x" },
      }),
    ).toBe("loading");
  });

  it("Matching events loading wins over a failed statistics request", () => {
    expect(
      mascotFor({
        ...base,
        stats: { status: "error", error: "x" },
        preview: { status: "loading" },
      }),
    ).toBe("loading");
  });

  // Statistics can say "found some" while the query has a red message: the
  // red message still wins.
  it("is disappointed for an invalid query even when statistics found matches", () => {
    expect(
      mascotFor({
        ...base,
        issues: [{ nodeId: "c", message: "x", kind: "invalid" }],
        stats: { status: "ok", results: [ok("a", 3)] },
      }),
    ).toBe("disappointed");
  });
});
