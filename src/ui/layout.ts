import type { ActiveView } from "../state";
import { MASCOT } from "../config";
import type { MascotState } from "./mascot";

const VIEWS: { id: ActiveView; label: string }[] = [
  { id: "filter", label: "Filter" },
  { id: "review", label: "Review" },
  { id: "approval", label: "Approval" },
  { id: "done", label: "Done" },
];

/**
 * What the strip along the docs' left edge offers: its arrow points the way the
 * docs will move (« to fold them away, » to bring them back) and its label
 * says it in words, so it is clear what a click does in either state.
 */
export function docsToggle(collapsed: boolean): { icon: string; label: string; title: string } {
  return collapsed
    ? {
        icon: "angle double right",
        label: "Show docs",
        title: "Show the data dictionary",
      }
    : {
        icon: "angle double left",
        label: "Hide docs",
        title: "Hide the data dictionary",
      };
}

/** The page frame, as returned by `renderShell`. */
export interface Shell {
  /** The container each panel paints into (see the render functions in src/ui/). */
  panels: {
    docs: HTMLElement;
    dbpicker: HTMLElement;
    center: HTMLElement;
    stats: HTMLElement;
    preview: HTMLElement;
    account: HTMLElement;
  };
  /** Show the Filter view, or the "Coming soon" placeholder for the other steps. */
  setActiveView(v: ActiveView): void;
  /** The sidebar's drag handle; wire it with wireDocsResize. */
  docsResizeHandle: HTMLElement;
  /** The pickle in the top bar. */
  logo: HTMLImageElement;
  /** Show the pickle with the face for `state`. */
  setMascot(state: MascotState): void;
  /** Fold the data dictionary into its rail, or open it. */
  setSidebarCollapsed(collapsed: boolean): void;
  /** Listen for clicks on the workflow steps and the docs toggles. Call once. */
  onMenu(handler: { view(v: ActiveView): void; toggleSidebar(): void }): void;
}

/**
 * The page frame, rendered once: a top bar (app name, workflow steps, account
 * area), then a docs rail + three columns — the data dictionary (collapsible,
 * open by default, resizable), the main column (databases, query, matching events)
 * and the pinned statistics column. Panels paint into the data-panel slots.
 */
export function renderShell(root: HTMLElement): Shell {
  const docsOpen = docsToggle(false); // the page starts with the docs open
  root.innerHTML = `
    <header class="qb-topbar">
      <span class="qb-brand"><img class="qb-logo" src="${MASCOT.neutral}" alt="" width="28" height="28" />Query Builder</span>
      <nav class="qb-steps" data-menu="views" aria-label="Workflow">
        ${VIEWS.map(
          (v, i) =>
            `<a class="qb-step${v.id === "filter" ? " is-active" : ""}" href="#" data-view="${v.id}"${v.id === "filter" ? ' aria-current="step"' : ""}><span class="qb-step-num">${i + 1}</span>${v.label}</a>`,
        ).join("")}
      </nav>
      <div class="qb-topbar-right">
        <div data-panel="account"></div>
      </div>
    </header>
    <div class="qb-body">
      <button type="button" class="qb-docs-rail" data-menu="toggle-sidebar" aria-controls="qb-docs" aria-expanded="true" title="${docsOpen.title}">
        <i class="${docsOpen.icon} icon"></i><span>${docsOpen.label}</span>
      </button>
      <aside class="qb-col-docs" id="qb-docs">
        <div data-panel="docs"></div>
        <div class="qb-docs-resize" role="separator" aria-orientation="vertical" aria-label="Resize the data dictionary" tabindex="0"></div>
      </aside>
      <main class="qb-col-main">
        <section data-panel="dbpicker"></section>
        <section data-panel="center"></section>
        <section data-panel="preview"></section>
      </main>
      <aside class="qb-col-stats" data-panel="stats"></aside>
    </div>
  `;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const body = find(".qb-body");
  const rail = find<HTMLButtonElement>(".qb-docs-rail");
  const steps = find('[data-menu="views"]');
  const logo = find<HTMLImageElement>(".qb-logo");
  // Face files that failed to load: never asked for again, so a missing file is
  // requested once, not on every repaint.
  const failed = new Set<string>();
  logo.addEventListener("error", () => {
    // A missing face falls back to the normal face; never loop.
    const src = logo.getAttribute("src");
    if (src && src !== MASCOT.neutral) {
      failed.add(src);
      logo.src = MASCOT.neutral;
    }
  });

  return {
    panels: {
      docs: find('[data-panel="docs"]'),
      dbpicker: find('[data-panel="dbpicker"]'),
      center: find('[data-panel="center"]'),
      stats: find('[data-panel="stats"]'),
      preview: find('[data-panel="preview"]'),
      account: find('[data-panel="account"]'),
    },

    docsResizeHandle: find(".qb-docs-resize"),

    logo,

    setMascot(state) {
      logo.dataset.state = state;
      // Panels repaint often; only touch the image when the face changes.
      const wanted = failed.has(MASCOT[state]) ? MASCOT.neutral : MASCOT[state];
      if (logo.getAttribute("src") !== wanted) logo.src = wanted;
    },

    setActiveView(v) {
      steps.querySelectorAll<HTMLElement>("[data-view]").forEach((a) => {
        const on = a.dataset.view === v;
        a.classList.toggle("is-active", on);
        if (on) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
      });
      const filtering = v === "filter";
      body.hidden = !filtering;
      let placeholder = root.querySelector<HTMLElement>("#qb-coming-soon");
      if (!filtering && !placeholder) {
        placeholder = document.createElement("div");
        placeholder.id = "qb-coming-soon";
        placeholder.className = "qb-card qb-coming-soon";
        placeholder.innerHTML = `<i class="clock outline icon"></i> Coming soon`;
        body.after(placeholder);
      }
      if (placeholder) placeholder.hidden = filtering;
    },

    setSidebarCollapsed(collapsed) {
      body.classList.toggle("qb-docs-collapsed", collapsed);
      rail.setAttribute("aria-expanded", String(!collapsed));
      const toggle = docsToggle(collapsed);
      rail.title = toggle.title;
      rail.querySelector("i")!.className = `${toggle.icon} icon`;
      rail.querySelector("span")!.textContent = toggle.label;
    },

    /**
     * The step links carry `href="#"` only so they are keyboard-focusable (an
     * `<a>` without `href` is skipped by Tab and ignores Enter) — every handler
     * below calls preventDefault so the URL hash never changes.
     */
    onMenu(handler) {
      steps.addEventListener("click", (e) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
        if (!item) return;
        e.preventDefault();
        handler.view(item.dataset.view as ActiveView);
      });
      // Delegated: the rail AND the docs panel's own Hide button toggle the
      // docs, and the Hide button is repainted with its panel, so it can't be
      // bound once.
      root.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest('[data-menu="toggle-sidebar"]')) return;
        e.preventDefault();
        handler.toggleSidebar();
      });
    },
  };
}
