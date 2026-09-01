// Fomantic's JS expects a global jQuery. Set it BEFORE importing Fomantic's JS.
// (docs/ARCHITECTURE.md §3 — the bootstrap wrinkle.)
import $ from "jquery";
(window as unknown as { jQuery: typeof $; $: typeof $ }).jQuery = $;
(window as unknown as { jQuery: typeof $; $: typeof $ }).$ = $;

import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "fomantic-ui-css/semantic.min.css";
import "fomantic-ui-css/semantic.min.js";
import "./styles.css";

import { getSchema, getStats } from "./api/client";
import { store } from "./state";
import { addChild, countConditions, newCondition } from "./query/tree";
import { hasBlockingErrors, validateQuery } from "./query/validate";
import type { Group } from "./query/types";
import { debounce } from "./util/debounce";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => {
    /* wired in Task 15 */
  },
});

const refreshStats = debounce(() => {
  const { query, issues, schema } = store.getState();
  if (!schema || hasBlockingErrors(issues) || countConditions(query) === 0) return;
  const key = JSON.stringify(query);
  store.setState({ stats: { status: "loading", data: null, error: null } });
  getStats(query)
    .then((data) => {
      if (key !== JSON.stringify(store.getState().query)) return; // stale — a newer edit won
      store.setState({ stats: { status: "ok", data, error: null } });
    })
    .catch((err) => {
      if (key !== JSON.stringify(store.getState().query)) return;
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

store.subscribe((state, changed) => {
  if (changed.has("activeView")) setActiveView(state.activeView);
  if (changed.has("sidebarCollapsed")) setSidebarCollapsed(state.sidebarCollapsed);
  if (changed.has("schema")) renderDocsSidebar(state);
  if (changed.has("schema") || changed.has("query") || changed.has("issues")) {
    renderQueryBuilder(state);
    wireQueryBuilder(panelEls().center, onQueryChange);
  }
  if (
    changed.has("schema") ||
    changed.has("query") ||
    changed.has("issues") ||
    changed.has("stats")
  ) {
    renderStatsPanel(state);
  }
  // the preview panel render is wired in Task 16.
});

renderQueryBuilder(store.getState()); // initial loader (centre panel spinner during schema fetch)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDocsSidebar(store.getState()); // initial loader
getSchema()
  .then((schema) => {
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    store.setState({ schema, query: seeded });
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });

// Temporary placeholder content so the preview column is visibly present until Task 16.
panelEls().preview.innerHTML = `<div class="ui segment">Data preview (Task 16)</div>`;
