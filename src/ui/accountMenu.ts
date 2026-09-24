import type { AppState } from "../state";
import { COMPLIANCE_START_URL, LOGIN_URL } from "../api/client";
import { formatWhen } from "./format";
import { escapeHtml, paint } from "./panel";

/**
 * The top-bar account menu: login state and the compliance acknowledgment in
 * one place. Display-only — Run is never
 * gated on it; src/app.ts reacts to POST /api/query's real 401/403 instead.
 *
 * A native <details> dropdown rather than a Fomantic one: Fomantic's dropdown
 * treats a clicked item as a selection and rewrites the trigger's text, and
 * this menu holds actions, not choices. It needs no jQuery.
 */
function badgeHtml(state: AppState): string {
  if (state.compliance.status === "acknowledged") {
    return `<span class="qb-badge qb-badge-ok"><i class="check icon"></i>Compliance</span>`;
  }
  if (state.compliance.status === "required") {
    return `<span class="qb-badge qb-badge-warn">Compliance needed</span>`;
  }
  return "";
}

function complianceHtml(state: AppState): string {
  const c = state.compliance;
  if (c.status === "loading") return `<p class="qb-account-meta">Checking…</p>`;
  if (c.status === "required") {
    return `<p class="qb-account-meta">Running a query needs a compliance reason for this session.</p>
      <a class="ui fluid small primary button" href="${escapeHtml(COMPLIANCE_START_URL)}" data-flow-link>Start compliance check</a>`;
  }
  return `<p class="qb-account-reason">“${escapeHtml(c.reason)}”</p>
    ${c.givenAt ? `<p class="qb-account-meta">Given ${escapeHtml(formatWhen(c.givenAt))}</p>` : ""}
    <button type="button" class="ui fluid small basic button" data-action="invalidate-compliance">Invalidate</button>`;
}

export function renderAccountMenu(el: HTMLElement, state: AppState): void {
  const { auth } = state;
  if (auth.status === "loading") {
    paint(el, "");
    return;
  }
  if (auth.status === "anonymous") {
    paint(
      el,
      `<a href="${escapeHtml(LOGIN_URL)}" data-flow-link class="ui small primary button">Log in</a>`,
    );
    return;
  }
  paint(
    el,
    `<details class="qb-account">
       <summary class="qb-account-chip">
         <i class="user circle icon"></i>
         <span class="qb-account-name">${escapeHtml(auth.user.name)}</span>
         ${badgeHtml(state)}
         <i class="dropdown icon"></i>
       </summary>
       <div class="qb-account-menu">
         <div class="qb-account-section">
           <div class="qb-account-label">Compliance</div>
           ${complianceHtml(state)}
         </div>
         <div class="qb-account-section">
           <button type="button" class="ui fluid small basic button" data-action="logout">Log out</button>
         </div>
       </div>
     </details>`,
  );
}

/** Delegated menu actions + close-on-outside-click/Escape. Call once at startup. */
export function wireAccountMenu(
  container: HTMLElement,
  handlers: { onLogout(): void; onInvalidate(): void },
): void {
  container.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("[data-action='logout']")) handlers.onLogout();
    else if (t.closest("[data-action='invalidate-compliance']")) handlers.onInvalidate();
  });
  // A <details> menu doesn't close itself on an outside click or on Escape.
  const close = () =>
    container
      .querySelector<HTMLDetailsElement>("details.qb-account[open]")
      ?.removeAttribute("open");
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const details = container.querySelector<HTMLDetailsElement>("details.qb-account[open]");
    if (!details) return;
    const focusWasInMenu = details.contains(document.activeElement);
    close();
    if (focusWasInMenu) {
      details.querySelector<HTMLElement>("summary.qb-account-chip")?.focus();
    }
  });
}
