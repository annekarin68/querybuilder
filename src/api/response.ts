import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetResponse,
  IndividualFieldResponse,
  IndividualResponse,
  StatsResponse,
} from "./types";
import type { ResponseObject } from "./contract";
import type {
  Compliance,
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  Field,
  Scalar,
  User,
} from "../model";

/**
 * Backend response → the frontend's own model (src/model.ts). client.ts runs
 * every response through one of these as it arrives, so no other file sees the
 * backend's names. When the backend renames or reshapes a field, change the
 * matching line here (and src/api/types.ts) — nothing else.
 *
 * Each function reads one object of a response key by key, through the checks
 * in src/api/contract.ts (docs/ARCHITECTURE.md, "Reading responses"): `id`,
 * `number`, `boolean` and `list` are required and throw a ContractError naming
 * the field; `text` and `strings` are only shown, so they fall back to blank.
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
    eventCount: d.number("totalEntrysets"),
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
    tags: [...new Set(tags)],
    group: i.text("group"),
    comment: i.text("comment"),
    description: i.text("description"),
    eventCount: i.number("totalCount"),
    fields: i.list<IndividualFieldResponse>("fields").map(toField),
  };
}

export function toEvent(e: ResponseObject<EntrysetResponse>): EventRecord {
  // `items` is keyed by facet id, then by field id: the backend's own ids,
  // so the keys are read as they come rather than by name.
  const items = e.object<EntrysetResponse["items"]>("items");
  const values: EventRecord["values"] = {};
  for (const facetId of items.keys()) {
    values[facetId] = items.object<Record<string, Scalar>>(facetId).scalars();
  }
  return { id: e.number("id"), values };
}

/**
 * One line of the /stats stream. A line that claims success but carries no
 * count is treated as a failure: showing it as "0 matched" would be a guess.
 */
export function toDatabaseResult(line: ResponseObject<StatsResponse>): DatabaseResult {
  const databaseId = line.id("label");
  const success = line.boolean("success");
  const matchCount = line.optionalNumber("matchCount");
  const notes = line.optionalStrings("infoMessages");
  if (success && matchCount !== undefined) {
    return { databaseId, status: "ok", matchCount, notes };
  }
  const errors = success
    ? ["The server sent no count for this database."]
    : line.optionalStrings("errorMessages");
  return { databaseId, status: "failed", errors, notes };
}

export function toUser(u: ResponseObject<AuthUser>): User {
  return { name: u.text("name") };
}

export function toCompliance(c: ResponseObject<ComplianceStatus>): Compliance {
  // Anything but "acknowledged" — even a status this app doesn't know yet —
  // means a reason is still needed.
  if (c.text("status") !== "acknowledged") return { status: "required" };
  return {
    status: "acknowledged",
    reason: c.optionalText("reason"),
    givenAt: c.optionalText("ackedAt") || null,
  };
}
