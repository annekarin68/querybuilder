import { describe, it, expect } from "vitest";
import {
  legendHtml,
  legendId,
  legendPlacement,
  legendToggleHtml,
  LEGEND_GAP_PX,
  LEGEND_MAX_WIDTH_PX,
} from "../../src/ui/legendHtml";
import type { CoTokens } from "../../src/ui/coTokens";

// Made-up names: src/ never names backend data, and neither do these tests.
const tokens: CoTokens = {
  stops: ["#eeeeee", "#888888", "#111111"],
  never: "#dddddd",
  cellBorder: "#777777",
  own: "#886600",
  dotDark: "#000000",
  dotLight: "#ffffff",
};
const range = { min: 0.01, max: 100 };

describe("legendHtml", () => {
  const html = legendHtml("Alpha", range, tokens);

  it("says what is measured, naming the block's facet", () => {
    expect(html).toContain(
      "How often each facet is seen together with <strong>Alpha</strong>: the share of Alpha's events that also hold it.",
    );
  });

  it("escapes the facet's name", () => {
    expect(legendHtml("A<b>", range, tokens)).toContain("A&lt;b&gt;");
    expect(legendHtml("A<b>", range, tokens)).not.toContain("A<b>");
  });

  it("draws the bar through every stop, blended in OKLab where the browser can", () => {
    expect(html).toContain("linear-gradient(to right,#eeeeee 0%,#888888 50%,#111111 100%)");
    expect(html).toContain(
      "linear-gradient(in oklab to right,#eeeeee 0%,#888888 50%,#111111 100%)",
    );
  });

  it("labels each stop with the range's values (legendTicks), and the two ends", () => {
    for (const label of ["1e-2 %", "1 %", "100 %"]) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain(">rarer<");
    expect(html).toContain(">more often<");
  });

  it("says how far apart the steps are", () => {
    expect(html).toContain("Log scale: each step is about 100 times more often.");
  });

  it("leaves the step out when every value is the same (there are no steps)", () => {
    expect(legendHtml("Alpha", { min: 5, max: 5 }, tokens)).not.toContain("Log scale");
  });

  it("has a key for each of the four marks", () => {
    expect(html).toContain("qb-co-cell is-seen");
    expect(html).toContain("qb-co-cell is-never");
    expect(html).toContain("qb-co-cell is-own");
    expect(html).toContain("qb-co-cell is-too-rare");
    for (const words of [
      "Seen together",
      "Never seen together",
      "Alpha itself",
      "Seen together, too rare to colour",
    ]) {
      expect(html).toContain(`<span>${words}</span>`);
    }
  });

  it("says that a square opens the dictionary", () => {
    expect(html).toContain("Click a square to open that facet in the data dictionary.");
  });

  // With no value anywhere there is no scale to explain.
  it("says there is no data when nothing is ever seen together", () => {
    const empty = legendHtml("Alpha", null, tokens);
    expect(empty).toContain("No co-occurrence data for this facet.");
    expect(empty).not.toContain("linear-gradient");
  });

  // Without the colour tokens nothing is known: no claim about the data.
  it("says the colours cannot be shown without tokens", () => {
    const none = legendHtml("Alpha", range, null);
    expect(none).toContain("The colours cannot be shown right now.");
    expect(none).not.toContain("No co-occurrence data");
    expect(none).not.toContain("linear-gradient");
  });
});

describe("legendToggleHtml", () => {
  const html = legendToggleHtml("legend-f-1", "legend", "<p>inside</p>");

  it("is a ? button that opens a native popover by id", () => {
    expect(html).toContain(
      '<button type="button" class="qb-icon-btn qb-legend-btn" data-action="legend" popovertarget="legend-f-1" aria-label="Explain the colours" title="Explain the colours">?</button>',
    );
    expect(html).toContain('<div id="legend-f-1" popover class="qb-legend"><p>inside</p></div>');
  });
});

describe("legendId", () => {
  it("gives the row's and the chart's legend of a block different ids", () => {
    expect(legendId("f-1", "row")).toBe("legend-f-1");
    expect(legendId("f-1", "seen")).toBe("legend-f-1-seen");
  });
});

describe("legendPlacement", () => {
  const viewport = { width: 1280, height: 900 };

  it("opens under the button, its right edge under the button's", () => {
    const place = legendPlacement({ top: 100, bottom: 124, right: 900 }, viewport);
    expect(place).toEqual({
      left: 900 - LEGEND_MAX_WIDTH_PX,
      width: LEGEND_MAX_WIDTH_PX,
      top: 124 + LEGEND_GAP_PX,
      bottom: null,
      maxHeight: 900 - 124 - 2 * LEGEND_GAP_PX,
    });
  });

  it("opens above the button when there is more room above", () => {
    const place = legendPlacement({ top: 700, bottom: 724, right: 900 }, viewport);
    expect(place.top).toBeNull();
    expect(place.bottom).toBe(900 - 700 + LEGEND_GAP_PX);
    expect(place.maxHeight).toBe(700 - 2 * LEGEND_GAP_PX);
  });

  it("stays inside the window when the button is near its left edge", () => {
    const place = legendPlacement({ top: 100, bottom: 124, right: 40 }, viewport);
    expect(place.left).toBe(LEGEND_GAP_PX);
  });

  it("narrows to the window at 512 px", () => {
    const place = legendPlacement(
      { top: 100, bottom: 124, right: 500 },
      { width: 512, height: 700 },
    );
    expect(place.width).toBeLessThanOrEqual(512 - 2 * LEGEND_GAP_PX);
    expect(place.left).toBeGreaterThanOrEqual(LEGEND_GAP_PX);
    expect(place.left + place.width).toBeLessThanOrEqual(512 - LEGEND_GAP_PX);
  });
});
