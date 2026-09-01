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

import { getDatabases, getSchema, getStats, runQuery } from "./api/client";
import { store } from "./state";
import { addChild, countConditions, newCondition } from "./query/tree";
import { hasBlockingErrors, validateQuery } from "./query/validate";
import type { Group, QueryNode } from "./query/types";
import { debounce } from "./util/debounce";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderDatabasePicker, wireDatabasePicker } from "./ui/databasePicker";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";

/**
 * Stale-guard key for /api/stats and /api/query. A request depends on BOTH the
 * query tree and the selected databases, so a change to either must invalidate an
 * in-flight response (§6). Databases are sorted so selection order doesn't matter.
 */
const requestKey = (query: QueryNode, databases: string[]): string =>
  JSON.stringify({ query, databases: [...databases].sort() });

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => runPreview(1),
});

const PAGE_SIZE = 25;

function runPreview(page: number): void {
  const { query, issues, schema, selectedDatabaseIds } = store.getState();
  if (
    !schema ||
    hasBlockingErrors(issues) ||
    countConditions(query) === 0 ||
    selectedDatabaseIds.length === 0
  )
    return;
  const key = requestKey(query, selectedDatabaseIds);
  store.setState({ preview: { status: "loading", data: null, error: null, page } });
  runQuery(query, selectedDatabaseIds, page, PAGE_SIZE)
    .then((data) => {
      const s = store.getState();
      if (key !== requestKey(s.query, s.selectedDatabaseIds)) return; // scope changed since Run
      store.setState({ preview: { status: "ok", data, error: null, page: data.page } });
    })
    .catch((err) => {
      const s = store.getState();
      if (key !== requestKey(s.query, s.selectedDatabaseIds)) return;
      store.setState({
        preview: {
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : String(err),
          page,
        },
      });
    });
}

function syncRunButton(state = store.getState()): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu="run"]');
  if (!btn) return;
  const ready =
    !!state.schema &&
    !hasBlockingErrors(state.issues) &&
    countConditions(state.query) > 0 &&
    state.selectedDatabaseIds.length > 0 &&
    state.preview.status !== "loading";
  btn.disabled = !ready;
}

const refreshStats = debounce(() => {
  const { query, issues, schema, selectedDatabaseIds } = store.getState();
  if (
    !schema ||
    hasBlockingErrors(issues) ||
    countConditions(query) === 0 ||
    selectedDatabaseIds.length === 0
  )
    return;
  const key = requestKey(query, selectedDatabaseIds);
  store.setState({ stats: { status: "loading", data: null, error: null } });
  getStats(query, selectedDatabaseIds)
    .then((data) => {
      const s = store.getState();
      if (key !== requestKey(s.query, s.selectedDatabaseIds)) return; // stale — a newer change won
      store.setState({ stats: { status: "ok", data, error: null } });
    })
    .catch((err) => {
      const s = store.getState();
      if (key !== requestKey(s.query, s.selectedDatabaseIds)) return;
      store.setState({
        stats: {
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });
}, 400);

function onQueryChange(nextQuery: Group): void {
  if (nextQuery === store.getState().query) return;
  const schema = store.getState().schema;
  const issues = schema
    ? validateQuery(nextQuery, { fields: schema.fields, operators: schema.operators })
    : [];
  // Spec §6: editing the query immediately clears stats & preview in the SAME setState.
  store.setState({
    query: nextQuery,
    issues,
    stats: { status: "idle", data: null, error: null },
    preview: { status: "idle", data: null, error: null, page: 1 },
  });
  refreshStats();
}

/** Changing the database scope behaves exactly like a query edit (§6). */
function onDatabasesChange(nextIds: string[]): void {
  const cur = store.getState().selectedDatabaseIds;
  if (nextIds.length === cur.length && nextIds.every((id) => cur.includes(id))) return;
  store.setState({
    selectedDatabaseIds: nextIds,
    stats: { status: "idle", data: null, error: null },
    preview: { status: "idle", data: null, error: null, page: 1 },
  });
  refreshStats();
}

store.subscribe((state, changed) => {
  if (changed.has("activeView")) setActiveView(state.activeView);
  if (changed.has("sidebarCollapsed")) setSidebarCollapsed(state.sidebarCollapsed);
  if (changed.has("schema")) renderDocsSidebar(state);
  if (changed.has("databases") || changed.has("selectedDatabaseIds")) {
    renderDatabasePicker(state);
    wireDatabasePicker(panelEls().dbpicker, onDatabasesChange);
  }
  if (changed.has("schema") || changed.has("query") || changed.has("issues")) {
    renderQueryBuilder(state);
    wireQueryBuilder(panelEls().center, onQueryChange);
  }
  if (
    changed.has("schema") ||
    changed.has("query") ||
    changed.has("issues") ||
    changed.has("stats") ||
    changed.has("selectedDatabaseIds")
  ) {
    renderStatsPanel(state);
  }
  if (
    changed.has("preview") ||
    changed.has("query") ||
    changed.has("issues") ||
    changed.has("schema") ||
    changed.has("selectedDatabaseIds")
  ) {
    renderDataPreview(state);
    wireDataPreview(panelEls().preview, {
      prev: () => runPreview(store.getState().preview.page - 1),
      next: () => runPreview(store.getState().preview.page + 1),
    });
    syncRunButton(state);
  }
});

renderDatabasePicker(store.getState()); // "" while databases is null
renderQueryBuilder(store.getState()); // initial loader (centre panel spinner during schema fetch)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDataPreview(store.getState()); // initial idle message
syncRunButton(); // top-menu Run starts disabled
renderDocsSidebar(store.getState()); // initial loader
Promise.all([getSchema(), getDatabases()])
  .then(([schema, dbResp]) => {
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases: dbResp.databases,
      selectedDatabaseIds: dbResp.databases.map((d) => d.id),
      query: seeded,
      issues,
    });
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
