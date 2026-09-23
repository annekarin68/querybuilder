/** One request that a slot started. */
export interface SlotRequest {
  /** Pass to fetch() so the request is aborted when it is superseded. */
  signal: AbortSignal;
  /** True once a newer request started or the slot was cancelled — its
   *  response (or error) must then be ignored. */
  isStale(): boolean;
}

/**
 * At most one in-flight request of a kind (stats, preview). `start()` aborts the
 * previous one; `cancel()` aborts without starting another.
 *
 * This is the whole stale-response guard (docs/ARCHITECTURE.md, "Correctness
 * invariant"): every
 * change to the query or the selected databases cancels the slot, so a
 * response is only applied while its request is still the slot's current one.
 * Checking identity rather than comparing query contents also covers
 * edit-and-undo, where an old request's query equals the new one's.
 */
export function requestSlot() {
  let current: AbortController | null = null;
  return {
    start(): SlotRequest {
      current?.abort();
      const ctrl = new AbortController();
      current = ctrl;
      return { signal: ctrl.signal, isStale: () => current !== ctrl };
    },
    cancel(): void {
      current?.abort();
      current = null;
    },
  };
}
