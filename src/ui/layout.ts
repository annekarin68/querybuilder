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
};
let bodyEl: HTMLElement;

export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="ui borderless menu" style="margin:0;border-radius:0">
      <span class="header item">Query Builder</span>
      <div class="right menu">
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
      </div>
    </div>
    <div class="ui pointing secondary menu" data-menu="views" style="margin:0 1rem">
      ${VIEWS.map((v) => `<a class="item${v.id === "filter" ? " active" : ""}" data-view="${v.id}">${v.label}</a>`).join("")}
    </div>
    <div class="qb-body">
      <aside class="qb-col-docs" data-panel="docs"></aside>
      <main class="qb-col-center">
        <div data-panel="dbpicker"></div>
        <div data-panel="center"></div>
      </main>
      <aside class="qb-col-stats" data-panel="stats"></aside>
    </div>
    <section class="qb-preview" data-panel="preview"></section>
  `;
  bodyEl = root.querySelector<HTMLElement>(".qb-body")!;
  els = {
    docs: root.querySelector<HTMLElement>('[data-panel="docs"]')!,
    dbpicker: root.querySelector<HTMLElement>('[data-panel="dbpicker"]')!,
    center: root.querySelector<HTMLElement>('[data-panel="center"]')!,
    stats: root.querySelector<HTMLElement>('[data-panel="stats"]')!,
    preview: root.querySelector<HTMLElement>('[data-panel="preview"]')!,
  };
}

export function panelEls() {
  return els;
}

export function setActiveView(v: ActiveView): void {
  document.querySelectorAll('[data-menu="views"] .item').forEach((a) => {
    a.classList.toggle("active", (a as HTMLElement).dataset.view === v);
  });
  const filtering = v === "filter";
  bodyEl.style.display = filtering ? "" : "none";
  panelEls().preview.style.display = filtering ? "" : "none";
  let placeholder = document.getElementById("qb-coming-soon");
  if (!filtering) {
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.id = "qb-coming-soon";
      placeholder.className = "ui placeholder segment";
      placeholder.style.margin = "2rem";
      placeholder.innerHTML = `<div class="ui icon header"><i class="clock outline icon"></i> Coming soon</div>`;
      bodyEl.parentElement!.insertBefore(placeholder, bodyEl.nextSibling);
    }
    placeholder.style.display = "";
  } else if (placeholder) {
    placeholder.style.display = "none";
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  bodyEl.classList.toggle("qb-docs-collapsed", collapsed);
}

export function onMenu(handler: {
  view(v: ActiveView): void;
  toggleSidebar(): void;
  run(): void;
}): void {
  document.querySelector('[data-menu="views"]')!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (item) handler.view(item.dataset.view as ActiveView);
  });
  document
    .querySelector('[data-menu="toggle-sidebar"]')!
    .addEventListener("click", () => handler.toggleSidebar());
  document.querySelector('[data-menu="run"]')!.addEventListener("click", () => handler.run());
}
