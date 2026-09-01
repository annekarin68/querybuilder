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

import { getSchema } from "./api/client";
import { store } from "./state";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";
import { renderDocsSidebar } from "./ui/docsSidebar";

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => {
    /* wired in Task 15 */
  },
});

store.subscribe((state, changed) => {
  if (changed.has("activeView")) setActiveView(state.activeView);
  if (changed.has("sidebarCollapsed")) setSidebarCollapsed(state.sidebarCollapsed);
  if (changed.has("schema")) renderDocsSidebar(state);
  // panel renders are wired in Tasks 12–15.
});

renderDocsSidebar(store.getState()); // initial loader
getSchema()
  .then((schema) => store.setState({ schema }))
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });

// Temporary placeholder content so the columns are visibly present until Tasks 13–15.
panelEls().center.innerHTML = `<div class="ui segment">Query builder (Tasks 13–14)</div>`;
panelEls().stats.innerHTML = `<div class="ui segment">Statistics (Task 14)</div>`;
panelEls().preview.innerHTML = `<div class="ui segment">Data preview (Task 15)</div>`;
