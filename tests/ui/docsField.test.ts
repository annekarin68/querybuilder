import { describe, it, expect } from "vitest";
import { fieldPreview } from "../../src/ui/docsField";

describe("fieldPreview", () => {
  it("a field with nothing has nothing to show or open", () => {
    expect(fieldPreview({ comment: "", description: "" }, 0)).toEqual({ text: null, more: [] });
  });

  it("one text and no values: show it, nothing more to open", () => {
    expect(fieldPreview({ comment: "", description: "Theirs." }, 0)).toEqual({
      text: { body: "Theirs.", source: "thirdParty" },
      more: [],
    });
  });

  it("our comment is the one shown when there are both; opening adds theirs", () => {
    expect(fieldPreview({ comment: "Ours.", description: "Theirs." }, 0)).toEqual({
      text: { body: "Ours.", source: "ours" },
      more: ["third-party description"],
    });
  });

  it("known values are always more", () => {
    expect(fieldPreview({ comment: "Ours.", description: "" }, 1).more).toEqual([
      "1 previously seen value",
    ]);
    expect(fieldPreview({ comment: "Ours.", description: "Theirs." }, 12).more).toEqual([
      "third-party description",
      "12 previously seen values",
    ]);
  });
});
