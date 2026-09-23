# Compliance logging redirect gate — design

> **Historical design record.** This describes the design as approved at the time;
> the code has moved on since. For current behaviour see `docs/ARCHITECTURE.md`.

Status: approved, ready for implementation planning.

Branched from `worktree-oauth2-auth-code-login` (OAuth2 authorization-code
login, PR #13, not yet merged to `main`) — this feature depends directly on
that branch's session/cookie infrastructure and cannot be built against
`main` alone.

## 1. Problem

`POST /api/query` (the Run/Refresh data-extraction action) currently
requires only an authenticated session. We additionally want every
extraction to be preceded by a compliance acknowledgment — the user is
redirected to a compliance-logging service, writes a short reason for the
extraction, and only then may the query actually run. Like login, this
should be a one-time-per-session gate, not a per-request one: acknowledge
once, extract freely until the acknowledgment is invalidated or the
session ends.

This is designed to generalize: today there is exactly one protected
endpoint (`POST /api/query`), but more may be added later. The mechanism
below reacts to HTTP status codes rather than hard-coding which endpoints
are gated, so a future protected endpoint gets both the login and
compliance flows for free as long as it returns the same status codes on
the same conditions.

## 2. Flow

Two independent redirect flows, each shaped like the existing OAuth one:
the frontend never sees a token/code/state value that isn't immediately
consumed by the backend, and the compliance service's page is
server-rendered HTML that never touches the SPA bundle.

```
Browser                    Backend                    Mock Compliance Service
   |                           |                              |
   |-- click Run -->           |                               |
   |   POST /api/query --------|                               |
   |<-- 401 (no session) or 403 (session, no compliance) ------|
   |                           |                              |
   |   [save current query + selectedDatabaseIds to            |
   |    sessionStorage, then navigate:]                        |
   |                           |                              |
   |-- 401: GET /api/auth/login ---------------------------->  | (existing OAuth flow, unchanged)
   |-- 403: GET /api/compliance/start ----------------------->|
   |                           |-- 302 → /mock-compliance/submit?state=... -->
   |<---------------------------------------------------------|
   |-- GET /mock-compliance/submit?state=... -------------------------------->|
   |                                            (a reason text field + submit)|
   |<---------------------------------------------------------|
   |-- POST /mock-compliance/submit (reason=..., state=...) ---------------->|
   |                                                            |-- 302 → /api/compliance/callback?token=...&state=... -->
   |<---------------------------------------------------------|
   |-- GET /api/compliance/callback?token=...&state=... -->    |
   |                           |-- verifies the state-binding cookie, consumes
   |                           |   the token, attaches {reason, ackedAt} to the
   |                           |   CURRENT session (found via the existing
   |                           |   qb_session cookie already on this request —
   |                           |   no new session-identifying cookie)         |
   |                           |-- 302 → /?resume=1 -->                       |
   |<---------------------------------------------------------|
   |-- restores the saved query/selection from sessionStorage,
   |   strips ?resume=1 from the URL, and STOPS. No auto-retry,
   |   no auto-chaining into the next gate. The user clicks Run
   |   again to actually retry the extraction.
```

**Why status codes, not a client-side pre-check:** `401` means "not
authenticated" (unchanged from the OAuth work). `403` means "authenticated,
but this specific requirement (compliance) isn't met." Any client call that
throws through the existing `ApiError` (added in the OAuth PR's final
review) with one of these two statuses triggers the matching redirect,
generically — the frontend does not maintain its own model of "which
gates does this endpoint have"; it reacts to what the backend says. A
future second protected endpoint needs no new frontend wiring as long as
its handler returns 401/403 under the same conditions `POST /api/query`
does.

**Why no auto-chaining:** an earlier version of this design tried to
automatically continue through both gates and auto-run the query once
both were satisfied, guarded by a hop counter to prevent a stuck backend
from causing an infinite redirect bounce. That is unnecessary complexity:
requiring an explicit Run click to retry after *each* redirect return
means the app never redirects itself without a fresh user gesture — there
is no code path left that could loop, regardless of what breaks upstream
(a stuck cookie, a flaky callback, a genuinely down service). Worst case
under a persistent failure: Run produces the same 401/403 and the same
single redirect, every time, forever — annoying, never runaway.

**Query preservation is entirely client-side** (`sessionStorage`, never
sent through the backend or any redirect URL, so query contents never
appear in an IdP/compliance-service-visible parameter). `/api/auth/callback`
(existing, from the OAuth PR) and the new `/api/compliance/callback` both
redirect to `/?resume=1` instead of bare `/` — that query parameter is the
one signal a load uses to know it's a return-hop and should restore saved
state; any other load with a stale leftover `sessionStorage` entry
discards it silently rather than acting on it.

## 3. Session & cookie design

Piggybacks on the existing session (no second session-identifying cookie):

```ts
// mock-server/auth.ts
interface Session {
  user: AuthUser;
  compliance?: { reason: string; ackedAt: string };
}
```

A parallel CSRF `state` + short-lived browser-binding cookie pair to the
one the OAuth PR's final review added for login (`qb_login_state`) — the
binding-cookie helpers there get generalized to take a cookie name
parameter instead of copy-pasting a second near-identical implementation,
since this is now a real second use, not a hypothetical one. A separate
single-use "pending compliance token → reason" map holds the reason text
between the mock compliance form's POST and the callback consuming it.

No `Secure` flag in the mock, same reasoning and same production
requirement as the session cookie (§7).

## 4. Mock compliance service (`mock-server/index.ts`, dev-only)

Same-process, new route prefix, mirroring how the mock IdP was added:

- `GET /api/compliance/start` — requires an existing session (`401` if
  none). Issues a CSRF `state`, sets the binding cookie, `302` →
  `/mock-compliance/submit?state=...`.
- `GET /mock-compliance/submit` — server-rendered HTML form: one text
  input for the reason, POSTing back to itself with the `state` carried as
  a hidden field.
- `POST /mock-compliance/submit` — parses the
  `application/x-www-form-urlencoded` body (a small parser parallel to the
  existing JSON `readJson`), stashes the reason under a fresh single-use
  token, `302` → `/api/compliance/callback?token=...&state=...`.
- `GET /api/compliance/callback` — checks the binding cookie against
  `state` (`400` on mismatch, before touching the token), consumes the
  token to retrieve the reason, requires the current session (`400` if
  none — the user logged out mid-flow), attaches
  `{ reason, ackedAt: new Date().toISOString() }` to that session, clears
  the binding cookie, `302` → `/?resume=1`.
- `GET /api/compliance/status` — never errors: no session, or a session
  with no `compliance` field, both report `{ status: "required" }`;
  otherwise `{ status: "acknowledged", reason, ackedAt }`.
- `POST /api/compliance/invalidate` — clears just the `compliance` field
  off the current session (the user stays logged in), `204`. The exact
  parallel of logout, narrowed to one field.
- `POST /api/query` gains a second check, after the existing session
  check: no `compliance` on the session → `403 { error: "Compliance
  acknowledgment required." }`.

**Per-query audit forwarding:** every time `POST /api/query` succeeds
(session and compliance both present), the backend appends
`{ name: session.user.name, reason: session.compliance.reason, timestamp:
new Date().toISOString() }` to an in-memory list, standing in for "forward
this to the real audit/compliance service over the network." This is
explicitly dev-only scaffolding — see §7.

## 5. Frontend

`src/api/types.ts` gains:

```ts
export interface ComplianceStatus {
  status: "required" | "acknowledged";
  reason?: string;
  ackedAt?: string;
}
```

`src/api/client.ts` gains `getComplianceStatus(): Promise<ComplianceStatus>`
and `invalidateCompliance(): Promise<void>`, matching `getMe`/`logout`'s
shapes exactly (the former never throws on "not required," matching
`/api/compliance/status`'s never-errors design above).

`AppState` gains:

```ts
compliance: { status: "loading" | "required" | "acknowledged"; reason: string | null; ackedAt: string | null };
```

populated at startup alongside `getMe()`. **This field is display-only** —
it drives the top-menu widget and an advisory hint in the data-preview
idle state, but it never gates the Run button or any click handler. The
actual gating is entirely reactive, at the point `POST /api/query`'s
response comes back (§2).

New `src/ui/complianceStatus.ts` (mirrors `authStatus.ts`): a
"Start compliance check" link (`/api/compliance/start`) when `required`;
the reason text (escaped) plus an "Invalidate" button when `acknowledged`,
calling `invalidateCompliance()` and resetting local state to
`{ status: "required", reason: null, ackedAt: null }` on success. New
`data-panel="compliance"` shell slot in `layout.ts`, next to the existing
auth slot.

`main.ts`:
- `syncRunButton` reverts to exactly `canRunQuery(state) && preview.status
  !== "loading"` — the auth-aware disabling the OAuth PR added is removed;
  clicking Run always genuinely attempts the request now.
- `runPreview`'s error handling: an `ApiError` with `status === 401` or
  `403` saves the current query/selection (via a new
  `src/util/pendingQuery.ts`) and navigates to `/api/auth/login` or
  `/api/compliance/start` respectively; any other error behaves as today
  (`preview.status = "error"`).
- Startup: if `location.search` contains `resume=1`, strip it
  (`history.replaceState`) and restore the saved query/selection (if any)
  in place of the normal freshly-seeded default, re-validated against the
  loaded schema exactly like the default-seed path. No auto-continuation
  and no auto-run follow — the restore is the only effect.
- `getComplianceStatus()` joins the startup `Promise.all`.

`src/util/pendingQuery.ts` (new, pure, `sessionStorage`-backed):

```ts
export function savePendingQuery(query: QueryNode, selectedDatabaseIds: string[]): void;
export function takePendingQuery(): { query: QueryNode; selectedDatabaseIds: string[] } | null;
```

Both wrap storage access in `try`/`catch` (private browsing, disabled site
data) — a failure to persist is not fatal, it just means the query isn't
recovered after the redirect.

`dataPreview.ts`'s idle-state hint gains a middle case (advisory only, per
above): anonymous → "Log in to preview data" (unchanged); authenticated
but `compliance.status === "required"` → "Confirm compliance to preview
data" with a link to `/api/compliance/start`; otherwise the existing
"Press Run/Refresh" hint.

## 6. Testing

Same conventions as the OAuth PR:
- The new mock-server compliance logic (state/token issuance and
  exchange, single-use enforcement, `complianceStatusFor`,
  `invalidateCompliance`, the generalized binding-cookie helpers) is
  pure-ish module logic — gets a dedicated test file matching
  `tests/mock-server/auth.test.ts`'s pattern.
- `src/api/client.ts`'s two new functions get cases in the existing
  `tests/api/client.test.ts`, following its `mockFetchOnce` pattern.
- `src/util/pendingQuery.ts` is pure — gets its own test file (save/take
  round trip, missing key, corrupted JSON handled gracefully).
- No new tests for `complianceStatus.ts`, the `dataPreview.ts`/
  `layout.ts`/`main.ts` changes, or the mock's new HTTP routes — the
  existing view-layer/route-wiring convention.

## 7. Production requirements (new — flag clearly in commit messages)

None of this exists today. A real backend team must implement, for real:

- `GET /api/compliance/start`, `GET /api/compliance/callback`,
  `GET /api/compliance/status`, `POST /api/compliance/invalidate` — the
  mock's versions (including the entire `/mock-compliance/*` fake service)
  are dev-only scaffolding; none of that code is reusable.
- A real compliance/audit service integration — the mock's per-query
  "audit forwarding" is an in-memory array that resets on process
  restart and is never actually sent anywhere; production needs a real
  network call to a real, durable audit store.
- The CSRF `state` browser-binding cookie pattern, tied to production's
  own session/cookie mechanism (same requirement as the OAuth work's
  equivalent, now needed a second time).
- The session cookie's `Secure` flag (same requirement as the OAuth work;
  the compliance record piggybacks on the same session, so this is one
  requirement, not two).
- `POST /api/query`'s `403`-without-compliance behavior — same contract,
  real enforcement. **Any future protected endpoint must return `401`
  (not authenticated) / `403` (authenticated, requirement unmet) under
  the same conditions for the frontend's generic redirect handling to
  keep working automatically without new frontend code.**
- `GET /api/auth/callback`'s redirect target changed from `/` to `/?resume=1`
  as part of this feature (a pre-existing OAuth-PR route, modified here) — a
  production implementation of the login callback must redirect to
  `/?resume=1` too, or a saved query can never be restored after a plain
  login (only after the compliance flow would work).
- The frontend currently treats EVERY `403` from `POST /api/query` as "compliance
  required" and redirects into the compliance flow accordingly. If a future
  protected endpoint ever needs to return `403` for a DIFFERENT, unrelated
  reason (e.g. a role-based permission failure with no compliance angle at
  all), that endpoint cannot reuse this exact contract as-is — it would
  incorrectly send the user into the compliance flow. This wasn't addressed
  now because no such second endpoint exists yet (YAGNI); a real fix would
  need the 403 response to carry a discriminator (e.g. a `code` field) so the
  frontend can tell compliance-related 403s apart from others.
- The compliance CSRF `state` is bound to the initiating BROWSER (via the
  short-lived cookie), not to the specific session that started the flow. In
  the mock this is harmless (single demo user). A production implementation
  should additionally bind the state to the session id that started the
  compliance flow, so a logout-then-different-login in the same browser
  within the state's short validity window can't attach the first user's
  submitted reason to the second user's session.

## 8. Out of scope

- A full audit-trail viewer (the user can see only their current
  compliance record, not a history of past extractions).
- Any gate type beyond the two already handled generically (401 → login,
  403 → compliance) — a hypothetical third requirement would need its own
  status code and its own explicit handling, not a magic extension of this
  mechanism.
- Time-boxed re-acknowledgment (compliance lasts as long as the session
  does, same as login, until invalidated or logged out).
- Any "remote"/IdP-style invalidation — invalidating compliance is local
  only, exactly like logout.
- Automatic redirect-chaining or auto-running the query after a
  successful redirect return (considered and deliberately dropped — see
  §2).
