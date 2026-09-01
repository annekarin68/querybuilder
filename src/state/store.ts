/**
 * A minimal, dependency-free observable store. This is the entire
 * "state management" layer the builder needs: components read the
 * current state, subscribe to changes, and dispatch updates. It's
 * intentionally generic (not query-builder-specific) so it could back
 * any other vanilla-component feature in this app.
 */
export type Listener<TState> = (state: TState) => void;
export type Unsubscribe = () => void;

export class Store<TState> {
  #state: TState;
  #listeners = new Set<Listener<TState>>();

  constructor(initialState: TState) {
    this.#state = initialState;
  }

  getState(): TState {
    return this.#state;
  }

  /** Replaces state (given the previous state) and notifies subscribers. */
  setState(updater: TState | ((previous: TState) => TState)): void {
    const next = typeof updater === "function" ? (updater as (previous: TState) => TState)(this.#state) : updater;
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener(this.#state);
  }

  subscribe(listener: Listener<TState>): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
