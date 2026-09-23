// Publishes `window.jQuery` before Fomantic's JS is imported below. MUST stay the
// first import — ES imports are hoisted and evaluated in order, so this is the only
// way to guarantee the global exists when `semantic.min.js` evaluates.
// (docs/ARCHITECTURE.md §3 — the bootstrap wrinkle.)
import "./setup-jquery";

// Lato is NOT imported separately: fomantic-ui-css@2.9.x self-hosts it via local
// @font-face rules pointing at its own bundled LatoLatin-*.woff2 files. See
// docs/ARCHITECTURE.md §2.3.
import "fomantic-ui-css/semantic.min.css";
import "fomantic-ui-css/semantic.min.js";
import "./styles.css";

import {
  ApiError,
  getComplianceStatus,
  getDatabases,
  getIndividuals,
  getMe,
  getStats,
  invalidateCompliance,
  logout,
  runQuery,
} from "./api/client";
import { buildFieldCatalog } from "./query/fieldCatalog";
import { canRunQuery, store, type AppState } from "./state";
import { addChild, countConditions, newCondition, stripCollapsed } from "./query/tree";
import { validateQuery } from "./query/validate";
import type { Group, QueryNode } from "./query/types";
import { debounce } from "./util/debounce";
import { savePendingQuery, takePendingQuery } from "./util/pendingQuery";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderAuthStatus, wireAuthStatus } from "./ui/authStatus";
import { renderComplianceStatus, wireComplianceStatus } from "./ui/complianceStatus";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview } from "./ui/dataPreview";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Stale-guard key for /api/stats and /api/query. A request depends on BOTH the
 * query tree and the selected databases, so a change to either must invalidate an
 * in-flight response (§6). `collapsed` is stripped first: it's a pure UI display
 * flag, not part of the query's semantics, so toggling it must never invalidate an
 * in-flight request. Databases are sorted so selection order doesn't matter.
 */
const requestKey = (query: QueryNode, databases: string[]): string =>
  JSON.stringify({ query: stripCollapsed(query), databases: [...databases].sort() });

/** A closure over the query/scope a request was made for — call it after the
 * request settles (or after each streamed line) to check whether the user has
 * since changed the query/scope, per §6's stale-response guard. */
function staleGuard(query: QueryNode, databases: string[]): () => boolean {
  const key = requestKey(query, databases);
  return () => key !== requestKey(store.getState().query, store.getState().selectedDatabaseIds);
}

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => runPreview(),
});

/**
 * Any link that navigates straight into the login or compliance flow (the
 * top-menu widgets, the data-preview hints) must save the in-progress query
 * first too, not just the Run button's own redirect path (§2 of the
 * compliance-logging design spec) — otherwise a user who follows the
 * on-screen guidance loses their query on a hop Run itself protects.
 */
document.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>(
    "a[href='/api/auth/login'], a[href='/api/compliance/start']",
  );
  if (!anchor) return;
  const s = store.getState();
  if (countConditions(s.query) > 0) savePendingQuery(s.query, s.selectedDatabaseIds);
});

const PAGE_SIZE = 25;

/**
 * Runs `fetcher` behind the shared §6 stale-response guard: bail out unless
 * `canRunQuery` says the current query/scope is runnable, mark loading, then apply
 * `onSuccess`/`onError` only if the query/scope hasn't changed since the request
 * was made. `runPreview` and `refreshStats` are this same shape twice over — this
 * is the one place that shape needs to be correct.
 */
function runGuarded<T>(
  fetcher: (query: QueryNode, databases: string[]) => Promise<T>,
  onLoading: () => void,
  onSuccess: (data: T) => void,
  onError: (err: unknown) => void,
): void {
  const state = store.getState();
  if (!canRunQuery(state)) return;
  const { query, selectedDatabaseIds } = state;
  const isStale = staleGuard(query, selectedDatabaseIds);
  onLoading();
  fetcher(query, selectedDatabaseIds)
    .then((data) => {
      if (!isStale()) onSuccess(data);
    })
    .catch((err) => {
      if (!isStale()) onError(err);
    });
}

function runPreview(): void {
  // No longer gated on auth.status: Run always genuinely attempts the request now,
  // and reacts to whatever comes back. A 401 (not authenticated) or 403
  // (authenticated, some requirement unmet — e.g. compliance) saves the current
  // query/selection and navigates into the matching flow. This pattern would
  // generalize to a future protected endpoint returning the same status codes —
  // but ONLY from a call site triggered by an explicit user gesture, same as
  // this one (a Run click). Never wrap this pattern around an automatically-
  // fired request (e.g. refreshStats's debounced calls) — that would redirect
  // the browser without a click, breaking the "never redirects itself"
  // loop-safety property this whole feature depends on.
  runGuarded(
    (query, databases) => runQuery(query, databases, 1, PAGE_SIZE),
    () => store.setState({ preview: { status: "loading", data: null, error: null } }),
    (data) => store.setState({ preview: { status: "ok", data, error: null } }),
    (err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        const s = store.getState();
        savePendingQuery(s.query, s.selectedDatabaseIds);
        window.location.href = err.status === 401 ? "/api/auth/login" : "/api/compliance/start";
        return;
      }
      store.setState({ preview: { status: "error", data: null, error: errorMessage(err) } });
    },
  );
}

function syncRunButton(state = store.getState()): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu="run"]');
  if (!btn) return;
  btn.disabled = !(canRunQuery(state) && state.preview.status !== "loading");
}

function onLogout(): void {
  logout()
    .then(() => {
      // Compliance is piggybacked on the session server-side, so it's gone too
      // once the session ends — reset the local display state to match.
      store.setState({
        auth: { status: "anonymous", user: null },
        compliance: { status: "required", reason: null, ackedAt: null },
        preview: { status: "idle", data: null, error: null },
      });
    })
    .catch((err) => {
      // Best-effort: nothing more actionable to show beyond the button
      // still being there for the user to try again.
      console.error("Logout failed:", errorMessage(err));
    });
}

function onInvalidateCompliance(): void {
  invalidateCompliance()
    .then(() => {
      store.setState({
        compliance: { status: "required", reason: null, ackedAt: null },
        preview: { status: "idle", data: null, error: null },
      });
    })
    .catch((err) => {
      console.error("Invalidate compliance failed:", errorMessage(err));
    });
}

// Bumped once per refreshStats invocation. A content-based staleGuard key alone
// isn't enough here: toggling a database off/on (or editing a value away and
// back) within the 400ms debounce window can produce a NEW stream whose key is
// equal to an OLD in-flight stream's key, so the key-based check alone would
// treat the old stream as still current. Both streams would then append into
// the same (freshly-reset) `stats.lines` array, doubling every row. Pairing the
// key check with stream identity (this counter) closes that gap.
let statsRun = 0;

const refreshStats = debounce(() => {
  const state = store.getState();
  if (!canRunQuery(state)) return;
  const { query, selectedDatabaseIds } = state;
  const run = ++statsRun;
  const keyStale = staleGuard(query, selectedDatabaseIds);
  const isStale = () => run !== statsRun || keyStale();
  store.setState({ stats: { status: "loading", lines: [], error: null } });
  getStats(query, selectedDatabaseIds, (line) => {
    if (isStale()) return;
    store.setState({
      stats: { status: "loading", lines: [...store.getState().stats.lines, line], error: null },
    });
  })
    .then(() => {
      if (isStale()) return;
      store.setState({ stats: { status: "ok", lines: store.getState().stats.lines, error: null } });
    })
    .catch((err) => {
      if (isStale()) return;
      store.setState({ stats: { status: "error", lines: [], error: errorMessage(err) } });
    });
}, 400);

/**
 * A tree edit that changes only a group's `collapsed` flag is a pure display
 * change, not a semantic one (§6): it must not reset stats/preview or trigger a
 * refetch — `requestKey` already ignores `collapsed` too, so an in-flight request
 * survives a collapse toggle instead of being wrongly treated as stale.
 */
function onQueryChange(nextQuery: Group): void {
  const prevQuery = store.getState().query;
  if (nextQuery === prevQuery) return;
  const onlyCollapsedChanged =
    JSON.stringify(stripCollapsed(nextQuery)) === JSON.stringify(stripCollapsed(prevQuery));
  if (onlyCollapsedChanged) {
    store.setState({ query: nextQuery });
    return;
  }
  const schema = store.getState().schema;
  const issues = schema
    ? validateQuery(nextQuery, { fields: schema.fields, operators: schema.operators })
    : [];
  // Spec §6: editing the query immediately clears stats & preview in the SAME setState.
  store.setState({
    query: nextQuery,
    issues,
    stats: { status: "idle", lines: [], error: null },
    preview: { status: "idle", data: null, error: null },
  });
  refreshStats();
}

/** Changing the database scope behaves exactly like a query edit (§6). */
function onDatabasesChange(nextIds: string[]): void {
  const cur = store.getState().selectedDatabaseIds;
  if (nextIds.length === cur.length && nextIds.every((id) => cur.includes(id))) return;
  store.setState({
    selectedDatabaseIds: nextIds,
    stats: { status: "idle", lines: [], error: null },
    preview: { status: "idle", data: null, error: null },
  });
  refreshStats();
}

/**
 * Each panel's re-render trigger: which AppState keys it depends on, and how to
 * (re)render it. One list to read and extend instead of several hand-maintained
 * `changed.has(...)` chains that repeat the same keys.
 */
const panelRenderers: { keys: (keyof AppState)[]; run: (state: AppState) => void }[] = [
  { keys: ["activeView"], run: (s) => setActiveView(s.activeView) },
  { keys: ["sidebarCollapsed"], run: (s) => setSidebarCollapsed(s.sidebarCollapsed) },
  { keys: ["individuals"], run: (s) => renderDocsSidebar(s) },
  {
    keys: ["databases", "selectedDatabaseIds"],
    run: (s) => {
      renderDatabasePicker(s);
      wireDatabasePicker(panelEls().dbpicker, onDatabasesChange);
    },
  },
  {
    keys: ["schema", "query", "issues", "individuals"],
    run: (s) => {
      renderQueryBuilder(s);
      wireQueryBuilder(panelEls().center, onQueryChange);
    },
  },
  {
    keys: ["schema", "query", "issues", "stats", "selectedDatabaseIds"],
    run: (s) => renderStatsPanel(s),
  },
  {
    keys: [
      "preview",
      "query",
      "issues",
      "schema",
      "selectedDatabaseIds",
      "individuals",
      "auth",
      "compliance",
    ],
    run: (s) => {
      renderDataPreview(s);
      syncRunButton(s);
    },
  },
  {
    keys: ["auth"],
    run: (s) => {
      renderAuthStatus(s);
      wireAuthStatus(panelEls().auth, onLogout);
    },
  },
  {
    keys: ["compliance", "auth"],
    run: (s) => {
      renderComplianceStatus(s);
      wireComplianceStatus(panelEls().compliance, onInvalidateCompliance);
    },
  },
];

store.subscribe((state, changed) => {
  for (const { keys, run } of panelRenderers) {
    if (keys.some((k) => changed.has(k))) run(state);
  }
});

/**
 * `?resume=1` marks a load as the direct return-hop from the login or
 * compliance callback (both redirect here) — the ONE signal that tells this
 * load to restore a saved query, as opposed to a generic revisit finding a
 * stale leftover sessionStorage entry from an abandoned attempt. Stripped
 * from the URL immediately so a manual refresh doesn't re-trigger this.
 */
function consumeResumeParam(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("resume") !== "1") return false;
  url.searchParams.delete("resume");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}

const resumed = consumeResumeParam();
// Always clear a saved entry, even on a non-resume load — a stale one from an
// abandoned attempt (backed out of login, or a widget link clicked on an
// unrelated later visit) must not silently resurface on some future,
// unrelated resume-hop (spec §2).
const pending = resumed ? takePendingQuery() : (takePendingQuery(), null);

renderDatabasePicker(store.getState()); // "" while databases is null
renderQueryBuilder(store.getState()); // initial loader (centre panel spinner while individuals/databases load)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDataPreview(store.getState()); // initial idle message
syncRunButton(); // top-menu Run starts disabled
renderDocsSidebar(store.getState()); // initial loader
renderAuthStatus(store.getState()); // "" while auth.status is "loading"
renderComplianceStatus(store.getState()); // "" while compliance.status is "loading"
Promise.all([
  getDatabases(),
  getIndividuals(),
  getMe(),
  getComplianceStatus().catch(() => ({ status: "required" }) as const),
])
  .then(([databases, individuals, user, complianceStatus]) => {
    const schema = buildFieldCatalog(individuals);
    // A restored query replaces the normal empty-condition seed entirely — it
    // already has whatever conditions the user built before being redirected.
    const seeded = pending
      ? pending.query
      : addChild(
          store.getState().query as Group,
          (store.getState().query as Group).id,
          newCondition(),
        );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default, unless restored.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases,
      individuals,
      selectedDatabaseIds: pending ? pending.selectedDatabaseIds : databases.map((d) => d.label),
      query: seeded,
      issues,
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
    // A restored query already has real conditions and databases selected —
    // unlike the default empty seed, it needs its stats fetched immediately,
    // the same way any other in-app edit would trigger refreshStats() via
    // onQueryChange. The default-seed path never needed this since it starts
    // with nothing runnable.
    if (pending) refreshStats();
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${errorMessage(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
