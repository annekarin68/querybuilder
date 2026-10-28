import type {
  DatabasesResponse,
  EventResponse,
  EventsResponse,
  IndividualResponse,
  SavedQueryResponse,
  StatsResponse,
  UserResponse,
} from "./types";
import type {
  Compliance,
  Database,
  DatabaseResult,
  EventRecord,
  Facet,
  SavedQuery,
  SavedQueryDraft,
  SavedQueryList,
  User,
} from "../model";
import type { Group } from "../query/types";
import { ContractError, ResponseValue } from "./contract";
import { toQueryRequest, toSavedQueryRequest } from "./request";
import {
  countWithoutCoOccurrence,
  pruneUnknownCoOccurrence,
  toCompliance,
  toDatabase,
  toDatabaseResult,
  toEvent,
  toFacet,
  toSavedQuery,
  toUser,
} from "./response";

// The only file that calls fetch(): one function per endpoint. Every one of
// them speaks the frontend's model (src/model.ts): request bodies are built by
// src/api/request.ts, and responses are checked and translated by
// src/api/response.ts as they are read. The backend's own types never leave
// src/api/ (docs/ARCHITECTURE.md, "Data model").

/** The API prefix from .env (docs/ARCHITECTURE.md, "API contract"). No
 *  fallback here: vite.config.ts refuses to run without it. */
const BASE = import.meta.env.VITE_API_BASE;

/**
 * Where the browser navigates (a real page load, not a fetch) to start the login
 * or compliance redirect flow. Built from the same BASE as every fetch below, so
 * a non-default VITE_API_BASE moves these links too.
 */
export const LOGIN_URL = `${BASE}/auth/login`;
export const COMPLIANCE_START_URL = `${BASE}/log/build`;

/**
 * How long a request may go without the server sending anything before it is
 * abandoned. For plain JSON requests that's the whole request; for the streamed
 * /filter/validate body the clock restarts on every chunk, so a slow-but-progressing
 * stream is never cut off — only a silent one.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/** The server answered with an HTTP error status (4xx/5xx). The message is for
 *  the console: the request, the status code and text, and the server's own
 *  `{ "error": … }` text if it sent one. Users are shown `userMessage`
 *  (src/api/errorText.ts) instead. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Thrown (as the abort reason) when a request hits REQUEST_TIMEOUT_MS. */
export class TimeoutError extends Error {
  constructor() {
    super("The server took too long to respond. Please try again.");
    this.name = "TimeoutError";
  }
}

/** No answer at all: the server is down or unreachable, or the connection
 *  broke. (fetch rejects with a bare TypeError, "Failed to fetch", for all of
 *  these; this names the request so the console says which one.) */
export class NetworkError extends Error {
  constructor(source: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`${source} failed: no answer from the server (${why})`);
    this.name = "NetworkError";
  }
}

/** `err` as a NetworkError if it is fetch's "no answer" TypeError. An abort
 *  (ours, or the timeout's TimeoutError) is not a TypeError and passes through. */
function asNetworkError(err: unknown, source: string): unknown {
  return err instanceof TypeError ? new NetworkError(source, err) : err;
}

// ---- the endpoints ----------------------------------------------------------
//
// Each one rejects with an ApiError (an HTTP error status), a NetworkError (no
// answer), a TimeoutError, or a ContractError (the answer doesn't match
// src/api/types.ts, src/api/contract.ts).

export async function getDatabases(): Promise<Database[]> {
  const body = await getJson("/documentation/databases");
  return body.list<DatabasesResponse>().map(toDatabase);
}

export async function getFacets(): Promise<Facet[]> {
  const body = await getJson("/documentation/individuals");
  const items = body.list<IndividualResponse>();
  countWithoutCoOccurrence(items);
  return pruneUnknownCoOccurrence(items.map(toFacet));
}

/**
 * POST …/filter/validate streams newline-delimited JSON: one line per database in
 * `databaseIds`, as soon as that database's result is ready. `onResult` is
 * called once per line, in arrival order; the returned promise resolves when
 * the stream ends, or rejects (before any line is read) on a non-2xx response.
 * Aborting `signal` stops reading and rejects with the abort reason — callers
 * use it to drop a stream whose query is no longer on screen.
 *
 * `query` must be able to run (`runBlocker` in src/state.ts): an unfinished
 * one rejects without sending anything.
 */
export async function getStats(
  query: Group,
  databaseIds: string[],
  onResult: (result: DatabaseResult) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = toQueryRequest(query, databaseIds);
  await send("POST", "/filter/validate", { body, signal }, async (res, source, touch) => {
    let lineNumber = 0;
    await readLines(res, source, touch, (line) => {
      lineNumber += 1;
      const value = ResponseValue.parse(line, `${source}, line ${lineNumber}`);
      onResult(toDatabaseResult(value.object<StatsResponse>()));
    });
  });
}

/** POST …/filter/execute: the events matching `query` in `databaseIds` (a random
 *  sample of up to 2,000; the backend decides the size). Like getStats, an
 *  unfinished query rejects without sending. */
export async function runQuery(
  query: Group,
  databaseIds: string[],
  signal?: AbortSignal,
): Promise<EventRecord[]> {
  const body = await postJson("/filter/execute", toQueryRequest(query, databaseIds), signal);
  return body.object<EventsResponse>().list<EventResponse>("events").map(toEvent);
}

/**
 * Who's logged in, if anyone. A 401 here is a normal answer (not logged in),
 * so it resolves to `null` rather than throwing: an anonymous visitor must not
 * trip app.ts's fatal startup error.
 */
export async function getMe(): Promise<User | null> {
  try {
    const body = await getJson("/users/me");
    return toUser(body.object<UserResponse>());
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function logout(): Promise<void> {
  return post("/auth/logout");
}

/**
 * The session's compliance log, if there is one. A 403 here is a normal answer
 * (no compliance log yet), so it resolves to "required" rather than throwing,
 * the same way getMe turns a 401 into `null`. Any other failure rejects.
 */
export async function getComplianceStatus(): Promise<Compliance> {
  try {
    const body = await getJson("/log/status");
    return toCompliance(body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return { status: "required" };
    throw err;
  }
}

export function invalidateCompliance(): Promise<void> {
  return post("/log/invalidate");
}

// ---- saved queries: the logged-in user's own list ---------------------------
//
// Each one also rejects with an ApiError of status 401 (not logged in); an
// update or delete adds 404 (no such saved query), a create or update 409 (the
// name is taken) and 400 (a malformed body, which is a bug on our side).

/**
 * The user's saved queries. An entry that can't be read (a `ContractError`:
 * saved by an older version, in a shape this one does not read) is skipped
 * with a console warning and counted, so one old entry does not make the
 * whole list unreadable. Anything else (an HTTP error, a body that is not a
 * list) still fails as a whole.
 */
export async function listSavedQueries(): Promise<SavedQueryList> {
  const body = await getJson("/filter/saved");
  const queries: SavedQuery[] = [];
  let unreadable = 0;
  for (const entry of body.items()) {
    try {
      queries.push(toSavedQuery(entry.object<SavedQueryResponse>()));
    } catch (err) {
      if (!(err instanceof ContractError)) throw err;
      unreadable += 1;
      const name = entry.textForMessage("name");
      console.warn(`Skipped the saved query${name ? ` “${name}”` : ""}: ${err.message}`);
    }
  }
  return { queries, unreadable };
}

export async function createSavedQuery(draft: SavedQueryDraft): Promise<SavedQuery> {
  const body = await postJson("/filter/saved", toSavedQueryRequest(draft));
  return toSavedQuery(body.object<SavedQueryResponse>());
}

/** Replaces the saved query `id` with `draft` (a rename included). */
export async function updateSavedQuery(id: string, draft: SavedQueryDraft): Promise<SavedQuery> {
  const body = await putJson(savedQueryPath(id), toSavedQueryRequest(draft));
  return toSavedQuery(body.object<SavedQueryResponse>());
}

export function deleteSavedQuery(id: string): Promise<void> {
  return del(savedQueryPath(id));
}

/** The id may hold any character (it is the server's), so it is encoded. */
function savedQueryPath(id: string): string {
  return `/filter/saved/${encodeURIComponent(id)}`;
}

// ---- how a request is sent --------------------------------------------------

/** GET `path` and return its JSON body, not checked yet. */
function getJson(path: string): Promise<ResponseValue> {
  return send("GET", path, {}, readJson);
}

/** POST `body` as JSON to `path` and return the JSON answer, not checked yet. */
function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<ResponseValue> {
  return send("POST", path, { body, signal }, readJson);
}

/** PUT `body` as JSON to `path` and return the JSON answer, not checked yet. */
function putJson(path: string, body: unknown): Promise<ResponseValue> {
  return send("PUT", path, { body }, readJson);
}

/** DELETE `path`, ignoring whatever the answer's body holds. */
function del(path: string): Promise<void> {
  return send("DELETE", path, {}, async () => {});
}

/** POST to `path` with no body, ignoring whatever the answer's body holds. */
function post(path: string): Promise<void> {
  return send("POST", path, {}, async () => {});
}

async function readJson(res: Response, source: string): Promise<ResponseValue> {
  const text = await res.text().catch((err: unknown) => {
    throw asNetworkError(err, source);
  });
  return ResponseValue.parse(text, source);
}

/**
 * Send one request under the API prefix, with the shared timeout, and hand a
 * successful response to `read`. Any other status rejects with an ApiError.
 *
 * `read` gets `source` ("GET /api/v1/documentation/databases", for error messages) and runs
 * inside the timeout, so a body that never finishes arriving times out too. A
 * streaming reader calls `touch()` whenever data arrives, to restart the clock.
 */
async function send<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  { body, signal }: { body?: unknown; signal?: AbortSignal },
  read: (res: Response, source: string, touch: () => void) => Promise<T>,
): Promise<T> {
  const url = `${BASE}${path}`;
  const source = `${method} ${url}`;
  const d = deadline(signal, REQUEST_TIMEOUT_MS);
  const init: RequestInit = { method, signal: d.signal };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(url, init).catch((err: unknown) => {
      throw asNetworkError(err, source);
    });
    if (!res.ok) throw await errorFromResponse(res, source);
    return await read(res, source, d.touch);
  } finally {
    d.done();
  }
}

/** The request, the status line and, when the answer has the usual
 *  `{ "error": "…" }` body, that text: everything someone debugging needs. */
async function errorFromResponse(res: Response, source: string): Promise<ApiError> {
  const statusLine = `${source} failed: ${res.status} ${res.statusText}`.trim();
  let serverText = "";
  try {
    const error = (JSON.parse(await res.text()) as { error?: unknown } | null)?.error;
    if (typeof error === "string") serverText = error.trim();
  } catch {
    /* no JSON error body: the status line says enough */
  }
  return new ApiError(res.status, serverText ? `${statusLine}: ${serverText}` : statusLine);
}

/**
 * A signal that aborts when the caller's `outer` signal does, or when `ms`
 * passes without `touch()` being called — whichever comes first. Call `done()`
 * once the request has fully settled so the timer and listener are released.
 */
function deadline(outer: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(new TimeoutError()), ms);
  };
  const onOuterAbort = () => ctrl.abort(outer!.reason);
  if (outer?.aborted) ctrl.abort(outer.reason);
  else outer?.addEventListener("abort", onOuterAbort, { once: true });
  touch();
  return {
    signal: ctrl.signal,
    touch,
    done() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    },
  };
}

/**
 * Call `onLine` for every non-blank line of a streamed body as it arrives, and
 * `touch` for every chunk (the stream is still alive). A chunk can end anywhere
 * — mid-line, even mid-character — so text is kept until its line is complete.
 */
async function readLines(
  res: Response,
  source: string,
  touch: () => void,
  onLine: (line: string) => void,
): Promise<void> {
  if (!res.body) throw new ContractError(source, "the body is empty.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read().catch((err: unknown) => {
        throw asNetworkError(err, source); // the connection broke mid-stream
      });
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // the last piece may be an incomplete line
      for (const line of lines) if (line.trim()) onLine(line);
    }
  } catch (err) {
    // A bad line (or an abort) ends the request: stop downloading the rest.
    reader.cancel().catch(() => {});
    throw err;
  }
  buffer += decoder.decode(); // a trailing multi-byte character, if any
  if (buffer.trim()) onLine(buffer);
}
