import { randomBytes } from "node:crypto";

export interface AuthUser {
  name: string;
}

interface Session {
  user: AuthUser;
}

/** In-memory session store — a real backend would use its own session/store mechanism. */
const SESSIONS = new Map<string, Session>();

/** CSRF `state` values issued by /api/auth/login, valid until consumed by /api/auth/callback. */
const PENDING_STATES = new Set<string>();

/** Fake authorization codes the mock's own fake-IdP page hands out. A real IdP issues these
 *  itself; the mock stands in for it since there's no real IdP reachable in a dev sandbox. */
const FAKE_CODES = new Set<string>();

const SESSION_COOKIE = "qb_session";

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Starts a login attempt: a fresh CSRF `state`, valid until /api/auth/callback consumes it. */
export function startLogin(): string {
  const state = randomToken();
  PENDING_STATES.add(state);
  return state;
}

/** Dev-only: stands in for the real IdP handing back a code after the user authenticates
 *  on its authorize page. Production's real IdP does this remotely over HTTPS — nothing
 *  here is reused by a real integration (see docs/superpowers/specs/
 *  2026-09-22-oauth2-login-design.md §7). */
export function issueFakeCode(): string {
  const code = randomToken();
  FAKE_CODES.add(code);
  return code;
}

export type ExchangeOutcome = { ok: true; sessionId: string } | { ok: false; error: string };

/** Stands in for POSTing the code to the IdP's /token endpoint with the client secret.
 *  The mock skips the real network call and PKCE entirely (see the design spec's §6/§7)
 *  — a real backend does not. */
export function exchangeCodeForSession(code: string, state: string): ExchangeOutcome {
  if (!PENDING_STATES.has(state)) return { ok: false, error: "Invalid or expired login attempt." };
  PENDING_STATES.delete(state);
  if (!FAKE_CODES.has(code)) return { ok: false, error: "Invalid or expired authorization code." };
  FAKE_CODES.delete(code);
  const sessionId = randomToken(32);
  SESSIONS.set(sessionId, { user: { name: "demo.user" } });
  return { ok: true, sessionId };
}

export function sessionFor(cookieHeader: string | undefined): Session | null {
  const id = parseCookie(cookieHeader, SESSION_COOKIE);
  return id ? (SESSIONS.get(id) ?? null) : null;
}

export function endSession(cookieHeader: string | undefined): void {
  const id = parseCookie(cookieHeader, SESSION_COOKIE);
  if (id) SESSIONS.delete(id);
}

/** Reads one cookie's value out of a raw `Cookie` request header. */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function sessionCookieHeader(sessionId: string): string {
  // No `Secure` flag: local dev runs over plain http, and browsers drop `Secure`
  // cookies entirely on a non-https origin. Production runs behind TLS and MUST
  // add `Secure` — see the design spec's §7.
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
