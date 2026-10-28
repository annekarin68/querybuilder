import { describe, it, expect } from "vitest";
import {
  popoverId,
  popoverPlacement,
  POPOVER_GAP_PX,
  POPOVER_MAX_WIDTH_PX,
} from "../../src/ui/popover";

describe("popoverId", () => {
  it("gives each popover of a block its own id", () => {
    expect(popoverId("f-1", "row")).toBe("popover-f-1-row");
    expect(popoverId("f-1", "seen")).toBe("popover-f-1-seen");
    expect(popoverId("f-1", "merged")).toBe("popover-f-1-merged");
  });
});

describe("popoverPlacement", () => {
  const viewport = { width: 1280, height: 900 };

  it("opens under the button, its right edge under the button's", () => {
    const place = popoverPlacement({ top: 100, bottom: 124, right: 900 }, viewport);
    expect(place).toEqual({
      left: 900 - POPOVER_MAX_WIDTH_PX,
      width: POPOVER_MAX_WIDTH_PX,
      top: 124 + POPOVER_GAP_PX,
      bottom: null,
      maxHeight: 900 - 124 - 2 * POPOVER_GAP_PX,
    });
  });

  it("opens above the button when there is more room above", () => {
    const place = popoverPlacement({ top: 700, bottom: 724, right: 900 }, viewport);
    expect(place.top).toBeNull();
    expect(place.bottom).toBe(900 - 700 + POPOVER_GAP_PX);
    expect(place.maxHeight).toBe(700 - 2 * POPOVER_GAP_PX);
  });

  it("stays inside the window when the button is near its left edge", () => {
    const place = popoverPlacement({ top: 100, bottom: 124, right: 40 }, viewport);
    expect(place.left).toBe(POPOVER_GAP_PX);
  });

  it("narrows to the window at 512 px", () => {
    const place = popoverPlacement(
      { top: 100, bottom: 124, right: 500 },
      { width: 512, height: 700 },
    );
    expect(place.width).toBeLessThanOrEqual(512 - 2 * POPOVER_GAP_PX);
    expect(place.left).toBeGreaterThanOrEqual(POPOVER_GAP_PX);
    expect(place.left + place.width).toBeLessThanOrEqual(512 - POPOVER_GAP_PX);
  });
});
