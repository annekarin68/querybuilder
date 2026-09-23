import type { AppState } from "../state";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { databaseTitle } from "./format";

/**
 * The database scope selector, above the query builder. Databases are
 * arbitrary partitions with no semantic tie to entryset content (returned by
 * GET /api/databases). Each one is a pill toggle — a real checkbox inside a
 * styled label, so it needs no plugin and works from the keyboard. Changing it
 * behaves like editing the query (see main.ts onDatabasesChange + §6).
 */
export function renderDatabasePicker(state: AppState): void {
  const el = panelEls().dbpicker;
  if (!state.databases) {
    paint(el, "");
    return;
  }
  const selected = new Set(state.selectedDatabaseIds);
  const pills = state.databases
    .map((d) => {
      const title = databaseTitle(d);
      return `<label class="qb-db-pill"${title ? ` title="${escapeHtml(title)}"` : ""}>
        <input type="checkbox" data-db-id="${escapeHtml(d.label)}"${selected.has(d.label) ? " checked" : ""} />
        <span>${escapeHtml(d.name)}</span>
      </label>`;
    })
    .join("");
  const none = state.selectedDatabaseIds.length === 0;
  paint(
    el,
    `<div class="qb-card qb-dbpicker">
       <h2 class="qb-card-title">
         Databases
         <span class="qb-card-count">${selected.size} of ${state.databases.length} selected</span>
         <span class="qb-spacer"></span>
         <button type="button" class="ui mini basic button" data-db-all>All</button>
         <button type="button" class="ui mini basic button" data-db-none>None</button>
       </h2>
       <div class="qb-db-pills">${pills}</div>
       ${none ? `<p class="qb-db-warn"><i class="exclamation triangle icon"></i>Select at least one database.</p>` : ""}
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
    if (t.closest("[data-db-all]")) onChange(boxes().map((b) => b.dataset.dbId!));
    else if (t.closest("[data-db-none]")) onChange([]);
  });
}
