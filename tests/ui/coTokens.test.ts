import { describe, it, expect } from "vitest";
import { coTokensFrom } from "../../src/ui/coTokens";

const values: Record<string, string> = {
  "--qb-cooc-stop-1": " #eef5e0 ",
  "--qb-cooc-stop-2": "#d3e8b5",
  "--qb-cooc-stop-3": "#b0d68a",
  "--qb-cooc-stop-5": "#000000", // after a gap: ignored
  "--qb-cooc-never": "#e4e1d2",
  "--qb-cooc-cell-border": "#85836f",
  "--qb-cooc-own": "#8a6400",
  "--qb-cooc-dot-dark": "#17240f",
  "--qb-cooc-dot-light": "#ffffff",
};

describe("coTokensFrom", () => {
  it("reads stops until the first empty one, trimming whitespace", () => {
    const t = coTokensFrom((name) => values[name] ?? "");
    expect(t.stops).toEqual(["#eef5e0", "#d3e8b5", "#b0d68a"]);
  });

  it("reads the other tokens", () => {
    const t = coTokensFrom((name) => values[name] ?? "");
    expect(t).toMatchObject({
      never: "#e4e1d2",
      cellBorder: "#85836f",
      own: "#8a6400",
      dotDark: "#17240f",
      dotLight: "#ffffff",
    });
  });
});
