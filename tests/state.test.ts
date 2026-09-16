import { describe, it, expect, vi } from "vitest";
import { canRunQuery, createStore, initialState, type AppState } from "../src/state";
import { addChild, emptyQuery, newCondition } from "../src/query/tree";
import type { SchemaResponse } from "../src/api/types";

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
  });
});

describe("canRunQuery", () => {
  const schema: SchemaResponse = { fields: [], operators: [] };

  function state(
    overrides: Partial<Pick<AppState, "schema" | "issues" | "query" | "selectedDatabaseIds">> = {},
  ): Pick<AppState, "schema" | "issues" | "query" | "selectedDatabaseIds"> {
    const root = emptyQuery();
    return {
      schema,
      issues: [],
      query: addChild(root, root.id, newCondition()),
      selectedDatabaseIds: ["alpha"],
      ...overrides,
    };
  }

  it("true when schema is loaded, no blocking issues, a condition exists, and a database is selected", () => {
    expect(canRunQuery(state())).toBe(true);
  });

  it("false when schema hasn't loaded yet", () => {
    expect(canRunQuery(state({ schema: null }))).toBe(false);
  });

  it("false when there's a blocking (error-severity) issue", () => {
    expect(canRunQuery(state({ issues: [{ nodeId: "x", message: "m", severity: "error" }] }))).toBe(
      false,
    );
  });

  it("true when the only issue is a warning", () => {
    expect(
      canRunQuery(state({ issues: [{ nodeId: "x", message: "m", severity: "warning" }] })),
    ).toBe(true);
  });

  it("false when the query has no conditions", () => {
    expect(canRunQuery(state({ query: emptyQuery() }))).toBe(false);
  });

  it("false when no database is selected", () => {
    expect(canRunQuery(state({ selectedDatabaseIds: [] }))).toBe(false);
  });
});
