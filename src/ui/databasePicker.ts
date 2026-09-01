import type { AppState } from "../state";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/**
 * The database scope selector, above the query builder. "Each kind of plant has
 * its own database" — so this is a checkbox per database (species). Changing it
 * behaves like editing the query (see main.ts onDatabasesChange + §6).
 */
export function renderDatabasePicker(state: AppState): void {
  const el = panelEls().dbpicker;
  if (!state.databases) {
    paint(el, "");
    return;
  }
  const selected = new Set(state.selectedDatabaseIds);
  const boxes = state.databases
    .map(
      (d) => `<div class="inline field" style="margin:0 1rem .25rem 0">
        <div class="ui checkbox">
          <input type="checkbox" data-db-id="${escapeHtml(d.id)}"${selected.has(d.id) ? " checked" : ""} />
          <label>${escapeHtml(d.label)}</label>
        </div>
      </div>`,
    )
    .join("");
  const none = state.selectedDatabaseIds.length === 0;
  paint(
    el,
    `<div class="ui small form" style="margin-bottom:.75rem">
       <div class="inline fields" style="margin-bottom:.15rem;flex-wrap:wrap">
         <label style="margin-right:.75rem">Databases</label>
         ${boxes}
       </div>
       <span class="ui small text">
         <a data-db-all>Select all</a> · <a data-db-none>Select none</a>
         ${none ? ` — <span class="qb-db-warn">nothing selected</span>` : ""}
       </span>
     </div>`,
  );
}

export function wireDatabasePicker(
  container: HTMLElement,
  onChange: (nextSelectedIds: string[]) => void,
): void {
  if (container.dataset.dbWired === "1") return;
  container.dataset.dbWired = "1";

  const boxes = () => Array.from(container.querySelectorAll<HTMLInputElement>("input[data-db-id]"));

  container.addEventListener("change", (e) => {
    if (!(e.target as HTMLElement).matches("input[data-db-id]")) return;
    onChange(
      boxes()
        .filter((b) => b.checked)
        .map((b) => b.dataset.dbId!),
    );
  });

  container.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches("[data-db-all]")) {
      e.preventDefault();
      onChange(boxes().map((b) => b.dataset.dbId!));
    } else if (t.matches("[data-db-none]")) {
      e.preventDefault();
      onChange([]);
    }
  });
}
