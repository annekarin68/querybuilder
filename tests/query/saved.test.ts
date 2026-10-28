import { describe, it, expect } from "vitest";
import { hasUnsavedWork, isEdited, saveTarget, type OpenSaved } from "../../src/query/saved";
import { emptyQuery, newBlock, setNegated, updateNode } from "../../src/query/tree";
import type { Group } from "../../src/query/types";

const block = newBlock("thing");
const query: Group = { ...emptyQuery(), children: [block] };
const open: OpenSaved = { id: "s1", name: "Weekly", note: "", query, databaseIds: ["a", "b"] };

describe("saved-query comparisons", () => {
  it("is not edited by a fold or a different database order", () => {
    expect(isEdited(open, updateNode(query, block.id, { collapsed: true }), ["b", "a"])).toBe(
      false,
    );
  });

  it("is edited by a real change", () => {
    expect(isEdited(open, setNegated(query, block.id, true), ["a", "b"])).toBe(true);
    expect(isEdited(open, query, ["a"])).toBe(true);
  });

  it("has unsaved work once a block exists that is not saved", () => {
    expect(hasUnsavedWork(null, emptyQuery(), [])).toBe(false);
    expect(hasUnsavedWork(null, query, [])).toBe(true);
    expect(hasUnsavedWork(open, query, ["a", "b"])).toBe(false);
  });

  it("updates under its own name, creates under another", () => {
    expect(saveTarget(" weekly ", open)).toEqual({ kind: "update", id: "s1" });
    expect(saveTarget("Monthly", open)).toEqual({ kind: "create" });
  });
});
