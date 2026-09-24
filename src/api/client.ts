import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetResponse,
  EventsResponse,
  IndividualResponse,
  StatsResponse,
} from "./types";
import type { Compliance, Database, DatabaseResult, EventRecord, Facet, User } from "../model";
import type { Group } from "../query/types";
import { ContractError, ResponseValue } from "./contract";
import { toQueryRequest } from "./request";
import { toCompliance, toDatabase, toDatabaseResult, toEvent, toFacet, toUser } from "./response";

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
export const COMPLIANCE_START_URL = `${BASE}/compliance/start`;

/**
 * How long a request may go without the server sending anything before it is
 * abandoned. For plain JSON requests that's the whole request; for the streamed
 * /stats body the clock restarts on every chunk, so a slow-but-progressing
 * stream is never cut off — only a silent one.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

/** The server answered with an HTTP error status (4xx/5xx). */
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

// ---- the endpoints ----------------------------------------------------------
//
// Each one rejects with an ApiError (an HTTP error status), a TimeoutError, or a
// ContractError (the answer doesn't match src/api/types.ts, src/api/contract.ts).

export async function getDatabases(): Promise<Database[]> {
  const body = await getJson("/databases");
  return body.list<DatabasesResponse>().map(toDatabase);
}

export async function getFacets(): Promise<Facet[]> {
  const body = await getJson("/individuals");
  return body.list<IndividualResponse>().map(toFacet);
}

/**
 * POST …/stats streams newline-delimited JSON: one line per database in
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
  await send("POST", "/stats", { body, signal }, async (res, source, touch) => {
    let lineNumber = 0;
    await readLines(res, source, touch, (line) => {
      lineNumber += 1;
      const value = ResponseValue.parse(line, `${source}, line ${lineNumber}`);
      onResult(toDatabaseResult(value.object<StatsResponse>()));
    });
  });
}

/** POST …/query: the events matching `query` in `databaseIds` (capped by the
 *  backend). Like getStats, an unfinished query rejects without sending. */
export async function runQuery(
  query: Group,
  databaseIds: string[],
  signal?: AbortSignal,
): Promise<EventRecord[]> {
  const body = await postJson("/query", toQueryRequest(query, databaseIds), signal);
  return body.object<EventsResponse>().list<EntrysetResponse>("entrysets").map(toEvent);
}

/**
 * Who's logged in, if anyone. A 401 here is a normal answer (not logged in),
 * so it resolves to `null` rather than throwing: an anonymous visitor must not
 * trip app.ts's fatal startup error.
 */
export async function getMe(): Promise<User | null> {
  try {
    const body = await getJson("/auth/me");
    return toUser(body.object<AuthUser>());
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function logout(): Promise<void> {
  return post("/auth/logout");
}

export async function getComplianceStatus(): Promise<Compliance> {
  const body = await getJson("/compliance/status");
  return toCompliance(body.object<ComplianceStatus>());
}

export function invalidateCompliance(): Promise<void> {
  return post("/compliance/invalidate");
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

/** POST to `path` with no body, ignoring whatever the answer's body holds. */
function post(path: string): Promise<void> {
  return send("POST", path, {}, async () => {});
}

async function readJson(res: Response, source: string): Promise<ResponseValue> {
  return ResponseValue.parse(await res.text(), source);
}

/**
 * Send one request under the API prefix, with the shared timeout, and hand a
 * successful response to `read`. Any other status rejects with an ApiError.
 *
 * `read` gets `source` ("GET /api/v1/databases", for error messages) and runs
 * inside the timeout, so a body that never finishes arriving times out too. A
 * streaming reader calls `touch()` whenever data arrives, to restart the clock.
 */
async function send<T>(
  method: "GET" | "POST",
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
    const res = await fetch(url, init);
    if (!res.ok) throw await errorFromResponse(res, source);
    return await read(res, source, d.touch);
  } finally {
    d.done();
  }
}

/** Every JSON endpoint answers an error with `{ "error": "…" }`; use that
 *  message when it is there, else the status line. */
async function errorFromResponse(res: Response, source: string): Promise<ApiError> {
  let message = `${source} failed: ${res.status} ${res.statusText}`.trim();
  try {
    const error = (JSON.parse(await res.text()) as { error?: unknown } | null)?.error;
    if (typeof error === "string" && error.trim()) message = error;
  } catch {
    /* no JSON error body: keep the status line */
  }
  return new ApiError(res.status, message);
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
      const { value, done } = await reader.read();
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
