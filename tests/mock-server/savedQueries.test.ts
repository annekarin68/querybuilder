import { describe, it, expect } from "vitest";
import {
  createSavedQueryStore,
  readSavedQueryBody,
  savedQueryIdFrom,
  savedQueryOwner,
} from "../../mock-server/savedQueries";
import type { SavedQueryRequest, SavedQueryResponse } from "../../src/api/types";
import { unfinishedRequest } from "../savedQueryFixtures";

/** A store whose clock and ids the test controls. `tick` moves the clock on. */
function testStore() {
  let ms = Date.parse("2026-10-08T09:00:00.000Z");
  let n = 0;
  const store = createSavedQueryStore(
    () => new Date(ms),
    () => `id-${++n}`,
  );
  return { store, tick: (by = 1000) => (ms += by) };
}

const draft = (name: string, over: Partial<SavedQueryRequest> = {}): SavedQueryRequest => ({
  ...unfinishedRequest,
  name,
  ...over,
});

const names = (answer: { body?: unknown }) =>
  (answer.body as SavedQueryResponse[]).map((q) => q.name);

describe("the saved-query store", () => {
  it("starts empty", () => {
    expect(testStore().store.list("ann")).toEqual({ status: 200, body: [] });
  });

  it("creates with 201, an id and updated_at, keeping the body as sent", () => {
    const { store } = testStore();
    expect(store.create("ann", draft("First"))).toEqual({
      status: 201,
      body: { ...draft("First"), id: "id-1", updated_at: "2026-10-08T09:00:00.000Z" },
    });
  });

  it("lists newest updated_at first, and the newer-created first on a tie", () => {
    const { store, tick } = testStore();
    store.create("ann", draft("A"));
    store.create("ann", draft("B")); // same instant as A
    tick();
    store.create("ann", draft("C"));
    expect(names(store.list("ann"))).toEqual(["C", "B", "A"]);
    tick();
    store.update("ann", "id-1", draft("A"));
    expect(names(store.list("ann"))).toEqual(["A", "C", "B"]);
  });

  it("keeps each user's list apart: another user sees none, and gets 404 on update and delete", () => {
    const { store } = testStore();
    store.create("ann", draft("Mine"));
    expect(store.list("bob")).toEqual({ status: 200, body: [] });
    expect(store.update("bob", "id-1", draft("Mine")).status).toBe(404);
    expect(store.remove("bob", "id-1").status).toBe(404);
    expect(names(store.list("ann"))).toEqual(["Mine"]);
  });

  it("lets two users use the same name", () => {
    const { store } = testStore();
    expect(store.create("ann", draft("Same")).status).toBe(201);
    expect(store.create("bob", draft("Same")).status).toBe(201);
  });

  it("answers 409 for a name that is taken, ignoring case and outer spaces", () => {
    const { store } = testStore();
    store.create("ann", draft("Slow Trips"));
    expect(store.create("ann", draft("  slow trips "))).toEqual({
      status: 409,
      body: { error: 'A saved query called "slow trips" already exists.' },
    });
    expect(names(store.list("ann"))).toEqual(["Slow Trips"]);
  });

  it("updates in place: the same id, a new updated_at, the new content", () => {
    const { store, tick } = testStore();
    store.create("ann", draft("Old"));
    tick();
    const answer = store.update("ann", "id-1", draft("New", { note: "changed" }));
    expect(answer).toEqual({
      status: 200,
      body: {
        ...draft("New", { note: "changed" }),
        id: "id-1",
        updated_at: "2026-10-08T09:00:01.000Z",
      },
    });
    expect(names(store.list("ann"))).toEqual(["New"]);
  });

  it("lets a saved query keep its own name (case changes included) but not take another's", () => {
    const { store } = testStore();
    store.create("ann", draft("One"));
    store.create("ann", draft("Two"));
    expect(store.update("ann", "id-1", draft("One")).status).toBe(200);
    expect(store.update("ann", "id-1", draft("ONE")).status).toBe(200);
    expect(store.update("ann", "id-1", draft(" two ")).status).toBe(409);
  });

  it("answers 404 when updating an id that does not exist", () => {
    expect(testStore().store.update("ann", "nope", draft("X"))).toEqual({
      status: 404,
      body: { error: "No saved query with that id." },
    });
  });

  it("deletes with 204 and no body, then 404", () => {
    const { store } = testStore();
    store.create("ann", draft("Gone"));
    expect(store.remove("ann", "id-1")).toEqual({ status: 204 });
    expect(store.list("ann").body).toEqual([]);
    expect(store.remove("ann", "id-1")).toEqual({
      status: 404,
      body: { error: "No saved query with that id." },
    });
  });

  it("makes ids like sq-1, sq-2 by default", () => {
    const store = createSavedQueryStore();
    const first = store.create("ann", draft("A")).body as SavedQueryResponse;
    const second = store.create("ann", draft("B")).body as SavedQueryResponse;
    expect([first.id, second.id]).toEqual(["sq-1", "sq-2"]);
  });
});

describe("readSavedQueryBody: is this a well-formed SavedQueryRequest?", () => {
  const ok = (body: unknown) => readSavedQueryBody(body);
  const bad = (body: unknown) => {
    const r = readSavedQueryBody(body);
    return r.ok ? null : r.error;
  };
  const withQuery = (query: unknown) => ({ ...unfinishedRequest, query });
  const group = (...children: unknown[]) => ({ kind: "group", operator: "AND", children });
  const condition = { kind: "condition", field_id: "size", operator_id: "gt", value: 3 };
  const block = (...conditions: unknown[]) => ({
    kind: "facet",
    facet_id: "thing",
    negated: false,
    operator: "AND",
    conditions,
  });
  /** A query saved before facet blocks: a condition directly in a group. */
  const oldCondition = { ...condition, facet_id: "thing" };

  it("accepts a half-built draft: nulls, a null inside a pair, an empty group", () => {
    expect(ok(unfinishedRequest)).toEqual({ ok: true, body: unfinishedRequest });
  });

  it("accepts nodes that still carry an id (sent by an older build), and does not check it", () => {
    const withIds = {
      ...group({ ...block({ ...condition, id: 1 }), id: 1 }, { ...block(), id: 1 }),
      id: " ",
    };
    expect(ok(withQuery(withIds)).ok).toBe(true);
  });

  it("accepts a block with nothing set, and a field condition with no operator yet", () => {
    const unfinished = block({ ...condition, operator_id: null, value: null });
    expect(ok(withQuery(group(block(), unfinished))).ok).toBe(true);
  });

  it("accepts a draft with no databases and a root without children", () => {
    expect(ok({ ...unfinishedRequest, databases: [], query: group() }).ok).toBe(true);
  });

  it("trims name and note", () => {
    expect(ok({ ...unfinishedRequest, name: " A ", note: " b " })).toMatchObject({
      ok: true,
      body: { name: "A", note: "b" },
    });
  });

  it("accepts an 80-character name and note", () => {
    const eighty = "x".repeat(80);
    expect(ok({ ...unfinishedRequest, name: eighty, note: eighty }).ok).toBe(true);
  });

  it.each([
    ["a body that is not an object", null, "Body must be an object."],
    ["no name", { ...unfinishedRequest, name: undefined }, "name must be 1 to 80 characters."],
    ["a blank name", { ...unfinishedRequest, name: "   " }, "name must be 1 to 80 characters."],
    [
      "a name over 80 characters",
      { ...unfinishedRequest, name: "x".repeat(81) },
      "name must be 1 to 80 characters.",
    ],
    [
      "a name that is a number",
      { ...unfinishedRequest, name: 5 },
      "name must be 1 to 80 characters.",
    ],
    [
      "no note",
      { ...unfinishedRequest, note: undefined },
      "note must be text of at most 80 characters.",
    ],
    [
      "a note over 80 characters",
      { ...unfinishedRequest, note: "x".repeat(81) },
      "note must be text of at most 80 characters.",
    ],
    [
      "databases that is not a list",
      { ...unfinishedRequest, databases: "a" },
      "databases must be a list of strings.",
    ],
    [
      "a database that is not a string",
      { ...unfinishedRequest, databases: ["a", 2] },
      "databases[1] must be a non-blank string.",
    ],
    [
      "a blank database id",
      { ...unfinishedRequest, databases: ["a", "  "] },
      "databases[1] must be a non-blank string.",
    ],
    ["no query", { ...unfinishedRequest, query: undefined }, "query must be an object."],
    ["a root that is a facet block", withQuery(block()), 'query.kind must be "group".'],
    [
      // Old queries are not migrated (spec, decision 9): refused, saying where.
      "a query in the shape before facet blocks",
      withQuery(group(block(), oldCondition)),
      'query.children[1].kind must be "group" or "facet".',
    ],
    [
      "a child of unknown kind",
      withQuery(group({ ...block(), kind: "other" })),
      'query.children[0].kind must be "group" or "facet".',
    ],
    [
      "a group operator that is neither",
      withQuery({ ...group(), operator: "XOR" }),
      'query.operator must be "AND" or "OR".',
    ],
    [
      "children that is not a list",
      withQuery({ ...group(), children: {} }),
      "query.children must be a list.",
    ],
    [
      "a block operator that is neither",
      withQuery(group({ ...block(), operator: "all" })),
      'query.children[0].operator must be "AND" or "OR".',
    ],
    [
      "a facet_id that is a number",
      withQuery(group(block(), { ...block(), facet_id: 3 })),
      "query.children[1].facet_id must be a non-blank string.",
    ],
    [
      "a block without a facet",
      withQuery(group({ ...block(), facet_id: null })),
      "query.children[0].facet_id must be a non-blank string.",
    ],
    [
      "negated that is not true or false",
      withQuery(group({ ...block(), negated: "no" })),
      "query.children[0].negated must be true or false.",
    ],
    [
      "conditions that is not a list",
      withQuery(group({ ...block(), conditions: {} })),
      "query.children[0].conditions must be a list.",
    ],
    [
      "a block holding a group",
      withQuery(group(block(group()))),
      'query.children[0].conditions[0].kind must be "condition".',
    ],
    [
      "a field condition that is not an object",
      withQuery(group(block(3))),
      "query.children[0].conditions[0] must be an object.",
    ],
    [
      "an operator_id that is an empty string",
      withQuery(group(block({ ...condition, operator_id: "" }))),
      "query.children[0].conditions[0].operator_id must be a non-blank string or null.",
    ],
    [
      "a field_id of spaces",
      withQuery(group(block({ ...condition, field_id: "  " }))),
      "query.children[0].conditions[0].field_id must be a non-blank string.",
    ],
    [
      "a field_id that is null (no more whole-facet conditions)",
      withQuery(group(block({ ...condition, field_id: null }))),
      "query.children[0].conditions[0].field_id must be a non-blank string.",
    ],
    [
      "a value that is an object",
      withQuery(group(group(block({ ...condition, value: { from: 1 } })))),
      "query.children[0].children[0].conditions[0].value must be null, a string, number or boolean, or a list of them (a list may hold nulls).",
    ],
    [
      "a value list holding a list",
      withQuery(group(block({ ...condition, value: [[1]] }))),
      "query.children[0].conditions[0].value must be null, a string, number or boolean, or a list of them (a list may hold nulls).",
    ],
  ])("rejects %s, naming the first problem", (_label, body, message) => {
    expect(bad(body)).toBe(message);
  });
});

describe("savedQueryIdFrom: the {id} of a saved-query path", () => {
  const api = "/test-api/v9";

  it("returns the decoded id", () => {
    expect(savedQueryIdFrom(`${api}/filter/saved/sq-1`, api)).toBe("sq-1");
    expect(savedQueryIdFrom(`${api}/filter/saved/a%2Fb`, api)).toBe("a/b");
  });

  it.each([
    ["the list path", `${api}/filter/saved`],
    ["the list path with a slash", `${api}/filter/saved/`],
    ["a longer path", `${api}/filter/saved/a/b`],
    ["another prefix", `/other/filter/saved/sq-1`],
    ["another resource", `${api}/databases/sq-1`],
    ["broken percent-encoding", `${api}/filter/saved/%E0%A4%A`],
  ])("returns null for %s", (_label, pathname) => {
    expect(savedQueryIdFrom(pathname, api)).toBeNull();
  });
});

describe("savedQueryOwner: whose list a session's user gets", () => {
  it("is the user's id (`sub`), or `user_id`, its other spelling", () => {
    expect(savedQueryOwner({ sub: "u-1", user_id: "u-2" })).toBe("u-1");
    expect(savedQueryOwner({ user_id: "u-2" })).toBe("u-2");
  });

  // Every user without an id would otherwise share one list under "".
  it("is null for a user with no id", () => {
    expect(savedQueryOwner({})).toBeNull();
    expect(savedQueryOwner({ sub: "" })).toBeNull();
  });
});
