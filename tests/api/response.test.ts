import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContractError, ResponseValue } from "../../src/api/contract";
import {
  toCompliance,
  toDatabase,
  toDatabaseResult,
  toEvent,
  toFacet,
  toField,
  toUser,
} from "../../src/api/response";
import { toSavedQuery } from "../../src/api/legacy/savedResponse";
import { toSavedQueryRequest } from "../../src/api/legacy/request";
import {
  unfinishedDraft,
  unfinishedResponse,
  unfinishedTree,
  withoutNodeIds,
} from "../savedQueryFixtures";
import type { Group, QueryNode } from "../../src/query/legacy/types";
import type { SavedQueryResponse } from "../../src/api/legacy/types";
import type {
  DatabasesResponse,
  EventResponse,
  IndividualFieldResponse,
  IndividualResponse,
  StatsResponse,
  UserResponse,
} from "../../src/api/types";

/** `body` as client.ts hands it to the function under test. Typed, so each
 *  fixture is checked against the contract (src/api/types.ts). */
const read = <T>(body: T) => new ResponseValue(body, "GET /test").object<T>();

/** Like `read`, for a body that deliberately breaks the contract. */
const readBroken = <T>(body: unknown) => new ResponseValue(body, "GET /test").object<T>();

const wireField = (over: Partial<IndividualFieldResponse> = {}): IndividualFieldResponse => ({
  label: "size",
  type: "BIGINT",
  description: "",
  comment: "",
  cardinality: 0,
  values: [],
  format: "",
  ...over,
});

const wireFacet = (over: Partial<IndividualResponse> = {}): IndividualResponse => ({
  label: "thing",
  group: "",
  tags: [],
  id_number: 1,
  name: "Thing",
  description: "",
  comment: "",
  total_count: 10,
  fields: [],
  ...over,
});

const wireDatabase = (over: Partial<DatabasesResponse> = {}): DatabasesResponse => ({
  label: "alpha",
  name: "Alpha",
  description: "",
  owner: "",
  total_entrysets: 1200,
  percentage_of_total: 40,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toDatabase", () => {
  it("renames the backend's fields and trims blank text", () => {
    expect(toDatabase(read(wireDatabase({ description: " Trucks. ", owner: "  " })))).toEqual({
      id: "alpha",
      name: "Alpha",
      description: "Trucks.",
      owner: "",
      eventCount: 1200,
    });
  });

  it("shows the id when the backend sends no name", () => {
    expect(toDatabase(read(wireDatabase({ name: " " }))).name).toBe("alpha");
  });

  it("throws a ContractError naming the field when the event count is missing", () => {
    const broken = { ...wireDatabase(), total_entrysets: undefined };
    expect(() => toDatabase(readBroken<DatabasesResponse>(broken))).toThrow(
      new ContractError("GET /test", '"total_entrysets" should be a number, but it is missing.'),
    );
  });
});

describe("toField", () => {
  it("renames the backend's fields", () => {
    expect(
      toField(read(wireField({ comment: "Ours.", description: "Theirs.", values: ["1"] }))),
    ).toEqual({
      id: "size",
      name: "size",
      typeName: "BIGINT",
      comment: "Ours.",
      description: "Theirs.",
      values: ["1"],
    });
  });

  it("uses the backend's name when it sends one, else the label", () => {
    expect(toField(read(wireField({ name: "Size" }))).name).toBe("Size");
    expect(toField(read(wireField({ name: " " }))).name).toBe("size");
    expect(toField(read(wireField())).name).toBe("size");
  });

  it("takes the type from `type`, falling back to `format` only when `type` is empty", () => {
    expect(toField(read(wireField({ type: "", format: "TIMESTAMP" }))).typeName).toBe("TIMESTAMP");
    expect(toField(read(wireField({ type: "BIGINT", format: "TIMESTAMP" }))).typeName).toBe(
      "BIGINT",
    );
  });

  it("copies the values rather than sharing the response's list", () => {
    const values = ["a"];
    expect(toField(read(wireField({ values }))).values).not.toBe(values);
  });

  it("keeps the values exactly as sent, untrimmed", () => {
    expect(toField(read(wireField({ values: [" a ", "b"] }))).values).toEqual([" a ", "b"]);
  });
});

describe("toFacet", () => {
  it("renames the backend's fields and maps every field", () => {
    const facet = toFacet(read(wireFacet({ fields: [wireField()] })));
    expect(facet).toMatchObject({ id: "thing", name: "Thing", eventCount: 10 });
    expect(facet.fields.map((f) => f.id)).toEqual(["size"]);
  });

  it("keeps the backend's facet number, which orders the events table's columns", () => {
    expect(toFacet(read(wireFacet({ id_number: 7 }))).number).toBe(7);
  });

  it("throws a ContractError when the facet number is missing", () => {
    const broken = { ...wireFacet(), id_number: undefined };
    expect(() => toFacet(readBroken<IndividualResponse>(broken))).toThrow('"id_number"');
  });

  it("trims tags and drops blank and repeated ones", () => {
    expect(toFacet(read(wireFacet({ tags: [" red ", "", "red", "  ", "blue"] }))).tags).toEqual([
      "red",
      "blue",
    ]);
  });

  it("trims the group and descriptions, blank becoming empty", () => {
    const facet = toFacet(read(wireFacet({ group: "  ", comment: " Ours. ", description: "" })));
    expect(facet).toMatchObject({ group: "", comment: "Ours.", description: "" });
  });

  it("a field without a label throws a ContractError that says where it is", () => {
    const broken = { ...wireFacet(), fields: [wireField(), { ...wireField(), label: undefined }] };
    expect(() => toFacet(readBroken<IndividualResponse>(broken))).toThrow(
      '"fields[1].label" should be non-blank text, but it is missing.',
    );
  });

  it("missing descriptive text shows as blank instead of stopping the app", () => {
    const broken = { ...wireFacet({ description: "Theirs." }), comment: undefined };
    const facet = toFacet(readBroken<IndividualResponse>(broken));
    expect(facet).toMatchObject({ comment: "", description: "Theirs." });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"comment" should be text'));
  });
});

describe("toEvent", () => {
  it("keeps the id and every occurrence of each facet, keyed by facet id then field id", () => {
    const body: EventResponse = {
      id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10",
      items: [{ facet_label: "thing", values: [{ size: 5 }, { size: 7, color: "red" }] }],
    };
    expect(toEvent(read<EventResponse>(body))).toEqual({
      id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10",
      values: { thing: [{ size: 5 }, { size: 7, color: "red" }] },
    });
  });

  it("leaves out a null value", () => {
    const body = {
      id: "e1",
      items: [{ facet_label: "thing", values: [{ size: 5, color: null }] }],
    };
    expect(toEvent(readBroken<EventResponse>(body)).values).toEqual({ thing: [{ size: 5 }] });
  });

  it("merges a facet listed twice instead of losing one", () => {
    const body: EventResponse = {
      id: "e1",
      items: [
        { facet_label: "thing", values: [{ size: 5 }] },
        { facet_label: "thing", values: [{ size: 6 }] },
      ],
    };
    expect(toEvent(read<EventResponse>(body)).values).toEqual({
      thing: [{ size: 5 }, { size: 6 }],
    });
  });

  it("reads a facet named like a built-in property", () => {
    const body = { id: "e1", items: [{ facet_label: "constructor", values: [{ k: 1 }] }] };
    expect(toEvent(read<EventResponse>(body)).values).toEqual({ constructor: [{ k: 1 }] });
  });

  it("merges a facet listed twice that is named like a built-in property", () => {
    const body = {
      id: "e1",
      items: [
        { facet_label: "constructor", values: [{ k: 1 }] },
        { facet_label: "constructor", values: [{ k: 2 }] },
      ],
    };
    expect(toEvent(read<EventResponse>(body)).values).toEqual({
      constructor: [{ k: 1 }, { k: 2 }],
    });
  });

  // A plain object can't hold "__proto__" as an ordinary key: assigning it
  // changes the object's prototype instead, and the facet would vanish.
  it('keeps a facet whose id is "__proto__"', () => {
    const body = { id: "e1", items: [{ facet_label: "__proto__", values: [{ k: 1 }] }] };
    const { values } = toEvent(read<EventResponse>(body));
    expect(Object.keys(values)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(values, "__proto__")?.value).toEqual([{ k: 1 }]);
  });

  it('keeps a field whose id is "__proto__"', () => {
    // JSON.parse, as for a real response: a literal { __proto__: 5 } would set the prototype.
    const occurrence: unknown = JSON.parse('{"__proto__": 5, "size": 7}');
    const body = { id: "e1", items: [{ facet_label: "thing", values: [occurrence] }] };
    const [first] = toEvent(readBroken<EventResponse>(body)).values.thing!;
    expect(Object.keys(first!)).toEqual(["__proto__", "size"]);
    expect(Object.getOwnPropertyDescriptor(first, "__proto__")?.value).toBe(5);
  });

  it("throws a ContractError when the id is missing", () => {
    expect(() => toEvent(readBroken<EventResponse>({ items: [] }))).toThrow('"id"');
  });

  it("throws a ContractError when a facet's values are not a list", () => {
    const body = { id: "e1", items: [{ facet_label: "thing", values: { size: 5 } }] };
    expect(() => toEvent(readBroken<EventResponse>(body))).toThrow(
      '"items[0].values" should be a list, but it is an object.',
    );
  });
});

describe("toDatabaseResult", () => {
  it("a successful line carries its count", () => {
    expect(
      toDatabaseResult(
        read<StatsResponse>({
          label: "alpha",
          success: true,
          match_count: 7,
          info_messages: ["slow"],
        }),
      ),
    ).toEqual({ databaseId: "alpha", status: "ok", matchCount: 7, notes: ["slow"] });
  });

  it("a zero count is a real zero", () => {
    expect(
      toDatabaseResult(read<StatsResponse>({ label: "alpha", success: true, match_count: 0 })),
    ).toMatchObject({ status: "ok", matchCount: 0 });
  });

  it("a failed line carries its errors and notes, never a count", () => {
    expect(
      toDatabaseResult(
        read<StatsResponse>({
          label: "beta",
          success: false,
          error_messages: [
            { node_id: "c1", message: "Operator no longer supported.", kind: "invalid" },
            { message: "Query too complex.", kind: "incomplete" },
          ],
          info_messages: ["timeout"],
        }),
      ),
    ).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [
        { nodeId: "c1", message: "Operator no longer supported.", kind: "invalid" },
        { nodeId: null, message: "Query too complex.", kind: "incomplete" },
      ],
      notes: ["timeout"],
    });
    expect(toDatabaseResult(read<StatsResponse>({ label: "beta", success: false }))).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [],
      notes: [],
    });
    // Leaving out the optional keys is normal, not worth a warning.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("an error of an unknown kind is invalid; a blank message gets a stand-in", () => {
    const result = toDatabaseResult(
      readBroken<StatsResponse>({
        label: "beta",
        success: false,
        error_messages: [{ node_id: "c1", message: " ", kind: "fatal" }],
      }),
    );
    expect(result).toMatchObject({
      errors: [
        { nodeId: "c1", message: "The server found a problem in the query.", kind: "invalid" },
      ],
    });
  });

  it("a plain-text error (the old contract) throws a ContractError", () => {
    expect(() =>
      toDatabaseResult(
        readBroken<StatsResponse>({ label: "beta", success: false, error_messages: ["bad date"] }),
      ),
    ).toThrow('"error_messages[0]" should be an object, but it is the text "bad date".');
  });

  it("a success without a count is a failure, not a made-up 0", () => {
    expect(toDatabaseResult(read<StatsResponse>({ label: "alpha", success: true }))).toMatchObject({
      status: "failed",
      errors: [
        { message: "The server sent no count for this database.", kind: "invalid", nodeId: null },
      ],
    });
  });

  it("a line without `success` throws a ContractError", () => {
    expect(() => toDatabaseResult(readBroken<StatsResponse>({ label: "alpha" }))).toThrow(
      '"success" should be true or false, but it is missing.',
    );
  });
});

describe("toUser", () => {
  it("shows the display name the backend chose", () => {
    const user = read<UserResponse>({
      sub: "u-1",
      preferred_username: "pat",
      email: null,
      authorizations: [],
      display_name: "pat",
    });
    expect(toUser(user)).toEqual({ name: "pat" });
  });

  it("shows the user's id when the display name is blank, either spelling", () => {
    expect(
      toUser(read<UserResponse>({ sub: "u-1", authorizations: [], display_name: " " })),
    ).toEqual({ name: "u-1" });
    expect(
      toUser(read<UserResponse>({ user_id: "u-2", authorizations: [], display_name: "" })),
    ).toEqual({ name: "u-2" });
  });
});

describe("toCompliance", () => {
  const body = (value: unknown) => new ResponseValue(value, "GET /test");

  it("shows the whole compliance log as indented JSON and reads no field of it", () => {
    const log = { user: "Ada", reason: "audit", nested: { list: [1, 2] }, anything: null };
    expect(toCompliance(body(log))).toEqual({
      status: "acknowledged",
      log: JSON.stringify(log, null, 2),
    });
    expect(toCompliance(body({ a: 1 }))).toEqual({ status: "acknowledged", log: '{\n  "a": 1\n}' });
  });

  it("an empty log is still a log", () => {
    expect(toCompliance(body({}))).toEqual({ status: "acknowledged", log: "{}" });
  });

  it("a log that is not an object is a ContractError", () => {
    expect(() => toCompliance(body("fine"))).toThrow(ContractError);
    expect(() => toCompliance(body([1]))).toThrow(ContractError);
  });
});

describe("toSavedQuery", () => {
  /** The wire query with `patch` merged over its first child. */
  const withFirstChild = (patch: Record<string, unknown>) => ({
    ...unfinishedResponse,
    query: {
      ...unfinishedResponse.query,
      children: [{ ...unfinishedResponse.query.children[0], ...patch }],
    },
  });

  it("gives back the tree as the user left it, with database ids and no display state", () => {
    const saved = toSavedQuery(read(unfinishedResponse));
    expect(saved).toMatchObject({
      id: "sq-1",
      name: "Slow trips",
      note: "the ones to check",
      databaseIds: ["alpha"],
      updatedAt: "2026-10-08T09:30:00.000Z",
    });
    expect(withoutNodeIds(saved.query)).toEqual(withoutNodeIds(unfinishedTree));
  });

  it("round-trips a draft: what is sent is what comes back", () => {
    const sent = toSavedQueryRequest(unfinishedDraft);
    const back = toSavedQuery(read({ ...sent, id: "sq-9", updated_at: "2026-10-08T10:00:00Z" }));
    expect(back).toMatchObject({
      name: "Slow trips",
      note: "the ones to check",
      databaseIds: ["alpha"],
    });
    // toEqual, not toMatchObject: a key added on the way (or one left in, like
    // the draft's `collapsed`) must fail the test.
    expect(withoutNodeIds(back.query)).toEqual(withoutNodeIds(unfinishedTree));
  });

  /** Every node id in `node`, depth first. */
  const nodeIds = (node: QueryNode): string[] =>
    node.kind === "group" ? [node.id, ...node.children.flatMap(nodeIds)] : [node.id];

  it("gives every node a fresh id of its own, each time it is read", () => {
    const first = nodeIds(toSavedQuery(read(unfinishedResponse)).query);
    const second = nodeIds(toSavedQuery(read(unfinishedResponse)).query);
    expect(first).toHaveLength(5);
    expect(new Set([...first, ...second]).size).toBe(10);
  });

  it.each([
    ["text ids (saved by an older build)", "g1", "c1"],
    ["number ids", 1, 2],
    ["the same id twice", "x", "x"],
  ])("opens a query whose stored nodes carry %s, and ignores them", (_label, groupId, condId) => {
    const stored = {
      ...unfinishedResponse,
      query: {
        ...unfinishedResponse.query,
        id: groupId,
        children: [{ ...unfinishedResponse.query.children[2], id: condId }],
      },
    };
    const query = toSavedQuery(readBroken<SavedQueryResponse>(stored)).query;
    expect(nodeIds(query)).not.toContain(groupId);
    expect(nodeIds(query)).not.toContain(condId);
    expect(query.children[0]).toMatchObject({ facetId: "thing", value: [3, null] });
  });

  it("ignores keys it does not know, on the saved query and on its nodes", () => {
    const withExtras = {
      ...unfinishedResponse,
      extra: "from a newer backend",
      query: {
        ...unfinishedResponse.query,
        collapsed: true,
        extra: 1,
        children: unfinishedResponse.query.children.map((child) => ({
          ...child,
          collapsed: false,
          extra: "x",
        })),
      },
    };
    const saved = toSavedQuery(readBroken<SavedQueryResponse>(withExtras));
    expect({ ...saved, query: null }).toEqual({
      ...toSavedQuery(read(unfinishedResponse)),
      query: null,
    });
    expect(withoutNodeIds(saved.query)).toEqual(withoutNodeIds(unfinishedTree));
  });

  it("trims a padded name", () => {
    expect(toSavedQuery(read({ ...unfinishedResponse, name: "  Padded " })).name).toBe("Padded");
  });

  it("a missing note shows as empty, with a warning", () => {
    const broken = { ...unfinishedResponse, note: undefined };
    expect(toSavedQuery(readBroken<SavedQueryResponse>(broken)).note).toBe("");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"note" should be text'));
  });

  it.each([
    ["a missing id", { id: undefined }, '"id" should be non-blank text, but it is missing.'],
    ["a missing name", { name: undefined }, '"name" should be non-blank text, but it is missing.'],
    ["a blank name", { name: "  " }, '"name" should be non-blank text'],
    [
      "a missing updated_at",
      { updated_at: undefined },
      '"updated_at" should be non-blank text, but it is missing.',
    ],
    ["a missing query", { query: undefined }, '"query" should be an object, but it is missing.'],
  ])("throws a ContractError for %s", (_label, patch, message) => {
    const broken = readBroken<SavedQueryResponse>({ ...unfinishedResponse, ...patch });
    expect(() => toSavedQuery(broken)).toThrow(ContractError);
    expect(() => toSavedQuery(broken)).toThrow(message);
  });

  it.each([
    [
      "a root that is a condition",
      { query: { ...unfinishedResponse.query, kind: "condition" } },
      '"query.kind" should be "group"',
    ],
  ])("throws a ContractError for %s", (_label, patch, message) => {
    const broken = readBroken<SavedQueryResponse>({ ...unfinishedResponse, ...patch });
    expect(() => toSavedQuery(broken)).toThrow(message);
  });

  it.each([
    [
      "a kind that is neither",
      { kind: "other" },
      '"query.children[0].kind" should be "group" or "condition", but it is the text "other".',
    ],
    [
      "a facet_id that is a number",
      { facet_id: 3 },
      '"query.children[0].facet_id" should be non-blank text, but',
    ],
    [
      "an operator_id that is a list",
      { operator_id: [] },
      '"query.children[0].operator_id" should be non-blank text, but',
    ],
    ["a value that is an object", { value: { from: 1 } }, '"query.children[0].value" should be'],
    ["a value list holding an object", { value: [1, {}] }, '"query.children[0].value" should be'],
  ])("throws a ContractError for a node with %s", (_label, patch, message) => {
    const broken = readBroken<SavedQueryResponse>(withFirstChild(patch));
    expect(() => toSavedQuery(broken)).toThrow(ContractError);
    expect(() => toSavedQuery(broken)).toThrow(message);
  });

  it.each([
    ["no databases key", undefined, '"databases" should be a list of ids, but it is missing.'],
    ["databases that is not a list", "alpha", '"databases" should be a list of ids'],
    ["a blank database id", ["alpha", " "], '"databases[1]" should be non-blank text'],
    ["a database id that is a number", ["alpha", 2], '"databases[1]" should be non-blank text'],
  ])(
    "throws a ContractError for %s, instead of opening with fewer databases",
    (_l, databases, message) => {
      const broken = readBroken<SavedQueryResponse>({ ...unfinishedResponse, databases });
      expect(() => toSavedQuery(broken)).toThrow(ContractError);
      expect(() => toSavedQuery(broken)).toThrow(message);
    },
  );

  it("names the saved query's place in a list", () => {
    const broken = new ResponseValue(
      [unfinishedResponse, { ...unfinishedResponse, databases: ["a", null] }],
      "GET /test",
    ).list<SavedQueryResponse>();
    expect(() => toSavedQuery(broken[1]!)).toThrow('"[1].databases[1]" should be non-blank text');
  });

  it("throws a ContractError naming the path for a group without children", () => {
    const broken = readBroken<SavedQueryResponse>({
      ...unfinishedResponse,
      query: { ...unfinishedResponse.query, children: undefined },
    });
    expect(() => toSavedQuery(broken)).toThrow('"query.children" should be a list');
  });

  it("throws a ContractError for a group operator that is neither AND nor OR", () => {
    const broken = readBroken<SavedQueryResponse>({
      ...unfinishedResponse,
      query: { ...unfinishedResponse.query, operator: "XOR" },
    });
    expect(() => toSavedQuery(broken)).toThrow('"query.operator" should be "AND" or "OR"');
  });

  it("reads a deep tree", () => {
    const deep = {
      ...unfinishedResponse,
      query: {
        kind: "group",
        operator: "AND",
        children: [
          {
            kind: "group",
            operator: "OR",
            children: [unfinishedResponse.query.children[2]],
          },
        ],
      },
    };
    const inner = toSavedQuery(readBroken<SavedQueryResponse>(deep)).query.children[0] as Group;
    expect(inner).toMatchObject({ kind: "group", operator: "OR" });
    expect(inner.children[0]).toMatchObject({ fieldId: "size", value: [3, null] });
  });
});
