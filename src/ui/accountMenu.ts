import type { AppState, ComplianceState } from "../state";
import { COMPLIANCE_START_URL, LOGIN_URL } from "../api/client";
import { escapeHtml, paint } from "./panel";

/**
 * The top-bar account menu: login state and the compliance acknowledgment in
 * one place. Display-only — Run is never
 * gated on it; src/app.ts reacts to POST /api/filter/execute's real 401/403 instead.
 *
 * A native <details> dropdown rather than a Fomantic one: Fomantic's dropdown
 * treats a clicked item as a selection and rewrites the trigger's text, and
 * this menu holds actions, not choices. It needs no jQuery.
 */
function badgeHtml(state: AppState): string {
  // On narrow screens (styles.css, "Narrow top bar") a badge shrinks to its
  // icon and the text stays as visually hidden text. That is why the text has
  // its own span, why both badges have an icon, and why `title` (the tooltip
  // the icon then needs) repeats the text.
  if (state.compliance.status === "acknowledged") {
    return `<span class="qb-badge qb-badge-ok" title="Compliance"><i class="check icon"></i><span class="qb-badge-text">Compliance</span></span>`;
  }
  if (state.compliance.status === "required") {
    return `<span class="qb-badge qb-badge-warn" title="Compliance needed"><i class="exclamation icon qb-badge-narrow-icon"></i><span class="qb-badge-text">Compliance needed</span></span>`;
  }
  return "";
}

/**
 * The menu's Compliance section. The log is the backend's own message, shown
 * whole (the frontend reads no field of it). The <pre> is focusable because a
 * region the keyboard cannot reach cannot be scrolled by it when the log is
 * longer than its max-height.
 */
export function complianceHtml(c: ComplianceState): string {
  if (c.status === "loading") return `<p class="qb-account-meta">Checking…</p>`;
  if (c.status === "required") {
    return `<p class="qb-account-meta">Running a query needs a compliance reason for this session.</p>
      <a class="ui fluid small primary button" href="${escapeHtml(COMPLIANCE_START_URL)}">Start compliance check</a>`;
  }
  return `<pre class="qb-account-log" tabindex="0" aria-label="Compliance log">${escapeHtml(c.log)}</pre>
    <button type="button" class="ui fluid small basic button" data-action="withdraw-compliance">Withdraw compliance reason</button>`;
}

/** Withdraw compliance reason and Log out change what the menu shows, and the repaint
 *  rebuilds it closed. Their buttons are gone (or hidden), so paint() moves
 *  the keyboard focus to the chip, or to Log in: each is the panel's
 *  `data-focus-landing` (focusMemory.ts). */
export function renderAccountMenu(el: HTMLElement, state: AppState): void {
  const { auth } = state;
  if (auth.status === "loading") {
    paint(el, "");
    return;
  }
  if (auth.status === "anonymous") {
    paint(
      el,
      `<a href="${escapeHtml(LOGIN_URL)}" data-focus-landing class="ui small primary button qb-login-btn">Log in</a>`,
    );
    return;
  }
  paint(
    el,
    `<details class="qb-account">
       <summary class="qb-account-chip" data-focus-landing>
         <i class="user circle icon"></i>
         <span class="qb-account-name" title="${escapeHtml(auth.user.name)}">${escapeHtml(auth.user.name)}</span>
         ${badgeHtml(state)}
         <i class="dropdown icon"></i>
       </summary>
       <div class="qb-account-menu">
         <div class="qb-account-section">
           <div class="qb-account-label">Compliance</div>
           ${complianceHtml(state.compliance)}
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
  handlers: { onLogout(): void; onWithdraw(): void },
): void {
  // A <details> menu doesn't close itself on an outside click or on Escape.
  const openMenu = () => container.querySelector<HTMLDetailsElement>("details.qb-account[open]");
  /** Close the menu and put the focus on its chip, as Escape does. */
  const closeMenu = () => {
    const menu = openMenu();
    menu?.removeAttribute("open");
    menu?.querySelector<HTMLElement>("summary.qb-account-chip")?.focus();
  };
  container.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const logout = t.closest("[data-action='logout']");
    const withdraw = t.closest("[data-action='withdraw-compliance']");
    if (!logout && !withdraw) return;
    // Closed before the request: a failure is shown as a toast at the top
    // right, which would otherwise cover the open menu. A success repaints the
    // menu closed anyway.
    closeMenu();
    if (logout) handlers.onLogout();
    else handlers.onWithdraw();
  });
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target as Node)) openMenu()?.removeAttribute("open");
  });
  document.addEventListener("keydown", (e) => {
    const menu = openMenu();
    if (e.key !== "Escape" || !menu) return;
    if (menu.contains(document.activeElement)) closeMenu();
    else menu.removeAttribute("open");
  });
}
