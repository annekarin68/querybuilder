import { describe, it, expect, vi } from "vitest";
import {
  createStore,
  displayStateFor,
  initialState,
  runBlocker,
  type RunInputs,
} from "../src/state";
import { addChild, emptyQuery, groupOf, newBlock, removeNode } from "../src/query/tree";
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
    expect(initialState.easterEgg).toBe(false);
    expect(initialState.auth.status).toBe("loading");
    expect(initialState.compliance.status).toBe("loading");
    expect(initialState.sidebarCollapsed).toBe(false);
    expect(initialState.dropNotice).toBeNull();
  });

  it("initialState has no open field row and no folded field list opened", () => {
    expect(initialState.openField).toBeNull();
    expect(initialState.expandedBlockIds).toEqual([]);
  });

  it("initialState has no saved query open and the saved-queries dialogs closed", () => {
    expect(initialState).toMatchObject({
      openSaved: null,
      savedDialog: null,
      save: { status: "idle" },
      savedList: { status: "idle" },
      savedConfirm: null,
    });
  });
});

describe("runBlocker", () => {
  const catalog = buildFieldCatalog([]);
  const root = emptyQuery();
  const ready: RunInputs = {
    catalog,
    issues: [],
    serverIssues: [],
    query: addChild(root, root.id, newBlock("thing")),
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
    expect(runBlocker({ ...ready, query: emptyQuery() })).toBe("no-facet");
    // Empty groups are not a facet either.
    expect(runBlocker({ ...ready, query: { ...emptyQuery(), children: [groupOf([])] } })).toBe(
      "no-facet",
    );
    expect(
      runBlocker({
        ...ready,
        issues: [{ nodeId: "x", message: "m", kind: "incomplete" }],
      }),
    ).toBe("unfinished");
  });

  it("is 'rejected', after every other reason, when a database found a problem", () => {
    const issue = { nodeId: "x", message: "m", kind: "invalid" as const };
    expect(runBlocker({ ...ready, serverIssues: [issue] })).toBe("rejected");
    expect(runBlocker({ ...ready, serverIssues: [issue], issues: [issue] })).toBe("unfinished");
  });
});

describe("displayStateFor", () => {
  const a = newBlock("thing");
  const b = newBlock("other");
  const inner = groupOf([b]);
  const query = { ...emptyQuery(), children: [a, inner] };
  const display = {
    openField: { blockId: b.id, fieldId: "size" },
    expandedBlockIds: [a.id, b.id],
  };

  it("keeps display state whose blocks are all in the query, as the same object", () => {
    expect(displayStateFor(query, display)).toBe(display);
    expect(displayStateFor(query, { openField: null, expandedBlockIds: [] })).toEqual({
      openField: null,
      expandedBlockIds: [],
    });
  });

  it("drops the ids of a block that was removed, with the group around it", () => {
    expect(displayStateFor(removeNode(query, b.id), display)).toEqual({
      openField: null,
      expandedBlockIds: [a.id],
    });
    expect(displayStateFor(removeNode(query, inner.id), display)).toEqual({
      openField: null,
      expandedBlockIds: [a.id],
    });
  });

  it("drops an id that is no block at all (a group's id, or a stranger's)", () => {
    const odd = { openField: null, expandedBlockIds: [inner.id, "gone", a.id] };
    expect(displayStateFor(query, odd).expandedBlockIds).toEqual([a.id]);
  });

  it("drops everything when the query was replaced by one without those blocks", () => {
    expect(displayStateFor(emptyQuery(), display)).toEqual({
      openField: null,
      expandedBlockIds: [],
    });
  });
});
