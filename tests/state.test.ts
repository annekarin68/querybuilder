import { describe, it, expect } from "vitest";
import { createStore, initialState, store } from "../src/state";

describe("state store", () => {
  it("initialState has the expected shape with all required fields", () => {
    expect(initialState).toHaveProperty("activeView");
    expect(initialState).toHaveProperty("query");
    expect(initialState).toHaveProperty("issues");
    expect(initialState).toHaveProperty("stats");
    expect(initialState).toHaveProperty("preview");
    expect(initialState).toHaveProperty("schema");
    expect(initialState).toHaveProperty("sidebarCollapsed");
    expect(initialState.stats).toHaveProperty("status");
    expect(initialState.stats).toHaveProperty("data");
    expect(initialState.stats).toHaveProperty("error");
    expect(initialState.preview).toHaveProperty("page");
  });

  it("createStore getState returns state and setState shallow-merges with change notification", () => {
    const st = createStore(initialState);
    const listeners: Array<[typeof initialState, Set<string>]> = [];

    st.subscribe((s, changed) => {
      listeners.push([s, changed]);
    });

    const before = st.getState();
    st.setState({ sidebarCollapsed: !before.sidebarCollapsed });
    const after = st.getState();

    expect(before).not.toBe(after);
    expect(after.sidebarCollapsed).not.toBe(before.sidebarCollapsed);
    expect(listeners).toHaveLength(1);
    const [newState, changedKeys] = listeners[0]!;
    expect(changedKeys.has("sidebarCollapsed")).toBe(true);
    expect(newState.sidebarCollapsed).toBe(!before.sidebarCollapsed);
  });

  it("multiple subscribers are notified and module singleton store works", () => {
    const st = createStore(initialState);
    const called: number[] = [];

    st.subscribe(() => called.push(1));
    st.subscribe(() => called.push(2));

    st.setState({ sidebarCollapsed: true });

    expect(called).toEqual([1, 2]);

    const before = store.getState();
    store.setState({ sidebarCollapsed: !before.sidebarCollapsed });
    const after = store.getState();

    expect(after.sidebarCollapsed).not.toBe(before.sidebarCollapsed);
  });
});
