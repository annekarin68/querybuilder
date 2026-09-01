import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "../../src/util/debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delays calling the function until the wait time passes", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("resets the timer on subsequent calls and passes arguments", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("arg1");
    vi.advanceTimersByTime(50);
    debounced("arg2");
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith("arg2");
  });

  it("cancel method clears the pending call and allows re-debouncing", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });
});
