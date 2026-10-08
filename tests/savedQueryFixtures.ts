import type { SavedQueryResponse, SavedQueryRequest } from "../src/api/types";
import type { SavedQueryDraft } from "../src/model";

// One saved query shared by the conversion, client and mock tests.

/** A saved query that is half built on purpose: every kind of gap the backend must accept. */
export const unfinishedDraft: SavedQueryDraft = {
  name: "  Slow trips  ",
  note: " the ones to check ",
  databaseIds: ["alpha"],
  query: {
    kind: "group",
    id: "g1",
    operator: "OR",
    collapsed: true,
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
  },
};

/** What `unfinishedDraft` looks like on the wire. */
export const unfinishedRequest: SavedQueryRequest = {
  name: "Slow trips",
  note: "the ones to check",
  databases: ["alpha"],
  query: {
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
  },
};

/** `unfinishedRequest` as the server answers it. */
export const unfinishedResponse: SavedQueryResponse = {
  ...unfinishedRequest,
  id: "sq-1",
  updatedAt: "2026-10-08T09:30:00.000Z",
};
