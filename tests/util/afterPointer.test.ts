import { describe, it, expect } from "vitest";
import {
  createAfterPointer,
  shouldFlushBeforeClick,
  type ClickTargetDescription,
} from "../../src/util/afterPointer";

/** A hand-run scheduler: tasks wait in a list until `runTasks` (the "next macrotask"). */
function setup() {
  let pointerDown = false;
  const tasks: Array<() => void> = [];
  const log: string[] = [];
  const afterPointer = createAfterPointer({
    isPointerDown: () => pointerDown,
    schedule: (task) => tasks.push(task),
  });
  return {
    afterPointer,
    log,
    press: () => (pointerDown = true),
    release: () => {
      pointerDown = false;
      afterPointer.pointerReleased();
    },
    runTasks: () => tasks.splice(0).forEach((task) => task()),
    commit: (name: string) => () => log.push(name),
  };
}

describe("createAfterPointer", () => {
  it("applies a change with the pointer up on the next macrotask, not synchronously", () => {
    // Not synchronously: the browser fires `change` before it moves the focus,
    // and the repaint would destroy the control the focus is moving to.
    const t = setup();
    t.afterPointer.run(t.commit("a"));
    expect(t.log).toEqual([]);
    t.runTasks();
    expect(t.log).toEqual(["a"]);
  });

  it("holds a change that arrives with the pointer down, even after the next macrotask", () => {
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.runTasks();
    expect(t.log).toEqual([]);
  });

  it("applies a held change after the pointer is released, on a later macrotask", () => {
    // The click is dispatched in the same task as the release; the commit must
    // come after it, or the repaint replaces the button before the click lands.
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.release();
    expect(t.log).toEqual([]);
    t.runTasks();
    expect(t.log).toEqual(["a"]);
  });

  it("applies two held changes in the order they arrived", () => {
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.afterPointer.run(t.commit("b"));
    t.release();
    t.runTasks();
    expect(t.log).toEqual(["a", "b"]);
  });

  it("does not apply a held change twice when the pointer is released twice", () => {
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.release();
    t.release();
    t.runTasks();
    expect(t.log).toEqual(["a"]);
  });

  it("keeps changes in order when a held one meets a later change with the pointer up", () => {
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("held"));
    t.release();
    t.afterPointer.run(t.commit("later"));
    t.runTasks();
    expect(t.log).toEqual(["held", "later"]);
  });

  it("flush applies the held changes in order, and the timeout then does nothing", () => {
    // A click on a button flushes before its handler reads the query; the
    // timeout scheduled by the release must not apply the changes again.
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.afterPointer.run(t.commit("b"));
    t.release();
    t.afterPointer.flush();
    expect(t.log).toEqual(["a", "b"]);
    t.runTasks();
    expect(t.log).toEqual(["a", "b"]);
  });

  it("flush applies a change waiting for the next macrotask, once", () => {
    const t = setup();
    t.afterPointer.run(t.commit("a"));
    t.afterPointer.flush();
    t.runTasks();
    expect(t.log).toEqual(["a"]);
  });

  it("flush with nothing pending does nothing", () => {
    const t = setup();
    t.afterPointer.flush();
    t.runTasks();
    expect(t.log).toEqual([]);
  });

  it("flush while the pointer is still down applies the changes (the window lost focus)", () => {
    const t = setup();
    t.press();
    t.afterPointer.run(t.commit("a"));
    t.afterPointer.flush();
    expect(t.log).toEqual(["a"]);
  });
});

describe("shouldFlushBeforeClick", () => {
  /** A click target that is none of the things the rule asks about; each test sets what it is about. */
  function clicked(overrides: Partial<ClickTargetDescription>): ClickTargetDescription {
    return {
      inButton: false,
      inLink: false,
      inDataAction: false,
      inDropdown: false,
      inCheckbox: false,
      ...overrides,
    };
  }

  it("flushes before a button is handled", () => {
    expect(shouldFlushBeforeClick(clicked({ inButton: true }))).toBe(true);
  });

  it("flushes before a link is followed: the Log in link saves the query on click", () => {
    expect(shouldFlushBeforeClick(clicked({ inLink: true }))).toBe(true);
  });

  it("flushes before an element with a data-action is handled", () => {
    expect(shouldFlushBeforeClick(clicked({ inDataAction: true }))).toBe(true);
  });

  it("does not flush inside a Fomantic dropdown: a repaint would swallow the click", () => {
    expect(shouldFlushBeforeClick(clicked({ inDropdown: true, inDataAction: true }))).toBe(false);
  });

  it("does not flush inside a Fomantic checkbox, for the same reason", () => {
    expect(shouldFlushBeforeClick(clicked({ inCheckbox: true, inButton: true }))).toBe(false);
  });

  it("does not flush for a click on plain text", () => {
    expect(shouldFlushBeforeClick(clicked({}))).toBe(false);
  });
});
