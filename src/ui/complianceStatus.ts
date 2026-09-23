import type { AppState } from "../state";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/**
 * The top-menu compliance-acknowledgment widget. Advisory only — it does not
 * gate the Run button; main.ts reacts to POST /api/query's actual 401/403
 * response instead. "required": a plain navigation link into the compliance
 * flow (like authStatus.ts's Log in link — the browser needs to leave the SPA
 * and follow the redirects). "acknowledged": the stored reason + an
 * Invalidate button.
 */
export function renderComplianceStatus(state: AppState): void {
  const el = panelEls().compliance;
  if (state.compliance.status === "loading") {
    paint(el, "");
    return;
  }
  if (state.compliance.status === "required") {
    paint(
      el,
      `<a href="/api/compliance/start" class="ui small button">Start compliance check</a>`,
    );
    return;
  }
  paint(
    el,
    `<span class="qb-compliance-reason" title="${escapeHtml(state.compliance.ackedAt ?? "")}">${escapeHtml(state.compliance.reason ?? "")}</span>
     <button class="ui small basic button" data-action="invalidate-compliance">Invalidate</button>`,
  );
}

export function wireComplianceStatus(container: HTMLElement, onInvalidate: () => void): void {
  if (container.dataset.complianceWired === "1") return;
  container.dataset.complianceWired = "1";
  container.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='invalidate-compliance']")) onInvalidate();
  });
}
