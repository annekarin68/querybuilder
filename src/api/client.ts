import type { QueryNode } from "../query/types";
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EventsResponse,
  Facet,
  StatsResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

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

async function errorFromResponse(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* keep the status-line message */
  }
  return new ApiError(res.status, message);
}

/**
 * fetch() with the shared timeout. `read` consumes the response inside the
 * deadline, so a body that never finishes arriving times out too; a streaming
 * reader calls `touch()` whenever data arrives to restart the idle clock.
 */
async function send<T>(
  path: string,
  init: RequestInit | undefined,
  read: (res: Response, touch: () => void) => Promise<T>,
): Promise<T> {
  const d = deadline(init?.signal ?? undefined, REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: d.signal });
    return await read(res, d.touch);
  } finally {
    d.done();
  }
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return send(path, init, async (res) => {
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as T;
  });
}

function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  return send(path, init, async (res) => {
    if (!res.ok) throw await errorFromResponse(res);
  });
}

export function getDatabases(): Promise<DatabasesResponse[]> {
  return request<DatabasesResponse[]>("/databases");
}

export function getFacets(): Promise<Facet[]> {
  return request<Facet[]>("/individuals");
}

function postJson(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  };
}

/**
 * POST /api/stats streams newline-delimited JSON: one StatsResponse per
 * selected database, as soon as that database's result is ready. `onLine` is
 * called once per line, in arrival order; the returned promise resolves when
 * the stream ends, or rejects (before any line is read) on a non-2xx response.
 * Aborting `signal` stops reading and rejects with the abort reason — callers
 * use it to drop a stream whose query is no longer on screen.
 */
export function getStats(
  query: QueryNode,
  databases: string[],
  onLine: (line: StatsResponse) => void,
  signal?: AbortSignal,
): Promise<void> {
  return send("/stats", postJson({ query, databases }, signal), async (res, touch) => {
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body) throw new ApiError(res.status, "The server sent an empty statistics response.");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // A chunk boundary has no relation to line boundaries (or even UTF-8
    // character boundaries) in the NDJSON body, so buffer text across read()
    // calls and only emit complete lines.
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      touch(); // still making progress — restart the idle timeout
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // the last piece may be an incomplete line
      for (const line of lines) if (line.trim()) onLine(JSON.parse(line) as StatsResponse);
    }
    buffer += decoder.decode(); // flush a trailing partial multi-byte sequence, if any
    if (buffer.trim()) onLine(JSON.parse(buffer) as StatsResponse);
  });
}

/** POST /api/query: the events matching the query (capped by the backend). */
export function runQuery(
  query: QueryNode,
  databases: string[],
  signal?: AbortSignal,
): Promise<EventsResponse> {
  return request<EventsResponse>("/query", postJson({ query, databases }, signal));
}

/**
 * Who's logged in, if anyone. A 401 here is a normal outcome (not logged
 * in) — resolves to `null` rather than throwing, so this can sit alongside
 * getDatabases()/getFacets() in main.ts's startup Promise.all without
 * an anonymous visitor tripping their fatal-load-failure path.
 */
export function getMe(): Promise<AuthUser | null> {
  return send("/auth/me", undefined, async (res) => {
    if (res.status === 401) return null;
    if (!res.ok) throw await errorFromResponse(res);
    return (await res.json()) as AuthUser;
  });
}

export function logout(): Promise<void> {
  return requestNoContent("/auth/logout", { method: "POST" });
}

export function getComplianceStatus(): Promise<ComplianceStatus> {
  return request<ComplianceStatus>("/compliance/status");
}

export function invalidateCompliance(): Promise<void> {
  return requestNoContent("/compliance/invalidate", { method: "POST" });
}
