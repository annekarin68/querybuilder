import { describe, it, expect, vi } from "vitest";
import { createClickCounter, planRain, withTimeout } from "../../src/ui/pickleRain";

describe("createClickCounter", () => {
  it("fires on the fifth click within three seconds", () => {
    const t = 0;
    const click = createClickCounter(5, 3000, () => t);
    expect([1, 2, 3, 4].map(() => click())).toEqual([false, false, false, false]);
    expect(click()).toBe(true);
  });
  it("does not fire when the clicks are too slow", () => {
    let t = 0;
    const click = createClickCounter(5, 3000, () => t);
    for (let i = 0; i < 4; i++) {
      click();
      t += 1000;
    }
    expect(click()).toBe(false); // the first click is now 4s old
  });
  it("starts counting again after firing", () => {
    const t = 0;
    const click = createClickCounter(2, 3000, () => t);
    click();
    expect(click()).toBe(true);
    expect(click()).toBe(false);
    expect(click()).toBe(true);
  });
});

describe("planRain", () => {
  const srcs = ["/a.svg", "/b.svg", "/c.svg"];
  const counter = () => {
    let i = 0;
    return () => [0.05, 0.5, 0.95, 0.3][i++ % 4]!;
  };
  it("plans the requested number of drops using only the given files", () => {
    const drops = planRain(srcs, counter(), 30);
    expect(drops).toHaveLength(30);
    expect(drops.every((d) => srcs.includes(d.src))).toBe(true);
  });
  it("keeps every drop on screen, sized sensibly and with a delay and duration", () => {
    for (const d of planRain(srcs, counter(), 30)) {
      expect(d.leftPct).toBeGreaterThanOrEqual(0);
      expect(d.leftPct).toBeLessThanOrEqual(100);
      expect(d.sizePx).toBeGreaterThanOrEqual(24);
      expect(d.sizePx).toBeLessThanOrEqual(72);
      expect(d.delayMs).toBeGreaterThanOrEqual(0);
      expect(d.delayMs).toBeLessThanOrEqual(1500);
      expect(d.durationMs).toBeGreaterThanOrEqual(1800);
      expect(d.durationMs).toBeLessThanOrEqual(2800);
    }
  });
  it("plans nothing when no file is available", () => {
    expect(planRain([], Math.random, 30)).toEqual([]);
  });
});

describe("withTimeout", () => {
  it("gives the result of a promise that settles in time", async () => {
    await expect(withTimeout(Promise.resolve("loaded"), 50, "late")).resolves.toBe("loaded");
  });
  it("gives the fallback when the promise never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = withTimeout(new Promise<string>(() => {}), 2000, "late");
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).resolves.toBe("late");
    } finally {
      vi.useRealTimers();
    }
  });
});
