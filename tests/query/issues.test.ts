import { describe, it, expect } from "vitest";
import { placeIssues, serverIssues, shownIssues } from "../../src/query/issues";
import type { DatabaseError, DatabaseResult } from "../../src/model";
import type { Condition, Group, Issue, QueryNode } from "../../src/query/types";

const cond = (id: string): Condition => ({
  kind: "condition",
  id,
  facetId: null,
  fieldId: null,
  operatorId: null,
  value: null,
});
const group = (id: string, children: QueryNode[], collapsed = false): Group => ({
  kind: "group",
  id,
  operator: "AND",
  children,
  collapsed,
});

const err = (
  nodeId: string | null,
  message = "Bad.",
  kind: DatabaseError["kind"] = "invalid",
): DatabaseError => ({ nodeId, message, kind });
const failed = (databaseId: string, ...errors: DatabaseError[]): DatabaseResult => ({
  databaseId,
  status: "failed",
  errors,
  notes: [],
});
const ok: DatabaseResult = { databaseId: "ok", status: "ok", matchCount: 1, notes: [] };
const issue = (nodeId: string, message = "Bad."): Issue => ({ nodeId, message, kind: "invalid" });

describe("serverIssues", () => {
  it("turns every error that names a node into an issue, once", () => {
    const results = [failed("a", err("c1")), failed("b", err("c1"), err("c1", "Other."))];
    expect(serverIssues({ status: "ok", results })).toEqual([issue("c1"), issue("c1", "Other.")]);
  });

  it("keeps the same message with another kind or node apart", () => {
    const results = [failed("a", err("c1"), err("c1", "Bad.", "incomplete"), err("c2"))];
    expect(serverIssues({ status: "ok", results })).toHaveLength(3);
  });

  it("ignores errors without a node and databases that succeeded", () => {
    expect(serverIssues({ status: "ok", results: [ok, failed("a", err(null))] })).toEqual([]);
  });

  it("works while the stream is still loading, and is [] when stats failed", () => {
    expect(serverIssues({ status: "loading", results: [failed("a", err("c1"))] })).toEqual([
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

  it("uses the outermost collapsed group when several are nested", () => {
    expect(placeIssues(query, [issue("g4"), issue("c4")])).toEqual([issue("g3"), issue("g3")]);
  });

  it("moves an issue with an unknown id to the root group", () => {
    expect(placeIssues(query, [issue("gone")])).toEqual([issue("root")]);
  });
});

describe("shownIssues", () => {
  it("places the local and the server issues together", () => {
    const query = group("root", [group("g1", [cond("c1"), cond("c2")], true)]);
    const local: Issue = { nodeId: "c1", message: "Choose a field.", kind: "incomplete" };
    const stats = { status: "ok" as const, results: [failed("a", err("c2"), err("gone"))] };
    expect(shownIssues({ query, issues: [local], stats })).toEqual([
      { ...local, nodeId: "g1" },
      issue("g1"),
      issue("root"),
    ]);
  });
});
