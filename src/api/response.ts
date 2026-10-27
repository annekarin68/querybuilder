import type {
  ComplianceLogResponse,
  DatabasesResponse,
  EventItemResponse,
  EventResponse,
  IndividualFieldResponse,
  IndividualResponse,
  SavedFacet,
  SavedFieldCondition,
  SavedGroup,
  SavedNode,
  SavedQueryResponse,
  StatsErrorMessage,
  StatsResponse,
  UserResponse,
} from "./types";
import { setOwnKey, type ResponseObject, type ResponseValue } from "./contract";
import type {
  Compliance,
  Database,
  DatabaseError,
  DatabaseResult,
  EventRecord,
  Facet,
  Field,
  SavedQuery,
  Scalar,
  User,
} from "../model";
import { groupOf, newBlock, newFieldCondition } from "../query/tree";
import type { FacetBlock, FieldCondition, Group, QueryNode } from "../query/types";

/**
 * Backend response → the frontend's own model (src/model.ts). client.ts runs
 * every response through one of these as it arrives, so no other file sees the
 * backend's names. When the backend renames or reshapes a field, change the
 * matching line here (and src/api/types.ts) — nothing else.
 *
 * Each function reads one object of a response key by key, through the checks
 * in src/api/contract.ts (docs/ARCHITECTURE.md, "Reading responses"): `id`,
 * `ids`, `nullableId`, `oneOf`, `savedValue`, `number`, `boolean`, `list` and
 * `object` are required and throw a ContractError naming the field (a saved
 * query's tree and database ids are read with these); `text` and `strings` are
 * only shown, so they fall back to blank.
 *
 * The wire is snake_case and the model camelCase: the keys read here are the
 * backend's (`total_entrysets`), the properties built are ours
 * (`eventCount`), and this file is the only place that knows both.
 *
 * This is also where the backend's quirks are smoothed out once, instead of in
 * every panel: text may arrive padded, a facet or field may have no name, and a
 * field's type may sit in `type` or in `format`.
 */

export function toDatabase(d: ResponseObject<DatabasesResponse>): Database {
  const id = d.id("label");
  return {
    id,
    name: d.text("name") || id,
    description: d.text("description"),
    owner: d.text("owner"),
    eventCount: d.number("total_entrysets"),
  };
}

export function toField(f: ResponseObject<IndividualFieldResponse>): Field {
  const id = f.id("label");
  return {
    id,
    // The backend doesn't fill `name` yet; the id stands in until it does.
    name: f.optionalText("name") || id,
    // `type` wins; `format` is only a hint for when `type` is empty.
    typeName: f.text("type") || f.text("format"),
    comment: f.text("comment"),
    description: f.text("description"),
    values: f.strings("values"),
  };
}

export function toFacet(i: ResponseObject<IndividualResponse>): Facet {
  const id = i.id("label");
  const tags = i
    .strings("tags")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    id,
    name: i.text("name") || id,
    number: i.number("id_number"),
    tags: [...new Set(tags)],
    group: i.text("group"),
    comment: i.text("comment"),
    description: i.text("description"),
    eventCount: i.number("total_count"),
    fields: i.list<IndividualFieldResponse>("fields").map(toField),
  };
}

export function toEvent(e: ResponseObject<EventResponse>): EventRecord {
  const values: EventRecord["values"] = {};
  for (const item of e.list<EventItemResponse>("items")) {
    const facetId = item.id("facet_label");
    // Each occurrence is keyed by the backend's own field ids, so its keys are
    // read as they come rather than by name; the backend leaves an empty field out, and a null
    // value (tolerated, never expected) is dropped too.
    const occurrences = item
      .list<Record<string, Scalar | null>>("values")
      .map((occurrence) => occurrence.scalars());
    // The same facet listed twice: keep every occurrence rather than drop one.
    // Checked with hasOwn: a facet named like a built-in ("constructor") would
    // otherwise pick up Object.prototype's value here. Set with setOwnKey, so
    // that a facet named "__proto__" is kept too.
    const earlier = Object.hasOwn(values, facetId) ? values[facetId]! : [];
    setOwnKey(values, facetId, [...earlier, ...occurrences]);
  }
  return { id: e.id("id"), values };
}

/**
 * One item of a stats line's `error_messages`. These decide whether Run is
 * allowed (src/state.ts), so the item must be an object; within it, a kind
 * this app doesn't know is "invalid" (the safe choice, as in toCompliance).
 */
function toDatabaseError(e: ResponseObject<StatsErrorMessage>): DatabaseError {
  return {
    message: e.text("message") || "The server found a problem in the query.",
    kind: e.text("kind") === "incomplete" ? "incomplete" : "invalid",
    nodeId: e.optionalText("node_id") || null,
  };
}

/**
 * One line of the /filter/validate stream. A line that claims success but carries no
 * count is treated as a failure: showing it as "0 matched" would be a guess.
 */
export function toDatabaseResult(line: ResponseObject<StatsResponse>): DatabaseResult {
  const databaseId = line.id("label");
  const success = line.boolean("success");
  const matchCount = line.optionalNumber("match_count");
  const notes = line.optionalStrings("info_messages");
  if (success && matchCount !== undefined) {
    return { databaseId, status: "ok", matchCount, notes };
  }
  const errors: DatabaseError[] = success
    ? [{ message: "The server sent no count for this database.", kind: "invalid", nodeId: null }]
    : line.optionalList<StatsErrorMessage>("error_messages").map(toDatabaseError);
  return { databaseId, status: "failed", errors, notes };
}

export function toUser(u: ResponseObject<UserResponse>): User {
  // The backend already picked the best name (username, else email, else id).
  // A blank one shows the id, as a nameless database does.
  return { name: u.text("display_name") || u.optionalText("sub") || u.optionalText("user_id") };
}

/**
 * A 200 from GET /api/log/status: the session has a compliance log. Its fields
 * belong to the backend, so none is read; the whole message is kept as
 * formatted JSON for display. Only the shape is checked: a log that is not a
 * JSON object is a ContractError.
 */
export function toCompliance(body: ResponseValue): Compliance {
  body.object<ComplianceLogResponse>();
  return { status: "acknowledged", log: body.formatted() };
}

/**
 * A saved query. The tree is required data (a malformed one throws a
 * ContractError naming the node, e.g. "query.children[0].kind"): loading half
 * of a user's query would be worse than saying it cannot be read. The note is
 * only shown, so a missing one becomes ""; the database ids are required like
 * every id.
 */
export function toSavedQuery(q: ResponseObject<SavedQueryResponse>): SavedQuery {
  return {
    id: q.id("id"),
    name: q.id("name").trim(),
    note: q.text("note"),
    databaseIds: q.ids("databases"),
    query: fromSavedTree(q.object<SavedGroup>("query")),
    updatedAt: q.id("updated_at"),
  };
}

/**
 * A saved query's tree, read strictly (a malformed node is a ContractError
 * naming its path: half of a user's query would be worse than saying it can't
 * be read). Every node gets a fresh id, as any new node does: a saved tree
 * has none. The tree comes back as it was saved, unfinished parts included.
 */
export function fromSavedTree(root: ResponseObject<SavedGroup>): Group {
  root.oneOf("kind", ["group"]); // a saved query's root is always a group
  return savedGroupOf(root);
}

function savedNodeOf(n: ResponseObject<SavedNode>): QueryNode {
  return n.oneOf("kind", ["group", "facet"]) === "group"
    ? savedGroupOf(n as ResponseObject<SavedGroup>)
    : savedFacetOf(n as ResponseObject<SavedFacet>);
}

function savedGroupOf(g: ResponseObject<SavedGroup>): Group {
  const operator = g.oneOf("operator", ["AND", "OR"]);
  return groupOf(g.list<SavedNode>("children").map(savedNodeOf), operator);
}

function savedFacetOf(f: ResponseObject<SavedFacet>): FacetBlock {
  return {
    ...newBlock(f.id("facet_id")),
    negated: f.boolean("negated"),
    operator: f.oneOf("operator", ["AND", "OR"]),
    conditions: f.list<SavedFieldCondition>("conditions").map(savedConditionOf),
  };
}

function savedConditionOf(c: ResponseObject<SavedFieldCondition>): FieldCondition {
  c.oneOf("kind", ["condition"]);
  return newFieldCondition(c.id("field_id"), c.nullableId("operator_id"), c.savedValue("value"));
}
