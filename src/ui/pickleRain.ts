/** One falling pickle. All values are plain numbers so they are easy to test. */
export interface RainDrop {
  src: string;
  /** Distance from the left edge, 0–100. */
  leftPct: number;
  sizePx: number;
  delayMs: number;
  durationMs: number;
  /** Total turn while falling. */
  spinDeg: number;
}

const DROPS = 30;

/**
 * A click counter: the returned function is called on every click and says
 * whether this click was the `required`-th within `windowMs`. After it fires
 * it starts counting from zero again.
 */
export function createClickCounter(
  required = 5,
  windowMs = 3000,
  now: () => number = Date.now,
): () => boolean {
  let times: number[] = [];
  return () => {
    const t = now();
    times = [...times.filter((x) => t - x < windowMs), t];
    if (times.length < required) return false;
    times = [];
    return true;
  };
}

/** Where, how big and how fast each pickle falls. `random` returns [0, 1). */
export function planRain(srcs: string[], random: () => number, count = DROPS): RainDrop[] {
  if (srcs.length === 0) return [];
  return Array.from({ length: count }, () => ({
    src: srcs[Math.floor(random() * srcs.length)]!,
    leftPct: random() * 100,
    sizePx: 24 + random() * 48,
    delayMs: random() * 1500,
    durationMs: 1800 + random() * 1000,
    spinDeg: (random() - 0.5) * 720,
  }));
}

/** Resolve to the files among `srcs` that actually load (a replaced or
 *  removed mascot file must not leave broken-image icons falling). */
function loadable(srcs: string[]): Promise<string[]> {
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<string | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(src);
          img.onerror = () => resolve(null);
          img.src = src;
        }),
    ),
  ).then((all) => all.filter((s): s is string => s !== null));
}

let raining = false;

/**
 * Make the given pickle files fall from the top of the screen for a few
 * seconds. Ignored while it is already raining. The overlay ignores the
 * mouse, is hidden from screen readers and removes itself afterwards. The
 * motion is a CSS animation (styles.css, `.qb-rain-drop`); this only creates
 * the elements.
 */
export function startRain(srcs: string[]): void {
  if (raining) return;
  raining = true;
  void loadable([...new Set(srcs)]).then((available) => {
    const drops = planRain(available, Math.random);
    if (drops.length === 0) {
      raining = false;
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "qb-rain";
    overlay.setAttribute("aria-hidden", "true");
    for (const d of drops) {
      const img = document.createElement("img");
      img.className = "qb-rain-drop";
      img.src = d.src;
      img.alt = "";
      img.style.setProperty("--x", `${d.leftPct}%`);
      img.style.setProperty("--size", `${d.sizePx}px`);
      img.style.setProperty("--delay", `${d.delayMs}ms`);
      img.style.setProperty("--dur", `${d.durationMs}ms`);
      img.style.setProperty("--spin", `${d.spinDeg}deg`);
      overlay.append(img);
    }
    document.body.append(overlay);
    const longest = Math.max(...drops.map((d) => d.delayMs + d.durationMs));
    window.setTimeout(() => {
      overlay.remove();
      raining = false;
    }, longest + 200);
  });
}
