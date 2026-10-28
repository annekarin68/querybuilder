/**
 * The frontend's own data model: what the app knows about databases, facets,
 * events, statistics and the session, in the app's own words
 * (docs/ARCHITECTURE.md, "Data model").
 *
 * Nothing outside src/api/ sees the backend's response types. src/api/response.ts
 * turns every response into these types as it arrives, so when the backend
 * renames or reshapes something, that file is the one to change.
 *
 * Every `id` is the backend's machine id for the thing (never shown to the
 * user); every `name` is the text shown in its place. Text the backend leaves
 * blank is "" (already trimmed), never missing.
 */

import type { Group } from "./query/types";

/** A partition of the events the query can be scoped to. */
export interface Database {
  id: string;
  name: string;
  /** What this database contains or what makes it unique. */
  description: string;
  /** Who reported the data. */
  owner: string;
  /** How many events this database holds. */
  eventCount: number;
}

/** One value a facet can report. */
export interface Field {
  /** Unique within its facet only: a field is named by the pair
   *  (facet id, field id), never by one joined string. */
  id: string;
  /** Always set: the field's id when the backend has no name for it. */
  name: string;
  /** The type as the backend spells it (e.g. "VARCHAR(255)", "TIMESTAMP").
   *  Shown in the data dictionary; `valueTypeFor` (src/query/fieldCatalog.ts)
   *  turns it into the query builder's value type. */
  typeName: string;
  /** The backend's own, always-correct description. */
  comment: string;
  /** A third-party technical description; may contain errors. */
  description: string;
  /** Known values, to suggest in a pick-list only: the list can be out of
   *  date, so it never decides the field's type or which values are allowed. */
  values: string[];
}

/** How often events holding one facet also hold another (the backend's
 *  `co_occurrence`, "Seen together" in docs/ARCHITECTURE.md). */
export interface CoValue {
  /** The backend's text, trimmed, for display ("1.2e-20"): never re-formatted. */
  text: string;
  /** 0 to 100: the share of this facet's events that also hold the other.
   *  0 for a value `tooRare` to be told from zero. */
  percent: number;
  /** The text is not zero, but is too small for a JavaScript number, which
   *  would round it to 0 and so say "never seen together". */
  tooRare: boolean;
}

/** One described aspect of an event: a signal, a reading, a piece of context. */
export interface Facet {
  id: string;
  name: string;
  /** The backend's number for this facet. The Matching events table orders
   *  its columns by it (after the facets in `FIRST_COLUMNS`). */
  number: number;
  /** Our own tags: trimmed, no blanks, no repeats. May be empty. */
  tags: string[];
  /** A third-party grouping; "" when there is none. Less useful than `tags`. */
  group: string;
  /** The backend's own, always-correct description. */
  comment: string;
  /** A third-party technical description. */
  description: string;
  /** How many events, across all databases, hold a value for this facet. */
  eventCount: number;
  /** By the other facet's id (this facet's own id too, at 100). Empty when
   *  the backend sent none. Display data only: nothing depends on it. */
  coOccurrence: ReadonlyMap<string, CoValue>;
  fields: Field[];
}

/** A single value an event holds for one field. */
export type Scalar = string | number | boolean;

/** One record: something that happened, holding values for some facets. */
export interface EventRecord {
  /** The event's own id (a GUID): long, so the panel shows its start. */
  id: string;
  /** Keyed by `Facet.id`: one entry per occurrence of the facet in this event
   *  (usually one), each keyed by `Field.id` within that facet. */
  values: Record<string, Record<string, Scalar>[]>;
}

/** One problem a database found in the query. */
export interface DatabaseError {
  message: string;
  /** "incomplete": something is missing. "invalid": something can't work. */
  kind: "incomplete" | "invalid";
  /** The `id` of the query node (a group, a facet block or a field
   *  condition) it is in, or null when it is not in one place. */
  nodeId: string | null;
}

/**
 * One database's answer to the statistics request. A database that failed
 * has no count at all, so it can never be shown as "0 matched".
 */
export type DatabaseResult =
  | {
      databaseId: string;
      status: "ok";
      /** Events in this database that match the query. */
      matchCount: number;
      /** Notices that don't stop the result (e.g. a warning). */
      notes: string[];
    }
  | {
      databaseId: string;
      status: "failed";
      /** Problems with the query itself (a malformed value, …). May be empty. */
      errors: DatabaseError[];
      /** Other messages (a timeout, an internal error, …). */
      notes: string[];
    };

/** Who's logged in. */
export interface User {
  name: string;
}

/** Whether this session has a compliance log. */
export type Compliance =
  | { status: "required" }
  | {
      status: "acknowledged";
      /** The session's compliance log as the backend sent it, formatted as
       *  indented JSON for display. The frontend reads no field of it. */
      log: string;
    };

/** A query the user saved (GET/POST/PUT …/filter/saved). It may be unfinished
 *  or invalid: saving never checks what the query means. */
export interface SavedQuery {
  /** Made by the server (not a backend `label`); never shown to the user. */
  id: string;
  name: string;
  /** A few words to recognise it by; "" when none. Never the query itself. */
  note: string;
  databaseIds: string[];
  query: Group;
  /** ISO 8601 UTC. */
  updatedAt: string;
}

/** The user's saved queries as the list endpoint gives them: the ones that
 *  could be read, newest first, and how many could not (saved by an older
 *  version, in a shape this one does not read). */
export interface SavedQueryList {
  queries: SavedQuery[];
  unreadable: number;
}

/** What is sent to save a query. */
export type SavedQueryDraft = Omit<SavedQuery, "id" | "updatedAt">;
