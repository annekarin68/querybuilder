import { describe, it, expect } from "vitest";
import { legendHtml, legendToggleHtml } from "../../src/ui/legendHtml";
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
    for (const label of ["0.01 %", "1 %", "100 %"]) expect(html).toContain(`>${label}</span>`);
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

  // A row without a range: every value it has is too rare for a number,
  // so there is no scale, but the marks still need their keys.
  it("keeps the sentence and the keys without a bar when every value is too rare", () => {
    const rare = legendHtml("Alpha", null, tokens);
    expect(rare).toContain("How often each facet is seen together with <strong>Alpha</strong>");
    expect(rare).toContain("Every value is too small to colour.");
    expect(rare).not.toContain("linear-gradient");
    expect(rare).not.toContain("Log scale");
    for (const kind of ["is-seen", "is-never", "is-own", "is-too-rare"]) {
      expect(rare).toContain(`qb-co-cell ${kind}`);
    }
  });
});

describe("legendToggleHtml", () => {
  const html = legendToggleHtml("popover-f-1-row", "legend", "<p>inside</p>");

  it("is a ? button that opens a native popover by id", () => {
    expect(html).toContain(
      '<button type="button" class="qb-icon-btn qb-legend-btn" data-action="legend" popovertarget="popover-f-1-row" aria-label="Explain the colours" title="Explain the colours">?</button>',
    );
    expect(html).toContain(
      '<div id="popover-f-1-row" popover class="qb-popover qb-legend"><p>inside</p></div>',
    );
  });
});
