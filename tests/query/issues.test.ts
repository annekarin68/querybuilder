import { describe, it, expect } from "vitest";
import { placeIssues, serverIssues } from "../../src/query/issues";
import { emptyQuery, groupOf, newBlock, newFieldCondition } from "../../src/query/tree";
import type { FacetBlock, Group, Issue } from "../../src/query/types";
import { dbError, failed, ok } from "../statsFixtures";

const issue = (nodeId: string, message = "m"): Issue => ({ nodeId, message, kind: "invalid" });

const serverIssue = (nodeId: string, message = "m"): Issue => ({
  ...issue(nodeId, message),
  fromServer: true,
});

function sample() {
  const c = newFieldCondition("size", "gt", null);
  const block: FacetBlock = { ...newBlock("thing"), conditions: [c] };
  const inner = groupOf([block]);
  const root: Group = { ...emptyQuery(), children: [inner] };
  return { c, block, inner, root };
}

describe("placeIssues", () => {
  it("keeps an issue on its condition while everything is open", () => {
    const { c, root } = sample();
    expect(placeIssues(root, [issue(c.id)])).toEqual([issue(c.id)]);
  });

  it("moves a condition's issue to its folded block", () => {
    const { c, block, inner, root } = sample();
    const folded: Group = {
      ...root,
      children: [{ ...inner, children: [{ ...block, collapsed: true }] }],
    };
    expect(placeIssues(folded, [issue(c.id)])).toEqual([issue(block.id)]);
  });

  it("moves it to the outermost folded group around it", () => {
    const { c, block, inner, root } = sample();
    const folded: Group = { ...root, children: [{ ...inner, collapsed: true }] };
    expect(placeIssues(folded, [issue(c.id), issue(block.id)])).toEqual([issue(inner.id)]);
  });

  it("puts an unknown id on the root", () => {
    const { root } = sample();
    expect(placeIssues(root, [issue("gone")])).toEqual([issue(root.id)]);
  });
});

describe("placeIssues: a local and a server issue with the same text", () => {
  // The server's flag changes how it is drawn (a warning, not a hint), so a
  // local twin must not hide it, whichever comes first.
  it("keeps one, as the server's, in either order", () => {
    const { c, root } = sample();
    expect(placeIssues(root, [issue(c.id), serverIssue(c.id)])).toEqual([serverIssue(c.id)]);
    expect(placeIssues(root, [serverIssue(c.id), issue(c.id)])).toEqual([serverIssue(c.id)]);
  });

  it("keeps issues that fold onto the same node once, others apart", () => {
    const { c, block, inner, root } = sample();
    const folded: Group = { ...root, children: [{ ...inner, collapsed: true }] };
    expect(placeIssues(folded, [issue(c.id), issue(block.id), issue(c.id, "Other.")])).toEqual([
      issue(inner.id),
      issue(inner.id, "Other."),
    ]);
  });
});

describe("serverIssues", () => {
  const bad = (nodeId: string, message = "Bad.") => serverIssue(nodeId, message);

  it("turns every error that names a node into an issue, once", () => {
    const results = [
      failed("a", dbError("c1")),
      failed("b", dbError("c1"), dbError("c1", "Other.")),
    ];
    expect(serverIssues({ status: "ok", results })).toEqual([bad("c1"), bad("c1", "Other.")]);
  });

  it("keeps the same message with another kind or node apart", () => {
    const results = [
      failed("a", dbError("c1"), dbError("c1", "Bad.", "incomplete"), dbError("c2")),
    ];
    expect(serverIssues({ status: "ok", results })).toEqual([
      bad("c1"),
      { nodeId: "c1", message: "Bad.", kind: "incomplete", fromServer: true },
      bad("c2"),
    ]);
  });

  it("marks every issue as found by the server", () => {
    const stats = {
      status: "ok" as const,
      results: [failed("a", dbError("g1", "Group contains no valid conditions.", "incomplete"))],
    };
    expect(serverIssues(stats)).toEqual([
      {
        nodeId: "g1",
        message: "Group contains no valid conditions.",
        kind: "incomplete",
        fromServer: true,
      },
    ]);
  });

  it("ignores errors without a node and databases that succeeded", () => {
    expect(
      serverIssues({ status: "ok", results: [ok("a", 1), failed("b", dbError(null))] }),
    ).toEqual([]);
  });

  it("works while the stream is still loading, and is [] when stats failed", () => {
    expect(serverIssues({ status: "loading", results: [failed("a", dbError("c1"))] })).toEqual([
      bad("c1"),
    ]);
    expect(serverIssues({ status: "error", error: "down" })).toEqual([]);
  });
});
