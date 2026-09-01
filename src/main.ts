// Fomantic's JS expects a global jQuery. Set it BEFORE importing Fomantic's JS.
// (docs/ARCHITECTURE.md §3 — the bootstrap wrinkle.)
import $ from "jquery";
(window as unknown as { jQuery: typeof $; $: typeof $ }).jQuery = $;
(window as unknown as { jQuery: typeof $; $: typeof $ }).$ = $;

// Lato is NOT imported separately: fomantic-ui-css@2.9.x self-hosts it via local
// @font-face rules pointing at its own bundled LatoLatin-*.woff2 files. See
// docs/ARCHITECTURE.md §2.3.
import "fomantic-ui-css/semantic.min.css";
import "fomantic-ui-css/semantic.min.js";
import "./styles.css";

import { getSchema, getStats, runQuery } from "./api/client";
import { store } from "./state";
import { addChild, countConditions, newCondition } from "./query/tree";
import { hasBlockingErrors, validateQuery } from "./query/validate";
import type { Group } from "./query/types";
import { debounce } from "./util/debounce";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderDocsSidebar } from "./ui/docsSidebar";
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { renderStatsPanel } from "./ui/statsPanel";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => runPreview(1),
});

const PAGE_SIZE = 25;

function runPreview(page: number): void {
  const { query, issues, schema } = store.getState();
  if (!schema || hasBlockingErrors(issues) || countConditions(query) === 0) return;
  const key = JSON.stringify(query);
  store.setState({ preview: { status: "loading", data: null, error: null, page } });
  runQuery(query, page, PAGE_SIZE)
    .then((data) => {
      if (key !== JSON.stringify(store.getState().query)) return; // query changed since Run
      store.setState({ preview: { status: "ok", data, error: null, page: data.page } });
    })
    .catch((err) => {
      if (key !== JSON.stringify(store.getState().query)) return;
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
    state.preview.status !== "loading";
  btn.disabled = !ready;
}

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
  if (
    changed.has("preview") ||
    changed.has("query") ||
    changed.has("issues") ||
    changed.has("schema")
  ) {
    renderDataPreview(state);
    wireDataPreview(panelEls().preview, {
      prev: () => runPreview(store.getState().preview.page - 1),
      next: () => runPreview(store.getState().preview.page + 1),
    });
    syncRunButton(state);
  }
});

renderQueryBuilder(store.getState()); // initial loader (centre panel spinner during schema fetch)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDataPreview(store.getState()); // initial idle message
syncRunButton(); // top-menu Run starts disabled
renderDocsSidebar(store.getState()); // initial loader
getSchema()
  .then((schema) => {
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({ schema, query: seeded, issues });
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
