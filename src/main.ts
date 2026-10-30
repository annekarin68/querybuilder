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
import { EASTER_EGG_MASCOT, EASTER_EGG_TOAST, MASCOT } from "./config";
import { createApp } from "./app";
import { startupFailure } from "./api/errorText";
import { store, type AppState } from "./state";
import { showToast } from "./ui/fomantic";
import { renderShell } from "./ui/layout";
import { mascotFor } from "./ui/mascot";
import { renderAccountMenu, wireAccountMenu } from "./ui/accountMenu";
import {
  escapeClosesDocs,
  KEEPS_FLOATING_DOCS_OPEN,
  renderDocsSidebar,
  wireDocsSidebar,
} from "./ui/docsSidebar";
import { wireDocsResize } from "./ui/docsResize";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import {
  holdsBuilderRepaint,
  isValueBoxInUse,
  QUERY_BUILDER_KEYS,
  revealNode,
  wireQueryBuilder,
} from "./ui/queryBuilder";
import { ABOUT_PANEL_KEYS, paintAboutPanels } from "./ui/aboutPanel";
import { renderStatsPanel, wireStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";
import { escapeHtml } from "./ui/panel";
import { renderSavedDialog, wireSavedDialog } from "./ui/savedQueries";
import { renderEventDialog, wireEventDialog } from "./ui/eventDialog";
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
  // A failure with no panel to show it in: a red toast, and the same words
  // for screen readers (a Fomantic toast is not a live region).
  showError: (message) => {
    showToast(message, "error");
    shell.announce(message);
  },
});

// Hidden: five quick clicks on the logo switch the mascot to the easter-egg set
// (five more switch back) and make it rain with the new set; switching on also
// shows a toast (switching off needs none: the face changes back). It rains even for
// people who prefer reduced motion: five quick clicks are a deliberate choice
// (maintainers' decision, 2026-10-28; "Pickle theme and mascot").
const logoClicked = createClickCounter();
shell.logo.addEventListener("click", () => {
  if (!logoClicked()) return;
  const easterEgg = !store.getState().easterEgg;
  store.setState({ easterEgg });
  startRain(Object.values(easterEgg ? EASTER_EGG_MASCOT : MASCOT));
  if (easterEgg) showToast(EASTER_EGG_TOAST);
});

// Wire every panel once. The listeners are delegated to the panel containers
// renderShell created, so they survive every repaint.
shell.onMenu({
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
});
const docs = wireDocsSidebar(panels.docs, () => store.getState().facets, app.onAddItem);
wireDocsResize(shell.docsResizeHandle);
wireDataPreview(panels.preview, {
  onRun: app.runPreview,
  onPage: app.showEventPage,
  onOpenEvent: app.openEvent,
});
wireDatabasePicker(panels.dbpicker, app.onDatabasesChange);
wireStatsPanel(panels.stats, {
  onRetry: app.retryStats,
  onShowIssue: (nodeId) => revealNode(panels.center, nodeId),
});
wireAccountMenu(panels.account, {
  onLogout: app.onLogout,
  onWithdraw: app.onWithdrawCompliance,
});
const { render: renderQueryBuilder, runAfterPointer } = wireQueryBuilder(
  panels.center,
  store.getState,
  app.onQueryChange,
  {
    onDrop: app.onDropItem,
    onMove: app.onMoveNode,
    onDismissNotice: app.dismissDropNotice,
    onNotice: app.showNotice,
    announce: shell.announce,
    onOpenSaveDialog: app.openSaveDialog,
    onOpenSavedList: app.openSavedList,
    onStartFresh: app.startFresh,
    onDismissRestored: app.dismissRestoredNotice,
    openFieldRow: app.openFieldRow,
    toggleFields: app.toggleFields,
    setPanelTab: app.setPanelTab,
    toggleCoNames: app.toggleCoNames,
    selectFieldForPanel: app.selectFieldForPanel,
    showFacetInDictionary: (facetId) => {
      // The app unfolds the dictionary first: a folded one has no card to show.
      // The focus stays on the square, so a screen reader is told instead.
      if (app.showFacetInDictionary(facetId) && docs.showFacet(facetId)) {
        const name = store.getState().facets?.find((f) => f.id === facetId)?.name ?? facetId;
        shell.announce(`${name} is open in the data dictionary.`);
      }
    },
  },
);

// A builder repaint that a statistics line asked for while the user was in a
// value box waits until the focus leaves it (holdsBuilderRepaint, issue #76).
let builderRepaintWaiting = false;
function renderBuilder(state: AppState): void {
  builderRepaintWaiting = false;
  renderQueryBuilder(state);
}
function holdBuilderRepaint(changed: ReadonlySet<keyof AppState>): boolean {
  const hold = holdsBuilderRepaint(changed, isValueBoxInUse(panels.center));
  if (hold) builderRepaintWaiting = true;
  return hold;
}
// After the focus has moved: a Tab into the next value box still waits. Pressing
// a builder button moves the focus on mousedown, so the repaint goes through the
// builder's afterPointer: it waits until the mouse button is released, else the
// button under the pointer would be replaced and its click would be lost.
panels.center.addEventListener("focusout", () =>
  runAfterPointer(() => {
    if (builderRepaintWaiting && !isValueBoxInUse(panels.center)) {
      repaintPanel(renderBuilder, store.getState());
    }
  }),
);

wireSavedDialog(shell.savedDialog, app);
wireEventDialog(shell.eventDialog, app.closeEvent);

/**
 * Each panel's re-render trigger: which AppState keys it depends on, and how to
 * (re)render it. Add a key here whenever a render function starts reading it.
 */
const panelRenderers: {
  keys: (keyof AppState)[];
  run: (state: AppState) => void;
  /** True: skip this repaint for now (the panel repaints itself later). */
  held?: (changed: ReadonlySet<keyof AppState>) => boolean;
}[] = [
  {
    keys: ["issues", "stats", "preview", "easterEgg"],
    run: (s) => shell.setMascot(mascotFor(s), s.easterEgg),
  },
  {
    keys: ["sidebarCollapsed"],
    run: (s) => shell.setSidebarCollapsed(s.sidebarCollapsed),
  },
  { keys: ["facets", "databases", "catalog"], run: (s) => renderDocsSidebar(panels.docs, s) },
  {
    keys: ["databases", "selectedDatabaseIds", "stats"],
    run: (s) => renderDatabasePicker(panels.dbpicker, s),
  },
  // The builder's keys leave out `selectedField`: a field selected for the
  // About panel repaints only those panels, after the builder, so a builder
  // repaint in the same change has drawn them already.
  { keys: QUERY_BUILDER_KEYS, run: renderBuilder, held: holdBuilderRepaint },
  // It reads the state afresh rather than taking `s`: focusing a row selects
  // its field (a nested setState), and that can happen inside the builder's
  // repaint just above, when paint() puts the focus back. With `s` this row
  // would then paint the older selection over the newer one.
  { keys: ABOUT_PANEL_KEYS, run: () => paintAboutPanels(panels.center, store.getState()) },
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
  // Last: when a dialog closes, the focus goes back to its button in the query
  // card, which must already be repainted (opening a saved query repaints it).
  {
    keys: [
      "savedDialog",
      "save",
      "savedList",
      "savedConfirm",
      "deletingSavedId",
      "savedListNotice",
      "openSaved",
    ],
    run: (s) => renderSavedDialog(shell.savedDialog, s),
  },
  // After the preview row, which repaints the id buttons that closing this
  // dialog gives the focus to. `issues` and `serverIssues` are what can block
  // Run (and so hide the table) while `preview` stays "ok": see openEventOf.
  {
    keys: [
      "openEventId",
      "preview",
      "catalog",
      "selectedDatabaseIds",
      "query",
      "issues",
      "serverIssues",
    ],
    run: (s) => renderEventDialog(shell.eventDialog, s),
  },
];

// Below this width the open docs float over the page (styles.css), so start
// with them folded away instead of covering the builder on first load. Set
// before the first paint below, so nothing flickers. Keep the number in step
// with the `@media (max-width: 1100px)` rule in styles.css (CSS cannot import it).
const NARROW_SCREEN = "(max-width: 1100px)";
if (window.matchMedia(NARROW_SCREEN).matches) store.setState({ sidebarCollapsed: true });

// Escape closes the floating docs (only while focus is inside them, and not
// when the search box just used it to clear its text). Folding them moves the
// focus to the rail button, or back to the co-occurrence cell that opened
// them (`setSidebarCollapsed`), so keyboard users are not left on a hidden panel.
const docsColumn = root.querySelector<HTMLElement>("#qb-docs")!;
document.addEventListener("keydown", (e) => {
  const closes = escapeClosesDocs({
    key: e.key,
    defaultPrevented: e.defaultPrevented,
    floating: window.matchMedia(NARROW_SCREEN).matches,
    collapsed: store.getState().sidebarCollapsed,
    focusInDocs: docsColumn.contains(document.activeElement),
    focusOnOpener: document.activeElement?.matches("[data-opens-docs]") ?? false,
  });
  if (!closes) return;
  store.setState({ sidebarCollapsed: true });
});

// A click anywhere else on the page also closes the floating docs, since they
// cover the builder. Clicks inside the docs must not (that would break "+ Add"
// and dragging), nor those `KEEPS_FLOATING_DOCS_OPEN` lists (docsSidebar.ts
// says why for each).
document.addEventListener("click", (e) => {
  if (!window.matchMedia(NARROW_SCREEN).matches || store.getState().sidebarCollapsed) return;
  // composedPath() is fixed when the click starts, so it still says "inside the
  // docs" if a handler has already repainted the element that was clicked.
  const insideDocs = e.composedPath().includes(docsColumn);
  if (insideDocs || (e.target as Element).closest(KEEPS_FLOATING_DOCS_OPEN)) return;
  store.setState({ sidebarCollapsed: true });
});

/**
 * Repaint one panel. A renderer that throws (say, on data it did not expect)
 * is logged and skipped, so the panels after it still repaint: otherwise the
 * Matching events panel could keep showing the previous query's rows next to
 * new statistics, and the error would reach whoever called `setState`
 * (app.ts), which may report it as an unrelated failure.
 */
function repaintPanel(run: (state: AppState) => void, state: AppState): void {
  try {
    run(state);
  } catch (err) {
    console.error("Could not repaint a panel:", err);
  }
}

store.subscribe((state, changed) => {
  for (const { keys, run, held } of panelRenderers) {
    if (keys.some((k) => changed.has(k)) && !held?.(changed)) repaintPanel(run, state);
  }
});

/**
 * `?resume=1` marks a load as the direct return-hop from the login or
 * compliance callback (both redirect here). Such a load restores the kept
 * query (src/util/keptQuery.ts) whatever it holds and without the Restored
 * notice; any other load restores it only if something was chosen in it, and
 * says so (`app.start`). Stripped from the URL immediately, so a manual
 * refresh counts as an ordinary reload.
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
 * page with the error and one button: Log in when the backend wants a login,
 * Reload otherwise (`startupFailure`). The text is plain words for the kind
 * of failure, the details are in the console; it is still escaped, like every
 * panel's text. No inline onclick either: a strict Content-Security-Policy
 * would block it.
 */
function showFatalError(err: unknown): void {
  console.error("Could not load the app:", err);
  const { message, action } = startupFailure(err);
  // Log in is a plain link. Nothing was on screen yet, so the kept query (if
  // the tab has one) is still the one from before, and the return trip
  // restores it.
  const button =
    action === "log-in"
      ? `<a class="ui primary button" href="${escapeHtml(api.LOGIN_URL)}" data-fatal-action>Log in</a>`
      : `<button type="button" class="ui button" data-fatal-action>Reload</button>`;
  // role="alert" makes a screen reader read the message at once, and the focus
  // goes to the button: the page the user was on has just vanished, so without
  // this their focus is on nothing and the only action is out of reach.
  root.innerHTML = `<div class="ui negative message" style="margin:2rem" role="alert">
      <div class="header">Could not load the app</div>
      <p>${escapeHtml(message)}</p>
      <p class="qb-muted">Technical details are in the browser console.</p>
      ${button}
    </div>`;
  const actionButton = root.querySelector<HTMLElement>("[data-fatal-action]");
  if (action === "reload") actionButton?.addEventListener("click", () => window.location.reload());
  actionButton?.focus();
}

// Back from the login or compliance page can show this page from the
// browser's back/forward cache instead of loading it (`persisted`): no
// start(), so the app resets what was left waiting (onPageRestored). The dev
// server's live reload keeps pages out of that cache: check this on a build.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) app.onPageRestored();
});

const resumed = consumeResumeParam();
// First paint: loaders/placeholders until the startup requests finish.
for (const { run } of panelRenderers) repaintPanel(run, store.getState());
app.start(resumed).catch(showFatalError);
