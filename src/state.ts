import type { Group } from "./query/types";
import type { Issue } from "./query/types";
import type { SchemaResponse, StatsResponse, QueryResponse } from "./api/types";
import { emptyQuery } from "./query/tree";

export interface AppState {
  activeView: string;
  query: Group;
  issues: Issue[];
  stats: {
    status: "idle" | "loading" | "done" | "error";
    data: StatsResponse | null;
    error: string | null;
  };
  preview: {
    status: "idle" | "loading" | "done" | "error";
    data: QueryResponse | null;
    error: string | null;
    page: number;
  };
  schema: SchemaResponse | null;
  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  activeView: "query",
  query: emptyQuery(),
  issues: [],
  stats: {
    status: "idle",
    data: null,
    error: null,
  },
  preview: {
    status: "idle",
    data: null,
    error: null,
    page: 1,
  },
  schema: null,
  sidebarCollapsed: false,
};

type StateListener = (state: AppState, changedKeys: Set<string>) => void;

export interface Store {
  getState(): AppState;
  setState(patch: Partial<AppState>): void;
  subscribe(listener: StateListener): void;
}

export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners: StateListener[] = [];

  return {
    getState() {
      return state;
    },
    setState(patch: Partial<AppState>) {
      const changedKeys = new Set<string>();
      let changed = false;

      for (const key in patch) {
        if (key in state && state[key as keyof AppState] !== patch[key as keyof AppState]) {
          changedKeys.add(key);
          changed = true;
        }
      }

      if (changed) {
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener(state, changedKeys));
      }
    },
    subscribe(listener: StateListener) {
      listeners.push(listener);
    },
  };
}

export const store = createStore(initialState);
