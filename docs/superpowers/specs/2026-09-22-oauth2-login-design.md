# OAuth2 authorization-code login — design

Status: approved, ready for implementation planning.

## 1. Problem

The app currently has no authentication at all — every endpoint is open. We
need to add login via OAuth2 authorization-code flow against an internal,
LAN-reachable identity provider (not a public provider — the app has a hard
offline-first constraint, `docs/ARCHITECTURE.md` §2: no external hosts,
ever). Only one endpoint needs to be gated: `POST /api/query` (the "Run /
Refresh" data preview). Everything else — browsing the schema-derived query
builder, the docs sidebar, and the live stats panel — stays usable
anonymously.

**Hard constraints carried over from the existing app:**
- Offline-first: nothing added here may introduce an external-network
  dependency. The identity provider is internal/LAN-reachable, same as the
  app's own API.
- Frontend/backend separation: `mock-server/` is discarded entirely in
  production. Anything this design adds to it is dev-only scaffolding; §6
  below is explicit about what a real backend team must implement for real.
- A static SPA cannot safely hold an OAuth client secret. The token exchange
  must happen server-side.

## 2. Flow — the frontend never sees the code, state, or tokens

The identity provider's registered redirect URI points at the **backend**,
not the SPA. This means the whole exchange is a server-to-server concern;
the frontend does zero routing/parsing for it.

```
Browser                    Backend                         IdP
   |  click <a href="/api/auth/login">                       |
   |------------------------------->|                        |
   |         302 -> IdP /authorize?state=...                 |
   |<--------------------------------|                        |
   |------------------------------------------------------->|
   |                       user authenticates at the IdP     |
   |<-------------------------------------------------------|
   |         302 -> {origin}/api/auth/callback?code=&state=  |
   |------------------------------->|                        |
   |                                 |--- exchange code ---->|
   |                                 |   (server-to-server,   |
   |                                 |    client secret used) |
   |                                 |<---- tokens -----------|
   |         302 -> "/", Set-Cookie: qb_session=...           |
   |<--------------------------------|                        |
```

- `GET /api/auth/login` — starts the flow: generates a CSRF `state`,
  redirects to the IdP's `/authorize` endpoint.
- `GET /api/auth/callback?code=&state=` — verifies `state`, exchanges the
  code for tokens server-to-server (client secret never leaves the
  backend), creates a session, sets the session cookie, redirects to `/`.
- `GET /api/auth/me` — `200 AuthUser` if the request's session cookie is
  valid, `401 {error}` otherwise.
- `POST /api/auth/logout` — clears the session, clears the cookie, `204`.
- `POST /api/query` — now `401 {error}` without a valid session cookie,
  same error shape this endpoint already uses for its existing `400`s.

**PKCE:** out of scope for THIS design. The client here is confidential
(the backend holds the secret), and there is no public-client interception
surface to defend against. A production backend team choosing to add PKCE
anyway (defense-in-depth, current best practice) is free to; nothing here
prevents it, but the mock does not simulate it (§6 flags this explicitly).

**Logout scope:** clears the local/backend session only — no IdP-side
RP-initiated logout. If the IdP session itself needs to end too, that's a
follow-up, not this design.

## 3. Wire types (`src/api/types.ts`)

```ts
export interface AuthUser {
  name: string;
}
```

`GET /api/auth/me` returns this directly on success (bare, matching this
contract's established convention — no wrapper). No other new wire types;
`login`/`callback`/`logout` are plain redirects/status codes, not JSON
payloads the frontend parses.

## 4. `src/api/client.ts`

```ts
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

No `login()` function — logging in is a real browser navigation
(`<a href="/api/auth/login">`), not a `fetch()`, since the whole point is
that the browser needs to actually leave the SPA and follow redirects.

`getMe()` treats `401` as a normal, non-throwing outcome (`null` = "not
logged in"), not an error — this lets it join the app's startup
`Promise.all` alongside `getDatabases()`/`getIndividuals()` without an
anonymous visitor's missing session tripping the existing fatal-load-failure
path those two use.

## 5. State & UI

`AppState` gains:

```ts
auth: { status: "loading" | "authenticated" | "anonymous"; user: AuthUser | null };
```

`initialState.auth = { status: "loading", user: null }`.

Startup (`main.ts`) becomes `Promise.all([getDatabases(), getIndividuals(),
getMe()])`; the resolved `user` sets `auth.status` to `"authenticated"` or
`"anonymous"`.

**Top menu** gets a small new panel, `src/ui/authStatus.ts`
(`renderAuthStatus`/`wireAuthStatus`, following the exact shape of
`databasePicker.ts`): anonymous shows a `<a href="/api/auth/login">Log
in</a>`; authenticated shows the user's name + a "Log out" button that
`POST`s `/api/auth/logout` then re-fetches `/api/auth/me` (or just reloads
— simplest is fine here). `src/ui/layout.ts`'s shell template gains a
`data-panel="auth"` slot in the top menu for this to paint into, alongside
the existing `docs`/`center`/`stats`/`preview`/`dbpicker` slots.

**`src/ui/dataPreview.ts`**: the existing early-return ladder (no schema →
no database selected → no condition → blocking issues → idle/loading/
error/ok) is unchanged up through "blocking issues". Where it currently
shows the idle-state "Press Run/Refresh..." hint, it now branches on
`state.auth.status`: `"authenticated"` shows that hint as today;
`"anonymous"` shows "Log in to preview data" + the same login link as the
top menu; `"loading"` shows nothing new (the existing schema/individuals
loaders already cover the startup window).

**Run button** (`main.ts`'s `syncRunButton`): gains `&& state.auth.status
=== "authenticated"` alongside its existing `canRunQuery(state) &&
preview.status !== "loading"` check. **`canRunQuery` itself (in
`state.ts`) is NOT changed** — it's shared with `refreshStats`, and stats
stay available anonymously per §1. The auth requirement is layered on top
only at the two call sites that gate the Run action specifically
(`syncRunButton`, and a defense-in-depth check inside `runPreview()` itself
— the button being disabled should already prevent this, but a stray click
shouldn't be trusted to have respected `disabled`).

**Lost query state on login, by design, not a bug to fix:** clicking "Log
in" is a real page navigation away from the SPA and back. Per this repo's
own stated non-goal ("no query persistence / URL state"), the in-progress
query is lost — identical to what a manual page refresh already does today.
Not building persistence for this specifically to avoid it.

## 6. Mock server (`mock-server/auth.ts`, dev-only)

New module, session/PKCE-adjacent state kept in-memory (module-level `Map`s
— same pattern as `mock-server/rows.ts`'s computed-once `ROWS`):

```ts
export interface AuthUser {
  name: string;
}
interface Session {
  user: AuthUser;
}

const SESSIONS = new Map<string, Session>();
const PENDING_STATES = new Set<string>();
const FAKE_CODES = new Map<string, true>();
const SESSION_COOKIE = "qb_session";

function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function startLogin(): string {
  const state = randomToken();
  PENDING_STATES.add(state);
  return state;
}

/** Dev-only: stands in for the real IdP handing back a code after the user
 *  authenticates on its authorize page. Production's real IdP does this
 *  remotely over HTTPS — nothing here is reused by a real integration. */
export function issueFakeCode(): string {
  const code = randomToken();
  FAKE_CODES.set(code, true);
  return code;
}

export type ExchangeOutcome = { ok: true; sessionId: string } | { ok: false; error: string };

/** Stands in for POSTing the code to the IdP's /token endpoint with the
 *  client secret. The mock skips the real network call and PKCE entirely
 *  (see §2/§6's production note) — a real backend does not. */
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

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function sessionCookieHeader(sessionId: string): string {
  // No `Secure` flag: local dev runs over plain http, and browsers drop
  // `Secure` cookies entirely on a non-https origin. Production runs behind
  // TLS and MUST add `Secure` — see §7.
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
```

**Routes added to `mock-server/index.ts`** (plain `if` branches, matching
the file's existing style — no new dependency, no router library):

- `GET /api/auth/login` → `startLogin()`, `302` to
  `/mock-idp/authorize?state=...`.
- `GET /mock-idp/authorize` → serves a tiny static HTML page (a "Log in as
  demo.user" link to `/mock-idp/authorize/confirm?state=...`) — the mock's
  stand-in for a real IdP's login screen. This is dev-only server-rendered
  HTML; it is never bundled by Vite and never touches `dist/`, so it has no
  interaction with the offline-first `check:offline` guard.
- `GET /mock-idp/authorize/confirm` → `issueFakeCode()`, `302` to
  `/api/auth/callback?code=&state=` (the `state` just passed through).
- `GET /api/auth/callback` → `exchangeCodeForSession(code, state)`; on
  success, `302` to `/` with `Set-Cookie` from `sessionCookieHeader`; on
  failure, `400 {error}` (matching the file's existing error-response
  convention).
- `GET /api/auth/me` → `sessionFor(req.headers.cookie)`; `200 session.user`
  or `401 {error}`.
- `POST /api/auth/logout` → `endSession(...)`, `204` with `Set-Cookie` from
  `clearSessionCookieHeader`.
- `POST /api/query`'s existing handler gains a `sessionFor` check at the
  top: `401 {error}` if absent, before any of its existing `badQuery`/
  `badDatabases` validation.

A small `sendHtml(res, status, html)` helper is added alongside the
existing `sendJson`.

## 7. Production requirements (new — flag clearly in commit messages)

None of this exists today. A real backend team must implement, for real,
against the real internal IdP:

- `GET /api/auth/login`, `GET /api/auth/callback`, `GET /api/auth/me`,
  `POST /api/auth/logout` — the mock's versions are dev-only scaffolding
  that fakes the IdP round-trip in-process; none of that code is reusable.
- The actual OAuth client registration (client id, client secret, redirect
  URI) with the real IdP — none of that exists yet either.
- Session storage that survives process restarts / works across multiple
  backend instances (the mock's in-memory `Map` does neither — fine for a
  single dev process, not for production).
- The session cookie's `Secure` flag: the mock omits it (dev runs over
  plain `http`, and browsers drop `Secure` cookies on a non-https origin
  outright). Production runs behind TLS and MUST add `Secure`.
- `POST /api/query`'s `401`-without-session behavior — same contract, real
  enforcement.
- Whatever production decides about PKCE (§2) and IdP-side logout (§2) —
  both are explicitly out of scope for this design, not decided against.

## 8. Testing

- `mock-server/auth.ts`'s functions are pure-ish module logic (matching
  this repo's "unit tests on pure modules only" convention) — new
  `tests/mock-server/auth.test.ts` covers: a `state`/code pair round-trips
  to a valid session; a `state` or code can only be consumed once; an
  unknown/already-used `state` or code fails; `sessionFor`/`endSession`
  correctly parse a `Cookie` header (including when other cookies are
  present) and a missing/invalid cookie yields no session.
- `src/api/client.ts`'s `getMe`/`logout` get test cases in the existing
  `tests/api/client.test.ts`, following its established `mockFetchOnce`
  pattern — including confirming `getMe()` resolves to `null` (not a throw)
  on a `401`.
- No new tests for `src/ui/authStatus.ts`, the `dataPreview.ts`/
  `layout.ts`/`main.ts` changes, or the mock's new HTTP routes themselves —
  consistent with this repo's existing convention that the view layer and
  route wiring are not unit-tested.

## 9. Out of scope

- Multi-provider support — one IdP only.
- Refresh-token rotation or any session-lifetime logic beyond what the
  backend's own session naturally has (the frontend never sees token
  expiry at all).
- Remember-me / persistent login beyond the session cookie's own lifetime.
- Preserving in-progress query state across the login redirect (§5).
- IdP-side (RP-initiated) logout (§2).
- PKCE (§2, §6) — noted as a production decision, not built here.
- Gating anything other than `POST /api/query` — schema/databases/
  individuals/stats all stay anonymous-accessible.
