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

/** One described aspect of an event: a signal, a reading, a piece of context. */
export interface Facet {
  id: string;
  name: string;
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
  fields: Field[];
}

/** A single value an event holds for one field. */
export type Scalar = string | number | boolean;

/** One record: something that happened, holding values for some facets. */
export interface EventRecord {
  id: number;
  /** Keyed by `Facet.id`, then by `Field.id` within that facet. */
  values: Record<string, Record<string, Scalar>>;
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
      errors: string[];
      /** Other messages (a timeout, an internal error, …). */
      notes: string[];
    };

/** Who's logged in. */
export interface User {
  name: string;
}

/** Whether this session has given a compliance reason. */
export type Compliance =
  | { status: "required" }
  | {
      status: "acknowledged";
      reason: string;
      /** When the reason was given (an ISO timestamp), if the backend says. */
      givenAt: string | null;
    };
