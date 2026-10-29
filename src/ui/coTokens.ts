// The co-occurrence colours from the `--qb-cooc-*` tokens in src/styles.css.
// The only DOM read is `readCoTokens`; the parsing is a pure function so the
// Node tests can reach it.

export interface CoTokens {
  /** From "rarely together" (first) to "often together" (last). */
  stops: string[];
  cellBorder: string;
  own: string;
  dotDark: string;
  dotLight: string;
}

/** The one colour form the colour maths reads (`parseHex`, colour.ts). */
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** Builds the tokens from `get`, which returns a custom property's value
 *  ("" when unset). Stops are read as -1, -2, … until one is empty, which is
 *  why the numbering must have no gaps. A stop that is not "#rrggbb" (a
 *  stray ";" or quote, "#ff0", "red") is left out and named in `badStops`:
 *  the colour maths would read it as black, and the cells would then not
 *  match the legend's bar, which the browser draws from the same text. */
export function coTokensFrom(get: (name: string) => string): CoTokens & { badStops: string[] } {
  const read = (name: string) => get(name).trim();
  const stops: string[] = [];
  const badStops: string[] = [];
  for (let n = 1; read(`--qb-cooc-stop-${n}`) !== ""; n++) {
    const value = read(`--qb-cooc-stop-${n}`);
    if (HEX_COLOUR.test(value)) stops.push(value);
    else badStops.push(`--qb-cooc-stop-${n}: ${value}`);
  }
  return {
    stops,
    badStops,
    cellBorder: read("--qb-cooc-cell-border"),
    own: read("--qb-cooc-own"),
    dotDark: read("--qb-cooc-dot-dark"),
    dotLight: read("--qb-cooc-dot-light"),
  };
}

/** The bad stops already reported: the builder repaints on every edit. */
const reported = new Set<string>();

/** Reads the tokens at paint time, so a changed theme is picked up. A bad
 *  stop is reported in the console once. */
export function readCoTokens(): CoTokens {
  const style = getComputedStyle(document.documentElement);
  const { badStops, ...tokens } = coTokensFrom((name) => style.getPropertyValue(name));
  for (const bad of badStops) {
    if (reported.has(bad)) continue;
    reported.add(bad);
    console.warn(`styles.css: left out the colour stop "${bad}"; write it as #rrggbb.`);
  }
  return tokens;
}
