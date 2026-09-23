import { describe, it, expect, vi } from "vitest";
import { createStore, initialState, runBlocker, type AppState } from "../src/state";
import { addChild, emptyQuery, newCondition } from "../src/query/tree";
import { buildFieldCatalog } from "../src/query/fieldCatalog";

describe("store", () => {
  it("setState shallow-merges and keeps other keys", () => {
    const s = createStore(initialState);
    s.setState({ sidebarCollapsed: true });
    expect(s.getState().sidebarCollapsed).toBe(true);
    expect(s.getState().activeView).toBe("filter");
  });

  it("subscribers receive the new state and the set of changed keys", () => {
    const s = createStore(initialState);
    const seen: string[] = [];
    s.subscribe((_state, changed) => {
      seen.push(...changed);
    });
    s.setState({ activeView: "review" });
    expect(seen).toEqual(["activeView"]);
  });

  it("unsubscribe stops notifications", () => {
    const s = createStore(initialState);
    const spy = vi.fn();
    const off = s.subscribe(spy);
    off();
    s.setState({ sidebarCollapsed: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("initialState has an empty AND-group query and idle panels", () => {
    expect(initialState.query).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(initialState.stats.status).toBe("idle");
    expect(initialState.preview.status).toBe("idle");
    expect(initialState.auth.status).toBe("loading");
    expect(initialState.compliance.status).toBe("loading");
    expect(initialState.sidebarCollapsed).toBe(true);
  });
});

describe("runBlocker", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const ready: Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds"> = {
    catalog,
    issues: [],
    query: addChild(root, root.id, newCondition()),
    selectedDatabaseIds: ["alpha"],
  };

  it("is null when the query can run", () => {
    expect(runBlocker(ready)).toBeNull();
  });

  it("names the first reason it cannot, in the order the panels explain them", () => {
    expect(runBlocker({ ...ready, catalog: null, selectedDatabaseIds: [] })).toBe("loading");
    expect(runBlocker({ ...ready, selectedDatabaseIds: [], query: emptyQuery() })).toBe(
      "no-database",
    );
    expect(runBlocker({ ...ready, query: emptyQuery() })).toBe("no-condition");
    expect(
      runBlocker({
        ...ready,
        issues: [{ nodeId: "x", message: "m", kind: "incomplete" }],
      }),
    ).toBe("unfinished");
  });
});
