import { afterEach, describe, expect, it } from "vitest";
import { draggedItem, forgetDrag, rememberDrag } from "../../src/ui/dragMemory";

describe("dragMemory", () => {
  afterEach(forgetDrag);

  it("knows nothing until the dictionary picks something up", () => {
    expect(draggedItem()).toBeNull();
  });

  it("remembers the dragged item until the drag ends", () => {
    rememberDrag({ type: "field", facetId: "thing", fieldId: "size" });
    expect(draggedItem()).toEqual({ type: "field", facetId: "thing", fieldId: "size" });
    forgetDrag();
    expect(draggedItem()).toBeNull();
  });
});
