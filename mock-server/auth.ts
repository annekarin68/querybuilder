import { randomBytes } from "node:crypto";
import type { AuthUser, ComplianceStatus } from "../src/api/types";

interface Session {
  user: AuthUser;
  compliance?: { reason: string; ackedAt: string };
}

/** In-memory session store — a real backend would use its own session/store mechanism. */
const SESSIONS = new Map<string, Session>();

/** How long a login/compliance round trip may take — the same 5 minutes as
 *  the state-binding cookie (`bindingCookieHeader`). */
const PENDING_TTL_MS = 5 * 60_000;

/**
 * Single-use values (CSRF states, codes, tokens) that expire after
 * PENDING_TTL_MS, so abandoned attempts don't pile up in memory forever.
 * `take` returns the value and forgets it, or undefined if unknown or expired.
 */
function pendingStore<V>() {
  const entries = new Map<string, { value: V; expiresAt: number }>();
  return {
    put(key: string, value: V): void {
      const now = Date.now();
      for (const [k, e] of entries) if (e.expiresAt <= now) entries.delete(k);
      entries.set(key, { value, expiresAt: now + PENDING_TTL_MS });
    },
    take(key: string): V | undefined {
      const e = entries.get(key);
      entries.delete(key);
      return e && e.expiresAt > Date.now() ? e.value : undefined;
    },
  };
}

/** CSRF `state` values issued by /api/auth/login, valid until consumed by /api/auth/callback. */
const PENDING_STATES = pendingStore<true>();

/** Fake authorization codes the mock's own fake-IdP page hands out. A real IdP issues these
 *  itself; the mock stands in for it since there's no real IdP reachable in a dev sandbox. */
const FAKE_CODES = pendingStore<true>();

const SESSION_COOKIE = "qb_session";

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Starts a login attempt: a fresh CSRF `state`, valid until /api/auth/callback consumes it. */
export function startLogin(): string {
  const state = randomToken();
  PENDING_STATES.put(state, true);
  return state;
}

/** Dev-only: stands in for the real IdP handing back a code after the user authenticates
 *  on its authorize page. Production's real IdP does this remotely over HTTPS — nothing
 *  here is reused by a real integration (issue #15;
 *  docs/superpowers/specs/2026-09-22-oauth2-login-design.md, §7). */
export function issueFakeCode(): string {
  const code = randomToken();
  FAKE_CODES.put(code, true);
  return code;
}

export type ExchangeOutcome = { ok: true; sessionId: string } | { ok: false; error: string };

/** Stands in for POSTing the code to the IdP's /token endpoint with the client
 *  secret. The mock skips the real network call entirely. PKCE is a production
 *  decision left open by the design (§2 of
 *  docs/superpowers/specs/2026-09-22-oauth2-login-design.md) — the mock does
 *  not simulate it either way, which says nothing about whether production
 *  should use it. */
export function exchangeCodeForSession(code: string, state: string): ExchangeOutcome {
  if (!PENDING_STATES.take(state)) return { ok: false, error: "Invalid or expired login attempt." };
  if (!FAKE_CODES.take(code)) return { ok: false, error: "Invalid or expired authorization code." };
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
  // add `Secure` (issue #15; docs/superpowers/specs/2026-09-22-oauth2-login-design.md, §7).
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Binds a CSRF `state` to the browser that started a redirect flow, so a leaked or
 * guessed callback URL can't be replayed by a different browser (login CSRF, and
 * the same risk for the compliance flow) — the flow's own single-use `state` set
 * alone only prevents *replay* of an already-used state, not this. Short-lived:
 * only needs to survive the round trip to the external service and back. Shared
 * by both the login and compliance flows via a cookie-name parameter.
 */
function bindingCookieHeader(name: string, value: string): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`;
}

function clearBindingCookieHeader(name: string): string {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

const LOGIN_STATE_COOKIE = "qb_login_state";

export function loginStateCookieHeader(state: string): string {
  return bindingCookieHeader(LOGIN_STATE_COOKIE, state);
}

export function clearLoginStateCookieHeader(): string {
  return clearBindingCookieHeader(LOGIN_STATE_COOKIE);
}

export function loginStateFromCookie(cookieHeader: string | undefined): string | undefined {
  return parseCookie(cookieHeader, LOGIN_STATE_COOKIE);
}

const COMPLIANCE_STATE_COOKIE = "qb_compliance_state";

export function complianceStateCookieHeader(state: string): string {
  return bindingCookieHeader(COMPLIANCE_STATE_COOKIE, state);
}

export function clearComplianceStateCookieHeader(): string {
  return clearBindingCookieHeader(COMPLIANCE_STATE_COOKIE);
}

export function complianceStateFromCookie(cookieHeader: string | undefined): string | undefined {
  return parseCookie(cookieHeader, COMPLIANCE_STATE_COOKIE);
}

/** CSRF `state` values issued by /api/compliance/start, valid until consumed by
 *  /api/compliance/callback. A separate set from the login flow's, so the two
 *  flows' state spaces can never cross-validate each other's tokens. */
const PENDING_COMPLIANCE_STATES = pendingStore<true>();

/** The reason text a user typed on the mock compliance page, keyed by a
 *  single-use token, until /api/compliance/callback consumes it. */
const PENDING_COMPLIANCE_REASONS = pendingStore<string>();

/** Starts a compliance attempt: a fresh CSRF `state`, valid until
 *  /api/compliance/callback consumes it. */
export function startCompliance(): string {
  const state = randomToken();
  PENDING_COMPLIANCE_STATES.put(state, true);
  return state;
}

/** Dev-only: stands in for the real compliance service handing back a token
 *  after the user submits their reason on its form. Production's real service
 *  does this remotely over HTTPS — nothing here is reused by a real
 *  integration (issue #15; docs/superpowers/specs/2026-09-23-compliance-logging-design.md, §7). */
export function issueFakeComplianceToken(reason: string): string {
  const token = randomToken();
  PENDING_COMPLIANCE_REASONS.put(token, reason);
  return token;
}

export type ComplianceExchangeOutcome = { ok: true } | { ok: false; error: string };

/** Attaches the reason to the CURRENT session (found via the existing
 *  qb_session cookie already on this request) — compliance piggybacks on the
 *  session record rather than a second session-identifying cookie. */
export function exchangeComplianceToken(
  token: string,
  state: string,
  cookieHeader: string | undefined,
): ComplianceExchangeOutcome {
  if (!PENDING_COMPLIANCE_STATES.take(state)) {
    return { ok: false, error: "Invalid or expired compliance attempt." };
  }
  const reason = PENDING_COMPLIANCE_REASONS.take(token);
  if (reason === undefined) {
    return { ok: false, error: "Invalid or expired compliance token." };
  }
  const session = sessionFor(cookieHeader);
  if (!session) {
    return { ok: false, error: "Not authenticated." };
  }
  session.compliance = { reason, ackedAt: new Date().toISOString() };
  return { ok: true };
}

/** Never errors: no session, or a session with no compliance record, both
 *  report "required" — from the caller's perspective, compliance isn't met
 *  either way. */
export function complianceStatusFor(cookieHeader: string | undefined): ComplianceStatus {
  const session = sessionFor(cookieHeader);
  if (!session?.compliance) return { status: "required" };
  return {
    status: "acknowledged",
    reason: session.compliance.reason,
    ackedAt: session.compliance.ackedAt,
  };
}

/** Clears just the compliance field off the current session — the user stays
 *  logged in, but must go through the compliance flow again before their next
 *  extraction. The exact parallel of endSession, narrowed to one field. */
export function clearCompliance(cookieHeader: string | undefined): void {
  const session = sessionFor(cookieHeader);
  if (session) delete session.compliance;
}
