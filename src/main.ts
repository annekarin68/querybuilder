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
  COMPLIANCE_START_URL,
  getComplianceStatus,
  getDatabases,
  getFacets,
  getMe,
  getStats,
  invalidateCompliance,
  LOGIN_URL,
  logout,
  runQuery,
} from "./api/client";
import { buildFieldCatalog } from "./query/fieldCatalog";
import { runBlocker, store, type AppState } from "./state";
import { addChild, countConditions, newCondition, sameSemantics } from "./query/tree";
import { validateQuery } from "./query/validate";
import type { Group } from "./query/types";
import { debounce } from "./util/debounce";
import { savePendingQuery, takePendingQuery } from "./util/pendingQuery";
import { requestSlot, type SlotRequest } from "./util/requestSlot";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderAccountMenu, wireAccountMenu } from "./ui/accountMenu";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";
import { escapeHtml } from "./ui/panel";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

/**
 * Any link that navigates straight into the login or compliance flow (the
 * account menu, the Matching events card's notes) must save the in-progress
 * query first, not just Run's own redirect (§2 of the compliance-logging design
 * spec) — otherwise a user who follows the on-screen guidance loses their
 * query. Those links are marked `data-flow-link`.
 */
document.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-flow-link]");
  if (!anchor) return;
  const s = store.getState();
  if (countConditions(s.query) > 0) savePendingQuery(s.query, s.selectedDatabaseIds);
});

// One slot per request kind. Every query/scope edit cancels both (§6).
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
    return (await getComplianceStatus()).status === "required";
  } catch {
    return false;
  }
}

function redirectInto(url: string): void {
  const s = store.getState();
  savePendingQuery(s.query, s.selectedDatabaseIds);
  window.location.href = url;
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
  runQuery(state.query, state.selectedDatabaseIds, req.signal)
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
  const req: SlotRequest = statsSlot.start();
  store.setState({ stats: { status: "loading", lines: [], error: null } });
  const lines = () => store.getState().stats.lines;
  getStats(
    state.query,
    state.selectedDatabaseIds,
    (line) => {
      if (!req.isStale()) {
        store.setState({ stats: { status: "loading", lines: [...lines(), line], error: null } });
      }
    },
    req.signal,
  )
    .then(() => {
      if (!req.isStale()) store.setState({ stats: { status: "ok", lines: lines(), error: null } });
    })
    .catch((err) => {
      if (!req.isStale()) {
        store.setState({ stats: { status: "error", lines: [], error: errorMessage(err) } });
      }
    });
}, 400);

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
  logout()
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
  invalidateCompliance()
    .then(() => {
      store.setState({ compliance: { status: "required", reason: null, ackedAt: null } });
    })
    .catch((err) => {
      console.error("Invalidate compliance failed:", errorMessage(err));
    });
}

/**
 * A query edit or a database-scope change: clear stats & preview in the SAME
 * setState and abandon every request still in flight (§6), then schedule fresh
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

// Wire every panel once; they paint into containers renderShell created.
onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
});
wireDataPreview(panelEls().preview, runPreview);
wireDatabasePicker(panelEls().dbpicker, onDatabasesChange);
wireAccountMenu(panelEls().account, { onLogout, onInvalidate: onInvalidateCompliance });
const bindQueryDropdowns = wireQueryBuilder(panelEls().center, store.getState, onQueryChange);

/**
 * Each panel's re-render trigger: which AppState keys it depends on, and how to
 * (re)render it. Add a key here whenever a render function starts reading it.
 */
const panelRenderers: { keys: (keyof AppState)[]; run: (state: AppState) => void }[] = [
  { keys: ["activeView"], run: (s) => setActiveView(s.activeView) },
  { keys: ["sidebarCollapsed"], run: (s) => setSidebarCollapsed(s.sidebarCollapsed) },
  { keys: ["facets", "databases"], run: renderDocsSidebar },
  { keys: ["databases", "selectedDatabaseIds"], run: renderDatabasePicker },
  {
    keys: ["catalog", "query", "issues", "facets"],
    run: (s) => {
      renderQueryBuilder(s);
      bindQueryDropdowns();
    },
  },
  {
    keys: ["catalog", "query", "issues", "stats", "selectedDatabaseIds", "databases"],
    run: renderStatsPanel,
  },
  {
    keys: [
      "preview",
      "query",
      "issues",
      "catalog",
      "selectedDatabaseIds",
      "facets",
      "auth",
      "compliance",
    ],
    run: renderDataPreview,
  },
  { keys: ["auth", "compliance"], run: renderAccountMenu },
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

// Always take (and so clear) a saved entry, even on a non-resume load — a
// stale one from an abandoned attempt must not resurface on some future,
// unrelated resume-hop (spec §2). Only a resume-hop actually uses it.
const resumed = consumeResumeParam();
const saved = takePendingQuery();
const pending = resumed ? saved : null;

// First paint: loaders/placeholders until the startup requests below finish.
for (const { run } of panelRenderers) run(store.getState());

Promise.all([
  getDatabases(),
  getFacets(),
  // Login state is display-only (§9) and most of the app works anonymously, so
  // an auth-service outage must not take the whole app down: show "Log in",
  // and let a Run press surface the real problem.
  getMe().catch((err) => {
    console.error("Could not determine login state:", errorMessage(err));
    return null;
  }),
  getComplianceStatus().catch(() => ({ status: "required" }) as const),
])
  .then(([databases, facets, user, complianceStatus]) => {
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
  })
  .catch((err) => {
    // The message can come from the server's `{ error }` body — escape it like
    // every panel does. No inline onclick either: it would be blocked by a
    // strict Content-Security-Policy (script-src without 'unsafe-inline').
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load the app</div>
      <p>${escapeHtml(errorMessage(err))}</p>
      <button class="ui button" data-action="reload">Reload</button>
    </div>`;
    root
      .querySelector('[data-action="reload"]')
      ?.addEventListener("click", () => window.location.reload());
  });
