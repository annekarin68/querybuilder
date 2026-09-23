import type { QueryNode } from "../query/types";
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetsResponse,
  Individual,
  StatsResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

export function getDatabases(): Promise<DatabasesResponse[]> {
  return request<DatabasesResponse[]>("/databases");
}

export function getIndividuals(): Promise<Individual[]> {
  return request<Individual[]>("/individuals");
}

/**
 * POST /api/stats streams newline-delimited JSON: one StatsResponse per
 * selected database, as soon as that database's result is ready. `onLine` is
 * called once per line, in arrival order; the returned promise resolves when
 * the stream ends, or rejects (before any line is read) on a non-2xx response.
 */
export async function getStats(
  query: QueryNode,
  databases: string[],
  onLine: (line: StatsResponse) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/stats`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, databases }),
  });
  if (!res.ok) throw await errorFromResponse(res);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // A chunk boundary from the underlying stream has no relation to line
  // boundaries (or even UTF-8 character boundaries) in the NDJSON body, so a
  // chunk may end mid-line — buffer text across read() calls and only emit
  // complete lines, split on "\n".
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onLine(JSON.parse(line) as StatsResponse);
    }
  }
  buffer += decoder.decode(); // flush a trailing partial multi-byte sequence, if any
  const rest = buffer.trim();
  if (rest) onLine(JSON.parse(rest) as StatsResponse);
}

export function runQuery(
  query: QueryNode,
  databases: string[],
  page: number,
  pageSize: number,
): Promise<EntrysetsResponse> {
  return request<EntrysetsResponse>("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, databases, page, pageSize }),
  });
}

/**
 * Who's logged in, if anyone. A 401 here is a normal outcome (not logged
 * in) — resolves to `null` rather than throwing, so this can sit alongside
 * getDatabases()/getIndividuals() in main.ts's startup Promise.all without
 * an anonymous visitor tripping their fatal-load-failure path.
 */
export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 401) return null;
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as AuthUser;
}

export async function logout(): Promise<void> {
  const res = await fetch(`${BASE}/auth/logout`, { method: "POST" });
  if (!res.ok) throw await errorFromResponse(res);
}

export function getComplianceStatus(): Promise<ComplianceStatus> {
  return request<ComplianceStatus>("/compliance/status");
}

export async function invalidateCompliance(): Promise<void> {
  const res = await fetch(`${BASE}/compliance/invalidate`, { method: "POST" });
  if (!res.ok) throw await errorFromResponse(res);
}
