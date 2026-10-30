import { describe, it, expect } from "vitest";
import { blockedText } from "../../src/ui/databasePicker";

// Both the Matching events card and the statistics use this helper, so this is
// how the Matching events card's "no databases" message is tested.
describe("blockedText", () => {
  const messages = { "no-database": "Select at least one database.", other: "Add a facet." };

  it("says no database is available when the backend lists none", () => {
    expect(blockedText("no-database", { databases: [] }, messages)).toBe(
      "No databases are available to you.",
    );
  });

  it("keeps the panel's own text otherwise", () => {
    expect(blockedText("no-database", { databases: null }, messages)).toBe(messages["no-database"]);
    expect(blockedText("other", { databases: [] }, messages)).toBe("Add a facet.");
  });
});
