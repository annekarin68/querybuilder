import { describe, it, expect } from "vitest";
import { labelToShow } from "../../src/ui/coOccurrenceWiring";

// The merged box has two labels, "+ N less often" then "+N"; a facet's box
// has one. The browser measures them; this picks which one stays visible.
describe("labelToShow", () => {
  it("shows the first label that fits", () => {
    expect(labelToShow([true, true])).toBe(0);
    expect(labelToShow([false, true])).toBe(1);
    expect(labelToShow([true])).toBe(0);
  });
  it("shows none when none fits", () => {
    expect(labelToShow([false, false])).toBe(-1);
    expect(labelToShow([])).toBe(-1);
  });
});
