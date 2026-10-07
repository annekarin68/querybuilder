/**
 * Decides WHEN a typed value is committed, because committing repaints the whole
 * query builder and a repaint at the wrong moment breaks the user's next action.
 * The browser fires `change` on a box when it loses focus, and that happens
 * BEFORE what the user did next has finished:
 *
 * - A mouse press on a button: `change` fires on mousedown, a repaint replaces
 *   the button under the pointer, and the click never lands. So while the
 *   pointer is down the commit is held until it is released and the click has
 *   been dispatched.
 * - Tab to the next control: `change` fires before the focus moves, so a
 *   repaint destroys the control the focus is moving to. So even with the
 *   pointer up the commit waits for the next macrotask, when the focus has
 *   already moved and the repaint can put it back (see "Focus across a repaint"
 *   in docs/ARCHITECTURE.md).
 *
 * Pure: the DOM (is the pointer down? what is a macrotask?) is injected, so the
 * Node-only tests can drive it by hand.
 */
export interface AfterPointer {
  /** Apply `commit` when it is safe: on the next macrotask, or, if the pointer
   *  is down now, once it has been released. Commits run in arrival order. */
  run(commit: () => void): void;
  /** Tell it the pointer went up or was cancelled (`pointerup`, `pointercancel`). */
  pointerReleased(): void;
}

export function createAfterPointer(deps: {
  isPointerDown: () => boolean;
  /** Runs the task on a LATER macrotask (the browser's `setTimeout(task, 0)`). */
  schedule: (task: () => void) => void;
}): AfterPointer {
  let held: Array<() => void> = [];
  return {
    run(commit) {
      if (deps.isPointerDown()) held.push(commit);
      else deps.schedule(commit);
    },
    pointerReleased() {
      if (held.length === 0) return;
      // Take the list now, so a second release before the task runs cannot
      // apply the same commits twice.
      const commits = held;
      held = [];
      // `pointerup` and the `click` it causes are dispatched in the same task,
      // so a later macrotask runs after the click.
      deps.schedule(() => commits.forEach((commit) => commit()));
    },
  };
}
