// The co-occurrence colours from the `--qb-cooc-*` tokens in src/styles.css.
// The only DOM read is `readCoTokens`; the parsing is a pure function so the
// Node tests can reach it.

export interface CoTokens {
  /** From "rarely together" (first) to "often together" (last). */
  stops: string[];
  never: string;
  cellBorder: string;
  own: string;
  dotDark: string;
  dotLight: string;
}

/** Builds the tokens from `get`, which returns a custom property's value
 *  ("" when unset). Stops are read as -1, -2, … until one is empty, which is
 *  why the numbering must have no gaps. */
export function coTokensFrom(get: (name: string) => string): CoTokens {
  const read = (name: string) => get(name).trim();
  const stops: string[] = [];
  for (let n = 1; read(`--qb-cooc-stop-${n}`) !== ""; n++) stops.push(read(`--qb-cooc-stop-${n}`));
  return {
    stops,
    never: read("--qb-cooc-never"),
    cellBorder: read("--qb-cooc-cell-border"),
    own: read("--qb-cooc-own"),
    dotDark: read("--qb-cooc-dot-dark"),
    dotLight: read("--qb-cooc-dot-light"),
  };
}

/** Reads the tokens at paint time, so a changed theme is picked up. */
export function readCoTokens(): CoTokens {
  const style = getComputedStyle(document.documentElement);
  return coTokensFrom((name) => style.getPropertyValue(name));
}
