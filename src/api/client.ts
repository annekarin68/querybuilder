import type { QueryNode } from "../query/types";
import type { QueryResponse, SchemaResponse, StatsResponse } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* keep the status-line message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/schema");
}

export function getStats(query: QueryNode): Promise<StatsResponse> {
  return request<StatsResponse>("/stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export function runQuery(query: QueryNode, page: number, pageSize: number): Promise<QueryResponse> {
  return request<QueryResponse>("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, page, pageSize }),
  });
}
