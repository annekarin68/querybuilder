import type { DatabaseResult } from "../model";
import type { AppState } from "../state";
import { escapeHtml, paint } from "./panel";
import { databaseTitle } from "./format";

/**
 * Each failed database's id → why it failed, in the user's words: its errors'
 * messages, else its notes (a timeout, an unreachable server), else "Failed.".
 */
export function failedDatabases(results: DatabaseResult[]): Map<string, string[]> {
  const failed = new Map<string, string[]>();
  for (const r of results) {
    if (r.status !== "failed") continue;
    const reasons = r.errors.length > 0 ? r.errors.map((e) => e.message) : r.notes;
    failed.set(r.databaseId, reasons.length > 0 ? reasons : ["Failed."]);
  }
  return failed;
}

/**
 * The selection without the databases that failed, for the "Deselect failing"
 * button. null means the button must not show: nothing selected failed (nothing
 * to do), or every selected database did. In that last case deselecting them
 * all would leave no database, and the query itself is the likely problem, so
 * the user should fix it rather than be offered an empty scope.
 */
export function deselectFailingIds(
  selected: string[],
  failed: ReadonlyMap<string, string[]>,
): string[] | null {
  const kept = selected.filter((id) => !failed.has(id));
  return kept.length === 0 || kept.length === selected.length ? null : kept;
}

/**
 * The databases that failed for the query on screen. Only the current results
 * count: `changeScope` (src/app.ts) empties them when a new query starts, so
 * the markers clear instead of lingering from the previous query.
 */
function currentFailures(state: AppState): Map<string, string[]> {
  return state.stats.status === "error" ? new Map() : failedDatabases(state.stats.results);
}

/**
 * The database scope selector, above the query builder. Databases are
 * arbitrary partitions with no semantic tie to event content (returned by
 * GET /api/databases). Each one is a pill toggle — a real checkbox inside a
 * styled label, so it needs no plugin and works from the keyboard. Changing it
 * behaves like editing the query (see onDatabasesChange in src/app.ts and
 * docs/ARCHITECTURE.md, "Correctness invariant").
 *
 * A selected database that failed for this query is marked on its pill, and
 * "Deselect failing (N)" drops those from the selection.
 */
export function databasePickerHtml(state: AppState): string {
  if (!state.databases) return "";
  const selected = new Set(state.selectedDatabaseIds);
  // Only selected databases are marked: an unselected one is not part of this
  // query, so an earlier failure of it says nothing about it now.
  const failures = new Map([...currentFailures(state)].filter(([id]) => selected.has(id)));
  const pills = state.databases
    .map((d) => {
      const reasons = failures.get(d.id);
      const title = [databaseTitle(d), reasons?.join(" · ")].filter(Boolean).join("\n");
      // The icon and the sr-only text carry the failure for people who cannot
      // see the outline's colour.
      return `<label class="qb-db-pill${reasons ? " is-failed" : ""}"${title ? ` title="${escapeHtml(title)}"` : ""}>
        <input type="checkbox" data-db-id="${escapeHtml(d.id)}"${selected.has(d.id) ? " checked" : ""} />
        <span>${reasons ? `<i class="exclamation circle icon" aria-hidden="true"></i>` : ""}${escapeHtml(d.name)}${reasons ? `<span class="qb-sr-only">failed for this query</span>` : ""}</span>
      </label>`;
    })
    .join("");
  const none = state.selectedDatabaseIds.length === 0;
  const kept = deselectFailingIds(state.selectedDatabaseIds, failures);
  const deselectFailing = kept
    ? `<button type="button" class="ui mini basic button" data-db-deselect-failing>Deselect failing (${state.selectedDatabaseIds.length - kept.length})</button>`
    : "";
  return `<div class="qb-card qb-dbpicker">
       <h2 class="qb-card-title">
         Databases
         <span class="qb-card-count">${selected.size} of ${state.databases.length} selected</span>
         <span class="qb-spacer"></span>
         ${deselectFailing}
         <button type="button" class="ui mini basic button" data-db-all data-focus-landing>All</button>
         <button type="button" class="ui mini basic button" data-db-none>None</button>
       </h2>
       <div class="qb-db-pills">${pills}</div>
       ${none ? `<p class="qb-db-warn"><i class="exclamation triangle icon"></i>Select at least one database.</p>` : ""}
     </div>`;
}

export function renderDatabasePicker(el: HTMLElement, state: AppState): void {
  paint(el, databasePickerHtml(state));
}

/** Delegated listeners for the pills, All/None and Deselect failing. Call once at startup. */
export function wireDatabasePicker(
  container: HTMLElement,
  onChange: (nextSelectedIds: string[]) => void,
): void {
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
    else if (t.closest("[data-db-deselect-failing]")) {
      // The failed pills are marked in the DOM, so the click needs no state.
      const failing = new Map(
        Array.from(
          container.querySelectorAll<HTMLInputElement>(".qb-db-pill.is-failed input[data-db-id]"),
        ).map((b) => [b.dataset.dbId!, []] as [string, string[]]),
      );
      const checked = boxes()
        .filter((b) => b.checked)
        .map((b) => b.dataset.dbId!);
      const kept = deselectFailingIds(checked, failing);
      if (kept) onChange(kept);
    }
  });
}
