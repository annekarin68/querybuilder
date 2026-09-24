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
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetResponse,
  IndividualFieldResponse,
  IndividualResponse,
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

  it("a failed line carries its messages, never a count", () => {
    expect(
      toDatabaseResult(
        read<StatsResponse>({
          label: "beta",
          success: false,
          errorMessages: ["bad date"],
          infoMessages: ["timeout"],
        }),
      ),
    ).toEqual({ databaseId: "beta", status: "failed", errors: ["bad date"], notes: ["timeout"] });
    expect(toDatabaseResult(read<StatsResponse>({ label: "beta", success: false }))).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [],
      notes: [],
    });
    // Leaving out the optional keys is normal, not worth a warning.
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("a success without a count is a failure, not a made-up 0", () => {
    expect(toDatabaseResult(read<StatsResponse>({ label: "alpha", success: true }))).toMatchObject({
      status: "failed",
      errors: ["The server sent no count for this database."],
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
