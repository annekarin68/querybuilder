import { describe, it, expect, vi } from "vitest";
import { debounce } from "../../src/util/debounce";

describe("debounce", () => {
  it("calls once after the quiet period, with the latest args", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 400);
    d(1);
    d(2);
    d(3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });
});
