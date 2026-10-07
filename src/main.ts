// Publishes `window.jQuery` before Fomantic's JS is imported below. MUST stay the
// first import — ES imports are hoisted and evaluated in order, so this is the only
// way to guarantee the global exists when `semantic.min.js` evaluates.
// (docs/ARCHITECTURE.md, "The bootstrap wrinkle".)
import "./setup-jquery";

// Lato is NOT imported separately: fomantic-ui-css@2.9.x self-hosts it via local
// @font-face rules pointing at its own bundled LatoLatin-*.woff2 files. See
// docs/ARCHITECTURE.md, "Offline-first".
import "fomantic-ui-css/semantic.min.css";
import "fomantic-ui-css/semantic.min.js";
import "./styles.css";

import * as api from "./api/client";
import { EASTER_EGG_TOAST, MASCOT } from "./config";
import { createApp, errorMessage } from "./app";
import { store, type AppState } from "./state";
import { showToast } from "./ui/fomantic";
import { renderShell } from "./ui/layout";
import { mascotFor } from "./ui/mascot";
import { renderAccountMenu, wireAccountMenu } from "./ui/accountMenu";
import { escapeClosesDocs, renderDocsSidebar, wireDocsSidebar } from "./ui/docsSidebar";
import { wireDocsResize } from "./ui/docsResize";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import { wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";
import { escapeHtml } from "./ui/panel";
import { createClickCounter, startRain } from "./ui/pickleRain";

// This file only sets up the page: it renders the frame, wires each panel to
// `app` (src/app.ts, where everything the app DOES lives) and repaints panels
// when the state they read changes.

const root = document.querySelector<HTMLElement>("#app")!;
const shell = renderShell(root);
const { panels } = shell;

const app = createApp({
  store,
  api,
  navigate: (url) => {
    window.location.href = url;
  },
  announce: shell.announce,
});

// Links straight into the login or compliance flow (marked data-flow-link)
// save the in-progress query first, so it survives the round trip.
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("a[data-flow-link]")) app.saveQueryBeforeRedirect();
});

// Hidden: five quick clicks on the logo make it rain pickles (instead, a toast
// for people who prefer reduced motion).
const logoClicked = createClickCounter();
shell.logo.addEventListener("click", () => {
  if (!logoClicked()) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) showToast(EASTER_EGG_TOAST);
  else startRain(Object.values(MASCOT));
});

// Wire every panel once. The listeners are delegated to the panel containers
// renderShell created, so they survive every repaint.
shell.onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
});
wireDocsSidebar(panels.docs, () => store.getState().facets, app.onAddItem);
wireDocsResize(shell.docsResizeHandle);
wireDataPreview(panels.preview, app.runPreview);
wireDatabasePicker(panels.dbpicker, app.onDatabasesChange);
wireAccountMenu(panels.account, {
  onLogout: app.onLogout,
  onInvalidate: app.onInvalidateCompliance,
});
const renderQueryBuilder = wireQueryBuilder(panels.center, store.getState, app.onQueryChange, {
  onDrop: app.onDropItem,
  onDismissNotice: app.dismissDropNotice,
  announce: shell.announce,
});

/**
 * Each panel's re-render trigger: which AppState keys it depends on, and how to
 * (re)render it. Add a key here whenever a render function starts reading it.
 */
const panelRenderers: { keys: (keyof AppState)[]; run: (state: AppState) => void }[] = [
  { keys: ["activeView"], run: (s) => shell.setActiveView(s.activeView) },
  { keys: ["issues", "stats", "preview"], run: (s) => shell.setMascot(mascotFor(s)) },
  { keys: ["sidebarCollapsed"], run: (s) => shell.setSidebarCollapsed(s.sidebarCollapsed) },
  { keys: ["facets", "databases", "catalog"], run: (s) => renderDocsSidebar(panels.docs, s) },
  {
    keys: ["databases", "selectedDatabaseIds"],
    run: (s) => renderDatabasePicker(panels.dbpicker, s),
  },
  {
    keys: ["catalog", "query", "issues", "serverIssues", "facets", "dropNotice"],
    run: renderQueryBuilder,
  },
  {
    keys: [
      "catalog",
      "query",
      "issues",
      "serverIssues",
      "stats",
      "selectedDatabaseIds",
      "databases",
    ],
    run: (s) => renderStatsPanel(panels.stats, s),
  },
  {
    keys: [
      "preview",
      "query",
      "issues",
      "serverIssues",
      "catalog",
      "selectedDatabaseIds",
      "facets",
      "auth",
      "compliance",
    ],
    run: (s) => renderDataPreview(panels.preview, s),
  },
  { keys: ["auth", "compliance"], run: (s) => renderAccountMenu(panels.account, s) },
];

// Below this width the open docs float over the page (styles.css), so start
// with them folded away instead of covering the builder on first load. Set
// before the first paint below, so nothing flickers. Keep the number in step
// with the `@media (max-width: 1100px)` rule in styles.css (CSS cannot import it).
const NARROW_SCREEN = "(max-width: 1100px)";
if (window.matchMedia(NARROW_SCREEN).matches) store.setState({ sidebarCollapsed: true });

// Escape closes the floating docs (only while focus is inside them, and not
// when the search box just used it to clear its text), and
// focus moves to the rail button so keyboard users are not left on a hidden panel.
const docsColumn = root.querySelector<HTMLElement>("#qb-docs")!;
document.addEventListener("keydown", (e) => {
  const closes = escapeClosesDocs({
    key: e.key,
    defaultPrevented: e.defaultPrevented,
    floating: window.matchMedia(NARROW_SCREEN).matches,
    collapsed: store.getState().sidebarCollapsed,
    focusInDocs: docsColumn.contains(document.activeElement),
  });
  if (!closes) return;
  store.setState({ sidebarCollapsed: true });
  root.querySelector<HTMLElement>(".qb-docs-rail")?.focus();
});

// A click anywhere else on the page also closes the floating docs, since they
// cover the builder. Clicks inside the docs must not (that would break "+ Add"
// and dragging), nor those on the rail or the Hide/Show buttons, which toggle
// the docs themselves.
document.addEventListener("click", (e) => {
  if (!window.matchMedia(NARROW_SCREEN).matches || store.getState().sidebarCollapsed) return;
  // composedPath() is fixed when the click starts, so it still says "inside the
  // docs" if a handler has already repainted the element that was clicked.
  const insideDocs = e.composedPath().includes(docsColumn);
  const target = e.target as Element;
  if (insideDocs || target.closest(".qb-docs-rail, [data-menu='toggle-sidebar']")) return;
  store.setState({ sidebarCollapsed: true });
});

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
  console.error("Could not load the app:", err);
  // role="alert" makes a screen reader read the message at once, and the focus
  // goes to Reload: the page the user was on has just vanished, so without
  // this their focus is on nothing and the only action is out of reach.
  root.innerHTML = `<div class="ui negative message" style="margin:2rem" role="alert">
      <div class="header">Could not load the app</div>
      <p>${escapeHtml(errorMessage(err))}</p>
      <button class="ui button" data-action="reload">Reload</button>
    </div>`;
  const reload = root.querySelector<HTMLButtonElement>('[data-action="reload"]');
  reload?.addEventListener("click", () => window.location.reload());
  reload?.focus();
}

const resumed = consumeResumeParam();
// First paint: loaders/placeholders until the startup requests finish.
for (const { run } of panelRenderers) run(store.getState());
app.start(resumed).catch(showFatalError);
