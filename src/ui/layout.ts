import type { ActiveView } from "../state";

const VIEWS: { id: ActiveView; label: string }[] = [
  { id: "filter", label: "Filter" },
  { id: "review", label: "Review" },
  { id: "approval", label: "Approval" },
  { id: "done", label: "Done" },
];

let els: {
  docs: HTMLElement;
  dbpicker: HTMLElement;
  center: HTMLElement;
  stats: HTMLElement;
  preview: HTMLElement;
  auth: HTMLElement;
  compliance: HTMLElement;
};
let bodyEl: HTMLElement;
let railEl: HTMLButtonElement;

/**
 * The page frame, rendered once: a top bar (app name, workflow steps, account
 * area), then a docs rail + three columns — the data dictionary (collapsible,
 * starts collapsed), the main column (databases, query, matching entrysets)
 * and the pinned statistics column. Panels paint into the data-panel slots.
 */
export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="qb-topbar">
      <span class="qb-brand">Query Builder</span>
      <nav class="qb-steps" data-menu="views" aria-label="Workflow">
        ${VIEWS.map(
          (v, i) =>
            `<a class="qb-step${v.id === "filter" ? " is-active" : ""}" href="#" data-view="${v.id}"${v.id === "filter" ? ' aria-current="step"' : ""}><span class="qb-step-num">${i + 1}</span>${v.label}</a>`,
        ).join("")}
      </nav>
      <div class="qb-topbar-right">
        <button class="ui primary button" data-menu="run" disabled>Run / Refresh</button>
        <div data-panel="auth"></div>
        <div data-panel="compliance"></div>
      </div>
    </header>
    <div class="qb-body qb-docs-collapsed">
      <button type="button" class="qb-docs-rail" data-menu="toggle-sidebar" aria-controls="qb-docs" aria-expanded="false" title="Show the data dictionary">
        <i class="book icon"></i><span>Docs</span>
      </button>
      <aside class="qb-col-docs" id="qb-docs" data-panel="docs"></aside>
      <main class="qb-col-main">
        <section data-panel="dbpicker"></section>
        <section data-panel="center"></section>
        <section data-panel="preview"></section>
      </main>
      <aside class="qb-col-stats" data-panel="stats"></aside>
    </div>
  `;
  bodyEl = root.querySelector<HTMLElement>(".qb-body")!;
  railEl = root.querySelector<HTMLButtonElement>(".qb-docs-rail")!;
  els = {
    docs: root.querySelector<HTMLElement>('[data-panel="docs"]')!,
    dbpicker: root.querySelector<HTMLElement>('[data-panel="dbpicker"]')!,
    center: root.querySelector<HTMLElement>('[data-panel="center"]')!,
    stats: root.querySelector<HTMLElement>('[data-panel="stats"]')!,
    preview: root.querySelector<HTMLElement>('[data-panel="preview"]')!,
    auth: root.querySelector<HTMLElement>('[data-panel="auth"]')!,
    compliance: root.querySelector<HTMLElement>('[data-panel="compliance"]')!,
  };
}

export function panelEls() {
  return els;
}

export function setActiveView(v: ActiveView): void {
  document.querySelectorAll<HTMLElement>('[data-menu="views"] [data-view]').forEach((a) => {
    const on = a.dataset.view === v;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "step");
    else a.removeAttribute("aria-current");
  });
  const filtering = v === "filter";
  bodyEl.hidden = !filtering;
  let placeholder = document.getElementById("qb-coming-soon");
  if (!filtering && !placeholder) {
    placeholder = document.createElement("div");
    placeholder.id = "qb-coming-soon";
    placeholder.className = "qb-card qb-coming-soon";
    placeholder.innerHTML = `<i class="clock outline icon"></i> Coming soon`;
    bodyEl.after(placeholder);
  }
  if (placeholder) placeholder.hidden = filtering;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  bodyEl.classList.toggle("qb-docs-collapsed", collapsed);
  railEl.setAttribute("aria-expanded", String(!collapsed));
  railEl.title = collapsed ? "Show the data dictionary" : "Hide the data dictionary";
}

/**
 * The step links carry `href="#"` only so they are keyboard-focusable (an `<a>`
 * without `href` is skipped by Tab and ignores Enter) — every handler below
 * calls preventDefault so the URL hash never changes.
 */
export function onMenu(handler: {
  view(v: ActiveView): void;
  toggleSidebar(): void;
  run(): void;
}): void {
  document.querySelector('[data-menu="views"]')!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!item) return;
    e.preventDefault();
    handler.view(item.dataset.view as ActiveView);
  });
  // Delegated: the rail AND the docs panel's own close button toggle the docs,
  // and the close button is repainted with its panel, so it can't be bound once.
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest('[data-menu="toggle-sidebar"]')) return;
    e.preventDefault();
    handler.toggleSidebar();
  });
  document.querySelector('[data-menu="run"]')!.addEventListener("click", () => handler.run());
}
