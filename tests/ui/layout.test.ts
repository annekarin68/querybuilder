import { describe, it, expect } from "vitest";
import { docsToggle } from "../../src/ui/layout";

describe("docsToggle", () => {
  it("while the docs are open, it offers to hide them", () => {
    expect(docsToggle(false)).toEqual({
      icon: "angle double left",
      label: "Hide dictionary",
      title: "Hide the data dictionary",
    });
  });

  it("while the docs are hidden, it offers to show them", () => {
    expect(docsToggle(true)).toEqual({
      icon: "angle double right",
      label: "Show dictionary",
      title: "Show the data dictionary",
    });
  });
});
