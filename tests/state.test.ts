import { describe, it, expect, vi } from "vitest";
import { canRunQuery, createStore, initialState, runBlocker, type AppState } from "../src/state";
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

describe("canRunQuery", () => {
  const catalog = buildFieldCatalog([]);

  function state(
    overrides: Partial<Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds">> = {},
  ): Pick<AppState, "catalog" | "issues" | "query" | "selectedDatabaseIds"> {
    const root = emptyQuery();
    return {
      catalog,
      issues: [],
      query: addChild(root, root.id, newCondition()),
      selectedDatabaseIds: ["alpha"],
      ...overrides,
    };
  }

  it("true when the catalog is loaded, no blocking issues, a condition exists, and a database is selected", () => {
    expect(canRunQuery(state())).toBe(true);
  });

  it("false when the catalog hasn't loaded yet", () => {
    expect(canRunQuery(state({ catalog: null }))).toBe(false);
  });

  it("false when there's a blocking (error-severity) issue", () => {
    expect(
      canRunQuery(
        state({ issues: [{ nodeId: "x", message: "m", severity: "error", kind: "invalid" }] }),
      ),
    ).toBe(false);
  });

  it("true when the only issue is a warning", () => {
    expect(
      canRunQuery(
        state({ issues: [{ nodeId: "x", message: "m", severity: "warning", kind: "invalid" }] }),
      ),
    ).toBe(true);
  });

  it("false when the query has no conditions", () => {
    expect(canRunQuery(state({ query: emptyQuery() }))).toBe(false);
  });

  it("false when no database is selected", () => {
    expect(canRunQuery(state({ selectedDatabaseIds: [] }))).toBe(false);
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
        issues: [{ nodeId: "x", message: "m", severity: "error", kind: "incomplete" }],
      }),
    ).toBe("unfinished");
  });
});
