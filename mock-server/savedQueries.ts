import {
  NODE_KIND,
  type SavedQueryRequest,
  type SavedQueryResponse,
  type SavedValue,
  type UserResponse,
} from "../src/api/types";
import { isObject, isScalar } from "./requestBody";
import { pathBelow } from "./paths";

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
    /** Newest `updated_at` first; for the same instant, the one created later first. */
    list(userId: string): SavedQueryAnswer {
      const newestCreatedFirst = [...queriesOf(userId).values()].reverse();
      // sort is stable, so ties keep the "created later first" order from above.
      newestCreatedFirst.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { status: 200, body: newestCreatedFirst };
    },

    create(userId: string, body: SavedQueryRequest): SavedQueryAnswer {
      if (nameTaken(userId, body.name)) return nameClash(body.name);
      const saved: SavedQueryResponse = {
        ...body,
        name: body.name.trim(),
        id: newId(),
        updated_at: now().toISOString(),
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
        updated_at: now().toISOString(),
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
  const problem = savedTreeProblem(query, "query", true);
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
 * field condition's operator and value may be null. `at` names the node, e.g.
 * "query.children[1]". Nodes have no ids (the frontend makes fresh ones when
 * it reads the tree back), so an `id` left in by an older build is not
 * checked. A query saved before facet blocks (a condition directly in a
 * group) is refused here, naming where: old queries are not migrated (spec,
 * decision 9). The first problem found wins.
 */
function savedTreeProblem(node: unknown, at: string, isRoot = false): string | null {
  if (!isObject(node)) return `${at} must be an object.`;
  if (isRoot && node.kind !== NODE_KIND.group) return `${at}.kind must be "${NODE_KIND.group}".`;
  if (node.kind !== NODE_KIND.group && node.kind !== NODE_KIND.facet) {
    return `${at}.kind must be "${NODE_KIND.group}" or "${NODE_KIND.facet}".`;
  }
  if (node.operator !== "AND" && node.operator !== "OR") {
    return `${at}.operator must be "AND" or "OR".`;
  }
  if (node.kind === NODE_KIND.group) {
    if (!Array.isArray(node.children)) return `${at}.children must be a list.`;
    for (const [i, child] of node.children.entries()) {
      const problem = savedTreeProblem(child, `${at}.children[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (!isNonBlankString(node.facet_id)) return `${at}.facet_id must be a non-blank string.`;
  if (typeof node.negated !== "boolean") return `${at}.negated must be true or false.`;
  if (!Array.isArray(node.conditions)) return `${at}.conditions must be a list.`;
  for (const [i, c] of node.conditions.entries()) {
    const problem = savedConditionProblem(c, `${at}.conditions[${i}]`);
    if (problem) return problem;
  }
  return null;
}

/** What is wrong with `c` as a SavedFieldCondition (a set field of a block), or null. */
function savedConditionProblem(c: unknown, at: string): string | null {
  if (!isObject(c)) return `${at} must be an object.`;
  if (c.kind !== NODE_KIND.condition) return `${at}.kind must be "${NODE_KIND.condition}".`;
  if (!isNonBlankString(c.field_id)) return `${at}.field_id must be a non-blank string.`;
  if (!isNonBlankStringOrNull(c.operator_id)) {
    return `${at}.operator_id must be a non-blank string or null.`;
  }
  if (!isSavedValue(c.value)) {
    return `${at}.value must be null, a string, number or boolean, or a list of them (a list may hold nulls).`;
  }
  return null;
}

// ---- whose list ------------------------------------------------------------------

/** Whose saved queries a session's user gets: their id (`sub`, also spelled
 *  `user_id`), or null when they have none. */
export function savedQueryOwner(user: Pick<UserResponse, "sub" | "user_id">): string | null {
  return user.sub || user.user_id || null;
}

// ---- the path ---------------------------------------------------------------------

/**
 * The `{id}` of `…/filter/saved/{id}`, decoded, or null when `pathname` is
 * not such a path (the server's route table matches exact paths, so it asks
 * this for the PUT and DELETE routes that carry an id).
 */
export function savedQueryIdFrom(pathname: string, apiBase: string): string | null {
  const below = pathBelow(pathname, apiBase);
  const prefix = "/filter/saved/";
  if (below === null || !below.startsWith(prefix)) return null;
  const rest = below.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null; // broken percent-encoding: no such saved query
  }
}
