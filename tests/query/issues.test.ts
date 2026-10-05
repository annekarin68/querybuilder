import { describe, it, expect } from "vitest";
import { placeIssues, serverIssues } from "../../src/query/issues";
import { emptyQuery, newCondition } from "../../src/query/tree";
import type { Condition, Group, Issue, QueryNode } from "../../src/query/types";
import { dbError, failed, ok } from "../statsFixtures";

const cond = (id: string): Condition => ({ ...newCondition(), id });
const group = (id: string, children: QueryNode[], collapsed = false): Group => ({
  ...emptyQuery(),
  id,
  children,
  collapsed,
});
const issue = (nodeId: string, message = "Bad."): Issue => ({ nodeId, message, kind: "invalid" });

describe("serverIssues", () => {
  it("turns every error that names a node into an issue, once", () => {
    const results = [
      failed("a", dbError("c1")),
      failed("b", dbError("c1"), dbError("c1", "Other.")),
    ];
    expect(serverIssues({ status: "ok", results })).toEqual([issue("c1"), issue("c1", "Other.")]);
  });

  it("keeps the same message with another kind or node apart", () => {
    const results = [
      failed("a", dbError("c1"), dbError("c1", "Bad.", "incomplete"), dbError("c2")),
    ];
    expect(serverIssues({ status: "ok", results })).toEqual([
      issue("c1"),
      { nodeId: "c1", message: "Bad.", kind: "incomplete" },
      issue("c2"),
    ]);
  });

  it("ignores errors without a node and databases that succeeded", () => {
    expect(
      serverIssues({ status: "ok", results: [ok("a", 1), failed("b", dbError(null))] }),
    ).toEqual([]);
  });

  it("works while the stream is still loading, and is [] when stats failed", () => {
    expect(serverIssues({ status: "loading", results: [failed("a", dbError("c1"))] })).toEqual([
      issue("c1"),
    ]);
    expect(serverIssues({ status: "error", error: "down" })).toEqual([]);
  });
});

describe("placeIssues", () => {
  const query = group("root", [
    cond("c1"),
    group("g1", [cond("c2"), group("g2", [cond("c3")], true)]),
    group("g3", [group("g4", [cond("c4")])], true),
  ]);

  it("leaves an issue on a node that is drawn where it is", () => {
    expect(placeIssues(query, [issue("c1"), issue("c2"), issue("g2")])).toEqual([
      issue("c1"),
      issue("c2"),
      issue("g2"),
    ]);
  });

  it("moves an issue inside a collapsed group to that group", () => {
    expect(placeIssues(query, [issue("c3")])).toEqual([issue("g2")]);
  });

  it("uses the outermost collapsed group, and keeps issues that end up the same once", () => {
    expect(placeIssues(query, [issue("g4"), issue("c4"), issue("c4", "Other.")])).toEqual([
      issue("g3"),
      issue("g3", "Other."),
    ]);
  });

  it("moves an issue with an unknown id to the root group", () => {
    expect(placeIssues(query, [issue("gone")])).toEqual([issue("root")]);
  });
});
