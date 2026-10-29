import { describe, it, expect } from "vitest";
import {
  barWidth,
  compact,
  countLabel,
  databaseTitle,
  displayLabel,
  exact,
  formatDate,
  formatWhen,
  hoverTitle,
  matchRatio,
} from "../../src/ui/format";

// The app's own setting (NUMBER_LOCALE in src/config.ts), pinned here so the
// assertions do not depend on the machine. Norwegian groups digits with a
// no-break space (written \u00a0 below) and writes "," as the decimal mark.
const L = "nb-NO";
const g = "\u00a0";

describe("compact", () => {
  it("groups exactly below 100 000", () => {
    expect(compact(0, L)).toBe("0");
    expect(compact(999, L)).toBe("999");
    expect(compact(12345, L)).toBe(`12${g}345`);
    expect(compact(28.86, L)).toBe("28,86");
  });
  // English words, Norwegian marks: "1,2 billion", never "1,2 mrd."
  // (maintainers, 2026-10-29).
  it("compacts at/above 100 000 in English words", () => {
    expect(compact(100_000, L)).toBe("100 thousand");
    expect(compact(1_234_567, L)).toBe("1,2 million");
    expect(compact(1_234_567_890, L)).toBe("1,2 billion");
  });
  it("defaults to NUMBER_LOCALE", () => {
    expect(compact(1_234_567_890)).toBe("1,2 billion");
  });
  it("handles non-finite", () => {
    expect(compact(NaN, L)).toBe("—");
  });
});

describe("exact", () => {
  it("full grouping for tooltips", () => {
    expect(exact(1_234_567_890, L)).toBe(`1${g}234${g}567${g}890`);
  });
  it("takes another locale's marks", () => {
    expect(exact(1_234_567.5, "en-US")).toBe("1,234,567.5");
  });
});

describe("matchRatio", () => {
  it("none / all", () => {
    expect(matchRatio(0, 100, L)).toBe("none");
    expect(matchRatio(5, 0, L)).toBe("none");
    expect(matchRatio(100, 100, L)).toBe("all");
  });
  it("normal percentages", () => {
    expect(matchRatio(62, 100, L)).toBe("62 %");
    expect(matchRatio(6, 100, L)).toBe("6,0 %");
    expect(matchRatio(1, 200, L)).toBe("0,5 %");
    expect(matchRatio(3, 4000, L)).toBe("0,075 %");
  });
  it("tiny fractions become a ratio, not a rounded 0 %", () => {
    expect(matchRatio(1, 2_900_000_000, L)).toBe("1 in 2,9 billion");
    expect(matchRatio(2, 10_000_000, L)).toBe("1 in 5 million");
  });
  it("near-100 % never rounds up to a misleading 100 %", () => {
    expect(matchRatio(999, 1000, L)).toBe("99,9 %");
    expect(matchRatio(999_999, 1_000_000, L)).toBe(">99,9 %");
  });
});

describe("barWidth", () => {
  it("0 for no matches", () => {
    expect(barWidth(0, 100)).toBe("0");
    expect(barWidth(5, 0)).toBe("0");
  });
  it("a 2px-floored max(), never scientific notation", () => {
    expect(barWidth(50, 100)).toBe("max(50%, 2px)");
    expect(barWidth(1234, 10000)).toBe("max(12.34%, 2px)");
    expect(barWidth(1, 1_000_000_000)).toBe("max(0.01%, 2px)");
  });
});

describe("displayLabel", () => {
  it("shows underscores as spaces and keeps the backend's casing", () => {
    expect(displayLabel("battery_ev")).toBe("battery ev");
    expect(displayLabel("HVAC_Cabin")).toBe("HVAC Cabin");
    expect(displayLabel("brakes")).toBe("brakes");
  });
});

describe("countLabel", () => {
  it("singular for exactly one, plural otherwise, with digit grouping", () => {
    expect(countLabel(1, "event", undefined, L)).toBe("1 event");
    expect(countLabel(0, "event", undefined, L)).toBe("0 events");
    expect(countLabel(9, "event", undefined, L)).toBe("9 events");
    expect(countLabel(12345, "event", undefined, L)).toBe(`12${g}345 events`);
    expect(countLabel(2, "match", "matches", L)).toBe("2 matches");
  });
});

describe("formatWhen", () => {
  it("medium date + short time, on one line, the month in English", () => {
    expect(formatWhen("2024-11-07T08:15:00Z", undefined, "UTC")).toBe("7 Nov 2024, 08:15");
  });
  it("an em dash when missing, the raw string when unparseable", () => {
    expect(formatWhen(undefined)).toBe("—");
    expect(formatWhen("")).toBe("—");
    expect(formatWhen("not a date")).toBe("not a date");
  });
});

describe("formatDate", () => {
  it("the day only, in the given locale (Norwegian by default)", () => {
    expect(formatDate("2026-10-08T09:30:00.000Z", undefined, "UTC")).toBe("08.10.2026");
    expect(formatDate("2026-10-08T09:30:00.000Z", "en-GB", "UTC")).toBe("08/10/2026");
    expect(formatDate("2026-10-08T09:30:00.000Z", "en-US", "UTC")).toBe("10/08/2026");
  });
  it("the raw text when it is not a date, so nothing is hidden", () => {
    expect(formatDate("not a date")).toBe("not a date");
  });
});

describe("databaseTitle", () => {
  it("joins owner and description", () => {
    expect(databaseTitle({ owner: "Acme", description: "Trucks." })).toBe("Acme: Trucks.");
  });

  it("falls back to whichever is non-blank", () => {
    expect(databaseTitle({ owner: "", description: "Trucks." })).toBe("Trucks.");
    expect(databaseTitle({ owner: "Acme", description: "" })).toBe("Acme");
  });

  it("is empty when both are blank", () => {
    expect(databaseTitle({ owner: "", description: "" })).toBe("");
  });
});

describe("hoverTitle (the full text of a cut-off choice or value)", () => {
  it("is the text, trimmed", () => {
    expect(hoverTitle("  a long value ")).toBe("a long value");
  });

  // null: no title attribute at all. An empty title="" still hides a
  // parent's title and is an odd thing to leave behind.
  it("is null when there is nothing to show", () => {
    expect(hoverTitle("")).toBeNull();
    expect(hoverTitle("   ")).toBeNull();
    expect(hoverTitle(null)).toBeNull();
    expect(hoverTitle(undefined)).toBeNull();
  });

  it("is null for a placeholder: it is not a choice", () => {
    expect(hoverTitle("Choose…", true)).toBeNull();
  });
});
