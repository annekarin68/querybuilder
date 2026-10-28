import { describe, it, expect } from "vitest";
import {
  coCtxOf,
  coRowHtml,
  seenLayout,
  seenTogetherHtml,
  rovingIndex,
  tabStopIndex,
  captionText,
  type CoCtx,
} from "../../src/ui/coOccurrenceHtml";
import { newBlock } from "../../src/query/tree";
import type { CoValue, Facet } from "../../src/model";
import type { CoTokens } from "../../src/ui/coTokens";

// Made-up facets: src/ never names backend data, and neither do these tests.
function co(text: string, tooRare = false): CoValue {
  return { text, percent: tooRare ? 0 : Number(text), tooRare };
}

function facet(id: string, name: string, values: Record<string, CoValue> = {}): Facet {
  return {
    id,
    name,
    number: 0,
    tags: [],
    group: "",
    comment: "",
    description: "",
    eventCount: 0,
    coOccurrence: new Map(Object.entries({ [id]: co("100"), ...values })),
    fields: [],
  };
}

const tokens: CoTokens = {
  stops: ["#eeeeee", "#111111"],
  never: "#dddddd",
  cellBorder: "#777777",
  own: "#886600",
  dotDark: "#000000",
  dotLight: "#ffffff",
};

// Dictionary order: alpha, beta, gamma, delta, lonely. "lonely" is seen with
// nobody, so it is not in the row.
const alpha = facet("a", "Alpha", { b: co("50"), c: co("1e-400", true), d: co("0") });
const beta = facet("b", "Beta", { a: co("5") });
const gamma = facet("c", "Gamma");
const delta = facet("d", "Delta", { b: co("0.5") });
const lonely = facet("l", "Lonely");
const facets = [alpha, beta, gamma, delta, lonely];
const ctx = coCtxOf(facets, tokens) as CoCtx;

/** The attribute values of every element carrying `attribute`, in order. */
function all(html: string, attribute: string): string[] {
  return [...html.matchAll(new RegExp(`${attribute}="([^"]*)"`, "g"))].map((m) =>
    (m[1] as string).replace(/&#39;/g, "'"),
  );
}

describe("coCtxOf", () => {
  it("works out the connected facets and the range once, for every block", () => {
    expect(ctx.connected.map((f) => f.id)).toEqual(["a", "b", "c", "d"]);
    expect(ctx.range).toEqual({ min: 0.5, max: 50 });
  });

  // Display data never blocks the builder: without two colour stops (the
  // CSS did not load) there is simply no row and no chart.
  it("is null without two colour stops", () => {
    expect(coCtxOf(facets, { ...tokens, stops: ["#eeeeee"] })).toBeNull();
  });
});

describe("coRowHtml", () => {
  it("draws one cell per connected facet, in dictionary order, the same in every block", () => {
    const rowA = coRowHtml(ctx, newBlock("a"));
    const rowD = coRowHtml(ctx, newBlock("d"));
    expect(all(rowA, "data-facet-id")).toEqual(["a", "b", "c", "d"]);
    expect(all(rowD, "data-facet-id")).toEqual(["a", "b", "c", "d"]);
  });

  it("names the group after the block's facet", () => {
    expect(coRowHtml(ctx, newBlock("a"))).toContain(
      'role="group" aria-label="Seen together with Alpha"',
    );
  });

  it("gives each kind of cell its name, from the block's own facet's values", () => {
    const names = all(coRowHtml(ctx, newBlock("a")), "aria-label").slice(1);
    expect(names).toEqual([
      "Alpha (this facet)",
      "Beta: 50 % of Alpha's events",
      // The backend's text even when it is too small to colour (spec, section 6).
      "Gamma: 1e-400 % of Alpha's events, too rare to colour",
      "Delta: never seen together",
    ]);
  });

  // The caption shows the name on hover and focus; a title as well would
  // repeat it a second later, over the neighbouring cells.
  it("gives the cells no hover title (the caption shows their name)", () => {
    expect(all(coRowHtml(ctx, newBlock("a")), "title")).toEqual([]);
  });

  it("marks each cell's kind, and colours only the seen ones", () => {
    const html = coRowHtml(ctx, newBlock("a"));
    expect(all(html, "class").filter((c) => c.includes("qb-co-cell"))).toEqual([
      "qb-co-cell is-own",
      "qb-co-cell is-seen",
      "qb-co-cell is-too-rare",
      "qb-co-cell is-never",
    ]);
    // 50 is the top of the range: the last stop, with the light dot on it.
    expect(html).toContain('style="background-color:#111111;color:#ffffff"');
    expect(all(html, "style")).toHaveLength(1);
  });

  it("gives a roving tabindex: the first cell is the row's one tab stop", () => {
    expect(all(coRowHtml(ctx, newBlock("a")), "tabindex")).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("gives every cell the attribute focus memory finds it by", () => {
    expect(all(coRowHtml(ctx, newBlock("a")), "data-co-cell")).toEqual(["a", "b", "c", "d"]);
  });

  it("draws an isolated facet's row as never-seen cells with the row's hover text", () => {
    const html = coRowHtml(ctx, newBlock("l"));
    expect(html).toContain('title="Never seen together with another facet."');
    expect(html).not.toContain("is-own");
    expect(html).not.toContain("is-seen");
    expect(all(html, "data-facet-id")).toEqual(["a", "b", "c", "d"]);
  });

  // The row must agree with the chart, which says "Never seen together…":
  // a facet only other facets name (its own map is empty) is isolated too.
  it("treats a facet whose own values name nobody as isolated", () => {
    const quiet = facet("q", "Quiet");
    const talker = facet("t", "Talker", { q: co("3") });
    const html = coRowHtml(coCtxOf([quiet, talker], tokens) as CoCtx, newBlock("q"));
    expect(html).toContain('title="Never seen together with another facet."');
    expect(html).toContain("is-own");
  });

  it("treats a facet the dictionary does not know like an isolated one", () => {
    const html = coRowHtml(ctx, newBlock("gone"));
    expect(html).toContain('aria-label="Seen together with gone"');
    expect(html).toContain('title="Never seen together with another facet."');
  });

  it("draws no row when no facet is seen with another (no data at all)", () => {
    const none = coCtxOf([gamma, lonely], tokens) as CoCtx;
    expect(coRowHtml(none, newBlock("c"))).toBe("");
  });

  it("escapes names", () => {
    const odd = facet("x", 'A <"b">', { y: co("1") });
    const html = coRowHtml(coCtxOf([odd, facet("y", "Y")], tokens) as CoCtx, newBlock("x"));
    expect(html).toContain("A &lt;&quot;b&quot;&gt; (this facet)");
  });

  it("never draws an empty accessible name", () => {
    for (const id of ["a", "b", "c", "d", "l", "gone"]) {
      for (const name of all(coRowHtml(ctx, newBlock(id)), "aria-label")) {
        expect(name.trim()).not.toBe("");
      }
    }
  });
});

describe("seenLayout", () => {
  it("draws the facet's non-zero values, largest first, and leaves out never-seen ones", () => {
    const layout = seenLayout(ctx, alpha);
    expect(layout.boxes.map((b) => b.mark.facet.id)).toEqual(["b"]);
    // The too-rare value has no size: it goes to "+ N less often".
    expect(layout.merged?.items.map((i) => i.facet.id)).toEqual(["c"]);
    // It has no size of its own, yet it is big enough to see and press.
    const rect = layout.merged!.rect;
    expect(Math.min(rect.w, rect.h) * 3).toBeGreaterThanOrEqual(12);
  });

  it("leaves out the facet itself", () => {
    expect(seenLayout(ctx, beta).boxes.map((b) => b.mark.facet.id)).toEqual(["a"]);
    expect(seenLayout(ctx, beta).merged).toBeNull();
  });

  it("merges boxes too small to see or press into one '+ N less often' box", () => {
    const big = facet("big", "Big", { s1: co("0.001"), s2: co("0.002"), m: co("40") });
    const dictionary = [big, facet("s1", "S1"), facet("s2", "S2"), facet("m", "M")];
    const layout = seenLayout(coCtxOf(dictionary, tokens) as CoCtx, big);
    expect(layout.boxes.map((b) => b.mark.facet.id)).toEqual(["m"]);
    // Largest first in the list the hover reads out.
    expect(layout.merged?.items.map((i) => i.facet.id)).toEqual(["s2", "s1"]);
  });

  // Every box left after merging can be seen and pressed.
  it("leaves no box under 12 px at the reference size (300 x 180)", () => {
    const values: Record<string, CoValue> = {};
    const others: Facet[] = [];
    for (let i = 0; i < 60; i++) {
      values[`f${i}`] = co(String(1.3 ** i));
      others.push(facet(`f${i}`, `F${i}`));
    }
    const own = facet("own", "Own", values);
    const layout = seenLayout(coCtxOf([own, ...others], tokens) as CoCtx, own);
    expect(layout.merged).not.toBeNull();
    for (const box of [...layout.boxes, layout.merged!]) {
      expect(Math.min(box.rect.w, box.rect.h) * 3).toBeGreaterThanOrEqual(12);
    }
  });

  // "Less often" must be true: a thin box is merged together with every
  // rarer one, even where squarify left a rarer box thick enough.
  it("merges only facets rarer than every box still shown", () => {
    // Here squarify leaves the 1.04 box thin but a 1.01 box thick enough.
    const percents = [83.21, 71.01, 45.32, 42.72, 13.65, 5.02, 2.69, 1.04];
    percents.push(1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 0.02);
    const values: Record<string, CoValue> = {};
    const others = percents.map((size, i) => {
      values[`f${i}`] = co(String(size));
      return facet(`f${i}`, `F${i}`);
    });
    const own = facet("own", "Own", values);
    const layout = seenLayout(coCtxOf([own, ...others], tokens) as CoCtx, own);
    const smallestShown = Math.min(...layout.boxes.map((b) => b.mark.percent));
    const largestMerged = Math.max(...layout.merged!.items.map((m) => m.percent));
    expect(largestMerged).toBeLessThan(smallestShown);
  });

  it("shortens the merged box's label to '+N', or drops it, as its box allows", () => {
    // Alpha's merged box holds one too-rare value: it is at its smallest.
    expect(seenLayout(ctx, alpha).merged?.label).not.toBe("+ 1 less often");
    const values: Record<string, CoValue> = { m: co("1") };
    const others = [facet("m", "M")];
    for (let i = 0; i < 40; i++) {
      values[`r${i}`] = co("1e-400", true);
      others.push(facet(`r${i}`, `R${i}`));
    }
    const own = facet("own", "Own", values);
    // Only too-rare values besides one: the merged box grows no further than
    // it must, yet "+ 40 less often" is chosen only where it fits.
    const merged = seenLayout(coCtxOf([own, ...others], tokens) as CoCtx, own).merged!;
    expect(["+ 40 less often", "+40", null]).toContain(merged.label);
  });

  it("is empty for an isolated facet", () => {
    expect(seenLayout(ctx, lonely)).toEqual({ boxes: [], merged: null });
  });
});

describe("seenTogetherHtml", () => {
  it("draws boxes as buttons with the cells' names, a roving tabindex and the facet id", () => {
    const html = seenTogetherHtml(ctx, newBlock("a"));
    expect(all(html, "aria-label")).toContain("Beta: 50 % of Alpha's events");
    expect(all(html, "data-facet-id")).toEqual(["b"]);
    expect(all(html, "tabindex")).toEqual(["0", "-1"]);
    expect(all(html, "data-co-box")).toEqual(["b", ""]);
  });

  it("lists the merged facets in the '+ N less often' box's accessible name", () => {
    const html = seenTogetherHtml(ctx, newBlock("a"));
    const name = "1 less often: Gamma: 1e-400 % of Alpha's events, too rare to colour";
    expect(all(html, "aria-label")).toContain(name);
    expect(all(html, "title")).toEqual([]);
  });

  // The whole list can be thousands of characters: the caption gets a short
  // text of its own (data-caption), the list stays in the accessible name.
  it("gives the merged box a short caption", () => {
    const html = seenTogetherHtml(ctx, newBlock("a"));
    expect(all(html, "data-caption")).toEqual(["1 facet, each less often than the boxes shown"]);
  });

  // Whether a name fits depends on the panel's real width, which only the
  // browser knows: every box gets its label, and hideCutLabels (queryBuilder.ts)
  // hides the ones that would be cut.
  it("writes every box's name as its label, even a long one", () => {
    const own = facet("o", "O", { w: co("90"), n: co("10") });
    const long = "A name far too long to fit in a small box";
    const html = seenTogetherHtml(
      coCtxOf([own, facet("w", "Wide"), facet("n", long)], tokens),
      newBlock("o"),
    );
    expect(html).toContain('<span class="qb-seen-label">Wide</span>');
    expect(html).toContain(`<span class="qb-seen-label">${long}</span>`);
  });

  it("places boxes in percentages of the chart", () => {
    const html = seenTogetherHtml(ctx, newBlock("b"));
    expect(html).toContain("left:0%;top:0%;width:100%;height:100%");
  });

  it("says so for an isolated facet, an unknown one and a missing dictionary", () => {
    expect(seenTogetherHtml(ctx, newBlock("l"))).toContain(
      "Never seen together with another facet.",
    );
    expect(seenTogetherHtml(ctx, newBlock("gone"))).toContain(
      "This facet is not in the data dictionary.",
    );
    expect(seenTogetherHtml(coCtxOf([gamma], tokens), newBlock("c"))).toContain(
      "No co-occurrence data for this facet.",
    );
  });

  // Without colours (the stylesheet did not load) or while the dictionary
  // loads, nothing is known about the data: no claim about it is made.
  it("makes no claim about the data when it cannot draw the chart", () => {
    const html = seenTogetherHtml(null, newBlock("a"));
    expect(html).toContain("Seen together cannot be shown right now.");
    expect(html).not.toContain("No co-occurrence data");
  });

  it("never draws an empty accessible name", () => {
    for (const id of ["a", "b", "c", "d"]) {
      for (const name of all(seenTogetherHtml(ctx, newBlock(id)), "aria-label")) {
        expect(name.trim()).not.toBe("");
      }
    }
  });
});

describe("rovingIndex", () => {
  const press = (
    key: string,
    mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey", boolean>> = {},
  ) => ({
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods,
  });

  it("moves one step with Left / Right, and to the ends with Home / End", () => {
    expect(rovingIndex(press("ArrowRight"), 1, 4)).toBe(2);
    expect(rovingIndex(press("ArrowLeft"), 1, 4)).toBe(0);
    expect(rovingIndex(press("Home"), 2, 4)).toBe(0);
    expect(rovingIndex(press("End"), 0, 4)).toBe(3);
  });

  it("stays at the ends instead of wrapping", () => {
    expect(rovingIndex(press("ArrowLeft"), 0, 4)).toBe(0);
    expect(rovingIndex(press("ArrowRight"), 3, 4)).toBe(3);
  });

  it("ignores other keys", () => {
    expect(rovingIndex(press("Enter"), 1, 4)).toBeNull();
    expect(rovingIndex(press("ArrowDown"), 1, 4)).toBeNull();
  });

  // Alt+Left is the browser's Back, Ctrl+Home / End scroll the page: those
  // belong to the browser, not to the row.
  it("leaves keys with Alt, Ctrl or Meta to the browser", () => {
    expect(rovingIndex(press("ArrowLeft", { altKey: true }), 1, 4)).toBeNull();
    expect(rovingIndex(press("Home", { ctrlKey: true }), 2, 4)).toBeNull();
    expect(rovingIndex(press("End", { metaKey: true }), 0, 4)).toBeNull();
  });
});

describe("tabStopIndex", () => {
  it("keeps the remembered item as the Tab stop after a repaint", () => {
    expect(tabStopIndex(["a", "b", "c"], "c")).toBe(2);
  });

  it("falls back to the first item when nothing is remembered or it is gone", () => {
    expect(tabStopIndex(["a", "b"], undefined)).toBe(0);
    expect(tabStopIndex(["a", "b"], "gone")).toBe(0);
  });

  // The merged box's id is "", which must still be found.
  it("finds the merged box by its empty id", () => {
    expect(tabStopIndex(["a", ""], "")).toBe(1);
  });
});

describe("opening the dictionary from a cell or box", () => {
  // `data-opens-docs` tells main.ts's "click outside closes the floating
  // dictionary" that this click opened it.
  it("marks every cell and every facet's box, but not the merged box", () => {
    const count = (html: string) => html.split(" data-opens-docs ").length - 1;
    expect(count(coRowHtml(ctx, newBlock("a")))).toBe(4);
    const chart = seenTogetherHtml(ctx, newBlock("a"));
    expect(chart).toContain("is-merged");
    expect(count(chart)).toBe(all(chart, "data-facet-id").length);
    expect(count(chart)).toBe(all(chart, "data-co-box").length - 1);
  });
});

describe("the chart's title line", () => {
  it("holds the caption and the tab's ?, which the caller passes in", () => {
    const html = seenTogetherHtml(ctx, newBlock("a"), "<button>?</button>");
    const head = html.slice(html.indexOf("qb-seen-head"), html.indexOf("qb-seen-chart"));
    expect(head).toContain('<p class="qb-co-caption" aria-hidden="true"></p><button>?</button>');
  });

  // Nothing to point at, so no caption; the "?" still explains the colours.
  it("keeps the ? but no caption when there is no chart", () => {
    const html = seenTogetherHtml(ctx, newBlock("l"), "<button>?</button>");
    expect(html).toContain("<button>?</button>");
    expect(html).not.toContain("qb-co-caption");
  });
});

describe("captionText", () => {
  it("shows the hovered item, else the focused one, else nothing", () => {
    expect(captionText("Beta: 5 %", "Gamma: 1 %")).toBe("Beta: 5 %");
    expect(captionText(null, "Gamma: 1 %")).toBe("Gamma: 1 %");
    expect(captionText(null, null)).toBe("");
  });
});
