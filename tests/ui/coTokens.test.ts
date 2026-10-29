import { describe, it, expect } from "vitest";
import { coTokensFrom } from "../../src/ui/coTokens";

const values: Record<string, string> = {
  "--qb-cooc-stop-1": " #eef5e0 ",
  "--qb-cooc-stop-2": "#d3e8b5",
  "--qb-cooc-stop-3": "#b0d68a",
  "--qb-cooc-stop-5": "#000000", // after a gap: ignored
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

  it("leaves out a stop that is not #rrggbb, and names it", () => {
    const bad: Record<string, string> = {
      "--qb-cooc-stop-1": "#ffff00",
      "--qb-cooc-stop-2": '"#ff9900;"',
      "--qb-cooc-stop-3": "#f00",
      "--qb-cooc-stop-4": "#1100FF",
    };
    const t = coTokensFrom((name) => bad[name] ?? "");
    expect(t.stops).toEqual(["#ffff00", "#1100FF"]);
    expect(t.badStops).toEqual(['--qb-cooc-stop-2: "#ff9900;"', "--qb-cooc-stop-3: #f00"]);
  });

  it("reads the other tokens", () => {
    const t = coTokensFrom((name) => values[name] ?? "");
    expect(t).toMatchObject({
      cellBorder: "#85836f",
      own: "#8a6400",
      dotDark: "#17240f",
      dotLight: "#ffffff",
    });
  });
});
