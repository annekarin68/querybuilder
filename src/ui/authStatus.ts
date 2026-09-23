import type { AppState } from "../state";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

/**
 * The top-menu login/logout widget. Anonymous: a plain navigation link to
 * GET /api/auth/login (a real page load, not a fetch — the whole point is
 * that the browser needs to leave the SPA and follow the OAuth redirects).
 * Authenticated: the user's name + a Log out button.
 */
export function renderAuthStatus(state: AppState): void {
  const el = panelEls().auth;
  if (state.auth.status === "loading") {
    paint(el, "");
    return;
  }
  if (state.auth.status === "anonymous") {
    paint(el, `<a href="/api/auth/login" class="ui small button">Log in</a>`);
    return;
  }
  paint(
    el,
    `<span class="qb-auth-user">${escapeHtml(state.auth.user!.name)}</span>
     <button class="ui small basic button" data-action="logout">Log out</button>`,
  );
}

export function wireAuthStatus(container: HTMLElement, onLogout: () => void): void {
  if (container.dataset.authWired === "1") return;
  container.dataset.authWired = "1";
  container.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='logout']")) onLogout();
  });
}
