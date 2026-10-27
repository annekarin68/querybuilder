import type { SavedQueryResponse, SavedQueryRequest } from "../src/api/legacy/types";
import type { SavedQueryDraft } from "../src/model";
import type { Group, QueryNode } from "../src/query/legacy/types";

// One saved query shared by the conversion, client and mock tests. The `unfinishedRequest` and `unfinishedResponse` use the wire's snake_case keys; the draft and tree use the frontend's own.

/** The tree of `unfinishedDraft` as the frontend holds it, without display state. */
export const unfinishedTree: Group = {
  kind: "group",
  id: "g1",
  operator: "OR",
  children: [
    { kind: "condition", id: "c1", facetId: null, fieldId: null, operatorId: null, value: null },
    {
      kind: "condition",
      id: "c2",
      facetId: "thing",
      fieldId: null,
      operatorId: "present",
      value: null,
    },
    {
      kind: "condition",
      id: "c3",
      facetId: "thing",
      fieldId: "size",
      operatorId: "between",
      value: [3, null],
    },
    { kind: "group", id: "g2", operator: "AND", children: [] },
  ],
};

/** A saved query that is half built on purpose: every kind of gap the backend must accept. */
export const unfinishedDraft: SavedQueryDraft = {
  name: "  Slow trips  ",
  note: " the ones to check ",
  databaseIds: ["alpha"],
  query: { ...unfinishedTree, collapsed: true },
};

/** What `unfinishedDraft` looks like on the wire: no node ids, which only live for one page load. */
export const unfinishedRequest: SavedQueryRequest = {
  name: "Slow trips",
  note: "the ones to check",
  databases: ["alpha"],
  query: {
    kind: "group",
    operator: "OR",
    children: [
      {
        kind: "condition",
        facet_id: null,
        field_id: null,
        operator_id: null,
        value: null,
      },
      {
        kind: "condition",
        facet_id: "thing",
        field_id: null,
        operator_id: "present",
        value: null,
      },
      {
        kind: "condition",
        facet_id: "thing",
        field_id: "size",
        operator_id: "between",
        value: [3, null],
      },
      { kind: "group", operator: "AND", children: [] },
    ],
  },
};

/** `unfinishedRequest` as the server answers it. */
export const unfinishedResponse: SavedQueryResponse = {
  ...unfinishedRequest,
  id: "sq-1",
  updated_at: "2026-10-08T09:30:00.000Z",
};

/**
 * `tree` without its node ids. A saved tree comes back with fresh ids
 * (docs/ARCHITECTURE.md, "Saved queries"), so tests compare everything else.
 */
export function withoutNodeIds(tree: QueryNode): unknown {
  return JSON.parse(
    JSON.stringify(tree, (key, value: unknown) => (key === "id" ? undefined : value)),
  );
}
