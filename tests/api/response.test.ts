import { describe, it, expect } from "vitest";
import {
  toCompliance,
  toDatabase,
  toDatabaseResult,
  toEvent,
  toFacet,
  toField,
  toUser,
} from "../../src/api/response";
import type { IndividualFieldResponse, IndividualResponse } from "../../src/api/types";

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

describe("toDatabase", () => {
  it("renames the backend's fields and trims blank text", () => {
    expect(
      toDatabase({
        label: "alpha",
        name: "Alpha",
        description: " Trucks. ",
        owner: "  ",
        totalEntrysets: 1200,
        percentageOfTotal: 40,
      }),
    ).toEqual({ id: "alpha", name: "Alpha", description: "Trucks.", owner: "", eventCount: 1200 });
  });
});

describe("toField", () => {
  it("renames the backend's fields", () => {
    expect(toField(wireField({ comment: "Ours.", description: "Theirs.", values: ["1"] }))).toEqual(
      {
        id: "size",
        name: "size",
        typeName: "BIGINT",
        comment: "Ours.",
        description: "Theirs.",
        values: ["1"],
      },
    );
  });

  it("uses the backend's name when it sends one, else the label", () => {
    expect(toField(wireField({ name: "Size" })).name).toBe("Size");
    expect(toField(wireField({ name: " " })).name).toBe("size");
    expect(toField(wireField()).name).toBe("size");
  });

  it("takes the type from `type`, falling back to `format` only when `type` is empty", () => {
    expect(toField(wireField({ type: "", format: "TIMESTAMP" })).typeName).toBe("TIMESTAMP");
    expect(toField(wireField({ type: "BIGINT", format: "TIMESTAMP" })).typeName).toBe("BIGINT");
  });

  it("copies the values rather than sharing the response's list", () => {
    const values = ["a"];
    expect(toField(wireField({ values })).values).not.toBe(values);
  });
});

describe("toFacet", () => {
  it("renames the backend's fields and maps every field", () => {
    const facet = toFacet(wireFacet({ fields: [wireField()] }));
    expect(facet).toMatchObject({ id: "thing", name: "Thing", eventCount: 10 });
    expect(facet.fields.map((f) => f.id)).toEqual(["size"]);
  });

  it("trims tags and drops blank and repeated ones", () => {
    expect(toFacet(wireFacet({ tags: [" red ", "", "red", "  ", "blue"] })).tags).toEqual([
      "red",
      "blue",
    ]);
  });

  it("trims the group and descriptions, blank becoming empty", () => {
    const facet = toFacet(wireFacet({ group: "  ", comment: " Ours. ", description: "" }));
    expect(facet).toMatchObject({ group: "", comment: "Ours.", description: "" });
  });
});

describe("toEvent", () => {
  it("keeps the id and the values, keyed by facet id then field id", () => {
    expect(toEvent({ id: 3, items: { thing: { size: 5 } } })).toEqual({
      id: 3,
      values: { thing: { size: 5 } },
    });
  });
});

describe("toDatabaseResult", () => {
  it("a successful line carries its count", () => {
    expect(
      toDatabaseResult({ label: "alpha", success: true, matchCount: 7, infoMessages: ["slow"] }),
    ).toEqual({ databaseId: "alpha", status: "ok", matchCount: 7, notes: ["slow"] });
  });

  it("a zero count is a real zero", () => {
    expect(toDatabaseResult({ label: "alpha", success: true, matchCount: 0 })).toMatchObject({
      status: "ok",
      matchCount: 0,
    });
  });

  it("a failed line carries its messages, never a count", () => {
    expect(
      toDatabaseResult({
        label: "beta",
        success: false,
        errorMessages: ["bad date"],
        infoMessages: ["timeout"],
      }),
    ).toEqual({ databaseId: "beta", status: "failed", errors: ["bad date"], notes: ["timeout"] });
    expect(toDatabaseResult({ label: "beta", success: false })).toEqual({
      databaseId: "beta",
      status: "failed",
      errors: [],
      notes: [],
    });
  });

  it("a success without a count is a failure, not a made-up 0", () => {
    expect(toDatabaseResult({ label: "alpha", success: true })).toMatchObject({
      status: "failed",
      errors: ["The server sent no count for this database."],
    });
  });
});

describe("toUser", () => {
  it("keeps the name", () => {
    expect(toUser({ name: "pat" })).toEqual({ name: "pat" });
  });
});

describe("toCompliance", () => {
  it("an acknowledged session carries its reason and when it was given", () => {
    expect(
      toCompliance({ status: "acknowledged", reason: "audit", ackedAt: "2026-09-23T10:00:00Z" }),
    ).toEqual({ status: "acknowledged", reason: "audit", givenAt: "2026-09-23T10:00:00Z" });
  });

  it("fills in what the backend leaves out", () => {
    expect(toCompliance({ status: "acknowledged" })).toEqual({
      status: "acknowledged",
      reason: "",
      givenAt: null,
    });
  });

  it("anything else needs a reason", () => {
    expect(toCompliance({ status: "required" })).toEqual({ status: "required" });
  });
});
