import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetResponse,
  IndividualFieldResponse,
  IndividualResponse,
  StatsResponse,
} from "./types";
import type {
  Compliance,
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  Field,
  User,
} from "../model";

/**
 * Backend response → the frontend's own model (src/model.ts). client.ts runs
 * every response through one of these as it arrives, so no other file sees the
 * backend's names. When the backend renames or reshapes a field, change the
 * matching function here (and src/api/types.ts) — nothing else.
 *
 * This is also where the backend's quirks are smoothed out once, instead of in
 * every panel: text may arrive blank or padded, a field may have no name yet,
 * and a field's type may sit in `type` or in `format`.
 */

/** The backend sends "" (never null) for missing text, sometimes padded. */
function clean(s: string | undefined): string {
  return (s ?? "").trim();
}

export function toDatabase(d: DatabasesResponse): Database {
  return {
    id: d.label,
    name: d.name,
    description: clean(d.description),
    owner: clean(d.owner),
    eventCount: d.totalEntrysets,
  };
}

export function toField(f: IndividualFieldResponse): Field {
  return {
    id: f.label,
    // The backend doesn't fill `name` yet; the label stands in until it does.
    name: clean(f.name) || f.label,
    // `type` wins; `format` is only a hint for when `type` is empty.
    typeName: clean(f.type) || clean(f.format),
    comment: clean(f.comment),
    description: clean(f.description),
    values: [...f.values],
  };
}

export function toFacet(i: IndividualResponse): Facet {
  return {
    id: i.label,
    name: i.name,
    tags: [...new Set(i.tags.map(clean).filter(Boolean))],
    group: clean(i.group),
    comment: clean(i.comment),
    description: clean(i.description),
    eventCount: i.totalCount,
    fields: i.fields.map(toField),
  };
}

export function toEvent(e: EntrysetResponse): EventRecord {
  return { id: e.id, values: e.items };
}

/**
 * One line of the /stats stream. A line that claims success but carries no
 * count is treated as a failure: showing it as "0 matched" would be a guess.
 */
export function toDatabaseResult(line: StatsResponse): DatabaseResult {
  const notes = line.infoMessages ?? [];
  if (line.success && typeof line.matchCount === "number") {
    return { databaseId: line.label, status: "ok", matchCount: line.matchCount, notes };
  }
  const errors = line.errorMessages ?? [];
  return {
    databaseId: line.label,
    status: "failed",
    errors: line.success ? ["The server sent no count for this database."] : errors,
    notes,
  };
}

export function toUser(u: AuthUser): User {
  return { name: u.name };
}

export function toCompliance(c: ComplianceStatus): Compliance {
  return c.status === "acknowledged"
    ? { status: "acknowledged", reason: c.reason ?? "", givenAt: c.ackedAt ?? null }
    : { status: "required" };
}
