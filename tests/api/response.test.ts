import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContractError, ResponseValue } from "../../src/api/contract";
import {
  toCompliance,
  toDatabase,
  toDatabaseResult,
  toEvent,
  toFacet,
  toField,
  toSavedQuery,
  toUser,
} from "../../src/api/response";
import { toSavedQueryRequest } from "../../src/api/request";
import { unfinishedDraft, unfinishedResponse } from "../savedQueryFixtures";
import type { Group } from "../../src/query/types";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";
import { isEdited, type OpenSaved } from "../../src/query/saved";
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetResponse,
  IndividualFieldResponse,
  IndividualResponse,
  SavedQueryResponse,
  StatsResponse,
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
  idNumber: 1,
  name: "Thing",
  description: "",
  comment: "",
  totalCount: 10,
  fields: [],
  ...over,
});

const wireDatabase = (over: Partial<DatabasesResponse> = {}): DatabasesResponse => ({
  label: "alpha",
  name: "Alpha",
  description: "",
  owner: "",
  totalEntrysets: 1200,
  percentageOfTotal: 40,
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
    const broken = { ...wireDatabase(), totalEntrysets: undefined };
    expect(() => toDatabase(readBroken<DatabasesResponse>(broken))).toThrow(
      new ContractError("GET /test", '"totalEntrysets" should be a number, but it is missing.'),
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
  it("keeps the id and the values, keyed by facet id then field id", () => {
    expect(toEvent(read<EntrysetResponse>({ id: 3, items: { thing: { size: 5 } } }))).toEqual({
      id: 3,
      values: { thing: { size: 5 } },
    });
  });

  it("leaves out a null value", () => {
    const body = { id: 3, items: { thing: { size: 5, color: null } } };
    expect(toEvent(readBroken<EntrysetResponse>(body)).values).toEqual({ thing: { size: 5 } });
  });

  it("throws a ContractError when a facet's values are not an object", () => {
    const body = { id: 3, items: { thing: [1, 2] } };
    expect(() => toEvent(readBroken<EntrysetResponse>(body))).toThrow(
      '"items.thing" should be an object, but it is a list.',
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
          matchCount: 7,
          infoMessages: ["slow"],
        }),
      ),
    ).toEqual({ databaseId: "alpha", status: "ok", matchCount: 7, notes: ["slow"] });
  });

  it("a zero count is a real zero", () => {
    expect(
      toDatabaseResult(read<StatsResponse>({ label: "alpha", success: true, matchCount: 0 })),
    ).toMatchObject({ status: "ok", matchCount: 0 });
  });

  it("a failed line carries its errors and notes, never a count", () => {
    expect(
      toDatabaseResult(
        read<StatsResponse>({
          label: "beta",
          success: false,
          errorMessages: [
            { nodeId: "c1", message: "Operator no longer supported.", kind: "invalid" },
            { message: "Query too complex.", kind: "incomplete" },
          ],
          infoMessages: ["timeout"],
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
        errorMessages: [{ nodeId: "c1", message: " ", kind: "fatal" }],
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
        readBroken<StatsResponse>({ label: "beta", success: false, errorMessages: ["bad date"] }),
      ),
    ).toThrow('"errorMessages[0]" should be an object, but it is the text "bad date".');
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
  it("keeps the name", () => {
    expect(toUser(read<AuthUser>({ name: "pat" }))).toEqual({ name: "pat" });
  });
});

describe("toCompliance", () => {
  it("an acknowledged session carries its reason and when it was given", () => {
    expect(
      toCompliance(
        read<ComplianceStatus>({
          status: "acknowledged",
          reason: "audit",
          ackedAt: "2026-09-23T10:00:00Z",
        }),
      ),
    ).toEqual({ status: "acknowledged", reason: "audit", givenAt: "2026-09-23T10:00:00Z" });
  });

  it("fills in what the backend leaves out", () => {
    expect(toCompliance(read<ComplianceStatus>({ status: "acknowledged" }))).toEqual({
      status: "acknowledged",
      reason: "",
      givenAt: null,
    });
  });

  it("anything else needs a reason", () => {
    expect(toCompliance(read<ComplianceStatus>({ status: "required" }))).toEqual({
      status: "required",
    });
    expect(toCompliance(readBroken<ComplianceStatus>({ status: "expired" }))).toEqual({
      status: "required",
    });
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
    expect(toSavedQuery(read(unfinishedResponse))).toEqual({
      id: "sq-1",
      name: "Slow trips",
      note: "the ones to check",
      databaseIds: ["alpha"],
      query: unfinishedResponse.query,
      updatedAt: "2026-10-08T09:30:00.000Z",
    });
  });

  it("round-trips a draft: what is sent is what comes back", () => {
    const sent = toSavedQueryRequest(unfinishedDraft);
    const back = toSavedQuery(read({ ...sent, id: "sq-9", updatedAt: "2026-10-08T10:00:00Z" }));
    expect(back).toMatchObject({
      name: "Slow trips",
      note: "the ones to check",
      databaseIds: ["alpha"],
    });
    // toEqual, not toMatchObject: a key added on the way (or one left in, like
    // the draft's `collapsed`) must fail the test.
    expect(back.query).toEqual(unfinishedResponse.query);
  });

  it("opening what was just saved is not an edit (the real conversions, both ways)", () => {
    // Built with the builder's own helpers, in the order the builder writes
    // keys: isEdited compares trees with sameSemantics, which compares JSON
    // text, so a conversion that wrote the keys in another order would make
    // every opened query look edited.
    const root = emptyQuery();
    const facetLevel = { ...newCondition(), facetId: "thing", operatorId: "present" };
    const between = { ...newCondition(), facetId: "thing", fieldId: "size", operatorId: "between" };
    const folded = { ...newGroup(), operator: "OR" as const };
    let query = addChild(root, root.id, facetLevel);
    query = addChild(query, root.id, folded);
    query = addChild(query, folded.id, between);
    query = updateNode(query, between.id, { value: [3, 7] });
    query = updateNode(query, folded.id, { collapsed: true });
    const draft = { name: "Trips", note: "", databaseIds: ["alpha", "beta"], query };

    const answer = { ...toSavedQueryRequest(draft), id: "sq-1", updatedAt: "2026-10-08T10:00:00Z" };
    // Through JSON text, as it travels.
    const saved = toSavedQuery(read<SavedQueryResponse>(JSON.parse(JSON.stringify(answer))));
    const open: OpenSaved = {
      id: saved.id,
      name: saved.name,
      note: saved.note,
      query: saved.query,
      databaseIds: saved.databaseIds,
    };
    expect(isEdited(open, query, ["beta", "alpha"])).toBe(false);
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
    expect(toSavedQuery(readBroken<SavedQueryResponse>(withExtras))).toEqual(
      toSavedQuery(read(unfinishedResponse)),
    );
    expect(toSavedQuery(readBroken<SavedQueryResponse>(withExtras)).query).toEqual(
      unfinishedResponse.query,
    );
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
      "a missing updatedAt",
      { updatedAt: undefined },
      '"updatedAt" should be non-blank text, but it is missing.',
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
      "a facetId that is a number",
      { facetId: 3 },
      '"query.children[0].facetId" should be non-blank text, but',
    ],
    [
      "a missing node id",
      { id: undefined },
      '"query.children[0].id" should be non-blank text, but it is missing.',
    ],
    [
      "an operatorId that is a list",
      { operatorId: [] },
      '"query.children[0].operatorId" should be non-blank text, but',
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
        id: "g1",
        operator: "AND",
        children: [
          {
            kind: "group",
            id: "g2",
            operator: "OR",
            children: [{ ...unfinishedResponse.query.children[2], id: "c9" }],
          },
        ],
      },
    };
    const inner = toSavedQuery(readBroken<SavedQueryResponse>(deep)).query.children[0] as Group;
    expect(inner.children[0]).toMatchObject({ id: "c9", value: [3, null] });
  });
});
