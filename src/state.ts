import type { Issue, QueryNode } from "./query/types";
import { emptyQuery } from "./query/tree";
import type { QueryResponse, SchemaResponse, StatsResponse } from "./api/types";

export type ActiveView = "filter" | "review" | "approval" | "done";
export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export interface AppState {
  schema: SchemaResponse | null;
  activeView: ActiveView;

  query: QueryNode;
  issues: Issue[];

  stats: { status: AsyncStatus; data: StatsResponse | null; error: string | null };
  preview: { status: AsyncStatus; data: QueryResponse | null; error: string | null; page: number };

  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  schema: null,
  activeView: "filter",
  query: emptyQuery(),
  issues: [],
  stats: { status: "idle", data: null, error: null },
  preview: { status: "idle", data: null, error: null, page: 1 },
  sidebarCollapsed: false,
};

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: (): AppState => state,
    setState(patch: Partial<AppState>): void {
      const changed = new Set(Object.keys(patch) as (keyof AppState)[]);
      state = { ...state, ...patch };
      for (const l of listeners) l(state, changed);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore(initialState);
