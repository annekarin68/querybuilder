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
import { KEEPS_FLOATING_DOCS_OPEN } from "../../src/ui/docsSidebar";
import { legendToggleHtml } from "../../src/ui/legendHtml";

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

  // Only the browser knows the box's real size, so both labels are drawn and
  // hideCutLabels (coOccurrenceWiring.ts) shows the long one, else the short.
  it("draws the merged box's long and short label, for the browser to pick", () => {
    const values: Record<string, CoValue> = { m: co("1") };
    const others = [facet("m", "M")];
    for (let i = 0; i < 40; i++) {
      values[`r${i}`] = co("1e-400", true);
      others.push(facet(`r${i}`, `R${i}`));
    }
    const own = facet("own", "Own", values);
    const html = seenTogetherHtml(coCtxOf([own, ...others], tokens), newBlock("own"));
    const merged = /<button[^>]*is-merged[^>]*>(.*?)<\/button>/.exec(html)?.[1];
    expect(merged).toBe(
      `<span class="qb-seen-label">+ 40 less often</span><span class="qb-seen-label is-short">+40</span>`,
    );
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

describe("the '+ N less often' box's list", () => {
  // Click or Enter on "+N" opens a popover listing what it stands for, as the
  // legend opens from its "?" (the same class, so the same placement).
  it("opens a popover beside the chart that lists the merged facets", () => {
    const block = newBlock("a");
    const html = seenTogetherHtml(ctx, block);
    const id = `popover-${block.id}-merged`;
    expect(html).toContain(`data-co-box="" popovertarget="${id}"`);
    const chartEnd = html.indexOf("</div>", html.indexOf('class="qb-seen-chart"'));
    const popover = html.slice(html.indexOf(`<div id="${id}" popover class="qb-popover">`));
    expect(html.indexOf(`<div id="${id}"`)).toBeGreaterThan(chartEnd);
    expect(popover).toContain("1 facet seen together less often with <strong>Alpha</strong>");
    expect(popover).toContain("<li>Gamma: 1e-400 % of Alpha&#39;s events, too rare to colour</li>");
  });

  it("lists them largest first, the too-rare ones last", () => {
    const own = facet("o", "O", {
      big: co("90"),
      ...Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`s${i}`, co(String(0.001 * (i + 1)))]),
      ),
      rare: co("1e-400", true),
    });
    const others = [
      facet("big", "Big"),
      ...Array.from({ length: 40 }, (_, i) => facet(`s${i}`, `S${i}`)),
      facet("rare", "Rare"),
    ];
    const html = seenTogetherHtml(coCtxOf([own, ...others], tokens), newBlock("o"));
    const items = [...html.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1] as string);
    expect(items.length).toBeGreaterThan(1);
    expect(items.at(-1)).toContain("Rare:");
    expect(items[0]).toContain("S39:");
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

// main.ts folds the floating dictionary on a click outside it, except on
// what `KEEPS_FLOATING_DOCS_OPEN` matches. Opening the dictionary from a
// cell or box, or opening or reading a popover, is a peek: it must stay open.
describe("KEEPS_FLOATING_DOCS_OPEN", () => {
  /** Whether the opening tag `tag` matches one of the comma-separated
   *  `selectors`. Only the kinds the list uses: `.class`, `[attr]` and
   *  `[attr='value']`; any other kind fails the test rather than pass it. */
  function matchesOneOf(tag: string, selectors: string): boolean {
    const classes = /\sclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
    return selectors.split(",").some((part) => {
      const sel = part.trim();
      if (/^\.[\w-]+$/.test(sel)) return classes.includes(sel.slice(1));
      const attr = /^\[([\w-]+)(?:='([^']*)')?\]$/.exec(sel);
      if (!attr) throw new Error(`The test cannot read the selector ${sel}`);
      const [, name, value] = attr;
      return value === undefined
        ? new RegExp(`\\s${name}(=|\\s|>)`).test(tag)
        : tag.includes(` ${name}="${value}"`);
    });
  }
  const openingTags = (html: string) => html.match(/<(button|div)\b[^>]*>/g) ?? [];

  it("matches the row's cells, the chart's boxes and the merged box", () => {
    const html = coRowHtml(ctx, newBlock("a")) + seenTogetherHtml(ctx, newBlock("a"));
    const items = openingTags(html).filter((t) => /qb-co-cell|qb-seen-box/.test(t));
    expect(items.some((t) => t.includes("is-merged"))).toBe(true);
    for (const tag of items) expect(matchesOneOf(tag, KEEPS_FLOATING_DOCS_OPEN)).toBe(true);
  });

  it("matches the legend's ? and every popover, so a click inside one counts too", () => {
    const html =
      legendToggleHtml("popover-a-row", "legend", "<p>inside</p>") +
      seenTogetherHtml(ctx, newBlock("a"));
    const tags = openingTags(html).filter((t) => /popover|qb-legend-btn/.test(t));
    expect(tags.filter((t) => / popover( |>)/.test(t))).toHaveLength(2);
    for (const tag of tags) expect(matchesOneOf(tag, KEEPS_FLOATING_DOCS_OPEN)).toBe(true);
  });

  it("does not match the builder's other buttons", () => {
    const remove = `<button type="button" class="qb-icon-btn" data-action="remove-node">`;
    expect(matchesOneOf(remove, KEEPS_FLOATING_DOCS_OPEN)).toBe(false);
  });
});

describe("a facet without co-occurrence data (null, not 'never seen together')", () => {
  const noData: Facet = { ...facet("n", "Nodata"), coOccurrence: null };
  const withNoData = coCtxOf([alpha, beta, gamma, delta, lonely, noData], tokens) as CoCtx;
  const questionMark = "<button>?</button>";

  it("draws no row for its block", () => {
    expect(coRowHtml(withNoData, newBlock("n"))).toBe("");
  });

  it("says so in the Seen together tab, without a ?", () => {
    const html = seenTogetherHtml(withNoData, newBlock("n"), questionMark);
    expect(html).toContain("No co-occurrence data for this facet.");
    expect(html).not.toContain(questionMark);
    expect(html).not.toContain("Never seen together");
  });

  it("is still a cell in the rows of facets that name it", () => {
    const names = new Map(alpha.coOccurrence);
    names.set("n", co("25"));
    const naming: Facet = { ...alpha, coOccurrence: names };
    const ctxNaming = coCtxOf([naming, beta, noData], tokens) as CoCtx;
    const row = coRowHtml(ctxNaming, newBlock("a"));
    expect(all(row, "data-facet-id")).toEqual(["a", "b", "n"]);
    expect(all(row, "aria-label")).toContain("Nodata: 25 % of Alpha's events");
  });

  it("keeps the ? for an isolated facet that does have a map", () => {
    expect(seenTogetherHtml(withNoData, newBlock("l"), questionMark)).toContain(questionMark);
  });
});

describe("rounded text on screen", () => {
  const long = "76.19047619047619";
  const own = facet("o", "Own", { x: co(long), y: co("1.23456e-20") });
  const rounded = coCtxOf([own, facet("x", "X"), facet("y", "Y")], tokens) as CoCtx;

  it("rounds a cell's caption but keeps the full text in its accessible name", () => {
    const row = coRowHtml(rounded, newBlock("o"));
    expect(all(row, "aria-label")).toContain(`X: ${long} % of Own's events`);
    expect(all(row, "data-caption")).toContain("X: 76.2 % of Own's events");
    expect(all(row, "data-caption")).toContain("Y: 1.23e-20 % of Own's events");
  });

  it("rounds a box's caption the same way", () => {
    const html = seenTogetherHtml(rounded, newBlock("o"));
    expect(all(html, "aria-label")).toContain(`X: ${long} % of Own's events`);
    expect(all(html, "data-caption")).toContain("X: 76.2 % of Own's events");
  });

  it("leaves out data-caption when the caption would repeat the name", () => {
    expect(all(coRowHtml(ctx, newBlock("a")), "data-caption")).toEqual([]);
  });

  it("rounds the values in the merged list too, not in its accessible name", () => {
    const values: Record<string, CoValue> = { big: co("90") };
    const others = [facet("big", "Big")];
    for (let i = 0; i < 30; i++) {
      values[`s${i}`] = co("0.0012345678");
      others.push(facet(`s${i}`, `S${i}`));
    }
    const html = seenTogetherHtml(
      coCtxOf([facet("o", "O", values), ...others], tokens),
      newBlock("o"),
    );
    expect(html).toContain("<li>S0: 0.00123 % of O&#39;s events</li>");
    expect(all(html, "aria-label").join("|")).toContain("S0: 0.0012345678 % of O's events");
  });
});

describe("the merged box with hundreds of facets", () => {
  const COUNT = 300;
  const values: Record<string, CoValue> = { big: co("10") };
  const others = [facet("big", "Big")];
  for (let i = 0; i < COUNT; i++) {
    values[`s${i}`] = co("0.5");
    others.push(facet(`s${i}`, `S${i}`));
  }
  const crowded = coCtxOf([facet("o", "O", values), ...others], tokens) as CoCtx;

  it("lists every merged facet and counts them in the heading", () => {
    const html = seenTogetherHtml(crowded, newBlock("o"));
    const merged = seenLayout(crowded, crowded.facets[0] as Facet).merged!;
    expect(merged.items.length).toBe(COUNT);
    expect([...html.matchAll(/<li>/g)]).toHaveLength(COUNT);
    expect(html).toContain(`${COUNT} facets seen together less often with`);
  });

  it("lays the merged box out last, in the bottom-right corner, even when it is the largest", () => {
    const { boxes, merged } = seenLayout(crowded, crowded.facets[0] as Facet);
    expect(merged!.rect.w * merged!.rect.h).toBeGreaterThan(
      Math.max(...boxes.map((b) => b.rect.w * b.rect.h)),
    );
    expect(merged!.rect.x + merged!.rect.w).toBeCloseTo(100);
    expect(merged!.rect.y + merged!.rect.h).toBeCloseTo(60);
  });
});
