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

import * as api from "./api/client";
import { createApp, errorMessage } from "./app";
import { store, type AppState } from "./state";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderAccountMenu, wireAccountMenu } from "./ui/accountMenu";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";
import { escapeHtml } from "./ui/panel";

// This file only sets up the page: it renders the frame, wires each panel to
// `app` (src/app.ts, where everything the app DOES lives) and repaints panels
// when the state they read changes.

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

const app = createApp({
  store,
  api,
  navigate: (url) => {
    window.location.href = url;
  },
});

// Links straight into the login or compliance flow (marked data-flow-link)
// save the in-progress query first, so it survives the round trip.
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("a[data-flow-link]")) app.saveQueryBeforeRedirect();
});

// Wire every panel once; they paint into containers renderShell created.
onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
});
wireDataPreview(panelEls().preview, app.runPreview);
wireDatabasePicker(panelEls().dbpicker, app.onDatabasesChange);
wireAccountMenu(panelEls().account, {
  onLogout: app.onLogout,
  onInvalidate: app.onInvalidateCompliance,
});
const bindQueryDropdowns = wireQueryBuilder(panelEls().center, store.getState, app.onQueryChange);

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

/**
 * Databases or facets could not be loaded: nothing can work, so replace the
 * page with the error and a Reload button. The message can come from the
 * server's `{ error }` body — escape it like every panel does. No inline
 * onclick either: a strict Content-Security-Policy would block it.
 */
function showFatalError(err: unknown): void {
  root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load the app</div>
      <p>${escapeHtml(errorMessage(err))}</p>
      <button class="ui button" data-action="reload">Reload</button>
    </div>`;
  root
    .querySelector('[data-action="reload"]')
    ?.addEventListener("click", () => window.location.reload());
}

const resumed = consumeResumeParam();
// First paint: loaders/placeholders until the startup requests finish.
for (const { run } of panelRenderers) run(store.getState());
app.start(resumed).catch(showFatalError);
