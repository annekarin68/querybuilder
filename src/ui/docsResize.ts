export const DOCS_MIN_REM = 20;
export const DOCS_MAX_REM = 40;
export const DOCS_DEFAULT_REM = 26;
const STORAGE_KEY = "qb:docs-width";
const KEY_STEP_REM = 1;

/** A sidebar width in rem, kept within the allowed range. */
export function clampDocsWidth(rem: number): number {
  if (!Number.isFinite(rem)) return DOCS_DEFAULT_REM;
  return Math.min(DOCS_MAX_REM, Math.max(DOCS_MIN_REM, rem));
}

/**
 * The width after one Left / Right press (`stepRem` is negative for Left).
 *
 * Shrinking steps from the smaller of the stored width and the width on screen:
 * under 1100 px CSS can cut the column to fit the window, so what the user sees
 * is not the stored width, and stepping from the stored one would change
 * nothing visible for the first few presses. Growing steps from the stored
 * width, so a grow key can never lower the remembered width (or the announced
 * aria-valuenow); in a cut column it may change nothing on screen, because
 * there is no room to grow into. An unusable visible width (0, NaN: not
 * measured, or the panel is folded) means "use the stored width". Where nothing
 * is cut the two widths are equal and this is plain stored + step.
 */
export function docsWidthAfterKey(storedRem: number, visibleRem: number, stepRem: number): number {
  const visibleIsKnown = Number.isFinite(visibleRem) && visibleRem > 0;
  const isShrinking = stepRem < 0;
  const startRem = visibleIsKnown && isShrinking ? Math.min(storedRem, visibleRem) : storedRem;
  return clampDocsWidth(startRem + stepRem);
}

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function applyWidth(rem: number): number {
  const clamped = clampDocsWidth(rem);
  document.documentElement.style.setProperty("--qb-docs-w", `${clamped}rem`);
  return clamped;
}

function remember(rem: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(rem));
  } catch {
    // Storage unavailable: the width just isn't remembered.
  }
}

function recall(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? DOCS_DEFAULT_REM : Number(saved);
  } catch {
    return DOCS_DEFAULT_REM;
  }
}

/**
 * Make `handle` (the sidebar's right edge) drag-resizable, and by keyboard
 * (Left / Right arrows). Restores the remembered width. Call once at startup.
 */
export function wireDocsResize(handle: HTMLElement): void {
  let current = applyWidth(recall());
  handle.setAttribute("aria-valuemin", String(DOCS_MIN_REM));
  handle.setAttribute("aria-valuemax", String(DOCS_MAX_REM));
  const show = () => handle.setAttribute("aria-valuenow", String(Math.round(current)));
  show();

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // only the primary button drags
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const left = handle.parentElement!.getBoundingClientRect().left;
    const move = (m: PointerEvent) => {
      current = applyWidth((m.clientX - left) / remPx());
      show();
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      remember(current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });

  handle.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? KEY_STEP_REM : e.key === "ArrowLeft" ? -KEY_STEP_REM : 0;
    if (!step) return;
    e.preventDefault();
    const visibleRem = handle.parentElement!.getBoundingClientRect().width / remPx();
    current = applyWidth(docsWidthAfterKey(current, visibleRem, step));
    show();
    remember(current);
  });
}
