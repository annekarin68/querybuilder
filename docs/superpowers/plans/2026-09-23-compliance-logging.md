# Compliance Logging Redirect Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compliance-acknowledgment redirect gate on data extraction (`POST /api/query`), reacting generically to `401`/`403` from any protected endpoint, with the in-progress query preserved across the redirect and no automatic retry loop.

**Architecture:** A second mock-service redirect flow, structurally identical to the OAuth one this branches from: the compliance service's redirect URI points at the backend, a CSRF `state` is bound to the browser via a short-lived cookie, and the acknowledgment (a user-typed reason + timestamp) is attached to the *existing* session record rather than a new cookie. The frontend never pre-checks auth/compliance status before allowing a click — it reacts to the HTTP status code any protected call returns (`401` → login, `403` → compliance), which generalizes to future protected endpoints for free. The query and selected databases are preserved across each redirect via `sessionStorage`, restored on return, with no automatic re-run — the user clicks Run again, which is what makes the mechanism immune to redirect loops.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Node's built-in `http` module (mock server).

**Spec:** `docs/superpowers/specs/2026-09-23-compliance-logging-design.md`

**Base branch note:** this branch (`worktree-compliance-logging`) is forked from `worktree-oauth2-auth-code-login` (PR #13, not yet merged to `main`), not from `main` — this feature depends directly on that branch's session/cookie infrastructure (`AuthUser`, `ApiError`, `mock-server/auth.ts`'s session store, the `authStatus.ts` panel pattern).

## Global Constraints

- Node 20.19+ toolchain floor; `tsconfig.json` strict mode.
- No `jquery` import outside `src/ui/fomantic.ts`. `src/**` may not import `mock-server/*`.
- **`canRunQuery` (in `src/state.ts`) stays untouched** — this task doesn't change it, same as the OAuth PR.
- **`syncRunButton` reverts to `canRunQuery(state) && preview.status !== "loading"`** — no auth/compliance-aware disabling. Clicking Run always genuinely attempts the request; the response's status code (not a pre-check) decides whether a redirect happens.
- **No automatic chaining or auto-retry.** Landing back from either redirect (`/?resume=1`) restores the saved query and stops — it never re-checks gates or re-triggers a request on its own. This is the redirect-loop protection: the app never redirects itself without a fresh, explicit user click.
- **`AppState.auth`/`AppState.compliance` are display-only.** They drive the top-menu widgets and the data-preview idle-state hint, never gating logic.
- Query preservation is `sessionStorage`-only — never sent through the backend or any redirect URL.
- Offline-first: nothing added here may introduce an external-network dependency. The mock compliance page is server-rendered HTML from `mock-server/index.ts` — never bundled by Vite, never touches `dist/`.
- Vitest unit tests target pure modules only. `src/ui/*.ts` panel files, `mock-server/index.ts`'s route handlers, and `src/main.ts` have no dedicated tests, per established convention.
- `docs/ARCHITECTURE.md` is a living document — updated in the same overall change (Task 10).
- **Production note discipline:** anything added to `mock-server/` that a real backend must also implement gets an explicit comment/commit-message flag (see the design spec §7 for the full list).

---

## File Structure

**Contract & client:**
- Modify: `src/api/types.ts` — add `ComplianceStatus`.
- Modify: `src/api/client.ts` — add `getComplianceStatus`/`invalidateCompliance`.

**Mock server:**
- Modify: `mock-server/auth.ts` — generalize the binding-cookie helpers (backward compatible), extend `Session` with `compliance?`, add compliance session/token logic.
- Create: `mock-server/audit.ts` — per-query audit-forwarding stand-in.
- Modify: `mock-server/index.ts` — new compliance routes, form-body parsing, `POST /api/query`'s compliance gate + audit call, `/api/auth/callback`'s redirect target.
- Modify: `vite.config.ts` — proxy `/mock-compliance` alongside the existing `/mock-idp`.

**Frontend state & UI:**
- Modify: `src/state.ts` — `AppState.compliance`.
- Create: `src/util/pendingQuery.ts` — save/restore the in-progress query across a redirect.
- Modify: `src/ui/layout.ts` — new `data-panel="compliance"` slot.
- Create: `src/ui/complianceStatus.ts` — the compliance widget.
- Modify: `src/main.ts` — reactive 401/403 handling, `syncRunButton` reversion, `onLogout`/`onInvalidateCompliance`, panel registration, `resume=1` handling.
- Modify: `src/ui/dataPreview.ts` — idle-state hint gains a compliance-required case.

**Tests:**
- Modify: `tests/api/client.test.ts`, `tests/state.test.ts`.
- Create: `tests/mock-server/audit.test.ts`, `tests/util/pendingQuery.test.ts`.
- Modify: `tests/mock-server/auth.test.ts` (new compliance-logic tests; existing tests untouched).

**Docs:**
- Modify: `docs/ARCHITECTURE.md`.

---

### Task 1: `src/api/types.ts` — `ComplianceStatus`

**Files:**
- Modify: `src/api/types.ts`

**Interfaces:**
- Produces: `ComplianceStatus { status: "required" | "acknowledged"; reason?: string; ackedAt?: string }` — consumed by Task 2 (`client.ts`).

- [ ] **Step 1: Add the type**

Add near the existing `AuthUser` type:

```ts
/** Compliance acknowledgment status, returned by GET /api/compliance/status. */
export interface ComplianceStatus {
  status: "required" | "acknowledged";
  reason?: string;
  ackedAt?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(api): add ComplianceStatus type for GET /api/compliance/status"
```

---

### Task 2: `src/api/client.ts` — `getComplianceStatus`/`invalidateCompliance`

**Files:**
- Modify: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `ComplianceStatus` (Task 1).
- Produces: `getComplianceStatus(): Promise<ComplianceStatus>`, `invalidateCompliance(): Promise<void>` — consumed by Task 8 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Update the import line in `tests/api/client.test.ts`:

```ts
import {
  ApiError,
  getComplianceStatus,
  getDatabases,
  getMe,
  getSchema,
  getStats,
  invalidateCompliance,
  logout,
  runQuery,
} from "../../src/api/client";
```

Add these tests to the `describe("api client", ...)` block:

```ts
  it("getComplianceStatus GETs /api/compliance/status and returns the parsed body", async () => {
    const f = mockFetchOnce(200, { status: "required" });
    vi.stubGlobal("fetch", f);
    const out = await getComplianceStatus();
    expect(out).toEqual({ status: "required" });
    expect(f).toHaveBeenCalledWith("/api/compliance/status", undefined);
  });

  it("invalidateCompliance POSTs to /api/compliance/invalidate", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await invalidateCompliance();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/compliance/invalidate");
    expect(init.method).toBe("POST");
  });

  it("invalidateCompliance throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(invalidateCompliance()).rejects.toThrow("boom");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `getComplianceStatus`/`invalidateCompliance` don't exist yet.

- [ ] **Step 3: Update `src/api/client.ts`**

Change the type-only import at the top:

```ts
import type {
  AuthUser,
  ComplianceStatus,
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./types";
```

Add, after `logout`:

```ts
export function getComplianceStatus(): Promise<ComplianceStatus> {
  return request<ComplianceStatus>("/compliance/status");
}

export async function invalidateCompliance(): Promise<void> {
  const res = await fetch(`${BASE}/compliance/invalidate`, { method: "POST" });
  if (!res.ok) throw await errorFromResponse(res);
}
```

(`getComplianceStatus` uses the generic `request<T>` — unlike `getMe`, `/api/compliance/status` never returns a non-2xx per its design, so no special-casing is needed. `invalidateCompliance` is standalone, matching `logout`, since the real endpoint returns `204 No Content` and `request<T>` always calls `.json()`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts tests/api/client.test.ts
git commit -m "feat(client): add getComplianceStatus/invalidateCompliance"
```

---

### Task 3: `mock-server/auth.ts` — generalized binding cookie + compliance session logic

**Files:**
- Modify: `mock-server/auth.ts`
- Test: `tests/mock-server/auth.test.ts`

**Interfaces:**
- Produces: `Session { user: AuthUser; compliance?: { reason: string; ackedAt: string } }` (extended), `startCompliance(): string`, `issueFakeComplianceToken(reason: string): string`, `ComplianceExchangeOutcome = { ok: true } | { ok: false; error: string }`, `exchangeComplianceToken(token: string, state: string, cookieHeader: string | undefined): ComplianceExchangeOutcome`, `ComplianceStatusBody = { status: "required" } | { status: "acknowledged"; reason: string; ackedAt: string }`, `complianceStatusFor(cookieHeader: string | undefined): ComplianceStatusBody`, `clearCompliance(cookieHeader: string | undefined): void`, `complianceStateCookieHeader(state: string): string`, `clearComplianceStateCookieHeader(): string`, `complianceStateFromCookie(cookieHeader: string | undefined): string | undefined` — all consumed by Task 4 (`mock-server/index.ts`).
- The existing exports `loginStateCookieHeader`, `clearLoginStateCookieHeader`, `loginStateFromCookie` keep their exact external behavior (internals refactored to share code with the new compliance ones) — the existing `tests/mock-server/auth.test.ts` tests for these need NO changes.

- [ ] **Step 1: Write the failing tests**

Add to the import line in `tests/mock-server/auth.test.ts`:

```ts
import {
  startLogin,
  issueFakeCode,
  exchangeCodeForSession,
  sessionFor,
  endSession,
  parseCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
  loginStateCookieHeader,
  clearLoginStateCookieHeader,
  loginStateFromCookie,
  startCompliance,
  issueFakeComplianceToken,
  exchangeComplianceToken,
  complianceStatusFor,
  clearCompliance,
  complianceStateCookieHeader,
  clearComplianceStateCookieHeader,
  complianceStateFromCookie,
} from "../../mock-server/auth";
```

Add these new `describe` blocks at the end of the file:

```ts
describe("compliance state/token round trip", () => {
  function newSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    return outcome.sessionId;
  }

  it("a valid state+token pair attaches the reason to the session", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state = startCompliance();
    const token = issueFakeComplianceToken("investigating incident #123");
    const outcome = exchangeComplianceToken(token, state, cookie);
    expect(outcome).toEqual({ ok: true });
    expect(complianceStatusFor(cookie)).toMatchObject({
      status: "acknowledged",
      reason: "investigating incident #123",
    });
  });

  it("a state can only be consumed once", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state = startCompliance();
    const token1 = issueFakeComplianceToken("reason one");
    const token2 = issueFakeComplianceToken("reason two");
    expect(exchangeComplianceToken(token1, state, cookie).ok).toBe(true);
    expect(exchangeComplianceToken(token2, state, cookie)).toEqual({
      ok: false,
      error: "Invalid or expired compliance attempt.",
    });
  });

  it("a token can only be consumed once", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state1 = startCompliance();
    const state2 = startCompliance();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, state1, cookie).ok).toBe(true);
    expect(exchangeComplianceToken(token, state2, cookie)).toEqual({
      ok: false,
      error: "Invalid or expired compliance token.",
    });
  });

  it("an unknown state is rejected", () => {
    const sessionId = newSession();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, "not-a-real-state", `qb_session=${sessionId}`)).toEqual({
      ok: false,
      error: "Invalid or expired compliance attempt.",
    });
  });

  it("an unknown token is rejected", () => {
    const sessionId = newSession();
    const state = startCompliance();
    expect(
      exchangeComplianceToken("not-a-real-token", state, `qb_session=${sessionId}`),
    ).toEqual({ ok: false, error: "Invalid or expired compliance token." });
  });

  it("fails when there is no session for the cookie", () => {
    const state = startCompliance();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, state, undefined)).toEqual({
      ok: false,
      error: "Not authenticated.",
    });
  });
});

describe("complianceStatusFor / clearCompliance", () => {
  function ackedSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    const sessionId = outcome.sessionId;
    const cookie = `qb_session=${sessionId}`;
    const cState = startCompliance();
    const token = issueFakeComplianceToken("reason");
    exchangeComplianceToken(token, cState, cookie);
    return sessionId;
  }

  it("reports required for a session with no compliance record", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    expect(complianceStatusFor(`qb_session=${outcome.sessionId}`)).toEqual({ status: "required" });
  });

  it("reports required when there is no session at all", () => {
    expect(complianceStatusFor(undefined)).toEqual({ status: "required" });
  });

  it("reports acknowledged with the reason after a successful exchange", () => {
    const sessionId = ackedSession();
    expect(complianceStatusFor(`qb_session=${sessionId}`)).toMatchObject({
      status: "acknowledged",
      reason: "reason",
    });
  });

  it("clearCompliance removes just the compliance field, leaving the session logged in", () => {
    const sessionId = ackedSession();
    const cookie = `qb_session=${sessionId}`;
    clearCompliance(cookie);
    expect(complianceStatusFor(cookie)).toEqual({ status: "required" });
    expect(sessionFor(cookie)).not.toBeNull(); // still logged in
  });
});

describe("compliance-state binding cookie", () => {
  it("complianceStateCookieHeader includes the state, HttpOnly, and SameSite=Lax", () => {
    const header = complianceStateCookieHeader("abc123");
    expect(header).toContain("qb_compliance_state=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("complianceStateFromCookie reads it back", () => {
    const header = complianceStateCookieHeader("xyz789");
    const cookiePair = header.split(";")[0]!;
    expect(complianceStateFromCookie(cookiePair)).toBe("xyz789");
  });

  it("clearComplianceStateCookieHeader expires it immediately", () => {
    expect(clearComplianceStateCookieHeader()).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/auth.test.ts`
Expected: FAIL — the new exports don't exist yet. The existing tests (parseCookie, login/callback, sessionFor/endSession, cookie headers, login-state binding cookie) still PASS unchanged.

- [ ] **Step 3: Update `mock-server/auth.ts`**

Extend `Session`:

```ts
interface Session {
  user: AuthUser;
  compliance?: { reason: string; ackedAt: string };
}
```

Generalize the binding-cookie helpers. Replace:

```ts
const LOGIN_STATE_COOKIE = "qb_login_state";

/**
 * Binds the CSRF `state` to the browser that started the login, so a leaked or
 * guessed callback URL can't be replayed by a different browser to log a victim
 * into an attacker's session (login CSRF) — the single global PENDING_STATES set
 * alone only prevents *replay* of an already-used state, not this. Short-lived:
 * only needs to survive the round trip to the IdP and back.
 */
export function loginStateCookieHeader(state: string): string {
  return `${LOGIN_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`;
}

export function clearLoginStateCookieHeader(): string {
  return `${LOGIN_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function loginStateFromCookie(cookieHeader: string | undefined): string | undefined {
  return parseCookie(cookieHeader, LOGIN_STATE_COOKIE);
}
```

with:

```ts
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
```

Add the compliance session/token logic at the end of the file:

```ts
/** CSRF `state` values issued by /api/compliance/start, valid until consumed by
 *  /api/compliance/callback. A separate set from the login flow's, so the two
 *  flows' state spaces can never cross-validate each other's tokens. */
const PENDING_COMPLIANCE_STATES = new Set<string>();

/** The reason text a user typed on the mock compliance page, keyed by a
 *  single-use token, until /api/compliance/callback consumes it. */
const PENDING_COMPLIANCE_REASONS = new Map<string, string>();

/** Starts a compliance attempt: a fresh CSRF `state`, valid until
 *  /api/compliance/callback consumes it. */
export function startCompliance(): string {
  const state = randomToken();
  PENDING_COMPLIANCE_STATES.add(state);
  return state;
}

/** Dev-only: stands in for the real compliance service handing back a token
 *  after the user submits their reason on its form. Production's real service
 *  does this remotely over HTTPS — nothing here is reused by a real
 *  integration (see the design spec's §7). */
export function issueFakeComplianceToken(reason: string): string {
  const token = randomToken();
  PENDING_COMPLIANCE_REASONS.set(token, reason);
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
  if (!PENDING_COMPLIANCE_STATES.has(state)) {
    return { ok: false, error: "Invalid or expired compliance attempt." };
  }
  PENDING_COMPLIANCE_STATES.delete(state);
  const reason = PENDING_COMPLIANCE_REASONS.get(token);
  if (reason === undefined) {
    return { ok: false, error: "Invalid or expired compliance token." };
  }
  PENDING_COMPLIANCE_REASONS.delete(token);
  const session = sessionFor(cookieHeader);
  if (!session) {
    return { ok: false, error: "Not authenticated." };
  }
  session.compliance = { reason, ackedAt: new Date().toISOString() };
  return { ok: true };
}

export type ComplianceStatusBody =
  | { status: "required" }
  | { status: "acknowledged"; reason: string; ackedAt: string };

/** Never errors: no session, or a session with no compliance record, both
 *  report "required" — from the caller's perspective, compliance isn't met
 *  either way. */
export function complianceStatusFor(cookieHeader: string | undefined): ComplianceStatusBody {
  const session = sessionFor(cookieHeader);
  if (!session?.compliance) return { status: "required" };
  return { status: "acknowledged", reason: session.compliance.reason, ackedAt: session.compliance.ackedAt };
}

/** Clears just the compliance field off the current session — the user stays
 *  logged in, but must go through the compliance flow again before their next
 *  extraction. The exact parallel of endSession, narrowed to one field. */
export function clearCompliance(cookieHeader: string | undefined): void {
  const session = sessionFor(cookieHeader);
  if (session) delete session.compliance;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/auth.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add mock-server/auth.ts tests/mock-server/auth.test.ts
git commit -m "feat(mock): add compliance session/token logic; generalize the binding-cookie helpers for reuse by both flows"
```

---

### Task 4: `mock-server/audit.ts` (new) + `mock-server/index.ts` — compliance routes and query gate

**Files:**
- Create: `mock-server/audit.ts`
- Test: `tests/mock-server/audit.test.ts`
- Modify: `mock-server/index.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: everything from Task 3 (`mock-server/auth.ts`).
- Produces: `AuditEntry { name: string; reason: string; timestamp: string }`, `logQueryAudit(name: string, reason: string): void`, `auditLogSnapshot(): AuditEntry[]` — consumed only within this task (`mock-server/index.ts`'s `POST /api/query` handler).
- No dedicated test for the `mock-server/index.ts` route changes (route handlers untested, per convention) — verified by manual curl walkthrough (Step 5) and the full mock-server test suite (Step 6).

- [ ] **Step 1: Write the failing test for `mock-server/audit.ts`**

Create `tests/mock-server/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { logQueryAudit, auditLogSnapshot } from "../../mock-server/audit";

describe("audit log", () => {
  it("appends an entry with the given name and reason, and a timestamp", () => {
    const before = auditLogSnapshot().length;
    logQueryAudit("demo.user", "investigating incident #123");
    const after = auditLogSnapshot();
    expect(after.length).toBe(before + 1);
    const entry = after[after.length - 1]!;
    expect(entry.name).toBe("demo.user");
    expect(entry.reason).toBe("investigating incident #123");
    expect(typeof entry.timestamp).toBe("string");
    expect(Number.isNaN(new Date(entry.timestamp).getTime())).toBe(false);
  });

  it("auditLogSnapshot returns a copy, not the live array", () => {
    const snapshot = auditLogSnapshot();
    snapshot.push({ name: "x", reason: "y", timestamp: "z" });
    expect(auditLogSnapshot().length).not.toBe(snapshot.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mock-server/audit.test.ts`
Expected: FAIL — `mock-server/audit.ts` doesn't exist yet.

- [ ] **Step 3: Create `mock-server/audit.ts`**

```ts
export interface AuditEntry {
  name: string;
  reason: string;
  timestamp: string;
}

/**
 * Dev-only stand-in for forwarding a per-extraction audit entry to a real
 * audit/compliance service over the network. This in-memory array resets on
 * every process restart and is never actually sent anywhere — production
 * needs a real, durable audit store and a real network call (see the design
 * spec's §7).
 */
const AUDIT_LOG: AuditEntry[] = [];

/** Called once per successful POST /api/query — see mock-server/index.ts. */
export function logQueryAudit(name: string, reason: string): void {
  AUDIT_LOG.push({ name, reason, timestamp: new Date().toISOString() });
}

export function auditLogSnapshot(): AuditEntry[] {
  return [...AUDIT_LOG];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mock-server/audit.test.ts`
Expected: PASS

- [ ] **Step 5: Update `mock-server/index.ts`**

Update the import from `./auth` to add the new exports:

```ts
import {
  startLogin,
  issueFakeCode,
  exchangeCodeForSession,
  sessionFor,
  endSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  loginStateCookieHeader,
  clearLoginStateCookieHeader,
  loginStateFromCookie,
  startCompliance,
  issueFakeComplianceToken,
  exchangeComplianceToken,
  complianceStatusFor,
  clearCompliance,
  complianceStateCookieHeader,
  clearComplianceStateCookieHeader,
  complianceStateFromCookie,
} from "./auth";
import { logQueryAudit } from "./audit";
```

Add a form-body parser near the existing `readJson`:

```ts
/** Parses an application/x-www-form-urlencoded request body — the mock
 *  compliance page's form POST, parallel to readJson for the JSON routes. */
async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
```

Add an HTML-attribute escaper and the mock compliance form page builder, near `mockIdpAuthorizePage`:

```ts
/** `state` is always a randomToken() output (base64url: [A-Za-z0-9_-]), so it
 *  can never actually contain an HTML-special character — this escaping is a
 *  cheap defensive habit, not a response to a real exploitable input. */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Dev-only stand-in for a real compliance/audit service's submission form.
 *  Server-rendered HTML — never bundled by Vite, never touches dist/. */
function mockComplianceSubmitPage(state: string): string {
  return `<!doctype html>
<html>
  <head><title>Mock Compliance Logging Service</title></head>
  <body style="font-family: sans-serif; max-width: 28rem; margin: 4rem auto;">
    <h1>Compliance Logging</h1>
    <p>This stands in for a real internal compliance/audit service during local development.</p>
    <form method="POST" action="/mock-compliance/submit">
      <input type="hidden" name="state" value="${escapeHtmlAttr(state)}" />
      <label for="reason">Reason for this data extraction:</label><br/>
      <input type="text" id="reason" name="reason" required style="width:100%;margin:0.5rem 0;" />
      <button type="submit">Submit</button>
    </form>
  </body>
</html>`;
}
```

Add the new routes, right after the existing `POST /api/auth/logout` block and before `POST /api/stats`:

```ts
    if (req.method === "GET" && url.pathname === "/api/compliance/start") {
      const session = sessionFor(req.headers.cookie);
      if (!session) {
        sendJson(res, 401, { error: "Not authenticated." });
        return;
      }
      const state = startCompliance();
      res.writeHead(302, {
        Location: `/mock-compliance/submit?state=${encodeURIComponent(state)}`,
        "Set-Cookie": complianceStateCookieHeader(state),
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/mock-compliance/submit") {
      const state = url.searchParams.get("state") ?? "";
      sendHtml(res, 200, mockComplianceSubmitPage(state));
      return;
    }
    if (req.method === "POST" && url.pathname === "/mock-compliance/submit") {
      const form = await readFormBody(req);
      const state = form.get("state") ?? "";
      const reason = form.get("reason") ?? "";
      const token = issueFakeComplianceToken(reason);
      res.writeHead(302, {
        Location: `/api/compliance/callback?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`,
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/compliance/callback") {
      const token = url.searchParams.get("token") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const boundState = complianceStateFromCookie(req.headers.cookie);
      if (boundState !== state) {
        sendJson(res, 400, { error: "Invalid or expired compliance attempt." });
        return;
      }
      const outcome = exchangeComplianceToken(token, state, req.headers.cookie);
      if (!outcome.ok) {
        sendJson(res, 400, { error: outcome.error });
        return;
      }
      res.writeHead(302, {
        Location: "/?resume=1",
        "Set-Cookie": clearComplianceStateCookieHeader(),
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/compliance/status") {
      sendJson(res, 200, complianceStatusFor(req.headers.cookie));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/compliance/invalidate") {
      clearCompliance(req.headers.cookie);
      res.writeHead(204);
      res.end();
      return;
    }
```

Update the existing `GET /api/auth/callback` route's success redirect — find:

```ts
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": [sessionCookieHeader(outcome.sessionId), clearLoginStateCookieHeader()],
      });
```

Change `Location: "/"` to `Location: "/?resume=1"`:

```ts
      res.writeHead(302, {
        Location: "/?resume=1",
        "Set-Cookie": [sessionCookieHeader(outcome.sessionId), clearLoginStateCookieHeader()],
      });
```

(This lets the frontend restore a preserved query after a plain login too, not just after compliance — see Task 8.)

Update `POST /api/query`'s handler to add the compliance gate and the audit call. Find:

```ts
    if (req.method === "POST" && url.pathname === "/api/query") {
      const session = sessionFor(req.headers.cookie);
      if (!session) {
        sendJson(res, 401, { error: "Log in to preview data." });
        return;
      }
      const body = (await readJson(req)) as {
        query?: JsonNode;
        databases?: string[];
        page?: number;
        pageSize?: number;
      };
      if (badQuery(body)) {
        sendJson(res, 400, { error: "Body must include a `query` tree." });
        return;
      }
      if (badDatabases(body)) {
        sendJson(res, 400, { error: "Select at least one database." });
        return;
      }
      const query = body.query as JsonNode;
      const ids = body.databases as string[];

      const scoped = filterByDatabases(ROWS, ids);
      const matchingIds = scoped.filter((r) => matches(query, r)).map((r) => r.id);
      const entrysets = matchingIds
        .map((id) => ENTRYSETS[String(id)])
        .filter((e): e is Entryset => e !== undefined)
        .slice(0, 25);
      sendJson(res, 200, { entrysets });
      return;
    }
```

Replace with:

```ts
    if (req.method === "POST" && url.pathname === "/api/query") {
      const session = sessionFor(req.headers.cookie);
      if (!session) {
        sendJson(res, 401, { error: "Log in to preview data." });
        return;
      }
      if (!session.compliance) {
        sendJson(res, 403, { error: "Compliance acknowledgment required." });
        return;
      }
      const body = (await readJson(req)) as {
        query?: JsonNode;
        databases?: string[];
        page?: number;
        pageSize?: number;
      };
      if (badQuery(body)) {
        sendJson(res, 400, { error: "Body must include a `query` tree." });
        return;
      }
      if (badDatabases(body)) {
        sendJson(res, 400, { error: "Select at least one database." });
        return;
      }
      const query = body.query as JsonNode;
      const ids = body.databases as string[];

      const scoped = filterByDatabases(ROWS, ids);
      const matchingIds = scoped.filter((r) => matches(query, r)).map((r) => r.id);
      const entrysets = matchingIds
        .map((id) => ENTRYSETS[String(id)])
        .filter((e): e is Entryset => e !== undefined)
        .slice(0, 25);
      logQueryAudit(session.user.name, session.compliance.reason);
      sendJson(res, 200, { entrysets });
      return;
    }
```

- [ ] **Step 6: Update `vite.config.ts`**

Find:

```ts
    // /api/auth/login 302s the browser (a real navigation, not a fetch) to
    // /mock-idp/... on this same origin — that redirect target must be proxied
    // too, or the dev server serves the SPA shell instead of the mock IdP page.
    proxy: { "/api": "http://localhost:3001", "/mock-idp": "http://localhost:3001" },
```

Replace with:

```ts
    // /api/auth/login and /api/compliance/start both 302 the browser (a real
    // navigation, not a fetch) to a mock-*/... path on this same origin — each
    // redirect target must be proxied too, or the dev server serves the SPA
    // shell instead of the mock service's page.
    proxy: {
      "/api": "http://localhost:3001",
      "/mock-idp": "http://localhost:3001",
      "/mock-compliance": "http://localhost:3001",
    },
```

- [ ] **Step 7: Manually verify the full round trip**

Run: `npm run mock` (check first whether port 3001 is already in use by another worktree's process — if so, follow the same non-destructive workaround as before: a temporary, uncommitted port override for verification only, reverted before committing; never kill a process from another worktree). In another terminal, using a cookie jar:

```bash
# Log in first (reuses the existing OAuth flow) — see the OAuth PR's plan for
# the full walkthrough; abbreviated here since only the NEW behavior matters:
curl -s -c /tmp/cookies.txt "http://localhost:3001/api/auth/login" -o /dev/null -w "%{redirect_url}\n"
# ... follow the mock-idp redirect chain as before, ending with a session cookie in /tmp/cookies.txt ...

# Confirm the callback now redirects to /?resume=1, not bare /:
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -i "http://localhost:3001/api/auth/callback?code=PASTE_CODE&state=PASTE_STATE" | grep Location
```
Expected: `Location: /?resume=1`.

```bash
# Authenticated but no compliance yet — /api/query should 403:
curl -s -i -b /tmp/cookies.txt -X POST "http://localhost:3001/api/query" -H 'content-type: application/json' -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha"]}'
```
Expected: `HTTP/1.1 403`, `{"error":"Compliance acknowledgment required."}`.

```bash
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt "http://localhost:3001/api/compliance/start" -o /dev/null -w "%{redirect_url}\n"
```
Expected: `/mock-compliance/submit?state=...`.

```bash
STATE="<paste the state from above>"
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt "http://localhost:3001/mock-compliance/submit?state=$STATE"
```
Expected: the compliance form HTML, with the `state` embedded in a hidden input.

```bash
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -i -X POST "http://localhost:3001/mock-compliance/submit" --data-urlencode "state=$STATE" --data-urlencode "reason=investigating incident #123" | grep Location
```
Expected: `Location: /api/compliance/callback?token=...&state=...`.

```bash
TOKEN="<paste the token>"
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -i "http://localhost:3001/api/compliance/callback?token=$TOKEN&state=$STATE" | grep -E "Location|Set-Cookie"
```
Expected: `Location: /?resume=1`, a `Set-Cookie` clearing `qb_compliance_state`.

```bash
curl -s -b /tmp/cookies.txt "http://localhost:3001/api/compliance/status"
```
Expected: `{"status":"acknowledged","reason":"investigating incident #123","ackedAt":"..."}`.

```bash
curl -s -i -b /tmp/cookies.txt -X POST "http://localhost:3001/api/query" -H 'content-type: application/json' -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha"]}'
```
Expected: `HTTP/1.1 200`, `{"entrysets":[...]}`.

```bash
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST -i "http://localhost:3001/api/compliance/invalidate" | head -3
curl -s -b /tmp/cookies.txt "http://localhost:3001/api/compliance/status"
```
Expected: `204` from invalidate, then `{"status":"required"}` from status afterward.

```bash
curl -s -i -b /tmp/cookies.txt -X POST "http://localhost:3001/api/query" -H 'content-type: application/json' -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha"]}'
```
Expected: `HTTP/1.1 403` again (compliance was invalidated, session is still valid).

Stop the mock server when done. Clean up: `rm -f /tmp/cookies.txt` (and any temporary port-override file, if one was needed).

- [ ] **Step 8: Run the full mock-server test suite**

Run: `npx vitest run tests/mock-server/`
Expected: PASS (all tests, including the new `audit.test.ts` and Task 3's additions to `auth.test.ts`).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add mock-server/audit.ts mock-server/index.ts vite.config.ts tests/mock-server/audit.test.ts
git commit -m "$(cat <<'EOF'
feat(mock): wire the compliance-logging round trip, gate POST /api/query on it too

Production note: GET /api/compliance/start, GET /api/compliance/callback,
GET /api/compliance/status, and POST /api/compliance/invalidate are all
new REAL requirements for the production backend team — none of this
exists yet. The mock-compliance/* routes, mock-server/audit.ts's
in-memory array, and mock-server/auth.ts's compliance session fields are
dev-only scaffolding; none of it is reusable in production. See
docs/superpowers/specs/2026-09-23-compliance-logging-design.md §7 for the
full list.
EOF
)"
```

---

### Task 5: `src/state.ts` — `AppState.compliance`

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Produces: `AppState.compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null }` — consumed by Task 7 (`complianceStatus.ts`), Task 8 (`main.ts`), Task 9 (`dataPreview.ts`).

**This task does NOT touch `canRunQuery`** — same reasoning as `auth`: this field is display-only.

- [ ] **Step 1: Write the failing test**

Add one assertion to the existing `"initialState has an empty AND-group query and idle panels"` test in `tests/state.test.ts`:

```ts
  it("initialState has an empty AND-group query and idle panels", () => {
    expect(initialState.query).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(initialState.stats.status).toBe("idle");
    expect(initialState.preview.status).toBe("idle");
    expect(initialState.auth.status).toBe("loading");
    expect(initialState.compliance.status).toBe("loading");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `initialState.compliance` doesn't exist yet.

- [ ] **Step 3: Update `src/state.ts`**

Add to the `AppState` interface, after `auth`:

```ts
  /** Compliance acknowledgment for this session, if any — populated once at
   *  startup via GET /api/compliance/status. Display-only, same as `auth`:
   *  it drives the top-menu widget and an advisory hint, never gating logic. */
  compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null };
```

Add to `initialState`, after `auth`:

```ts
  compliance: { status: "loading", reason: null, ackedAt: null },
```

(`canRunQuery`, `createStore`, `Listener`, `store` are all unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat(state): add AppState.compliance (display-only, same as auth)"
```

---

### Task 6: `src/util/pendingQuery.ts` — preserve the query across a redirect

**Files:**
- Create: `src/util/pendingQuery.ts`
- Test: `tests/util/pendingQuery.test.ts`

**Interfaces:**
- Produces: `savePendingQuery(query: QueryNode, selectedDatabaseIds: string[]): void`, `takePendingQuery(): { query: QueryNode; selectedDatabaseIds: string[] } | null` — consumed by Task 8 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Create `tests/util/pendingQuery.test.ts`. This repo's Vitest config runs in a plain Node environment (no DOM, no `sessionStorage` global) — stub it the same way `tests/api/client.test.ts` stubs `fetch`, with `vi.stubGlobal`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { savePendingQuery, takePendingQuery } from "../../src/util/pendingQuery";
import { emptyQuery } from "../../src/query/tree";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe("pendingQuery", () => {
  it("round-trips a saved query", () => {
    const query = emptyQuery();
    savePendingQuery(query, ["alpha", "beta"]);
    expect(takePendingQuery()).toEqual({ query, selectedDatabaseIds: ["alpha", "beta"] });
  });

  it("returns null when nothing was saved", () => {
    expect(takePendingQuery()).toBeNull();
  });

  it("clears the entry after taking it — a second take returns null", () => {
    savePendingQuery(emptyQuery(), ["alpha"]);
    takePendingQuery();
    expect(takePendingQuery()).toBeNull();
  });

  it("returns null for corrupted JSON instead of throwing", () => {
    sessionStorage.setItem("qb:pending-query", "{not valid json");
    expect(takePendingQuery()).toBeNull();
  });

  it("returns null when sessionStorage itself is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => savePendingQuery(emptyQuery(), ["alpha"])).not.toThrow();
    expect(takePendingQuery()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/util/pendingQuery.test.ts`
Expected: FAIL — `src/util/pendingQuery.ts` doesn't exist yet.

- [ ] **Step 3: Create `src/util/pendingQuery.ts`**

```ts
import type { QueryNode } from "../query/types";

const KEY = "qb:pending-query";

interface PendingQuery {
  query: QueryNode;
  selectedDatabaseIds: string[];
}

/**
 * Preserves the in-progress query across the full-page redirect into the
 * login or compliance flow — a lost query tree would otherwise force the
 * user to rebuild it from scratch after logging in or writing a compliance
 * reason. sessionStorage only: never sent through the backend or any
 * redirect URL.
 */
export function savePendingQuery(query: QueryNode, selectedDatabaseIds: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ query, selectedDatabaseIds }));
  } catch {
    // Storage unavailable (private browsing, disabled site data) — nothing to
    // preserve, not fatal; the user just rebuilds the query if this happens.
  }
}

/**
 * Reads and clears the saved query, if any. A missing key, a storage error,
 * and corrupted JSON are all treated the same: nothing to restore.
 */
export function takePendingQuery(): PendingQuery | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as PendingQuery;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/util/pendingQuery.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/util/pendingQuery.ts tests/util/pendingQuery.test.ts
git commit -m "feat(util): add pendingQuery — preserve the query across a login/compliance redirect"
```

---

### Task 7: Top-menu compliance widget (`layout.ts` slot + new `complianceStatus.ts`)

**Files:**
- Modify: `src/ui/layout.ts`
- Create: `src/ui/complianceStatus.ts`

**Interfaces:**
- Consumes: `AppState.compliance` (Task 5).
- Produces: `renderComplianceStatus(state: AppState): void`, `wireComplianceStatus(container: HTMLElement, onInvalidate: () => void): void` — consumed by Task 8 (`main.ts`).
- No dedicated tests (panel/shell files have none, per convention) — verified by `npx tsc --noEmit` and Task 11's manual smoke test.

- [ ] **Step 1: Add the `data-panel="compliance"` slot to the shell**

In `src/ui/layout.ts`'s `renderShell`, find:

```ts
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
        <div class="item" data-panel="auth"></div>
```

Add the new slot as the last item in the right menu:

```ts
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
        <div class="item" data-panel="auth"></div>
        <div class="item" data-panel="compliance"></div>
```

Update the `els` type and its assignment:

```ts
let els: {
  docs: HTMLElement;
  dbpicker: HTMLElement;
  center: HTMLElement;
  stats: HTMLElement;
  preview: HTMLElement;
  auth: HTMLElement;
  compliance: HTMLElement;
};
```

```ts
  els = {
    docs: root.querySelector<HTMLElement>('[data-panel="docs"]')!,
    dbpicker: root.querySelector<HTMLElement>('[data-panel="dbpicker"]')!,
    center: root.querySelector<HTMLElement>('[data-panel="center"]')!,
    stats: root.querySelector<HTMLElement>('[data-panel="stats"]')!,
    preview: root.querySelector<HTMLElement>('[data-panel="preview"]')!,
    auth: root.querySelector<HTMLElement>('[data-panel="auth"]')!,
    compliance: root.querySelector<HTMLElement>('[data-panel="compliance"]')!,
  };
```

- [ ] **Step 2: Create `src/ui/complianceStatus.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/layout.ts` or `src/ui/complianceStatus.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/layout.ts src/ui/complianceStatus.ts
git commit -m "feat(ui): add the top-menu compliance-acknowledgment widget and its shell slot"
```

---

### Task 8: `src/main.ts` — reactive gating, `resume=1` handling, panel wiring

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ApiError` (already in `client.ts`), `getComplianceStatus`/`invalidateCompliance` (Task 2), `AppState.compliance` (Task 5), `savePendingQuery`/`takePendingQuery` (Task 6), `renderComplianceStatus`/`wireComplianceStatus` (Task 7).
- No dedicated test (`main.ts` has none, per convention). Verified by `npx tsc --noEmit` and Task 11's manual smoke test.

- [ ] **Step 1: Update the import lines**

Change:

```ts
import {
  ApiError,
  getDatabases,
  getIndividuals,
  getMe,
  getSchema,
  getStats,
  logout,
  runQuery,
} from "./api/client";
```

to:

```ts
import {
  ApiError,
  getComplianceStatus,
  getDatabases,
  getIndividuals,
  getMe,
  getSchema,
  getStats,
  invalidateCompliance,
  logout,
  runQuery,
} from "./api/client";
```

Add, alongside the other `./ui/*` imports:

```ts
import { renderComplianceStatus, wireComplianceStatus } from "./ui/complianceStatus";
```

Add, alongside the other non-`./ui` imports:

```ts
import { savePendingQuery, takePendingQuery } from "./util/pendingQuery";
```

- [ ] **Step 2: Rewrite `runPreview` for reactive 401/403 handling**

Replace the entire function:

```ts
function runPreview(): void {
  if (store.getState().auth.status !== "authenticated") return;
  // page/pageSize are sent for API-shape stability; the response is capped at
  // 25 entrysets regardless (see EntrysetsResponse in api/types.ts).
  runGuarded(
    (query, databases) => runQuery(query, databases, 1, PAGE_SIZE),
    () => store.setState({ preview: { status: "loading", data: null, error: null } }),
    (data) => store.setState({ preview: { status: "ok", data, error: null } }),
    (err) => {
      if (err instanceof ApiError && err.status === 401) {
        // The session ended after Run was enabled (a session-store restart in dev, a
        // real expiry in production) — drop back to the anonymous UI instead of a
        // misleading "authenticated" top menu next to a permission error.
        store.setState({
          auth: { status: "anonymous", user: null },
          preview: { status: "idle", data: null, error: null },
        });
        return;
      }
      store.setState({ preview: { status: "error", data: null, error: errorMessage(err) } });
    },
  );
}
```

with:

```ts
function runPreview(): void {
  // No longer gated on auth.status: Run always genuinely attempts the request now,
  // and reacts to whatever comes back. A 401 (not authenticated) or 403
  // (authenticated, some requirement unmet — e.g. compliance) saves the current
  // query/selection and navigates into the matching flow. This generalizes to any
  // future protected endpoint that returns the same status codes under the same
  // conditions, without new frontend wiring per endpoint.
  runGuarded(
    (query, databases) => runQuery(query, databases, 1, PAGE_SIZE),
    () => store.setState({ preview: { status: "loading", data: null, error: null } }),
    (data) => store.setState({ preview: { status: "ok", data, error: null } }),
    (err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        const s = store.getState();
        savePendingQuery(s.query, s.selectedDatabaseIds);
        window.location.href = err.status === 401 ? "/api/auth/login" : "/api/compliance/start";
        return;
      }
      store.setState({ preview: { status: "error", data: null, error: errorMessage(err) } });
    },
  );
}
```

(This intentionally removes the local "drop back to anonymous UI" `setState` the OAuth PR added for a 401 — the browser is about to navigate away entirely, so there's nothing left to update locally; landing back at `/?resume=1` re-fetches fresh `auth`/`compliance` status from scratch in the startup `Promise.all` below.)

- [ ] **Step 3: Revert `syncRunButton`**

Replace:

```ts
function syncRunButton(state = store.getState()): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu="run"]');
  if (!btn) return;
  btn.disabled = !(
    canRunQuery(state) &&
    state.preview.status !== "loading" &&
    state.auth.status === "authenticated"
  );
}
```

with:

```ts
function syncRunButton(state = store.getState()): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu="run"]');
  if (!btn) return;
  btn.disabled = !(canRunQuery(state) && state.preview.status !== "loading");
}
```

- [ ] **Step 4: Reset `compliance` on logout, and add `onInvalidateCompliance`**

Replace `onLogout`:

```ts
function onLogout(): void {
  logout()
    .then(() => {
      store.setState({
        auth: { status: "anonymous", user: null },
        preview: { status: "idle", data: null, error: null },
      });
    })
    .catch((err) => {
      // Best-effort: nothing more actionable to show beyond the button
      // still being there for the user to try again.
      console.error("Logout failed:", errorMessage(err));
    });
}
```

with:

```ts
function onLogout(): void {
  logout()
    .then(() => {
      // Compliance is piggybacked on the session server-side, so it's gone too
      // once the session ends — reset the local display state to match.
      store.setState({
        auth: { status: "anonymous", user: null },
        compliance: { status: "required", reason: null, ackedAt: null },
        preview: { status: "idle", data: null, error: null },
      });
    })
    .catch((err) => {
      // Best-effort: nothing more actionable to show beyond the button
      // still being there for the user to try again.
      console.error("Logout failed:", errorMessage(err));
    });
}

function onInvalidateCompliance(): void {
  invalidateCompliance()
    .then(() => {
      store.setState({
        compliance: { status: "required", reason: null, ackedAt: null },
        preview: { status: "idle", data: null, error: null },
      });
    })
    .catch((err) => {
      console.error("Invalidate compliance failed:", errorMessage(err));
    });
}
```

- [ ] **Step 5: Update `panelRenderers`**

Find the entry that watches `"auth"` alongside the preview keys:

```ts
  {
    keys: ["preview", "query", "issues", "schema", "selectedDatabaseIds", "individuals", "auth"],
    run: (s) => {
      renderDataPreview(s);
      syncRunButton(s);
    },
  },
```

Add `"compliance"` (kept for `renderDataPreview`'s advisory hint — see Task 9 — even though `syncRunButton` no longer reads either):

```ts
  {
    keys: [
      "preview",
      "query",
      "issues",
      "schema",
      "selectedDatabaseIds",
      "individuals",
      "auth",
      "compliance",
    ],
    run: (s) => {
      renderDataPreview(s);
      syncRunButton(s);
    },
  },
```

Add a new entry for the compliance widget, next to the existing `auth` entry:

```ts
  {
    keys: ["compliance"],
    run: (s) => {
      renderComplianceStatus(s);
      wireComplianceStatus(panelEls().compliance, onInvalidateCompliance);
    },
  },
```

- [ ] **Step 6: Add the initial render call**

Alongside the other initial `render*(store.getState())` calls:

```ts
renderComplianceStatus(store.getState()); // "" while compliance.status is "loading"
```

- [ ] **Step 7: Handle `?resume=1` and restore the pending query in startup**

Replace the entire startup block:

```ts
renderDatabasePicker(store.getState()); // "" while databases is null
renderQueryBuilder(store.getState()); // initial loader (centre panel spinner during schema fetch)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDataPreview(store.getState()); // initial idle message
syncRunButton(); // top-menu Run starts disabled
renderDocsSidebar(store.getState()); // initial loader
renderAuthStatus(store.getState()); // "" while auth.status is "loading"
Promise.all([getSchema(), getDatabases(), getIndividuals(), getMe()])
  .then(([schema, dbResp, individuals, user]) => {
    const seeded = addChild(
      store.getState().query as Group,
      (store.getState().query as Group).id,
      newCondition(),
    );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases: dbResp.databases,
      individuals,
      selectedDatabaseIds: dbResp.databases.map((d) => d.id),
      query: seeded,
      issues,
      auth: { status: user ? "authenticated" : "anonymous", user },
    });
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${errorMessage(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
```

with:

```ts
/**
 * `?resume=1` marks a load as the direct return-hop from the login or
 * compliance callback (both redirect here) — the ONE signal that tells this
 * load to restore a saved query, as opposed to a generic revisit finding a
 * stale leftover sessionStorage entry from an abandoned attempt. Stripped
 * from the URL immediately so a manual refresh doesn't re-trigger this.
 */
function consumeResumeParam(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("resume") !== "1") return false;
  url.searchParams.delete("resume");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}

const pending = consumeResumeParam() ? takePendingQuery() : null;

renderDatabasePicker(store.getState()); // "" while databases is null
renderQueryBuilder(store.getState()); // initial loader (centre panel spinner during schema fetch)
renderStatsPanel(store.getState()); // initial state ("" while schema is null)
renderDataPreview(store.getState()); // initial idle message
syncRunButton(); // top-menu Run starts disabled
renderDocsSidebar(store.getState()); // initial loader
renderAuthStatus(store.getState()); // "" while auth.status is "loading"
renderComplianceStatus(store.getState()); // "" while compliance.status is "loading"
Promise.all([getSchema(), getDatabases(), getIndividuals(), getMe(), getComplianceStatus()])
  .then(([schema, dbResp, individuals, user, complianceStatus]) => {
    // A restored query replaces the normal empty-condition seed entirely — it
    // already has whatever conditions the user built before being redirected.
    const seeded = pending
      ? pending.query
      : addChild(
          store.getState().query as Group,
          (store.getState().query as Group).id,
          newCondition(),
        );
    // Validate in the SAME setState: this seed bypasses onQueryChange, so without
    // it `issues` would stay [] and syncRunButton would enable Run on the empty
    // seeded condition. Every database is selected by default, unless restored.
    const issues = validateQuery(seeded, { fields: schema.fields, operators: schema.operators });
    store.setState({
      schema,
      databases: dbResp.databases,
      individuals,
      selectedDatabaseIds: pending ? pending.selectedDatabaseIds : dbResp.databases.map((d) => d.id),
      query: seeded,
      issues,
      auth: { status: user ? "authenticated" : "anonymous", user },
      compliance:
        complianceStatus.status === "acknowledged"
          ? {
              status: "acknowledged",
              reason: complianceStatus.reason ?? null,
              ackedAt: complianceStatus.ackedAt ?? null,
            }
          : { status: "required", reason: null, ackedAt: null },
    });
  })
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${errorMessage(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/main.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): react to 401/403 generically (login/compliance redirects); preserve the query via ?resume=1, no auto-retry"
```

---

### Task 9: `src/ui/dataPreview.ts` — idle-state compliance hint

**Files:**
- Modify: `src/ui/dataPreview.ts`

**Interfaces:**
- Consumes: `AppState.compliance` (Task 5).
- No dedicated test (panel files have none, per convention). Verified by `npx tsc --noEmit` and Task 11's manual smoke test.

- [ ] **Step 1: Add the compliance-required case**

Find:

```ts
  if (p.status === "idle") {
    // onQueryChange nulls preview.data in the same setState that writes the query,
    // so "idle" always means "nothing current" — never run yet, or edited since.
    if (state.auth.status === "anonymous") {
      paint(
        el,
        `<h4 class="ui header">Data preview</h4><div class="ui info message">Log in to preview data. <a href="/api/auth/login">Log in</a></div>`,
      );
      return;
    }
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui info message">Press <b>Run / Refresh</b> to load sample entrysets.</div>`,
    );
    return;
  }
```

Replace with:

```ts
  if (p.status === "idle") {
    // onQueryChange nulls preview.data in the same setState that writes the query,
    // so "idle" always means "nothing current" — never run yet, or edited since.
    // Both hints below are advisory only — auth/compliance are display-only state;
    // the actual gate is main.ts's reactive 401/403 handling on the real request.
    if (state.auth.status === "anonymous") {
      paint(
        el,
        `<h4 class="ui header">Data preview</h4><div class="ui info message">Log in to preview data. <a href="/api/auth/login">Log in</a></div>`,
      );
      return;
    }
    if (state.compliance.status === "required") {
      paint(
        el,
        `<h4 class="ui header">Data preview</h4><div class="ui info message">Confirm compliance to preview data. <a href="/api/compliance/start">Start compliance check</a></div>`,
      );
      return;
    }
    paint(
      el,
      `<h4 class="ui header">Data preview</h4><div class="ui info message">Press <b>Run / Refresh</b> to load sample entrysets.</div>`,
    );
    return;
  }
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/dataPreview.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/dataPreview.ts
git commit -m "feat(ui): data preview shows a compliance prompt when logged in but not yet acknowledged"
```

---

### Task 10: `docs/ARCHITECTURE.md` — sync

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: §1 screen layout and non-goals**

Find the ASCII top-menu line:

```
│  top ui menu: app title ············· [☰ Docs]  [Run]  [Log in] │
```

Add the compliance widget:

```
│  top ui menu: app title ····· [☰ Docs] [Run] [Log in] [Compliance] │
```

Find the "Non-goals (for now)" bullet:

```
- Saving / sharing / restoring queries (URL state, persistence).
```

Add a clarifying parenthetical distinguishing it from the new narrow mechanism:

```
- Saving / sharing / restoring queries (URL state, persistence) — the
  `?resume=1` sessionStorage handoff in `main.ts` is a narrow exception,
  scoped only to surviving the login/compliance redirect round trip; it is
  not general query persistence.
```

- [ ] **Step 2: §4 directory layout**

Add a bullet after `authStatus.ts`'s entry:

```
    complianceStatus.ts render + wiring for the top-menu compliance-acknowledgment
                       widget (its own panel, data-panel="compliance"). See §9.
```

Add a bullet in the `util/` subsection (or create one if it doesn't exist yet — check the live file) for `pendingQuery.ts`:

```
  pendingQuery.ts      Save/restore the in-progress query across the login or
                       compliance redirect (sessionStorage only). See §7 of the
                       compliance-logging design spec.
```

Add a bullet in the `mock-server/` subsection after `auth.ts`'s entry:

```
  audit.ts             Per-query audit-forwarding stand-in: an in-memory list
                       appended to on every successful POST /api/query. Dev-only
                       — production needs a real network call to a real audit
                       service. See §10.
```

Update `main.ts`'s one-line description to mention compliance:

```
  main.ts              Bootstrap: import setup-jquery + Fomantic; render layout shell; load schema/databases/individuals/auth/compliance; wire subscriptions; hold the refreshStats / runPreview orchestrators; reacts to 401/403 generically to trigger the login/compliance redirects.
```

- [ ] **Step 3: §5 `AppState`**

Add, after the `auth` field:

```ts
  /** Compliance acknowledgment for this session, if any — populated once at
   *  startup via GET /api/compliance/status. Display-only, same as `auth`. */
  compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null };
```

- [ ] **Step 4: §7 API contract**

Read the file to find the Auth subsection's paragraph:

```markdown
Only `POST /api/query` requires a session (`401 { error }` without one) —
everything else (`schema`, `databases`, `individuals`, `stats`) stays
anonymous-accessible. `canRunQuery` is NOT auth-aware; the Run button and
`runPreview()` layer the auth check on separately (§5, §9).
```

Replace with:

```markdown
`POST /api/query` requires both a session (`401 { error }` without one) and
a compliance acknowledgment (`403 { error }` without one) — everything else
(`schema`, `databases`, `individuals`, `stats`) stays anonymous-accessible.
`canRunQuery` is NOT auth- or compliance-aware; neither is `syncRunButton` —
Run always genuinely attempts the request, and `main.ts` reacts to whatever
status code comes back (§5, §9). Any future protected endpoint gets both
redirect flows for free as long as it returns `401`/`403` under the same
conditions.
```

Insert a new subsection immediately after it, before `### Errors`:

```markdown
### Compliance (`GET /api/compliance/start`, `GET /api/compliance/callback`, `GET /api/compliance/status`, `POST /api/compliance/invalidate`)

A second redirect flow, structurally identical to Auth above, gating data
extraction on a user-provided reason: the compliance service's redirect URI
also points at the backend, so the frontend never handles its `state` or
token either. The acknowledgment piggybacks on the *same* session as
Auth — no second session-identifying cookie.

```ts
interface ComplianceStatus {
  status: "required" | "acknowledged";
  reason?: string;
  ackedAt?: string;
}
```

- `GET /api/compliance/start` — requires a session (`401` without one);
  starts the flow, redirects to the compliance service.
- `GET /api/compliance/callback?token=&state=` — exchanges the token
  server-to-server, attaches `{ reason, ackedAt }` to the current session,
  redirects to `/?resume=1`.
- `GET /api/compliance/status` — never errors: `{ status: "required" }` with
  no session or no acknowledgment yet, `{ status: "acknowledged", reason,
  ackedAt }` otherwise.
- `POST /api/compliance/invalidate` — clears just the compliance field off
  the session (stays logged in), `204`.

Every successful `POST /api/query` also appends `{ name, reason, timestamp
}` to an in-memory audit list (`mock-server/audit.ts`) — a dev-only stand-in
for forwarding to a real audit service (§10).
```

- [ ] **Step 5: §9 panels**

Find the "Top menu — `authStatus.ts`" subsection:

```markdown
### Top menu — `authStatus.ts`

Its own panel (`data-panel="auth"`, painted independently). Anonymous shows
a `Log in` link (`GET /api/auth/login` — a real navigation, not a fetch);
authenticated shows the user's name + a `Log out` button. The Run button
(`main.ts`'s `syncRunButton`) additionally requires `auth.status ===
"authenticated"`, on top of its existing `canRunQuery` check — stats stay
anonymous-accessible, only the Run/Refresh preview action is gated.
```

Replace the last sentence (the now-incorrect claim about `syncRunButton`) and add a sibling subsection:

```markdown
### Top menu — `authStatus.ts`

Its own panel (`data-panel="auth"`, painted independently). Anonymous shows
a `Log in` link (`GET /api/auth/login` — a real navigation, not a fetch);
authenticated shows the user's name + a `Log out` button. **Display only:**
`syncRunButton` does not read `auth.status` — Run always attempts the
request, and `main.ts` reacts to a `401` response by redirecting here (§7).

### Top menu — `complianceStatus.ts`

Its own panel (`data-panel="compliance"`, painted independently of
`authStatus.ts`). "Required" shows a `Start compliance check` link
(`GET /api/compliance/start`); "acknowledged" shows the stored reason (its
`ackedAt` timestamp in a tooltip) + an `Invalidate` button. Also
display-only: `main.ts` reacts to a `403` response by redirecting here,
never a pre-check of this widget's state.
```

Find the "Bottom — `dataPreview.ts`" subsection's opening line — confirm it still reads correctly (`"Run / Refresh` button (disabled while `issues` has errors or while loading — same gating as before)"` — this is unaffected by this change, since it was never auth-aware; leave as-is unless the live file shows otherwise).

- [ ] **Step 6: §10 mock server**

Update the Vite proxy sentence:

```markdown
Dev-only. `npm run mock` starts it; Vite proxies `/api/*`, `/mock-idp/*`, and
`/mock-compliance/*` to it (the latter two because their respective
`GET .../login` / `GET .../start` redirects are real browser navigations,
not fetches — proxying only `/api` would leave those hops unreachable under
`npm run dev`). Plain Node `http`, no Express, heavily commented top to
bottom.
```

Add a new bullet after the `mock-server/auth.ts` bullet (and its login-state-binding-cookie bullet):

```markdown
- `mock-server/auth.ts` also carries the compliance flow's session/token
  logic (`startCompliance`, `issueFakeComplianceToken`,
  `exchangeComplianceToken`, `complianceStatusFor`, `clearCompliance`) and a
  `qb_compliance_state` binding cookie identical in shape to the login one
  — the binding-cookie construction is now a shared, parameterized internal
  helper rather than two copies. Compliance is stored as an optional field
  on the *same* session record as `user`, not a second session.
- `mock-server/audit.ts` stands in for forwarding a per-extraction audit
  entry to a real audit/compliance service: an in-memory array, appended to
  on every successful `POST /api/query`. **Not reusable in production** — a
  real backend needs a real, durable audit store and a real network call.
```

- [ ] **Step 7: §13 changelog**

Add a new row at the end of the table:

```markdown
| 2026-09-23 | Compliance-logging redirect gate: `POST /api/query` now also requires a compliance acknowledgment (`403` without one), gated the same way login is (`401`) — via a second mock-service redirect flow (`mock-server/auth.ts`'s compliance session/token logic + `mock-server/index.ts`'s `/api/compliance/*` and `/mock-compliance/*` routes), the reason attached to the *same* session record rather than a second cookie. The frontend no longer pre-checks `auth`/`compliance` status before allowing Run — `syncRunButton` reverted to its pre-OAuth shape, and `main.ts` reacts generically to a `401`/`403` on the actual request, which will cover any future protected endpoint for free. The in-progress query survives both redirects via a new `src/util/pendingQuery.ts` (`sessionStorage`, restored on a `?resume=1` return-hop) — deliberately with no automatic retry or chaining, so the mechanism can never redirect-loop: the user always clicks Run again to retry. New top-menu widget (`src/ui/complianceStatus.ts`). Every successful extraction is also logged to a dev-only in-memory audit list (`mock-server/audit.ts`) standing in for a real audit-service call. Design: `docs/superpowers/specs/2026-09-23-compliance-logging-design.md`. |
```

- [ ] **Step 8: Update the "Last updated" header**

Find the header near the top of the file:

```markdown
Last updated: 2026-09-23 — OAuth2 authorization-code login added: only
`POST /api/query` requires a session; everything else stays
anonymous-accessible. See §13 for the full changelog entry.
```

Replace with:

```markdown
Last updated: 2026-09-23 — Compliance-logging redirect gate added
alongside OAuth2 login: `POST /api/query` requires both a session and a
compliance acknowledgment (`401`/`403`), each triggering its own redirect
flow; everything else stays anonymous-accessible. See §13 for the full
changelog entry.
```

- [ ] **Step 9: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: describe the compliance-logging redirect gate in ARCHITECTURE.md"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites pass.

- [ ] **Step 3: Lint**

Run: `npm run lint` (the full script, `eslint . && prettier --check .`).
Expected: no errors. Confirm the jQuery and `mock-server` import airlocks from `eslint.config.js` still pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (re-runs typecheck and `check:offline` — confirm the new mock compliance form page, being server-rendered and never bundled, introduces nothing for that guard to catch).

- [ ] **Step 5: Full manual smoke test**

Run: `npm run dev` (check first whether a mock-server process from another worktree already holds port 3001 — if so, follow the same non-destructive workaround pattern established in the OAuth PR rather than killing it). Walk through, driving a real browser if at all possible:

1. Load the app anonymously — confirm the top menu shows "Log in" and no compliance widget content yet; Run is enabled once a query/scope exists (this is new — it was disabled while anonymous before this PR).
2. Build a query, then click Run. Confirm you're redirected through the mock IdP exactly as before, and land back on `/` (URL briefly showing `?resume=1` before it's stripped) with your query and database selection intact — not reset to the default empty condition.
3. Click Run again (now authenticated, no compliance yet). Confirm you're redirected to the "Compliance Logging" mock page, type a reason, submit, and land back on `/` with the query still intact.
4. Click Run a third time. Confirm the data preview loads successfully, and the compliance widget shows your typed reason with an "Invalidate" button.
5. Click "Invalidate". Confirm the widget reverts to "Start compliance check" and the data preview reverts to the "Confirm compliance to preview data" hint.
6. Click Run again — confirm you're redirected into the compliance flow again (not blocked or stuck), complete it, and confirm the query survived again.
7. Click "Log out". Confirm both the auth and compliance widgets reset, and the data preview reverts to the "Log in to preview data" hint.
8. Confirm no console errors throughout, and no unexpected repeated redirects at any point (the core loop-safety property: each redirect only ever happens in direct response to a click).

If you cannot drive a real browser, do as much as you reasonably can via curl with a cookie jar against the running `npm run dev` instance (mirroring Task 4's Step 7 walkthrough, but through the Vite proxy on port 5173 rather than the mock server directly on 3001 — this is important, since Task 4's OAuth-PR predecessor found a real bug this way: the dev proxy not forwarding a mock service's redirect target), and report honestly what you substituted.

- [ ] **Step 6: Final commit (only if any of the above required fixes)**

If Steps 1-5 required any fixups, stage and commit them now with a message describing what verification caught. If everything passed cleanly, there is nothing to commit for this task.
