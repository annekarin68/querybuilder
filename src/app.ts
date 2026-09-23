import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "./api/client";
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EventsResponse,
  Facet,
  StatsResponse,
} from "./api/types";
import { buildFieldCatalog } from "./query/fieldCatalog";
import { addChild, countConditions, newCondition, sameSemantics } from "./query/tree";
import type { Group, QueryNode } from "./query/types";
import { validateQuery } from "./query/validate";
import { runBlocker, type AppState, type Store } from "./state";
import { debounce } from "./util/debounce";
import { savePendingQuery, takePendingQuery } from "./util/pendingQuery";
import { requestSlot } from "./util/requestSlot";

/**
 * What the app does in response to the user and the server: loading at
 * startup, live statistics, Run query, the 401/403 redirects into login and
 * compliance, and logging out. It changes state only through `store` and
 * touches no DOM, so tests drive it with a fake `api` (tests/app.test.ts).
 * main.ts wires it to the page.
 */

/** The API functions the app calls — src/api/client.ts in the browser. */
export interface AppApi {
  getDatabases(): Promise<DatabasesResponse[]>;
  getFacets(): Promise<Facet[]>;
  getMe(): Promise<AuthUser | null>;
  getComplianceStatus(): Promise<ComplianceStatus>;
  getStats(
    query: QueryNode,
    databases: string[],
    onLine: (line: StatsResponse) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  runQuery(query: QueryNode, databases: string[], signal?: AbortSignal): Promise<EventsResponse>;
  logout(): Promise<void>;
  invalidateCompliance(): Promise<void>;
}

export interface AppDeps {
  store: Store;
  api: AppApi;
  /** A full-page navigation (into the login or compliance flow). */
  navigate(url: string): void;
}

/** How long the query must stay unchanged before statistics are fetched. */
export const STATS_DEBOUNCE_MS = 400;

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createApp({ store, api, navigate }: AppDeps) {
  // One slot per request kind. Every query/scope edit cancels both
  // (docs/ARCHITECTURE.md, "Correctness invariant").
  const statsSlot = requestSlot();
  const previewSlot = requestSlot();

  /**
   * A 403 from /api/query means "authenticated, but some requirement is unmet" —
   * compliance is one such requirement, but not necessarily the only one (e.g. a
   * user not permitted to query a database). Redirecting into the compliance flow
   * on every 403 would send such a user round in circles with no error ever shown,
   * so ask the backend whether compliance is actually what's missing first.
   */
  async function complianceIsRequired(): Promise<boolean> {
    try {
      return (await api.getComplianceStatus()).status === "required";
    } catch {
      return false;
    }
  }

  /** Save the query (it survives the page load) and leave for `url`. */
  function redirectInto(url: string): void {
    const s = store.getState();
    savePendingQuery(s.query, s.selectedDatabaseIds);
    navigate(url);
  }

  /**
   * Run query. It always attempts the request and reacts to what comes back: a
   * 401 (not logged in) or 403 (logged in, some requirement unmet — e.g.
   * compliance) saves the query and navigates into the matching flow.
   *
   * Only ever do this from a call triggered by an explicit user gesture (a Run
   * click). Never wrap it around an automatically-fired request such as
   * refreshStats — that would redirect the browser without a click and break
   * the "never redirects itself" loop-safety property this feature depends on.
   */
  function runPreview(): void {
    const state = store.getState();
    if (runBlocker(state)) return;
    const req = previewSlot.start();
    const showError = (err: unknown) =>
      store.setState({ preview: { status: "error", error: errorMessage(err) } });
    store.setState({ preview: { status: "loading" } });
    api
      .runQuery(state.query, state.selectedDatabaseIds, req.signal)
      .then((data) => {
        if (!req.isStale()) store.setState({ preview: { status: "ok", data } });
      })
      .catch(async (err) => {
        if (req.isStale()) return;
        if (err instanceof ApiError && err.status === 401) return redirectInto(LOGIN_URL);
        if (err instanceof ApiError && err.status === 403) {
          const required = await complianceIsRequired();
          if (req.isStale()) return; // query, scope or session changed meanwhile
          return required ? redirectInto(COMPLIANCE_START_URL) : showError(err);
        }
        showError(err);
      });
  }

  /** Statistics, streamed one line per database and refetched live (debounced). */
  const refreshStats = debounce(() => {
    const state = store.getState();
    if (runBlocker(state)) return;
    const req = statsSlot.start();
    const lines: StatsResponse[] = [];
    store.setState({ stats: { status: "loading", lines: [], error: null } });
    api
      .getStats(
        state.query,
        state.selectedDatabaseIds,
        (line) => {
          if (req.isStale()) return;
          lines.push(line);
          store.setState({ stats: { status: "loading", lines: [...lines], error: null } });
        },
        req.signal,
      )
      .then(() => {
        if (!req.isStale()) store.setState({ stats: { status: "ok", lines, error: null } });
      })
      .catch((err) => {
        if (!req.isStale()) {
          store.setState({ stats: { status: "error", lines: [], error: errorMessage(err) } });
        }
      });
  }, STATS_DEBOUNCE_MS);

  /**
   * Logging out or invalidating compliance only affects Run (/api/stats is
   * anonymous), so only the preview is cancelled — and it is reset in the same
   * step, because whoever aborts a request must also reset its panel: the
   * aborted request's own handlers are stale and will never touch the state.
   */
  function resetPreview(): void {
    previewSlot.cancel();
    store.setState({ preview: { status: "idle" } });
  }

  function onLogout(): void {
    resetPreview();
    api
      .logout()
      .then(() => {
        // Compliance is piggybacked on the session server-side, so it's gone too
        // once the session ends — reset the local display state to match.
        store.setState({
          auth: { status: "anonymous", user: null },
          compliance: { status: "required", reason: null, ackedAt: null },
        });
      })
      .catch((err) => {
        // Best-effort: the button is still there for the user to try again.
        console.error("Logout failed:", errorMessage(err));
      });
  }

  function onInvalidateCompliance(): void {
    resetPreview();
    api
      .invalidateCompliance()
      .then(() => {
        store.setState({ compliance: { status: "required", reason: null, ackedAt: null } });
      })
      .catch((err) => {
        console.error("Invalidate compliance failed:", errorMessage(err));
      });
  }

  /**
   * A query edit or a database-scope change: clear stats & preview in the SAME
   * setState and abandon every request still in flight, then schedule fresh
   * statistics.
   */
  function changeScope(patch: Partial<AppState>): void {
    statsSlot.cancel();
    previewSlot.cancel();
    store.setState({
      ...patch,
      stats: { status: "idle", lines: [], error: null },
      preview: { status: "idle" },
    });
    refreshStats();
  }

  function onQueryChange(nextQuery: Group): void {
    const { query, catalog } = store.getState();
    if (nextQuery === query) return;
    // Expanding/collapsing a group is display-only: no reset, no refetch.
    if (sameSemantics(nextQuery, query)) {
      store.setState({ query: nextQuery });
      return;
    }
    const issues = catalog ? validateQuery(nextQuery, catalog) : [];
    changeScope({ query: nextQuery, issues });
  }

  function onDatabasesChange(nextIds: string[]): void {
    const cur = store.getState().selectedDatabaseIds;
    if (nextIds.length === cur.length && nextIds.every((id) => cur.includes(id))) return;
    changeScope({ selectedDatabaseIds: nextIds });
  }

  /**
   * Any link that navigates straight into the login or compliance flow (the
   * account menu, the Matching events card's notes) must save the in-progress
   * query first, not just Run's own redirect — otherwise a user who follows
   * the on-screen guidance loses their query.
   */
  function saveQueryBeforeRedirect(): void {
    const s = store.getState();
    if (countConditions(s.query) > 0) savePendingQuery(s.query, s.selectedDatabaseIds);
  }

  /**
   * Load everything the app needs and set the first real state. `resumed` is
   * true on the return hop from the login or compliance flow: only then is a
   * saved query restored. Rejects if databases or facets can't be loaded —
   * without them there is nothing to show.
   */
  async function start(resumed: boolean): Promise<void> {
    // Always take (and so clear) a saved entry, even on a normal load: a stale
    // one from an abandoned attempt must not resurface on some later, unrelated
    // return hop. Only a return hop actually uses it.
    const saved = takePendingQuery();
    const pending = resumed ? saved : null;

    const [databases, facets, user, complianceStatus] = await Promise.all([
      api.getDatabases(),
      api.getFacets(),
      // Login and compliance state are display-only and most of the app works
      // anonymously, so an outage of either must not take the whole app down:
      // show "Log in" / "Compliance needed", and let a Run press surface the
      // real problem.
      api.getMe().catch((err) => {
        console.error("Could not determine login state:", errorMessage(err));
        return null;
      }),
      api.getComplianceStatus().catch((err): ComplianceStatus => {
        console.error("Could not determine compliance status:", errorMessage(err));
        return { status: "required" };
      }),
    ]);

    const catalog = buildFieldCatalog(facets);
    // A restored query replaces the normal seed (one empty condition).
    const initial = store.getState().query;
    const query = pending ? pending.query : addChild(initial, initial.id, newCondition());
    store.setState({
      catalog,
      databases,
      facets,
      // A restored selection may name databases that no longer exist (it can
      // outlive a backend change) — keep only ones this load actually knows.
      // Otherwise every database is selected by default.
      selectedDatabaseIds: pending
        ? pending.selectedDatabaseIds.filter((id) => databases.some((d) => d.label === id))
        : databases.map((d) => d.label),
      query,
      // The seed bypasses onQueryChange, so validate here — otherwise Run
      // would be enabled on the empty seeded condition.
      issues: validateQuery(query, catalog),
      auth: { status: user ? "authenticated" : "anonymous", user },
      compliance:
        complianceStatus.status === "acknowledged"
          ? {
              status: "acknowledged",
              reason: complianceStatus.reason ?? null,
              ackedAt: complianceStatus.ackedAt ?? null,
            }
          : { status: "required", reason: null, ackedAt: null },
    });
    // A restored query is already complete, so fetch its statistics now, as
    // any in-app edit would. The empty seed has nothing runnable yet.
    if (pending) refreshStats();
  }

  return {
    start,
    runPreview,
    onQueryChange,
    onDatabasesChange,
    onLogout,
    onInvalidateCompliance,
    saveQueryBeforeRedirect,
  };
}
