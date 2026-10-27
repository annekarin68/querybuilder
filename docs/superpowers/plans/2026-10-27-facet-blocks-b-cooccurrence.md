# Facet blocks, plan B: co-occurrence, the panel, the legend, and the A2 follow-ups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every facet block shows how often other facets are seen together with it (the top row and the square pie chart), the facet's and the selected field's documentation in an About tab, a legend popover, and links into the dictionary; the colours are the designer's tokens; plus three small follow-ups from plan A2.

**Architecture:** Co-occurrence data arrives on each facet from `GET …/documentation/individuals` (`co_occurrence`), is read strictly-but-forgivingly in `src/api/response.ts` into the model, and all maths (which facets, the log scale, colour blending, the square pie chart's layout, the legend ticks) lives in pure modules (`src/query/coOccurrence.ts`, `src/ui/colour.ts`) tested in Node. The block's markup (`src/ui/blockHtml.ts`) gains a top row, a two-line head with tabs, and a panel; the About panel is repainted by its own small painter so focusing a row never redraws the rows.

**Tech Stack:** TypeScript, Vite, Vitest (Node), Fomantic UI (only via `src/ui/fomantic.ts`), the native HTML `popover` attribute, Playwright with Chromium for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-27-facet-blocks-design.md` — decisions 10–25 and sections 5 ("Panel"), 6 and 7. **Previous plans:** A1, A2 (`docs/superpowers/plans/2026-10-27-facet-blocks-a2-builder.md`, see "Carried into plan B").

## Global Constraints

- Before every commit: `npm run typecheck && npm test && npm run lint && npm run build` — all pass.
- Code for a junior team: comments explain *why*, names say what a thing is, logic in small pure functions the Node-only tests can reach. `docs/ARCHITECTURE.md` describes the code in the same commit; never rename its headings.
- `src/` never names backend data (tests use made-up ids). Offline-first: no CDN, no remote font or image. Only `src/ui/fomantic.ts` uses jQuery. Desktop only, down to 512 px; keyboard works everywhere; targets ≥ 24 px.
- Co-occurrence values are percentages as text (`"0.000123"`, `"1.2e-20"`, `"100"`): the share of THIS facet's events that also hold the other facet. Display data only: never required, never blocks loading.
- Colour scale: log scale from the smallest non-zero value in the whole matrix to the largest (own `100` excluded); blended between neighbouring designer stops; the same range in every block.
- Top row: every facet seen with at least one other facet (either direction, own value excluded), dictionary order, the same in every block. Cell: a dot = seen together, colour behind = how often; never seen = plain grey, no dot; this block's facet = a round mustard mark (no ring); too small for a JavaScript number = an empty box with a dot. A block whose facet is seen with no other facet: a row of never-seen cells, its hover/accessible text "Never seen together with another facet."
- Hover / focus on a cell or box shows only the facet's name and the value (the backend's original text). Click or Enter opens the dictionary at that facet.
- Square pie chart: area ∝ value, never-seen facets absent, boxes under ~12 px merged into "+ N less often", labels only where the whole name fits, never cut.
- Legend only as a popover from a "?" on every block (and in the Seen together tab).
- Panel: tabs Seen together / About; clicking the open tab hides the panel for every block (`panelTab: null`); About shows the facet, or the selected field with "← About <facet>".
- Never `git stash`, never `pkill` (stop only servers you started, by port and working directory). Do not push or open pull requests. Commit trailers name the model that wrote the commit.

## Controller rulings already made (binding)

- **Contrast (spec section 7):** the light colour stops cannot reach 3:1 against the card without losing the gradient. Instead: every cell has an outline (`--qb-cooc-cell-border`) that reaches 3:1 against the card; the dot reaches 3:1 against every stop and every blend; the own-facet mark reaches 3:1 against the card; box labels reach 4.5:1 against their box. The colour is supplementary (the value is in the accessible name).
- **Blending:** in OKLab (the perceptual space OKLCH is built on), which avoids hue wrap-around; the spec's "OKLCH" intent (no muddy middle) holds.
- **Legend popover:** the native `popover` attribute (`<div popover>` + `<button popovertarget>`), not a Fomantic popup: Escape, light dismiss and focus return come from the browser, with no jQuery.
- **Panel selection without repaint:** `AppState.selectedField` (what About shows) is painted by its own painter that rewrites only `.qb-about` elements; the builder's painter does not listen to it.

---

### Task 1: Follow-ups from plan A2

**Files:** `src/ui/fieldRows.ts`, `src/ui/statsPanel.ts`, `src/ui/docsSidebar.ts` and/or `src/ui/layout.ts`, `src/styles.css`, `docs/ARCHITECTURE.md`; tests `tests/ui/fieldRows.test.ts`, `tests/ui/statsPanel.test.ts`.

- [ ] **1. Unset slot tooltip** (maintainers, 2026-10-27): the unset row's focusable slot button gets `title="Filter on <field name>"` (the visible row stays text-free). Test: the button carries the title.
- [ ] **2. The floating dictionary steps aside during a drag** (maintainers: fix now): when the dictionary floats over the page (below 1100 px, see "Screen layout") and a drag starts from it, slide it out of the way for the drag (a class on the shell, e.g. `is-dragging-from-docs`, that translates the floating dictionary off-screen with a short transition, `pointer-events: none`), and bring it back on `dragend` (also after a cancelled drag). Keep the dragged element in the DOM (a transform, not `display: none`), or `dragend` may never fire. Respect `prefers-reduced-motion` (no transition). No change above 1100 px.
- [ ] **3. Run query stays put while statistics stream** (maintainers: fix now): at 900 px and below the statistics sit above Run query, and every arriving line pushes it down. While statistics load, draw a placeholder row for every selected database that has not answered yet (`pendingRowHtml(db)`: the database's name and a quiet "…"), so the panel has its final height from the start. Test the pure HTML function and that `statsPanelHtml` draws one row per selected database while loading.
- [ ] **4.** Update `docs/ARCHITECTURE.md` ("Screen layout" / "Narrow screens", "Right — `statsPanel.ts`", "Centre — `queryBuilder.ts`" unset rows); run the four checks; browser-check 2 and 3 at 900 and 512 px with your own servers; commit ("A2 follow-ups: slot tooltip, dictionary steps aside, steady Run button").

---

### Task 2: Co-occurrence data, from the backend (and the mock) to the model

**Files:** `src/api/types.ts`, `src/api/response.ts`, `src/api/client.ts`, `src/model.ts`, `mock-server/` (where individuals are answered), docs; tests `tests/api/response.test.ts`, `tests/api/client.test.ts`, `tests/mock-server/…`.

**Interfaces (produce):**
- `IndividualResponse.co_occurrence?: Record<string, string>`.
- `src/model.ts`: `export interface CoValue { text: string; percent: number; tooRare: boolean }`; `Facet.coOccurrence: ReadonlyMap<string, CoValue>` (keyed by the other facet's id; may be empty).
- `src/api/response.ts`: `readCoOccurrence(i: ResponseObject<IndividualResponse>, facetId: string): Map<string, CoValue>` used by `toFacet`; `pruneUnknownCoOccurrence(facets: Facet[]): Facet[]` used by `client.getFacets` after mapping.

Rules (spec section 6 "Data" and "Values too small for a JavaScript number"):
- Missing `co_occurrence`: empty map, **one** console warning for the whole list naming how many facets had none (not one per facet).
- A value that is not text, or whose `Number(text.trim())` is not a number from 0 to 100: left out, one warning per facet listing them.
- **Too rare:** a text whose mantissa (the part before an `e`/`E`) has a non-zero digit but which parses to `0` → `{ text, percent: 0, tooRare: true }`, one warning per facet listing them.
- Ids of facets that don't exist: dropped by `pruneUnknownCoOccurrence`, **one warning per facet listing them**.
- The original `text` is kept for display.

Tests (write first):

```ts
// tests/api/response.test.ts (sketch the fixture with the file's existing helpers)
it("reads co-occurrence values as numbers, keeping the backend's text", () => {
  const facet = toFacet(read({ ...individual("a"), co_occurrence: { b: "12.5", c: "1.2e-20", a: "100" } }));
  expect(facet.coOccurrence.get("b")).toEqual({ text: "12.5", percent: 12.5, tooRare: false });
  expect(facet.coOccurrence.get("c")!.percent).toBeCloseTo(1.2e-20);
});
it("marks a value too small for a JavaScript number as too rare, with a warning", () => {
  const facet = toFacet(read({ ...individual("a"), co_occurrence: { b: "1e-400", z: "0", y: "0.0" } }));
  expect(facet.coOccurrence.get("b")).toEqual({ text: "1e-400", percent: 0, tooRare: true });
  expect(facet.coOccurrence.get("z")).toEqual({ text: "0", percent: 0, tooRare: false });
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("too small"));
});
it("leaves out values that are not percentages", () => {
  const facet = toFacet(read({ ...individual("a"), co_occurrence: { b: "abc", c: "101", d: "-1", e: 5 } }));
  expect([...facet.coOccurrence.keys()]).toEqual([]);
});
it("drops ids of facets that don't exist, one warning per facet", () => {
  // two facets a, b; a mentions b and x, y → keeps b, warns once naming x and y
});
it("treats a missing map as empty, with one warning for the whole list", () => { /* getFacets on two facets without co_occurrence */ });
```

Mock: compute `co_occurrence` for every individual at startup from its sample events (share of A's events that also hold B, as `String(percent)`, `"100"` for itself, `"0"` for never), in a pure, tested function (e.g. `coOccurrenceOf(entrysets, individuals)` in `mock-server/coOccurrence.ts`), and answer it with each individual. Update `docs/ARCHITECTURE.md` ("Reading responses", "Data model" table if it lists facet fields, "Mock server"). Run the four checks; commit ("Co-occurrence: from the backend to the model").

---

### Task 3: The co-occurrence maths and colours (pure)

**Files:** create `src/ui/colour.ts`, `src/query/coOccurrence.ts`; tests `tests/ui/colour.test.ts`, `tests/query/coOccurrence.test.ts`.

**Interfaces (produce):**
- `colour.ts`: `parseHex(hex: string): [number, number, number]`; `toHex(rgb: [number, number, number]): string`; `mixOklab(a: string, b: string, t: number): string`; `relativeLuminance(hex: string): number`; `contrastRatio(a: string, b: string): number`; `betterOn(bg: string, dark: string, light: string): string` (whichever contrasts more).
- `coOccurrence.ts`: `CoRange = { min: number; max: number }`; `connectedFacets(facets: Facet[]): Facet[]`; `coOccurrenceRange(facets: Facet[]): CoRange | null`; `scalePosition(percent: number, range: CoRange): number` (0..1, log scale; `1` when `min === max`); `coOccurrenceColour(percent: number, range: CoRange, stops: string[]): string`; `legendTicks(range: CoRange, stopCount: number): { at: number; label: string }[]`; `stepFactorText(range: CoRange, stopCount: number): string` (e.g. "about 100 times"); `Rect = { x: number; y: number; w: number; h: number }`; `squarify(values: number[], width: number, height: number): Rect[]` (same order as `values`); `labelFits(name: string, rect: Rect, charWidth?: number, lineHeight?: number): boolean`; `formatPercent(text: string): string` (the backend text + " %").

OKLab conversion (Björn Ottosson's matrices) — use exactly:

```ts
const toLinear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
```

`squarify` (Bruls et al.): lay the values, largest first, in rows along the shorter side, adding a value to the row while it does not worsen the row's worst aspect ratio; zero values get an empty rect; return rects in the input order.

`coOccurrenceColour`: `t = scalePosition`; `segment = Math.min(Math.floor(t * (n - 1)), n - 2)`; `local = t * (n - 1) - segment`; `mixOklab(stops[segment], stops[segment + 1], local)`.

`legendTicks`: one tick per stop at `k / (n - 1)`, value `10 ** (log10(min) + k * (log10(max) - log10(min)) / (n - 1))`, label `≥ 1 → Number(v.toPrecision(2)) + " %"`, else `v.toExponential(0) + " %"` (e.g. "1e-12 %").

Tests (first): `mixOklab(a, a, t) === a`; `mixOklab(a, b, 0) === a`, `1 → b`; black–white midpoint is a grey; `contrastRatio("#000000", "#ffffff") ≈ 21`; `betterOn` picks the higher; `connectedFacets` keeps facets mentioned in either direction and drops an isolated one, ignoring own `100` and treating `tooRare` as seen; `coOccurrenceRange` ignores own values, zeros and too-rare; `scalePosition` 0 at min, 1 at max, 0.5 at the geometric middle; `coOccurrenceColour` gives the first stop at min, the last at max, a stop exactly at its position; `squarify`: rects inside the bounds, areas proportional within 1e-6, no two rects overlap, zero value → zero area, order preserved; `labelFits` true/false cases; `legendTicks` for `{min: 1e-12, max: 100}` with 7 stops gives 7 labels from "1e-12 %" to "100 %"; `stepFactorText` "about 100 times". Commit ("Co-occurrence: the maths and colours").

---

### Task 4: Palette tokens and contrast tests

**Files:** `src/styles.css` (`:root`), `tests/themeContrast.test.ts`, `src/ui/coTokens.ts` (create: `readCoTokens(): CoTokens` reading the `--qb-cooc-*` custom properties with `getComputedStyle(document.documentElement)` at paint time — a two-line DOM read; everything else stays pure), `docs/ARCHITECTURE.md` ("Pickle theme and mascot").

Tokens (all opaque `#rrggbb`; values below are the default pickle palette the designer replaces):

```css
  /* Co-occurrence (docs/superpowers/specs/2026-10-27-facet-blocks-design.md, section 7).
     Stops run from "rarely together" to "often together"; add or remove
     --qb-cooc-stop-N freely (at least 2, numbered without gaps). */
  --qb-cooc-stop-1: #eef5e0;
  --qb-cooc-stop-2: #d3e8b5;
  --qb-cooc-stop-3: #b0d68a;
  --qb-cooc-stop-4: #86bd5f;
  --qb-cooc-stop-5: #5f9a3f;
  --qb-cooc-stop-6: #3f7a2c;
  --qb-cooc-stop-7: #24521a;
  --qb-cooc-never: #e4e1d2;
  --qb-cooc-cell-border: #85836f;
  --qb-cooc-own: #8a6400;
  --qb-cooc-dot-dark: #17240f;
  --qb-cooc-dot-light: #ffffff;
```

`CoTokens = { stops: string[]; never: string; cellBorder: string; own: string; dotDark: string; dotLight: string }`; `readCoTokens` reads `--qb-cooc-stop-1`, `-2`, … until one is empty.

Contrast test (extend `tests/themeContrast.test.ts`, reading the tokens from the CSS like the existing pairs, and using `src/ui/colour.ts`): the cell border and the own mark ≥ 3:1 against `--qb-surface`; for every stop and 3 blends between each pair of neighbouring stops, `betterOn(bg, dotDark, dotLight)` reaches ≥ 3:1 (dot) and ≥ 4.5:1 (box labels use the same choice). Adjust the default token values (not the test) if a pair fails, and say so. Commit ("Co-occurrence: palette tokens and their contrast checks").

---

### Task 5: The block head, the panel and its state

**Files:** `src/state.ts`, `src/app.ts`, `src/main.ts`, `src/ui/blockHtml.ts`, `src/ui/queryBuilder.ts`, create `src/ui/aboutPanel.ts`, `src/ui/docsSidebar.ts` (extract `facetDetailsHtml` and `fieldDetailsHtml` from `facetHtml` / `fieldHtml` so About reuses them), `src/styles.css`, docs; tests.

**Interfaces (produce):** `AppState.panelTab: "seen" | "about" | null` (initial `"seen"`); `AppState.selectedField: FieldRef | null` (initial `null`; pruned by `displayStateFor` and reset with `openField`); app hooks `setPanelTab(tab: "seen" | "about")` (clicking the tab that is open sets `null`), `selectFieldForPanel(ref: FieldRef | null)`; `aboutPanelHtml(state-derived ctx, block): string`; `paintAboutPanels(container: HTMLElement, state: AppState): void` (rewrites only each `.qb-about[data-block-id]`'s content).

- Head, two lines (it wraps today): line 1 = grip, move, fold, name, Has / Has no, spacer, the tab buttons `Seen together` / `About` (`aria-pressed`, the open one has a "Hide panel" `title`), the legend "?" (Task 7 fills it; render the button now with `aria-label="Explain the colours"`), remove; line 2 (only when ≥ 1 field is set) = "an occurrence where [ALL|ANY] of the set fields match" (ALL/ANY only at ≥ 2).
- Body: rows and the panel side by side when the block is at least ~640 px wide, the panel under the rows when narrower (a container query on `.qb-block`); with `panelTab === null` no panel and the rows take the full width.
- About: the facet's details, or — when `selectedField` is in this block — that field's details with a "← About <facet name>" button (clears `selectedField`).
- Selecting for the panel: clicking a field label, or focus entering a row (`focusin` on `.qb-field-row`), calls `selectFieldForPanel`; this repaints only the About panels (`paintAboutPanels` registered in `src/main.ts` with key `selectedField`; the builder painter's keys must NOT include it). Test that the builder painter's key list excludes `selectedField`.
- Seen together content comes in Task 6; render an empty `.qb-seen` placeholder now.
- Tests: head markup (tabs, pressed state, line 2 rules), panel hidden when `panelTab` is null, `aboutPanelHtml` both modes and the back button, `setPanelTab` toggling, `displayStateFor` prunes `selectedField`. Update docs ("State and the render loop", "Centre"). Commit ("Facet blocks: two-line head, panel and About tab").

---

### Task 6: The top row and the square pie chart

**Files:** create `src/ui/coOccurrenceHtml.ts`; `src/ui/blockHtml.ts`, `src/ui/queryBuilder.ts`, `src/styles.css`, docs; tests `tests/ui/coOccurrenceHtml.test.ts`.

**Interfaces (produce):** `CoCtx = { facets: Facet[]; connected: Facet[]; range: CoRange | null; tokens: CoTokens }`; `coRowHtml(ctx: CoCtx, block: FacetBlock): string`; `seenTogetherHtml(ctx: CoCtx, block: FacetBlock): string`.

- Top row above each block's head: one 11 px square cell per connected facet (dictionary order), `role="group"` with `aria-label="Seen together with <facet>"`; cells are buttons with a roving tabindex (the first `0`, others `-1`; Left/Right/Home/End move focus inside the row — a small handler in `queryBuilder.ts`); each cell's accessible name and `title`: "<other facet>: <text> % of <facet>'s events", "<other facet>: never seen together", "<facet> (this facet)", "<other facet>: seen together, too rare to colour"; the colour from `coOccurrenceColour`, the dot from `betterOn`; never = `--qb-cooc-never`, no dot; own = a round mustard mark; too rare = an empty box with a dot. An isolated facet's row: every cell never-seen, the row's `title` "Never seen together with another facet.". Cells wrap onto more lines in a narrow block. `data-facet-id` on every cell (Task 7 opens the dictionary).
- Seen together tab: `squarify` of this facet's non-zero values (too-rare ones go to "+ N less often") into a 100 × 60 box drawn with percentages; boxes whose share of the box is under ~12 px at the panel's typical width (use `labelFits`-style estimate on a 300 × 180 px reference) merge into one "+ N less often" box whose `title` lists them; labels only where `labelFits`; after paint, hide any label whose text overflows its box (`scrollWidth > clientWidth`), as a safety net. Boxes are buttons with a roving tabindex and the same accessible names as cells; `data-facet-id`.
- Tests: cell kinds and names, dictionary order, the isolated row, the merge of tiny boxes, label rule, accessible names never empty. Update docs ("Centre"). Commit ("Co-occurrence: the top row and the square pie chart").

---

### Task 7: The legend popover and "open in the dictionary"

**Files:** create `src/ui/legendHtml.ts`; `src/ui/blockHtml.ts`, `src/ui/queryBuilder.ts`, `src/ui/docsSidebar.ts`, `src/app.ts`, `src/main.ts`, `src/styles.css`, docs; tests.

- Legend: `legendHtml(facetName: string, range: CoRange | null, tokens: CoTokens): string` — the sentence "How often each facet is seen together with <facet>: the share of <facet>'s events that also hold it", the blended bar (a CSS `linear-gradient` through the stops), tick labels from `legendTicks`, "rarer" / "more often", "log scale: each step is <stepFactorText>", and the four keys (seen together, never seen together, this facet, too rare to colour). Each block's "?" is `<button type="button" popovertarget="legend-<block id>" aria-label="Explain the colours">?</button>` with `<div id="legend-<block id>" popover class="qb-legend">…</div>`; the Seen together tab has the same "?". Without a range (no data), the legend says "No co-occurrence data for this facet."
- Open in the dictionary: a click or Enter on a cell or box calls app `showFacetInDictionary(facetId)`: unfold the dictionary if folded (`sidebarCollapsed: false`), then (after its repaint) open the facet's first `.qb-doc-facet[data-facet-id]` `<details>` and its section, scroll it into view, mark it `is-highlighted` for 2 s (no animation under reduced motion), and move focus to its `<summary>`; remember the cell; when the user closes the dictionary (Escape or Hide), focus returns to that cell if it still exists. Below 1100 px the dictionary floats, as today.
- Tests: `legendHtml` contents (sentence names the facet, 4 keys, tick labels, the no-data text); the app hook sets `sidebarCollapsed` false; the reveal function's pure part (which element to open) if extractable. Update docs ("Left — `docsSidebar.ts`", "Centre"). Commit ("Co-occurrence: legend popover and open in the dictionary").

---

### Task 8: Browser check

Start your own servers (CLAUDE.md ports 3091 / 5191), Playwright with Chromium (installed at `/tmp/claude-1000/-home-annek-repos-query-builder--claude-worktrees-query-builder-facet-ops-1d4ae7/f8d04979-ff14-4e8e-914e-9e5ee6f6bd88/scratchpad/pw/node_modules`; write scripts in that folder), log in via `/api/v1/auth/login` → "Log in as demo.user", realistic clicks. At 1280 × 900 and 512 × 900, screenshot and check: the top row (cells, dot vs never vs own, too-rare if the data has one, wrapping at 512, Left/Right/Home/End, hover and focus names), the square pie chart (labels never cut, "+ N less often"), the tabs (switch, hide all, show again), About (facet; click a label and focus a row → field docs, rows not repainted: an open operator dropdown stays open while About changes; "← About …"), the legend popover (open with click and Enter, Escape closes, focus back on "?"), a cell click opening the dictionary at that facet (and at 512, floating; closing returns focus), the A2 follow-ups (slot tooltip, the dictionary stepping aside during a drag at 512, Run query not moving while statistics stream at 512), no console errors. Fix what fails (with a Node test where reachable), run the four checks, stop your servers, commit ("Co-occurrence: fixes from the browser check"), and report every check with its result and screenshot path.
