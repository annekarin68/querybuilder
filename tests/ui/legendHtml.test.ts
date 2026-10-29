import { describe, it, expect } from "vitest";
import { legendHtml, legendToggleHtml } from "../../src/ui/legendHtml";
import type { CoTokens } from "../../src/ui/coTokens";

// Made-up names: src/ never names backend data, and neither do these tests.
const tokens: CoTokens = {
  stops: ["#eeeeee", "#888888", "#111111"],
  cellBorder: "#777777",
  own: "#886600",
  dotDark: "#000000",
  dotLight: "#ffffff",
};

describe("legendHtml", () => {
  const html = legendHtml("Alpha", tokens, false);

  it("says what is measured, naming the block's facet", () => {
    expect(html).toContain(
      "How often each facet is seen together with <strong>Alpha</strong>: the share of Alpha's events that also hold it.",
    );
  });

  it("escapes the facet's name", () => {
    expect(legendHtml("A<b>", tokens, false)).toContain("A&lt;b&gt;");
    expect(legendHtml("A<b>", tokens, false)).not.toContain("A<b>");
  });

  it("draws the bar through every stop, blended in OKLab where the browser can", () => {
    expect(html).toContain("linear-gradient(to right,#eeeeee 0%,#888888 50%,#111111 100%)");
    expect(html).toContain(
      "linear-gradient(in oklab to right,#eeeeee 0%,#888888 50%,#111111 100%)",
    );
  });

  // Five labels however many stops there are: with 100 stops one label per
  // stop was unreadable (maintainers, 2026-10-29).
  it("labels the bar from 0 % to 100 %, five labels for any number of stops", () => {
    const many = { ...tokens, stops: Array.from({ length: 100 }, () => "#888888") };
    for (const legend of [html, legendHtml("Alpha", many, false)]) {
      const labels = [...legend.matchAll(/<span style="left:[^"]*">([^<]*)<\/span>/g)];
      expect(labels.map((m) => m[1])).toEqual(["0 %", "25 %", "50 %", "75 %", "100 %"]);
    }
    expect(html).toContain(">rarer<");
    expect(html).toContain(">more often<");
  });

  it("says that the scale is linear", () => {
    expect(html).toContain("The colour follows the share evenly, from 0 % to 100 %.");
  });

  it("has a key for each mark", () => {
    expect(html).toContain("qb-co-cell is-seen");
    expect(html).toContain("qb-co-cell is-seen is-full");
    expect(html).toContain("qb-co-cell is-never");
    expect(html).toContain("qb-co-cell is-own");
    for (const words of [
      "Seen together",
      "Seen together in every event (100 %)",
      "Never seen together",
      "Alpha itself",
    ]) {
      expect(html).toContain(`<span>${words}</span>`);
    }
  });

  it("has the toggle for the names above the squares, saying whether it is on", () => {
    expect(html).toContain('data-action="co-names" aria-pressed="false"');
    expect(legendHtml("Alpha", tokens, true)).toContain(
      'data-action="co-names" aria-pressed="true"',
    );
  });

  it("says that a square opens the dictionary", () => {
    expect(html).toContain("Click a square to open that facet in the data dictionary.");
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
