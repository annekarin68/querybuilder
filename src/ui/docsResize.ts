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
    current = applyWidth(current + step);
    show();
    remember(current);
  });
}
