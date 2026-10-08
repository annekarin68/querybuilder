import type {
  SavedNode,
  SavedQueryRequest,
  SavedQueryResponse,
  SavedValue,
} from "../src/api/types";
import { isObject, isScalar } from "./requestBody";

// The mock's saved queries (docs/ARCHITECTURE.md, "Saved queries"): in memory,
// one list per user, lost when the mock restarts. A pure store plus the body
// check, so tests need no HTTP; server.ts only adds the routes and the session.

/** What a store call answers: an HTTP status and, unless it is 204, a JSON body. */
export interface SavedQueryAnswer {
  status: number;
  body?: unknown;
}

export const MAX_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 80;

/** Two names clash when they are the same ignoring case and surrounding spaces. */
const nameKey = (name: string) => name.trim().toLowerCase();

const notFound = (): SavedQueryAnswer => ({
  status: 404,
  body: { error: "No saved query with that id." },
});

/**
 * `now` and `newId` are parameters so a test controls the clock and the ids;
 * the mock server uses the defaults.
 */
export function createSavedQueryStore(
  now: () => Date = () => new Date(),
  newId: () => string = counter("sq-"),
) {
  /** Per user, by id. A Map keeps creation order, which breaks ties in `list`. */
  const byUser = new Map<string, Map<string, SavedQueryResponse>>();

  const queriesOf = (userId: string) => {
    let queries = byUser.get(userId);
    if (!queries) byUser.set(userId, (queries = new Map()));
    return queries;
  };

  /** The other saved queries of this user that already use `name`. */
  const nameTaken = (userId: string, name: string, exceptId?: string) =>
    [...queriesOf(userId).values()].some(
      (q) => q.id !== exceptId && nameKey(q.name) === nameKey(name),
    );

  const nameClash = (name: string): SavedQueryAnswer => ({
    status: 409,
    body: { error: `A saved query called "${name.trim()}" already exists.` },
  });

  return {
    /** Newest `updatedAt` first; for the same instant, the one created later first. */
    list(userId: string): SavedQueryAnswer {
      const newestCreatedFirst = [...queriesOf(userId).values()].reverse();
      // sort is stable, so ties keep the "created later first" order from above.
      newestCreatedFirst.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { status: 200, body: newestCreatedFirst };
    },

    create(userId: string, body: SavedQueryRequest): SavedQueryAnswer {
      if (nameTaken(userId, body.name)) return nameClash(body.name);
      const saved: SavedQueryResponse = {
        ...body,
        name: body.name.trim(),
        id: newId(),
        updatedAt: now().toISOString(),
      };
      queriesOf(userId).set(saved.id, saved);
      return { status: 201, body: saved };
    },

    /** Replaces the content of a saved query of this user; its place in the creation order stays. */
    update(userId: string, id: string, body: SavedQueryRequest): SavedQueryAnswer {
      const queries = queriesOf(userId);
      if (!queries.has(id)) return notFound();
      if (nameTaken(userId, body.name, id)) return nameClash(body.name);
      const saved: SavedQueryResponse = {
        ...body,
        name: body.name.trim(),
        id,
        updatedAt: now().toISOString(),
      };
      queries.set(id, saved);
      return { status: 200, body: saved };
    },

    remove(userId: string, id: string): SavedQueryAnswer {
      return queriesOf(userId).delete(id) ? { status: 204 } : notFound();
    },
  };
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

// ---- the request body ---------------------------------------------------------

export type SavedQueryBodyCheck =
  { ok: true; body: SavedQueryRequest } | { ok: false; error: string };

/**
 * Checks a POST/PUT body against SavedQueryRequest (src/api/types.ts): the
 * shape only, never the meaning, so a half-built query is accepted. Untrusted
 * JSON in; the first problem found is the error. A valid body comes back with
 * name and note trimmed.
 */
export function readSavedQueryBody(value: unknown): SavedQueryBodyCheck {
  if (!isObject(value)) return { ok: false, error: "Body must be an object." };
  const { name, note, databases, query } = value;
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName === "" || trimmedName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `name must be 1 to ${MAX_NAME_LENGTH} characters.` };
  }
  const trimmedNote = typeof note === "string" ? note.trim() : null;
  if (trimmedNote === null || trimmedNote.length > MAX_NOTE_LENGTH) {
    return { ok: false, error: `note must be text of at most ${MAX_NOTE_LENGTH} characters.` };
  }
  if (!Array.isArray(databases)) {
    return { ok: false, error: "databases must be a list of strings." };
  }
  // The client reads every saved query's ids strictly (a blank one is a
  // ContractError), so one bad stored entry would hide the user's whole list:
  // refuse it here instead.
  const blankAt = databases.findIndex((d) => !isNonBlankString(d));
  if (blankAt !== -1) {
    return { ok: false, error: `databases[${blankAt}] must be a non-blank string.` };
  }
  const problem = savedTreeProblem(query, "query", new Set(), true);
  if (problem) return { ok: false, error: problem };
  return {
    ok: true,
    body: {
      name: trimmedName,
      note: trimmedNote,
      databases: databases as string[],
      query: query as SavedQueryRequest["query"],
    },
  };
}

/** A value that is `null`, a scalar, or a list of scalars and nulls. */
const isSavedValue = (v: unknown): v is SavedValue =>
  v === null ||
  isScalar(v) ||
  (Array.isArray(v) && v.every((item) => item === null || isScalar(item)));

const isNonBlankString = (v: unknown) => typeof v === "string" && v.trim() !== "";
const isNonBlankStringOrNull = (v: unknown) => v === null || isNonBlankString(v);

/**
 * What is wrong with `node` as a SavedNode, or null if nothing is. Like
 * `queryProblem` (requestBody.ts) but for a draft: a group may be empty, and a
 * condition's ids and value may be null. `at` names the node, e.g.
 * "query.children[1]". `seenIds` collects the node ids met so far: the
 * frontend finds nodes by id, so two with the same one would make edits land
 * on the wrong node. The first problem found wins.
 */
function savedTreeProblem(
  node: unknown,
  at: string,
  seenIds: Set<string>,
  isRoot = false,
): string | null {
  if (!isObject(node)) return `${at} must be an object.`;
  if (isRoot && node.kind !== "group") return `${at}.kind must be "group".`;
  if (node.kind !== "group" && node.kind !== "condition") {
    return `${at}.kind must be "group" or "condition".`;
  }
  if (!isNonBlankString(node.id)) return `${at}.id must be a non-blank string.`;
  const id = node.id as string;
  if (seenIds.has(id)) return `${at}.id "${id}" is already used by another node.`;
  seenIds.add(id);
  if (node.kind === "group") {
    if (node.operator !== "AND" && node.operator !== "OR") {
      return `${at}.operator must be "AND" or "OR".`;
    }
    if (!Array.isArray(node.children)) return `${at}.children must be a list.`;
    for (const [i, child] of (node.children as SavedNode[]).entries()) {
      const problem = savedTreeProblem(child, `${at}.children[${i}]`, seenIds);
      if (problem) return problem;
    }
    return null;
  }
  for (const key of ["facetId", "fieldId", "operatorId"] as const) {
    if (!isNonBlankStringOrNull(node[key]))
      return `${at}.${key} must be a non-blank string or null.`;
  }
  if (!isSavedValue(node.value)) {
    return `${at}.value must be null, a string, number or boolean, or a list of them (a list may hold nulls).`;
  }
  return null;
}

// ---- the path ---------------------------------------------------------------------

/**
 * The `{id}` of `…/saved-queries/{id}`, decoded, or null when `pathname` is
 * not such a path (the server's route table matches exact paths, so it asks
 * this for the PUT and DELETE routes that carry an id).
 */
export function savedQueryIdFrom(pathname: string, apiBase: string): string | null {
  const prefix = `${apiBase}/saved-queries/`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null; // broken percent-encoding: no such saved query
  }
}
