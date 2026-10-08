import { describe, it, expect } from "vitest";
import { EASTER_EGG_MASCOT, MASCOT } from "../../src/config";
import { BRAND_HTML, docsToggle, mascotFile } from "../../src/ui/layout";

describe("docsToggle", () => {
  it("while the docs are open, it offers to hide them", () => {
    expect(docsToggle(false)).toEqual({
      icon: "angle double left",
      label: "Hide dictionary",
      title: "Hide the data dictionary",
    });
  });

  it("while the docs are hidden, it offers to show them", () => {
    expect(docsToggle(true)).toEqual({
      icon: "angle double right",
      label: "Show dictionary",
      title: "Show the data dictionary",
    });
  });
});

describe("BRAND_HTML", () => {
  it("the logo cannot be dragged, so a click that moves a few pixels still counts", () => {
    expect(BRAND_HTML).toMatch(/<img class="qb-logo"[^>]*draggable="false"/);
  });
});

describe("mascotFile", () => {
  const none = new Set<string>();

  it("uses the normal set unless the easter egg is on", () => {
    expect(mascotFile("loading", false, none)).toBe(MASCOT.loading);
    expect(mascotFile("loading", true, none)).toBe(EASTER_EGG_MASCOT.loading);
  });

  it("falls back to the same set's neutral face, then to the normal neutral face", () => {
    expect(mascotFile("loading", true, new Set([EASTER_EGG_MASCOT.loading]))).toBe(
      EASTER_EGG_MASCOT.neutral,
    );
    expect(
      mascotFile("loading", true, new Set([EASTER_EGG_MASCOT.loading, EASTER_EGG_MASCOT.neutral])),
    ).toBe(MASCOT.neutral);
    expect(mascotFile("disappointed", false, new Set([MASCOT.disappointed]))).toBe(MASCOT.neutral);
  });

  it("never gives up on the normal neutral face, even if it is marked as failed", () => {
    expect(mascotFile("neutral", false, new Set([MASCOT.neutral]))).toBe(MASCOT.neutral);
  });
});
