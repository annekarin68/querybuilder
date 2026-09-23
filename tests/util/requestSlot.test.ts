import { describe, it, expect } from "vitest";
import { requestSlot } from "../../src/util/requestSlot";

describe("requestSlot", () => {
  it("a started request is current until something replaces it", () => {
    const slot = requestSlot();
    const req = slot.start();
    expect(req.isStale()).toBe(false);
    expect(req.signal.aborted).toBe(false);
  });

  it("starting a new request aborts and outdates the previous one", () => {
    const slot = requestSlot();
    const first = slot.start();
    const second = slot.start();
    expect(first.isStale()).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.isStale()).toBe(false);
  });

  it("cancel() aborts and outdates the current request", () => {
    const slot = requestSlot();
    const req = slot.start();
    slot.cancel();
    expect(req.isStale()).toBe(true);
    expect(req.signal.aborted).toBe(true);
  });

  it("a request stays stale even if a later one has identical content (edit-and-undo)", () => {
    const slot = requestSlot();
    const before = slot.start();
    slot.cancel(); // the user edited the query…
    slot.start(); // …then undid it: same query, new request
    expect(before.isStale()).toBe(true);
  });
});
