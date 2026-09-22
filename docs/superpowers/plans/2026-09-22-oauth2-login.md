# OAuth2 Authorization-Code Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth2 authorization-code login, gating only `POST /api/query` (the "Run / Refresh" data preview) — everything else in the app stays usable anonymously.

**Architecture:** The identity provider's redirect URI points at the backend, not the SPA, so the frontend never handles the auth code, CSRF `state`, or tokens — it only ever sees a session cookie's effect via `GET /api/auth/me`. The mock server plays both the backend and a fake, self-contained IdP (a tiny HTML page) so `npm run dev` stays fully offline, consistent with this app's existing LAN-only constraint.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Node's built-in `http` module (mock server), `node:crypto` for session/state/code tokens.

**Spec:** `docs/superpowers/specs/2026-09-22-oauth2-login-design.md`

## Global Constraints

- Node 20.19+ toolchain floor; `tsconfig.json` strict mode.
- No `jquery` import outside `src/ui/fomantic.ts`. `src/**` may not import `mock-server/*`.
- **Only `POST /api/query` requires a session.** `canRunQuery` (in `src/state.ts`) is shared with `refreshStats` (which stays anonymous-accessible) and must NOT be modified to know about auth — the auth requirement is layered on only at the two call sites that gate the Run action specifically (`syncRunButton`, `runPreview`).
- Offline-first: nothing added here may introduce an external-network dependency. The mock IdP page is server-rendered HTML from `mock-server/index.ts` — never bundled by Vite, never touches `dist/`, no interaction with `npm run check:offline`.
- No in-progress-query persistence across the login redirect — an explicit non-goal (matches this repo's existing "no query persistence / URL state" non-goal).
- Vitest unit tests target pure modules only. `src/ui/*.ts` panel files and `mock-server/index.ts`'s route handlers have no dedicated tests, per established convention.
- `docs/ARCHITECTURE.md` is a living document — updated in the same overall change (Task 9).
- **Production note discipline:** anything added to `mock-server/` that a real backend must also implement gets an explicit comment/commit-message flag, per this repo's established pattern (see the design spec §7 for the full list).

---

## File Structure

**Contract & client:**
- Modify: `src/api/types.ts` — add `AuthUser`.
- Modify: `src/api/client.ts` — extract `errorFromResponse`, add `getMe`/`logout`.

**Mock server:**
- Create: `mock-server/auth.ts` — session/state/code logic (pure-ish, testable).
- Modify: `mock-server/index.ts` — new routes (`login`, `mock-idp/authorize[/confirm]`, `callback`, `me`, `logout`); gate `POST /api/query`.

**Frontend state & UI:**
- Modify: `src/state.ts` — `AppState.auth`.
- Modify: `src/ui/layout.ts` — new `data-panel="auth"` slot in the top menu.
- Create: `src/ui/authStatus.ts` — the login/logout widget.
- Modify: `src/main.ts` — wire `getMe`/`logout`, register the new panel, gate the Run button + `runPreview`.
- Modify: `src/ui/dataPreview.ts` — the idle-state hint branches on auth.

**Tests:**
- Modify: `tests/api/client.test.ts`, `tests/state.test.ts`.
- Create: `tests/mock-server/auth.test.ts`.

**Docs:**
- Modify: `docs/ARCHITECTURE.md`.

---

### Task 1: `src/api/types.ts` — `AuthUser`

**Files:**
- Modify: `src/api/types.ts`

**Interfaces:**
- Produces: `AuthUser { name: string }` — consumed by Task 2 (`client.ts`), Task 5 (`state.ts`), Task 6 (`authStatus.ts`).

- [ ] **Step 1: Add the type**

Add this near the top of the file (order relative to the other types doesn't matter — TypeScript doesn't care about declaration order):

```ts
/** Who's logged in, returned by GET /api/auth/me. */
export interface AuthUser {
  name: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (this is an additive, unused-so-far type).

- [ ] **Step 3: Commit**

```bash
git add src/api/types.ts
git commit -m "feat(api): add AuthUser type for GET /api/auth/me"
```

---

### Task 2: `src/api/client.ts` — `getMe`/`logout`

**Files:**
- Modify: `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `AuthUser` (Task 1).
- Produces: `getMe(): Promise<AuthUser | null>` (resolves `null` on a `401` — a normal "not logged in" outcome, not an error — so it can join `main.ts`'s startup `Promise.all` without tripping its fatal-load-failure path), `logout(): Promise<void>`. Both consumed by Task 7 (`main.ts`).

- [ ] **Step 1: Write the failing tests**

Update the import line in `tests/api/client.test.ts`:

```ts
import { getDatabases, getMe, getSchema, getStats, logout, runQuery } from "../../src/api/client";
```

Add these tests to the `describe("api client", ...)` block (anywhere after the existing tests is fine):

```ts
  it("getMe returns the user when logged in", async () => {
    const f = mockFetchOnce(200, { name: "demo.user" });
    vi.stubGlobal("fetch", f);
    const out = await getMe();
    expect(out).toEqual({ name: "demo.user" });
    // getMe() calls fetch(url) with no second argument (unlike request<T>,
    // which always passes init explicitly) — so check just the URL, not the
    // full args array, which would otherwise differ in length from ["/api/auth/me", undefined].
    expect(f.mock.calls[0]![0]).toBe("/api/auth/me");
  });

  it("getMe returns null on 401 rather than throwing", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(401, { error: "Not authenticated." }));
    await expect(getMe()).resolves.toBeNull();
  });

  it("getMe still throws on other non-2xx statuses", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(getMe()).rejects.toThrow("boom");
  });

  it("logout POSTs to /api/auth/logout", async () => {
    const f = mockFetchOnce(200, {});
    vi.stubGlobal("fetch", f);
    await logout();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
  });

  it("logout throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, { error: "boom" }));
    await expect(logout()).rejects.toThrow("boom");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `getMe`/`logout` don't exist yet in `src/api/client.ts`.

- [ ] **Step 3: Update `src/api/client.ts`**

Extract the error-handling logic already inline in `request<T>` into a shared `errorFromResponse` helper (needed by both `request<T>` and the new `getMe`), then add `getMe`/`logout`. Current top of the file:

```ts
import type { QueryNode } from "../query/types";
import type {
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* keep the status-line message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}
```

Replace with:

```ts
import type { QueryNode } from "../query/types";
import type {
  AuthUser,
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function errorFromResponse(res: Response): Promise<Error> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* keep the status-line message */
  }
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}
```

(`getSchema`, `getDatabases`, `getIndividuals`, `getStats`, `runQuery` are unchanged — `request<T>`'s external behavior is identical, only its internals moved.)

Add, after `runQuery`:

```ts
/**
 * Who's logged in, if anyone. A 401 here is a normal outcome (not logged
 * in) — resolves to `null` rather than throwing, so this can sit alongside
 * getDatabases()/getIndividuals() in main.ts's startup Promise.all without
 * an anonymous visitor tripping their fatal-load-failure path.
 */
export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 401) return null;
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as AuthUser;
}

export async function logout(): Promise<void> {
  const res = await fetch(`${BASE}/auth/logout`, { method: "POST" });
  if (!res.ok) throw await errorFromResponse(res);
}
```

(`logout` deliberately does NOT reuse `request<T>` — the real endpoint returns `204 No Content`, and `request<T>` always calls `res.json()`, which throws on an empty body.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts tests/api/client.test.ts
git commit -m "feat(client): add getMe/logout; extract errorFromResponse, shared with the existing request<T>"
```

---

### Task 3: `mock-server/auth.ts` — session/state/code logic (new)

**Files:**
- Create: `mock-server/auth.ts`
- Create: `tests/mock-server/auth.test.ts`

**Interfaces:**
- Produces: `AuthUser { name: string }` (mock-local — intentionally not imported from `src/api/types.ts`, matching this repo's existing frontend/backend type-decoupling pattern, e.g. `mock-server/vehicleData.ts`'s own `Individual`), `startLogin(): string`, `issueFakeCode(): string`, `exchangeCodeForSession(code, state): ExchangeOutcome`, `sessionFor(cookieHeader): Session | null`, `endSession(cookieHeader): void`, `parseCookie(header, name): string | undefined`, `sessionCookieHeader(sessionId): string`, `clearSessionCookieHeader(): string` — all consumed by Task 4 (`mock-server/index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `tests/mock-server/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  startLogin,
  issueFakeCode,
  exchangeCodeForSession,
  sessionFor,
  endSession,
  parseCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../../mock-server/auth";

describe("parseCookie", () => {
  it("finds a named cookie's value among several", () => {
    expect(parseCookie("a=1; qb_session=abc123; b=2", "qb_session")).toBe("abc123");
  });
  it("returns undefined when the cookie isn't present", () => {
    expect(parseCookie("a=1; b=2", "qb_session")).toBeUndefined();
  });
  it("returns undefined for an undefined header", () => {
    expect(parseCookie(undefined, "qb_session")).toBeUndefined();
  });
});

describe("login/callback round trip", () => {
  it("a valid state+code pair exchanges for a session with a demo user", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    expect(outcome).toEqual({ ok: true, sessionId: expect.any(String) });
  });

  it("the resulting session is findable via its cookie header", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    const cookieHeader = sessionCookieHeader(outcome.sessionId);
    const sessionId = parseCookie(cookieHeader, "qb_session");
    expect(sessionFor(`qb_session=${sessionId}`)).toEqual({ user: { name: "demo.user" } });
  });

  it("a state can only be consumed once", () => {
    const state = startLogin();
    const code1 = issueFakeCode();
    const code2 = issueFakeCode();
    expect(exchangeCodeForSession(code1, state).ok).toBe(true);
    expect(exchangeCodeForSession(code2, state)).toEqual({
      ok: false,
      error: "Invalid or expired login attempt.",
    });
  });

  it("a code can only be consumed once", () => {
    const state1 = startLogin();
    const state2 = startLogin();
    const code = issueFakeCode();
    expect(exchangeCodeForSession(code, state1).ok).toBe(true);
    expect(exchangeCodeForSession(code, state2)).toEqual({
      ok: false,
      error: "Invalid or expired authorization code.",
    });
  });

  it("an unknown state is rejected", () => {
    const code = issueFakeCode();
    expect(exchangeCodeForSession(code, "not-a-real-state")).toEqual({
      ok: false,
      error: "Invalid or expired login attempt.",
    });
  });

  it("an unknown code is rejected", () => {
    const state = startLogin();
    expect(exchangeCodeForSession("not-a-real-code", state)).toEqual({
      ok: false,
      error: "Invalid or expired authorization code.",
    });
  });
});

describe("sessionFor / endSession", () => {
  function newSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    return outcome.sessionId;
  }

  it("returns null for a missing cookie", () => {
    expect(sessionFor(undefined)).toBeNull();
  });

  it("returns null for a cookie that doesn't match any session", () => {
    expect(sessionFor("qb_session=not-a-real-session")).toBeNull();
  });

  it("finds the session for a valid cookie", () => {
    const sessionId = newSession();
    expect(sessionFor(`qb_session=${sessionId}`)).toEqual({ user: { name: "demo.user" } });
  });

  it("endSession removes the session so it's no longer found", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    expect(sessionFor(cookie)).not.toBeNull();
    endSession(cookie);
    expect(sessionFor(cookie)).toBeNull();
  });
});

describe("cookie headers", () => {
  it("sessionCookieHeader includes HttpOnly, SameSite=Lax, and the session id", () => {
    const header = sessionCookieHeader("abc123");
    expect(header).toContain("qb_session=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("clearSessionCookieHeader expires the cookie immediately", () => {
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mock-server/auth.test.ts`
Expected: FAIL — `mock-server/auth.ts` doesn't exist yet.

- [ ] **Step 3: Create `mock-server/auth.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mock-server/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mock-server/auth.ts tests/mock-server/auth.test.ts
git commit -m "feat(mock): add session/state/code logic for the fake-IdP login round trip"
```

---

### Task 4: `mock-server/index.ts` — wire the auth routes, gate `/api/query`

**Files:**
- Modify: `mock-server/index.ts`

**Interfaces:**
- Consumes: everything from Task 3 (`mock-server/auth.ts`).
- No dedicated test (route handlers untested, per convention) — verified by manual curl walkthrough (Step 3) and the full mock-server test suite (Step 4).

- [ ] **Step 1: Add the import and the `sendHtml` helper**

Add to the import list at the top of the file:

```ts
import {
  startLogin,
  issueFakeCode,
  exchangeCodeForSession,
  sessionFor,
  endSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "./auth";
```

Add a `sendHtml` helper right after the existing `sendJson`:

```ts
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
```

Add the mock IdP page builder, near the top of the file (module scope, e.g. right after `sendHtml`):

```ts
/** Dev-only stand-in for a real IdP's login screen. Server-rendered HTML —
 *  never bundled by Vite, never touches dist/, no interaction with the
 *  offline-first check:offline guard. */
function mockIdpAuthorizePage(state: string): string {
  return `<!doctype html>
<html>
  <head><title>Mock IdP</title></head>
  <body style="font-family: sans-serif; max-width: 28rem; margin: 4rem auto;">
    <h1>Mock Identity Provider</h1>
    <p>This stands in for a real internal IdP during local development.</p>
    <p><a href="/mock-idp/authorize/confirm?state=${encodeURIComponent(state)}">Log in as demo.user</a></p>
  </body>
</html>`;
}
```

- [ ] **Step 2: Add the routes**

Insert these route blocks into the `server`'s route dispatch (right after the existing `/api/individuals` block reads well, though exact placement among the `if` chain doesn't matter functionally):

```ts
    if (req.method === "GET" && url.pathname === "/api/auth/login") {
      const state = startLogin();
      res.writeHead(302, { Location: `/mock-idp/authorize?state=${encodeURIComponent(state)}` });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/mock-idp/authorize") {
      const state = url.searchParams.get("state") ?? "";
      sendHtml(res, 200, mockIdpAuthorizePage(state));
      return;
    }
    if (req.method === "GET" && url.pathname === "/mock-idp/authorize/confirm") {
      const state = url.searchParams.get("state") ?? "";
      const code = issueFakeCode();
      res.writeHead(302, {
        Location: `/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/auth/callback") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const outcome = exchangeCodeForSession(code, state);
      if (!outcome.ok) {
        sendJson(res, 400, { error: outcome.error });
        return;
      }
      res.writeHead(302, { Location: "/", "Set-Cookie": sessionCookieHeader(outcome.sessionId) });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      const session = sessionFor(req.headers.cookie);
      if (!session) {
        sendJson(res, 401, { error: "Not authenticated." });
        return;
      }
      sendJson(res, 200, session.user);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      endSession(req.headers.cookie);
      res.writeHead(204, { "Set-Cookie": clearSessionCookieHeader() });
      res.end();
      return;
    }
```

- [ ] **Step 3: Gate `POST /api/query`**

Find the existing `/api/query` route handler:

```ts
    if (req.method === "POST" && url.pathname === "/api/query") {
      const body = (await readJson(req)) as {
```

Add a session check as the FIRST thing inside that block, before `readJson`:

```ts
    if (req.method === "POST" && url.pathname === "/api/query") {
      const session = sessionFor(req.headers.cookie);
      if (!session) {
        sendJson(res, 401, { error: "Log in to preview data." });
        return;
      }
      const body = (await readJson(req)) as {
```

(The rest of that handler — `badQuery`/`badDatabases` checks, the `filterByDatabases`/`matches`/`ENTRYSETS` logic — is unchanged.)

- [ ] **Step 4: Manually verify the full round trip**

Run: `npm run mock` (one terminal), then in another, using a cookie jar to simulate a browser across requests:

```bash
curl -s -c /tmp/cookies.txt "http://localhost:3001/api/auth/login" -o /dev/null -w "%{redirect_url}\n"
```
Expected: a `Location`-style URL like `/mock-idp/authorize?state=...` printed (curl's `-w "%{redirect_url}"` prints the `Location` header without following it).

```bash
STATE=$(curl -s -c /tmp/cookies.txt "http://localhost:3001/mock-idp/authorize?state=PASTE_STATE_HERE" | grep -o 'state=[^"]*' | head -1 | cut -d= -f2)
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt "http://localhost:3001/mock-idp/authorize/confirm?state=$STATE" -o /dev/null -w "%{redirect_url}\n"
```
Expected: a `Location` like `/api/auth/callback?code=...&state=...`.

```bash
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -i "http://localhost:3001/api/auth/callback?code=PASTE_CODE&state=PASTE_STATE" | head -5
```
Expected: `HTTP/1.1 302 Found`, a `Set-Cookie: qb_session=...` header, `Location: /`.

```bash
curl -s -b /tmp/cookies.txt "http://localhost:3001/api/auth/me"
```
Expected: `{"name":"demo.user"}`.

```bash
curl -s -X POST "http://localhost:3001/api/query" -H 'content-type: application/json' -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha"]}'
```
(No cookie jar — simulating an anonymous request.) Expected: `401 {"error":"Log in to preview data."}`.

```bash
curl -s -b /tmp/cookies.txt -X POST "http://localhost:3001/api/query" -H 'content-type: application/json' -d '{"query":{"kind":"group","operator":"AND","children":[]},"databases":["alpha"]}'
```
Expected: `200` with the normal `{"entrysets":[...]}` shape (now WITH the cookie jar, simulating a logged-in browser).

```bash
curl -s -c /tmp/cookies.txt -b /tmp/cookies.txt -X POST -i "http://localhost:3001/api/auth/logout" | head -3
curl -s -b /tmp/cookies.txt "http://localhost:3001/api/auth/me"
```
Expected: `204` from logout with a `Set-Cookie` clearing the cookie, then `401` from `/api/auth/me` afterward.

Stop the mock server (Ctrl+C) when done. Clean up: `rm -f /tmp/cookies.txt`.

- [ ] **Step 5: Run the full mock-server test suite**

Run: `npx vitest run tests/mock-server/`
Expected: PASS (all mock-server tests, including the new `auth.test.ts` from Task 3).

- [ ] **Step 6: Commit**

```bash
git add mock-server/index.ts
git commit -m "feat(mock): wire the OAuth2 login round trip, gate POST /api/query on a session

Production note: GET /api/auth/login, GET /api/auth/callback,
GET /api/auth/me, POST /api/auth/logout, and POST /api/query's
401-without-session behavior are all new REAL requirements for the
production backend team — none of this exists yet. The mock-idp/*
routes and mock-server/auth.ts's in-memory session store are dev-only
scaffolding that fakes the whole IdP round-trip in-process; none of
that is reusable in production. See docs/superpowers/specs/
2026-09-22-oauth2-login-design.md §7 for the full list."
```

---

### Task 5: `src/state.ts` — `AppState.auth`

**Files:**
- Modify: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `AuthUser` (Task 1).
- Produces: `AppState.auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null }` — consumed by Task 6 (`authStatus.ts`), Task 7 (`main.ts`), Task 8 (`dataPreview.ts`).

**This task does NOT touch `canRunQuery`** — per the Global Constraints, auth is layered on only at the Run-specific call sites in `main.ts` (Task 7), not into this shared helper (which `refreshStats` also uses, and stats stay anonymous-accessible).

- [ ] **Step 1: Write the failing test**

Add one assertion to the existing `"initialState has an empty AND-group query and idle panels"` test in `tests/state.test.ts`:

```ts
  it("initialState has an empty AND-group query and idle panels", () => {
    expect(initialState.query).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(initialState.stats.status).toBe("idle");
    expect(initialState.preview.status).toBe("idle");
    expect(initialState.auth.status).toBe("loading");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/state.test.ts`
Expected: FAIL — `initialState.auth` doesn't exist yet.

- [ ] **Step 3: Update `src/state.ts`**

Change the import:

```ts
import type {
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./api/types";
```

to:

```ts
import type {
  AuthUser,
  DatabasesResponse,
  EntrysetsResponse,
  IndividualsResponse,
  SchemaResponse,
  StatsResponse,
} from "./api/types";
```

Add to the `AppState` interface (anywhere is fine — after `individuals` reads naturally):

```ts
  /** Who's logged in, if anyone — populated once at startup via GET /api/auth/me. */
  auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
```

Add to `initialState`:

```ts
  auth: { status: "loading", user: null },
```

(`canRunQuery`, `createStore`, `Listener`, `store` are all unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat(state): add AppState.auth (canRunQuery deliberately untouched — stats stay anonymous)"
```

---

### Task 6: Top-menu auth widget (`layout.ts` slot + new `authStatus.ts`)

**Files:**
- Modify: `src/ui/layout.ts`
- Create: `src/ui/authStatus.ts`

**Interfaces:**
- Consumes: `AppState.auth` (Task 5).
- Produces: `renderAuthStatus(state): void`, `wireAuthStatus(container, onLogout): void` — consumed by Task 7 (`main.ts`).
- No dedicated tests for either file (panel/shell files have none, per convention) — verified by `npx tsc --noEmit` and Task 10's manual smoke test.

- [ ] **Step 1: Add the `data-panel="auth"` slot to the shell**

In `src/ui/layout.ts`'s `renderShell`, find:

```ts
    <div class="ui borderless menu" style="margin:0;border-radius:0">
      <span class="header item">Query Builder</span>
      <div class="right menu">
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
      </div>
    </div>
```

Add the new slot as the last item in the right menu:

```ts
    <div class="ui borderless menu" style="margin:0;border-radius:0">
      <span class="header item">Query Builder</span>
      <div class="right menu">
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
        <div class="item" data-panel="auth"></div>
      </div>
    </div>
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
  };
```

- [ ] **Step 2: Create `src/ui/authStatus.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/layout.ts` or `src/ui/authStatus.ts`. (`main.ts` will show a new error here — `panelEls().auth` referenced nowhere yet, `renderAuthStatus`/`wireAuthStatus` unused — that's fine, Task 7 wires it up.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/layout.ts src/ui/authStatus.ts
git commit -m "feat(ui): add the top-menu login/logout widget (authStatus.ts) and its shell slot"
```

---

### Task 7: `src/main.ts` — wire `getMe`/`logout`, register the panel, gate Run

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `getMe`/`logout` (Task 2), `AppState.auth` (Task 5), `renderAuthStatus`/`wireAuthStatus` (Task 6).
- No dedicated test (`main.ts` has none, per convention). Verified by `npx tsc --noEmit` and Task 10's manual smoke test.

- [ ] **Step 1: Update the import lines**

Change:

```ts
import { getDatabases, getIndividuals, getSchema, getStats, runQuery } from "./api/client";
```

to:

```ts
import { getDatabases, getIndividuals, getMe, getSchema, getStats, logout, runQuery } from "./api/client";
```

Add, alongside the other `./ui/*` imports:

```ts
import { renderAuthStatus, wireAuthStatus } from "./ui/authStatus";
```

- [ ] **Step 2: Add an `onLogout` handler**

Add this function near `runPreview`/the other action handlers:

```ts
function onLogout(): void {
  logout()
    .then(() => {
      store.setState({ auth: { status: "anonymous", user: null } });
    })
    .catch((err) => {
      // Best-effort: nothing more actionable to show beyond the button
      // still being there for the user to try again.
      console.error("Logout failed:", errorMessage(err));
    });
}
```

- [ ] **Step 3: Register the new panel and gate the Run button**

In `panelRenderers`, add a new entry (anywhere in the array is fine):

```ts
  {
    keys: ["auth"],
    run: (s) => {
      renderAuthStatus(s);
      wireAuthStatus(panelEls().auth, onLogout);
    },
  },
```

Find the entry that already calls `syncRunButton`:

```ts
  {
    keys: ["preview", "query", "issues", "schema", "selectedDatabaseIds", "individuals"],
    run: (s) => {
      renderDataPreview(s);
      syncRunButton(s);
    },
  },
```

Add `"auth"` to its `keys` (so a login/logout state change re-syncs the button):

```ts
  {
    keys: ["preview", "query", "issues", "schema", "selectedDatabaseIds", "individuals", "auth"],
    run: (s) => {
      renderDataPreview(s);
      syncRunButton(s);
    },
  },
```

Update `syncRunButton` itself:

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

Add a defense-in-depth guard to `runPreview` (the button being disabled should already prevent this, but a stray click shouldn't be trusted to have respected `disabled`):

```ts
function runPreview(): void {
  if (store.getState().auth.status !== "authenticated") return;
  // page/pageSize are sent for API-shape stability; the response is capped at
  // 25 entrysets regardless (see EntrysetsResponse in api/types.ts).
  runGuarded(
    (query, databases) => runQuery(query, databases, 1, PAGE_SIZE),
    () => store.setState({ preview: { status: "loading", data: null, error: null } }),
    (data) => store.setState({ preview: { status: "ok", data, error: null } }),
    (error) => store.setState({ preview: { status: "error", data: null, error } }),
  );
}
```

- [ ] **Step 4: Add the initial render call**

Alongside the other initial `render*(store.getState())` calls near the bottom of the file:

```ts
renderAuthStatus(store.getState()); // "" while auth.status is "loading"
```

- [ ] **Step 5: Fold `getMe()` into the startup `Promise.all`**

Change:

```ts
Promise.all([getSchema(), getDatabases(), getIndividuals()])
  .then(([schema, dbResp, individuals]) => {
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
    });
  })
```

to:

```ts
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
```

(`getMe()` already resolves `null` rather than throwing on a `401`, so an anonymous visitor doesn't trip the `.catch()` below — that stays a fatal-load-failure path for genuine errors only, unchanged.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/main.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire login/logout into startup + the top menu; gate Run on auth (stats stay anonymous)"
```

---

### Task 8: `src/ui/dataPreview.ts` — idle-state auth branch

**Files:**
- Modify: `src/ui/dataPreview.ts`

**Interfaces:**
- Consumes: `AppState.auth` (Task 5).
- No dedicated test (panel files have none, per convention). Verified by `npx tsc --noEmit` and Task 10's manual smoke test.

- [ ] **Step 1: Branch the idle-state hint on auth**

Find:

```ts
  if (p.status === "idle") {
    // onQueryChange nulls preview.data in the same setState that writes the query,
    // so "idle" always means "nothing current" — never run yet, or edited since.
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

(By the time this branch is reached, `state.schema` is already confirmed non-null by an earlier check in the same function — and `auth` is set in the SAME startup `setState` call as `schema`, so `auth.status` is never `"loading"` here; no flash of the wrong hint.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors reported against `src/ui/dataPreview.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/dataPreview.ts
git commit -m "feat(ui): data preview shows a login prompt instead of Run/Refresh when anonymous"
```

---

### Task 9: `docs/ARCHITECTURE.md` — sync

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: §1 screen layout**

Find the ASCII top-menu line:

```
│  top ui menu: app title ······················ [☰ Docs]  [Run] │
```

Add the new widget:

```
│  top ui menu: app title ············· [☰ Docs]  [Run]  [Log in] │
```

- [ ] **Step 2: §4 directory layout**

In the `ui/` subsection, add a new bullet after `dataPreview.ts`'s entry:

```
    authStatus.ts      render + wiring for the top-menu login/logout widget
                       (its own panel, data-panel="auth"). See §9.
```

In the `mock-server/` subsection, add a new bullet (alongside `schema.ts`/`databases.ts`/etc.):

```
  auth.ts              Session/state/code logic for the fake-IdP login round
                       trip: startLogin/issueFakeCode/exchangeCodeForSession
                       (in-memory, dev-only) + cookie helpers. See §7, §10.
```

Update `main.ts`'s one-line description:

```
  main.ts              Bootstrap: import setup-jquery + Fomantic; render layout shell; load schema/databases/individuals/auth; wire subscriptions; hold the refreshStats / runPreview orchestrators.
```

- [ ] **Step 3: §5 `AppState`**

Find the `AppState` code block and add, after the `individuals` field:

```ts
  /** Who's logged in, if anyone — populated once at startup via GET /api/auth/me. */
  auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
```

- [ ] **Step 4: §7 API contract — new subsection**

Read the file to find where `POST /api/query`'s subsection ends (right before the `### Errors` subsection, or wherever the section actually ends in the live file), and insert a new subsection there:

```markdown
### Auth (`GET /api/auth/login`, `GET /api/auth/callback`, `GET /api/auth/me`, `POST /api/auth/logout`)

OAuth2 authorization-code login against an internal, LAN-reachable identity
provider (never a public one — see §2's offline-first constraint). The
IdP's redirect URI points at the backend, not the SPA, so the frontend
never handles the auth code, CSRF `state`, or tokens.

```ts
interface AuthUser {
  name: string;
}
```

- `GET /api/auth/login` — starts the flow, redirects to the IdP.
- `GET /api/auth/callback?code=&state=` — exchanges the code server-to-server
  (client secret never leaves the backend), sets a `qb_session` `HttpOnly`/
  `SameSite=Lax` cookie (`Secure` too, in production — see §10), redirects
  to `/`.
- `GET /api/auth/me` — `200 AuthUser` with a valid session cookie, `401`
  otherwise.
- `POST /api/auth/logout` — clears the session, `204`.

Only `POST /api/query` requires a session (`401 { error }` without one) —
everything else (`schema`, `databases`, `individuals`, `stats`) stays
anonymous-accessible. `canRunQuery` is NOT auth-aware; the Run button and
`runPreview()` layer the auth check on separately (§5, §9).
```

Also update the `getStats`/`runQuery` client function list near the top of §7 to add:

```
getMe(): Promise<AuthUser | null>
logout(): Promise<void>
```

- [ ] **Step 5: §9 panels — new note**

Read the file's §9 to find where the top-menu/Run button behavior is described (if anywhere) or the start of the section, and add a short paragraph:

```markdown
### Top menu — `authStatus.ts`

Its own panel (`data-panel="auth"`, painted independently). Anonymous shows
a `Log in` link (`GET /api/auth/login` — a real navigation, not a fetch);
authenticated shows the user's name + a `Log out` button. The Run button
(`main.ts`'s `syncRunButton`) additionally requires `auth.status ===
"authenticated"`, on top of its existing `canRunQuery` check — stats stay
anonymous-accessible, only the Run/Refresh preview action is gated.
```

- [ ] **Step 6: §10 mock server — new bullet**

Add a bullet describing the auth simulation, and a clear production-requirements note:

```markdown
- `mock-server/auth.ts` simulates the entire OAuth round trip in-process:
  `/api/auth/login` redirects to a tiny server-rendered "Mock IdP" page
  (`/mock-idp/authorize`, never bundled by Vite) that hands back a fake
  code via `/mock-idp/authorize/confirm`, which `/api/auth/callback`
  "exchanges" (no real network call) for an in-memory session. **None of
  this is reusable in production** — a real backend needs a real IdP
  integration, real PKCE/client-secret handling, session storage that
  survives process restarts, and a `Secure` cookie flag (the mock omits it
  since local dev runs over plain `http`).
```

- [ ] **Step 7: §13 changelog**

Add a new row at the end of the table:

```markdown
| 2026-09-23 | OAuth2 authorization-code login: only `POST /api/query` is gated (`401` without a session) — schema/databases/individuals/stats stay anonymous-accessible. The IdP's redirect URI points at the backend (`GET /api/auth/callback`), not the SPA, so the frontend never handles the auth code/state/tokens — it only reads `GET /api/auth/me`'s result via a new `AppState.auth`. `canRunQuery` deliberately stays auth-unaware (shared with `refreshStats`); the auth requirement is layered on separately at `syncRunButton`/`runPreview`. New top-menu widget (`src/ui/authStatus.ts`) for login/logout. Mock server (`mock-server/auth.ts` + new routes in `index.ts`) simulates the whole IdP round trip in-process to stay offline-first — none of it is reusable in production (see the design spec's §7 for the full list of new real backend requirements). Design: `docs/superpowers/specs/2026-09-22-oauth2-login-design.md`. |
```

- [ ] **Step 8: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: describe the OAuth2 login feature in ARCHITECTURE.md"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: all suites pass.

- [ ] **Step 3: Lint**

Run: `npm run lint` (the full script, `eslint . && prettier --check .` — not just `eslint .` alone).
Expected: no errors. In particular, confirm the jQuery and `mock-server` import airlocks from `eslint.config.js` still pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (also re-runs typecheck and `check:offline` — confirm the mock IdP page, being server-rendered and never bundled, introduces nothing for that guard to catch).

- [ ] **Step 5: Full manual smoke test**

Run: `npm run dev`. Walk through, driving a real browser if at all possible in your environment:
1. Load the app anonymously — confirm the top menu shows "Log in", the Run button is disabled, and the stats panel still works live as you build a query (anonymous access to schema/databases/individuals/stats).
2. Click "Log in" — confirm you land on the "Mock Identity Provider" page, click "Log in as demo.user", and land back on the app at `/` with the top menu now showing "demo.user" + "Log out", and the Run button enabled (once a valid query/scope exists).
3. Press Run/Refresh — confirm the data preview loads normally.
4. Click "Log out" — confirm the top menu reverts to "Log in" and the Run button disables again; confirm the data preview panel (if a query is still built) now shows the "Log in to preview data" hint instead of a stale "Press Run/Refresh" hint.
5. Confirm no console errors throughout.

If you cannot drive a real browser, do as much as you reasonably can via curl with a cookie jar (similar to Task 4's verification) against the running `npm run dev` instance, and report honestly what you substituted.

- [ ] **Step 6: Final commit (only if any of the above required fixes)**

If Steps 1-5 required any fixups, stage and commit them now with a message describing what verification caught. If everything passed cleanly, there is nothing to commit for this task.
