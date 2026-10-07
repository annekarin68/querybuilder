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
  /** Apply everything pending NOW, in arrival order. Safe to call at any time:
   *  the queue is emptied first, so whichever of this and a scheduled task
   *  comes first does the work and the other finds nothing to do. Used before
   *  a button's click is handled (the handler must see the typed value) and
   *  when the window loses focus (the pointer-up may never arrive). */
  flush(): void;
}

export function createAfterPointer(deps: {
  isPointerDown: () => boolean;
  /** Runs the task on a LATER macrotask (the browser's `setTimeout(task, 0)`). */
  schedule: (task: () => void) => void;
}): AfterPointer {
  // ONE queue, so every way of flushing sees the same pending commits.
  let pending: Array<() => void> = [];
  function flush(): void {
    const commits = pending;
    pending = [];
    commits.forEach((commit) => commit());
  }
  return {
    run(commit) {
      pending.push(commit);
      if (!deps.isPointerDown()) deps.schedule(flush);
    },
    pointerReleased() {
      // `pointerup` and the `click` it causes are dispatched in the same task,
      // so a later macrotask runs after the click.
      if (pending.length > 0) deps.schedule(flush);
    },
    flush,
  };
}

/**
 * What `shouldFlushBeforeClick` needs to know about the element a click landed
 * on. A plain object (not an `Element`) so the Node-only tests can build one;
 * each flag means "the element itself or one of its ancestors".
 */
export interface ClickTargetDescription {
  /** A `<button>`. */
  inButton: boolean;
  /** An `<a href>`: the top bar's Log in link and the compliance link are links, not buttons. */
  inLink: boolean;
  /** An element with a `data-action` attribute (a button-like `<i>` or `<div>` too). */
  inDataAction: boolean;
  /** A Fomantic `.ui.dropdown`. */
  inDropdown: boolean;
  /** A Fomantic `.ui.checkbox`. */
  inCheckbox: boolean;
}

/**
 * Whether a held edit must be applied BEFORE this click is handled: true for
 * anything that acts on the query when clicked, so it sees the typed value.
 * That includes links, because a link that saves the query and then leaves the
 * page (Log in) would otherwise save it without the value.
 *
 * False inside a Fomantic dropdown or checkbox: the repaint destroys Fomantic's
 * handlers, so repainting before their click would make the click do nothing;
 * they use the after-the-click timeout instead.
 */
export function shouldFlushBeforeClick(target: ClickTargetDescription): boolean {
  if (target.inDropdown || target.inCheckbox) return false;
  return target.inButton || target.inLink || target.inDataAction;
}
