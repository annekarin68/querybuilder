# User and Backend Feedback (14 points) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the 14 points of user and backend-team feedback received on 2026-10-13: two backend contract changes (`/users/me`, `/filter/execute`), friendlier error handling, clearer data dictionary and statistics, a busier and more honest mascot, a login dialog instead of a misleading note, and "Add all" that creates a group.

**Architecture:** Every change stays in the layer that already owns it. Wire changes go in `src/api/` (`types.ts`, `response.ts`, `client.ts`) plus the mock server. Behaviour goes in `src/app.ts` (tested with a fake API). Display goes in the panel render functions, with their decisions in small pure functions that the Node-only tests can reach. Colours go in the `:root` tokens of `src/styles.css`. Each task is self-contained, ends green on `npm run typecheck && npm test && npm run lint && npm run build`, updates `docs/ARCHITECTURE.md` in the same commit, and is committed on its own.

**Tech Stack:** TypeScript (strict), Vite 8, Vitest 4 (Node, no DOM), Fomantic UI 2.9 + jQuery (only in `src/ui/fomantic.ts`), plain Node `http` mock server, Playwright (Chromium) for browser checks.

**Spec:** This plan is its own spec. The sections "Decisions", "Findings" and "Questions for the backend team" below record what was asked, investigated and decided on 2026-10-13. Read them before any task, and read the `docs/ARCHITECTURE.md` section each task names before changing code.

## Decisions

### Taken with the maintainers (2026-10-13)

| Point | Decision |
|---|---|
| 6 | The pickle is **disappointed** when the query matches nothing, a database fails or finds a problem in the query, a request fails, or the query is invalid. **Not while the query is merely unfinished**: every session starts with a blank row, so a pickle that is sad from page load would mean nothing. |
| 10 | The line "You'll be asked to log in first." above the builder goes. A logged-out user who presses **Save…** or **Saved queries** gets a **small login dialog** ("Log in to save queries", **Log in** / **Cancel**) instead of an unannounced redirect. **Run query** keeps its note. |
| 14 | "Add all N" on a tag, and dragging a tag, create **one new ALL group** holding the tag's facets (when there are two or more). The maintainers keep ALL, although in the mock "Add all" on the first tag matches 0 events in all 7 databases. |
| 11 / 13 | All "Not counted…" and "Excludes N databases…" text goes. Red, striped bar segments show the data that failed. One short **⚠ Show problem** button stays when the query itself has a problem, because it is the only way to jump to that problem. |

### Made in this plan (challenge them if you disagree)

| Point | Decision | Why |
|---|---|---|
| 1 | The model keeps `User.name`; it is filled from `display_name`. If `display_name` is blank, the user's id (`sub` / `user_id`) is shown, as a nameless database shows its id. | "Naming" says `name` is the text shown to the user. The backend already does the username → email → id fallback, so the frontend must not do it again. |
| 2 | Implement the backend's draft shape, with the fixes listed in "Questions for the backend team". `EventRecord.id` becomes a `string`; a facet holds a **list** of occurrences. | The list form also covers "a facet occurs once" (a list of one). A long GUID is shortened to 8 characters in the row and shown whole in its tooltip and JSON. |
| 3 | The native `title` tooltip, moved onto the element the pointer really hits. | A `title` already existed but never showed (see Findings). Fomantic's CSS tooltips (`data-tooltip`) cannot attach to an `<input>`. |
| 4 | The logo files and their hover labels live in `src/config.ts` (`TEXT_SOURCES`). "Ours" defaults to the app logo (`/pickle/logo.svg`); the third party gets a neutral placeholder, `public/sources/third-party.svg`. | The third party's name and logo are deployment-specific, and `src/` must never name backend data. The label is also the `alt` text, so screen readers still hear whose text it is. |
| 5 | CSS spins the image (`.qb-logo[data-state="loading"]`). Under reduced motion it fades in and out instead. | The SVG files are meant to be replaced; an animation inside one would be lost with it. |
| 7 | The GUI never shows the server's own error text, an HTTP status or a URL; it shows a plain message for the kind of failure. The console gets the method, URL, status code, status text and the server's text. | The server's text can be a stack trace or name internals. Showing it caused the bad UX that was reported. |
| 7 | A failed **Log out**, **Invalidate** or **Delete** shows an error toast (also spoken). Deleting a query that is already gone (`404`) counts as deleted. | Today these fail silently, or replace the whole list with an error. |
| 9 | A field whose only content is one text and no known values is a plain row that shows its text in full (wrapped, never cut). A field that opens says what opening adds ("More: third-party description · 12 previously seen values"). | This removes the "expand shows the same text" case without measuring text in the DOM or guessing a character limit. |
| 12 | Every problem a database finds is highlighted, whatever its `kind`: a mustard ⚠ line for "incomplete", red as today for "invalid". The user's own unfinished rows keep their quiet grey hint. | Literal yellow text fails contrast on the cream cards (about 1.5:1). `--qb-warn` passes AA and is already checked by `tests/themeContrast.test.ts`. |

## Findings

### Point 7: what the GUI shows when the backend fails (simulated 2026-10-13)

Run in Chromium with Playwright: `page.route()` made one endpoint fail at a time, against the mock on ports 3091/5191.

| Simulated failure | What the user saw | Verdict |
|---|---|---|
| `GET /databases` 500 `{error: "Traceback: KeyError 'label' in db.py line 42"}` | Full-page "Could not load the app" + the raw traceback text | Leaks internals |
| `GET /databases` 502, HTML proxy page | "GET /api/v1/databases failed: 502 Bad Gateway" | Technical |
| `GET /individuals`, network down | "Failed to fetch" | Meaningless to a user |
| `GET /databases` 200 but an HTML page | "Unexpected response from GET /api/v1/databases: the body should be JSON… check VITE_API_BASE in .env…" | Developer text in the GUI (the example in the feedback) |
| `GET /auth/me` 500 | Silently shown as logged out ("Log in"); console only | Acceptable; console line lacks the status |
| `POST /stats` 500, no body | "Couldn't get statistics · POST /api/v1/stats failed: 500 Internal Server Error" | Technical |
| `POST /stats` 503 `{error: "upstream connect error…"}` | "Couldn't get statistics · upstream connect error or disconnect/reset before headers" | Leaks proxy internals |
| `POST /stats`, network down | "Couldn't get statistics · Failed to fetch" | Meaningless |
| `POST /stats` 200, a malformed line | "Unexpected response from POST /api/v1/stats, line 1: "label" should be non-blank text…" | Developer text |
| `POST /query` 500 `{error: "psycopg2.OperationalError…"}` | "Could not load events · psycopg2.OperationalError: could not connect" | Leaks internals |
| `POST /query`, network down | "Could not load events · Failed to fetch" | Meaningless |
| `POST /query` 403 (not compliance) | "Could not load events · Forbidden" | Technical |
| `POST /saved-queries` 500 | Save dialog: "sqlalchemy.exc.IntegrityError" | Leaks internals (the reported Save problem) |
| `POST /saved-queries` 502 HTML | Save dialog: "POST /api/v1/saved-queries failed: 502 Bad Gateway" | Technical |
| `GET /saved-queries`, network down | List dialog: "Could not load saved queries · Failed to fetch" | Meaningless |
| `POST /auth/logout` 500 | Nothing: the menu stays open, still logged in, no message | **Silent failure** |
| `POST /compliance/invalidate` fails (read from the code: same pattern as logout) | Nothing | **Silent failure** |
| `DELETE /saved-queries/{id}` fails (read from the code) | The whole list is replaced by the raw error | Loses the list |

Nothing crashed: every panel survived each failure. The problems are the wording and the silent failures. The console already gets a "Failed to load resource: 500" line from the browser, but our own `console.error` lines lose the status whenever the server sent an `{error}` body (the message is replaced by that text).

### Point 8: why the dictionary preview overflows (measured)

`.qb-doc-field-blurb` (the one-line text in a closed field row) is `flex: 1 0 100%` with `padding-left: 3rem`, and its `box-sizing` is `content-box` (Fomantic does not reset it on plain elements). Its box is therefore 100% of the row **plus** 3rem, and it sticks out of its card (measured: 34 px past the right edge in Chromium at the default width). When the row opens, the blurb is hidden and the full text is drawn in the body, which fits: that is exactly what users reported. With `box-sizing: border-box` it fits (measured: 8 px inside).

### Point 3: why the existing hover text never shows (measured)

`fomantic.ts` already puts the chosen text in a `title` on the dropdown's `.text`. But Facet, Field and Operator are `search` dropdowns: their typing box (`input.search`) lies on top of `.text`, so the pointer is always over the input, which has no `title` (checked with `elementFromPoint`). The placeholder "Operator…" also got a pointless title. Value text boxes have no title at all.

## Questions for the backend team (send before Task 3 and Task 4)

1. **`GET /users/me`**: which spelling is actually serialised, `sub` or `user_id`, `preferred_username` or `username`? (The frontend reads only `display_name`, and `sub` / `user_id` if that is blank, so either works, but the mock should send what the backend sends.) Do login, callback and logout stay at `/auth/login`, `/auth/callback` and `/auth/logout`? Is the answer still `401` for an anonymous visitor?
2. **`POST /filter/execute`**: proposed shape (changes from the draft are marked ★):

   ```json
   {
     "events": [
       {
         "id": "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10",
         "items": [
           { "facet_label": "<individual label>", "values": [ { "<field label>": "text", "<field label>": 42 } ] }
         ]
       }
     ]
   }
   ```

   - ★ Each event is an **object** `{ "id", "items" }`. The draft's `["id": …, "items": …]` is not valid JSON.
   - ★ **One naming style.** The rest of the API is camelCase (`totalEntrysets`, `matchCount`, `errorMessages`, `facetId`), but `/users/me` and this draft are snake_case (`facet_label`, `display_name`). Either works for us; please pick one for the whole API, or tell us the API is moving to snake_case.
   - ★ **What does the `values` list mean?** We read it as one object per occurrence of the facet in the event. Can a facet really occur more than once in one event? If never, `values` should be a single object. Can the same `facet_label` appear twice in `items`? (We merge them if it does.)
   - ★ A field without a value: please leave the key out, or send `null` (we treat both as "no value").
   - ★ Please add **`"truncated": true|false`** (or the total count). The result is capped (25 in the mock), and today the UI cannot tell "exactly 25 matches" from "more than 25".
   - Optional: the **database label per event**, so users can see where an event comes from.
   - Is the request body still the `QueryRequest` of `/stats`, with the same `401` (no session) and `403` (no compliance reason) answers? Is `id` unique across databases?
3. **`{ "error": … }` texts**: the frontend will no longer show them to users (console only). Is there a `403` whose reason users must read (for example "not allowed to query database X")? If so, send it in a separate, user-facing field.

## Global Constraints

Every task's requirements include these (from `CLAUDE.md` and `docs/ARCHITECTURE.md`):

- **`src/` never names backend data** (no facet, field, tag, group, database or company from the mock or the real backend, not even in a comment or example). Deployment-specific things go in `src/config.ts`, which ships neutral. `tests/noBackendDataInSrc.test.ts` enforces this.
- **Offline-first:** no CDN, web font or remote image. A new SVG must be self-contained, with no namespace other than `http://www.w3.org/2000/svg`. `npm run build` runs `check:offline`.
- **Only `src/ui/fomantic.ts` uses jQuery**; `src/` never imports `mock-server/`; only `src/api/` imports `src/api/types.ts` (ESLint enforces all three).
- **The backend interprets the query:** the frontend never rewrites a condition.
- **Do not rename headings in `docs/ARCHITECTURE.md`**: code cites them by exact title (`tests/docReferences.test.ts`). Every new code comment that cites a section uses an existing title.
- **The architecture doc changes in the same commit as the code it describes.** `docs/CHANGELOG.md` is an archive: do not touch it.
- **Junior audience:** comments say *why*; names say what a thing is; logic lives in small pure functions with Node tests.
- **Colours only through `:root` tokens.** A text colour must reach 4.5:1 (`PAIRS` in `tests/themeContrast.test.ts`); a colour that carries meaning without text (a bar, a focus ring) must reach 3:1.
- **Before every commit:** `npm run typecheck && npm test && npm run lint && npm run build`, then read the whole diff (easy for a junior to maintain? could it break Fomantic's behaviour? does the doc still describe the code?). Check UI changes in Chromium with Playwright.
- **Second dev server**, beside anyone else's: `DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts` and `DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort`. Stop only the processes you started, found by port and working directory; never `pkill` by name.
- **Commit messages** end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- **No pull request** unless the maintainers ask for one at that moment: push the branch and say so. Run `git fetch origin` before starting and again before pushing; if `origin/main` moved, merge it in, re-run the checks and report what changed upstream.

---

## File map

| File | Tasks | Responsibility after this plan |
|---|---|---|
| `mock-server/httpErrors.ts` (new) | 1 | Parses `MOCK_HTTP_ERRORS` and matches a request to a simulated failure. |
| `mock-server/server.ts` | 1, 3, 4 | Route table; answers simulated failures first; `/users/me`; `/filter/execute`. |
| `mock-server/index.ts` | 1 | Reads `MOCK_HTTP_ERRORS`. |
| `mock-server/auth.ts` | 3 | Mock sessions hold a `UserResponse`. |
| `mock-server/events.ts` (new) | 4 | Stored event → `EventResponse` (GUID id, item list). |
| `mock-server/vehicleData.ts` | 4 | Its own `Entryset` type for the data file. |
| `src/api/client.ts` | 2, 3, 4 | `ApiError` message for the console, new `NetworkError`, `/users/me`, `/filter/execute`. |
| `src/api/errorText.ts` (new) | 2 | `userMessage(err)`: the plain words a panel shows for a failed request. |
| `src/api/types.ts` | 3, 4 | `UserResponse`; `EventsResponse` / `EventResponse` / `EventItemResponse`. |
| `src/api/response.ts` | 3, 4 | `toUser` from `display_name`; `toEvent` for the new shape. |
| `src/model.ts` | 4 | `EventRecord.id: string`, values as a list of occurrences. |
| `src/app.ts` | 2, 9, 14 | Friendly errors, `showError`, the login dialog's actions, the group announcement. |
| `src/main.ts` | 2, 9 | Fatal page wording, `showError` wiring, renderer keys. |
| `src/state.ts` | 9 | `SavedDialog` gains the two login kinds. |
| `src/config.ts` | 7 | `TEXT_SOURCES` (logo + hover label for our and third-party texts). |
| `public/sources/third-party.svg` (new) | 7 | A neutral placeholder logo. |
| `src/ui/fomantic.ts` | 2, 5 | `showToast(message, kind)`; titles on the element the pointer hits. |
| `src/ui/valueControl.ts` | 5 | Value boxes carry their value as a title. |
| `src/ui/queryBuilder.ts` | 5, 9, 11 | Title follows typing; no login note; server issues highlighted. |
| `src/ui/docsField.ts` (new) | 8 | `fieldPreview`: what a field row shows closed, and what opening adds. |
| `src/ui/docsSidebar.ts` | 6, 7, 8 | Source logos; leaf rows with full text; "More: …" hint. |
| `src/ui/savedQueries.ts` | 9 | The login dialog. |
| `src/ui/dataPreview.ts` | 4, 9 | Short GUID, values from occurrences; `LOGIN_FIRST_NOTE` only for Run. |
| `src/ui/statsPanel.ts` | 10 | Split bar, failed rows as red bars, **Show problem**. |
| `src/ui/databasePicker.ts` | 10 | `failureReasons` shared with the statistics rows. |
| `src/ui/mascot.ts` | 13 | New disappointed rules. |
| `src/query/types.ts`, `src/query/issues.ts` | 11 | `Issue.fromServer`. |
| `src/query/tree.ts`, `src/query/drop.ts` | 14 | `groupOf`; a tag drop becomes one group; `addedNodesMessage`. |
| `src/styles.css` | 5, 6, 7, 8, 9, 10, 11, 12 | Overflow fix, logos, hint, bars, warning line, spin. |
| `docs/ARCHITECTURE.md` | every task | Kept in step, section by section. |

---

### Task 0: Branch and workspace

**Files:** none.

- [ ] **Step 1: Start from a fresh `origin/main`**

```bash
git fetch origin
git switch -c claude/user-feedback-round origin/main
npm ci
```

Expected: `npm ci` ends without errors. (A worktree needs its own `npm ci`: a symlinked `node_modules` makes Vite answer 403 for Fomantic's fonts.)

- [ ] **Step 2: Bring this plan onto the branch**

Copy `docs/superpowers/plans/2026-10-13-user-feedback-round.md` from the planning branch (`git checkout claude/frontend-feedback-plan-ddc17d -- docs/superpowers/plans/2026-10-13-user-feedback-round.md`, or copy the file), then confirm the baseline is green:

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all four pass on untouched `origin/main`. If not, stop and report: do not build on a red baseline.

- [ ] **Step 3: Commit the plan**

```bash
git add docs/superpowers/plans/2026-10-13-user-feedback-round.md
git commit -m "Add the implementation plan for the 2026-10-13 feedback round

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Simulated HTTP errors in the mock (point 7, tooling)

Read first: `docs/ARCHITECTURE.md`, "Mock server".

**Files:**
- Create: `mock-server/httpErrors.ts`
- Modify: `mock-server/server.ts` (`MockConfig`, `createMockServer`)
- Modify: `mock-server/index.ts`
- Test: `tests/mock-server/httpErrors.test.ts` (new), `tests/mock-server/server.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Mock server" (environment table) and "How do I…"

**Interfaces:**
- Produces: `interface HttpErrorRule { method: string; path: string; status: number; html: boolean }`, `parseHttpErrors(text: string | undefined): HttpErrorRule[]`, `httpErrorFor(rules: HttpErrorRule[], method: string, path: string): HttpErrorRule | undefined`, and `MockConfig.httpErrors?: HttpErrorRule[]`. Tasks 2 and 15 use the `MOCK_HTTP_ERRORS` variable to check the GUI.

- [ ] **Step 1: Write the failing parser tests**

`tests/mock-server/httpErrors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { httpErrorFor, parseHttpErrors } from "../../mock-server/httpErrors";

describe("parseHttpErrors", () => {
  it("is empty when the variable is unset or blank", () => {
    expect(parseHttpErrors(undefined)).toEqual([]);
    expect(parseHttpErrors("  ")).toEqual([]);
  });

  it("reads rules separated by commas", () => {
    expect(parseHttpErrors("POST /saved-queries=500, GET /databases=502:html")).toEqual([
      { method: "POST", path: "/saved-queries", status: 500, html: false },
      { method: "GET", path: "/databases", status: 502, html: true },
    ]);
  });

  it("accepts * for any method or any path", () => {
    expect(parseHttpErrors("* *=503")).toEqual([
      { method: "*", path: "*", status: 503, html: false },
    ]);
  });

  it.each(["POST /x", "POST /x=200", "post /x=500", "POST x=500", "POST /x=600"])(
    "refuses %s, naming the variable",
    (rule) => {
      expect(() => parseHttpErrors(rule)).toThrow("MOCK_HTTP_ERRORS");
    },
  );
});

describe("httpErrorFor", () => {
  const rules = parseHttpErrors(
    "POST /saved-queries=500, DELETE /saved-queries/*=404, * /stats=503",
  );

  it("matches the method and the path exactly", () => {
    expect(httpErrorFor(rules, "POST", "/saved-queries")?.status).toBe(500);
    expect(httpErrorFor(rules, "GET", "/saved-queries")).toBeUndefined();
  });

  it("a path ending in /* matches everything below it, not itself", () => {
    expect(httpErrorFor(rules, "DELETE", "/saved-queries/abc")?.status).toBe(404);
    expect(httpErrorFor(rules, "DELETE", "/saved-queries")).toBeUndefined();
  });

  it("* matches any method", () => {
    expect(httpErrorFor(rules, "POST", "/stats")?.status).toBe(503);
  });

  it("the first matching rule wins", () => {
    const two = parseHttpErrors("GET /databases=500, * *=503");
    expect(httpErrorFor(two, "GET", "/databases")?.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/mock-server/httpErrors.test.ts`
Expected: FAIL, "Failed to load url ../../mock-server/httpErrors".

- [ ] **Step 3: Write `mock-server/httpErrors.ts`**

```ts
/**
 * MOCK_HTTP_ERRORS: make chosen routes answer with an HTTP error, to see how
 * the frontend copes when the backend fails (docs/ARCHITECTURE.md, "Mock
 * server"). The variable holds rules separated by commas:
 *
 *     MOCK_HTTP_ERRORS="POST /saved-queries=500, GET /databases=502:html"
 *
 * Each rule is `METHOD PATH=STATUS`. PATH is below the API prefix
 * ("/saved-queries", not "/api/v1/saved-queries"). `*` as METHOD or PATH
 * matches anything, and a PATH ending in "/*" matches everything below it
 * ("/saved-queries/*" is every saved query's own path). `:html` answers with a
 * small HTML page instead of the usual `{ "error": … }` JSON, as a proxy or
 * gateway in front of a real backend would. The first matching rule wins.
 */
export interface HttpErrorRule {
  /** "GET", "POST", … or "*". */
  method: string;
  /** Below the API prefix, e.g. "/stats"; or "*"; or ending in "/*". */
  path: string;
  /** 400–599. */
  status: number;
  /** Answer with an HTML page instead of JSON. */
  html: boolean;
}

const RULE = /^(\*|[A-Z]+)\s+(\*|\/\S*)\s*=\s*(\d{3})(:html)?$/;

/** The rules in `text` (the variable's value). Throws on a rule it can't read,
 *  so a typo stops the mock at startup instead of silently doing nothing. */
export function parseHttpErrors(text: string | undefined): HttpErrorRule[] {
  if (!text || !text.trim()) return [];
  return text.split(",").map((part) => {
    const rule = part.trim();
    const m = RULE.exec(rule);
    const status = m ? Number(m[3]) : 0;
    if (!m || status < 400 || status > 599) {
      throw new Error(
        `MOCK_HTTP_ERRORS: "${rule}" should look like "POST /saved-queries=500" ` +
          `(a status from 400 to 599, optionally followed by ":html").`,
      );
    }
    return { method: m[1]!, path: m[2]!, status, html: m[4] !== undefined };
  });
}

function pathMatches(rulePath: string, path: string): boolean {
  if (rulePath === "*" || rulePath === path) return true;
  // "/saved-queries/*": anything below "/saved-queries/".
  return rulePath.endsWith("/*") && path.startsWith(rulePath.slice(0, -1));
}

/** The rule that makes `method path` fail, if any. `path` is below the prefix. */
export function httpErrorFor(
  rules: HttpErrorRule[],
  method: string,
  path: string,
): HttpErrorRule | undefined {
  return rules.find(
    (r) => (r.method === "*" || r.method === method) && pathMatches(r.path, path),
  );
}
```

- [ ] **Step 4: Run the parser tests**

Run: `npx vitest run tests/mock-server/httpErrors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing server test**

In `tests/mock-server/server.test.ts`, add at the end of the file (it starts its own server, so the shared one stays free of simulated failures):

```ts
describe("MOCK_HTTP_ERRORS", () => {
  let failing: Server;
  let failingBase: string;

  beforeAll(async () => {
    failing = createMockServer({
      apiBase: API,
      failRate: 0,
      lineDelayMs: () => 0,
      httpErrors: parseHttpErrors("GET /databases=503, GET /individuals=502:html"),
    });
    await new Promise<void>((resolve) => failing.listen(0, resolve));
    failingBase = `http://localhost:${(failing.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => failing.close(resolve));
  });

  it("answers a matching route with the simulated status and a JSON error", async () => {
    const res = await fetch(`${failingBase}${API}/databases`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: `Simulated HTTP 503 for GET ${API}/databases (MOCK_HTTP_ERRORS).`,
    });
  });

  it("answers with an HTML page for a :html rule", async () => {
    const res = await fetch(`${failingBase}${API}/individuals`);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("leaves every other route alone", async () => {
    expect((await fetch(`${failingBase}${API}/compliance/status`)).status).toBe(200);
  });
});
```

Add `import { parseHttpErrors } from "../../mock-server/httpErrors";` to the imports.

- [ ] **Step 6: Run it and see it fail**

Run: `npx vitest run tests/mock-server/server.test.ts -t "MOCK_HTTP_ERRORS"`
Expected: FAIL. `httpErrors` is not a known `MockConfig` key (a type error under `npm run typecheck`), and the route answers 200.

- [ ] **Step 7: Answer simulated failures first in `mock-server/server.ts`**

In `MockConfig`, add:

```ts
  /** Routes that answer with an HTTP error instead (MOCK_HTTP_ERRORS, httpErrors.ts). */
  httpErrors?: HttpErrorRule[];
```

Import `import { httpErrorFor, type HttpErrorRule } from "./httpErrors";`. Add this function under `sendFlowError`:

```ts
/** A failure MOCK_HTTP_ERRORS asked for: JSON like every API error, or an
 *  HTML page like a proxy in front of the backend would send. */
function sendSimulatedError(res: ServerResponse, rule: HttpErrorRule, request: string): void {
  if (rule.html) {
    sendHtml(res, rule.status, page(`${rule.status}`, `<h1>${rule.status}</h1><p>Simulated.</p>`));
    return;
  }
  sendJson(res, rule.status, { error: `Simulated HTTP ${rule.status} for ${request} (MOCK_HTTP_ERRORS).` });
}
```

In `createMockServer`, right after `const url = …`:

```ts
    // A simulated failure wins over the real route (MOCK_HTTP_ERRORS).
    const below = url.pathname.startsWith(config.apiBase)
      ? url.pathname.slice(config.apiBase.length)
      : null;
    const simulated =
      below === null ? undefined : httpErrorFor(config.httpErrors ?? [], req.method ?? "", below);
    if (simulated) {
      sendSimulatedError(res, simulated, `${req.method} ${url.pathname}`);
      return;
    }
```

- [ ] **Step 8: Read the variable in `mock-server/index.ts`**

Add `import { parseHttpErrors } from "./httpErrors";` and, before `createMockServer(`:

```ts
const httpErrors = parseHttpErrors(process.env.MOCK_HTTP_ERRORS);
if (httpErrors.length > 0) {
  console.log(`MOCK_HTTP_ERRORS: ${process.env.MOCK_HTTP_ERRORS}`);
}
```

and pass `httpErrors,` in the config object.

- [ ] **Step 9: Run the tests**

Run: `npx vitest run tests/mock-server`
Expected: PASS.

- [ ] **Step 10: Document it**

In `docs/ARCHITECTURE.md`, "Mock server", add a row to the environment table:

```
| `MOCK_HTTP_ERRORS` | unset | Routes that answer with an HTTP error instead, to see how the app copes: `METHOD PATH=STATUS` rules separated by commas, PATH below the prefix, `*` for any method or path, `/*` at the end of a path for everything below it, `:html` for an HTML page instead of JSON (`mock-server/httpErrors.ts`). Example: `MOCK_HTTP_ERRORS="POST /saved-queries=500, GET /databases=502:html"`. |
```

Change the sentence "Besides `.env`, two environment variables" to "Besides `.env`, three environment variables". Under "How do I…", add:

```
**…see how the app copes with a failing backend?** Start the mock with
`MOCK_HTTP_ERRORS` (see "Mock server"), e.g.
`MOCK_HTTP_ERRORS="POST /stats=503" npm run dev`. A dead network (no answer
at all) cannot be simulated by the mock: in a Playwright check use
`page.route(url, (route) => route.abort("connectionrefused"))`.
```

- [ ] **Step 11: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add mock-server/httpErrors.ts mock-server/server.ts mock-server/index.ts tests/mock-server/httpErrors.test.ts tests/mock-server/server.test.ts docs/ARCHITECTURE.md
git commit -m "Mock: simulate HTTP errors per route with MOCK_HTTP_ERRORS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plain error messages in the GUI, details in the console (point 7)

Read first: `docs/ARCHITECTURE.md`, "API contract" (its first paragraph), "Reading responses" and "Error and loading model".

**Files:**
- Create: `src/api/errorText.ts`
- Modify: `src/api/client.ts` (`ApiError` message, `NetworkError`, wrapping `fetch` and body reads)
- Modify: `src/app.ts` (`errorMessage` → `userMessage`, `showError` dependency, logout / invalidate / delete)
- Modify: `src/main.ts` (fatal page, `showError` wiring)
- Modify: `src/ui/fomantic.ts` (`showToast` kind)
- Test: `tests/api/errorText.test.ts` (new), `tests/api/client.test.ts`, `tests/app.test.ts`
- Docs: `docs/ARCHITECTURE.md` (the three sections above, and "How do I… find out why the app says …")

**Interfaces:**
- Produces: `class NetworkError extends Error` (client.ts); `ApiError` keeps `constructor(status: number, message: string)`, but its message is now always `"<METHOD> <url> failed: <status> <statusText>[: <server text>]"`; `userMessage(err: unknown): string` (errorText.ts); `AppDeps.showError(message: string): void`; `showToast(message: string, kind?: "success" | "error"): void`.
- Removes: `errorMessage` from `src/app.ts`.

- [ ] **Step 1: Write the failing `userMessage` tests**

`tests/api/errorText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { userMessage } from "../../src/api/errorText";
import { ApiError, NetworkError, TimeoutError } from "../../src/api/client";
import { ContractError } from "../../src/api/contract";

const api = (status: number) => new ApiError(status, `GET /x failed: ${status} STATUS: secret`);

describe("userMessage", () => {
  it("never shows the server's text, a status code or a URL", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      const text = userMessage(api(status));
      expect(text).not.toContain("secret");
      expect(text).not.toContain(String(status));
      expect(text).not.toContain("/x");
    }
  });

  it("says the server can't be reached when there was no answer", () => {
    expect(userMessage(new NetworkError("GET /x", new TypeError("Failed to fetch")))).toBe(
      "The server can't be reached. Check your network connection, then try again.",
    );
  });

  it("says the server was too slow on a timeout", () => {
    expect(userMessage(new TimeoutError())).toBe(
      "The server took too long to answer. Try again in a moment.",
    );
  });

  it("says the answer could not be understood on a contract error", () => {
    expect(userMessage(new ContractError("GET /x", '"label" is missing.'))).toBe(
      "The server sent an answer this app doesn't understand. Reload the page; if that doesn't help, contact support.",
    );
  });

  it.each([
    [401, "Your login has expired. Log in again, then try again."],
    [403, "You don't have permission to do this. If you think you should, contact support."],
    [404, "The server couldn't find what was asked for. Reload the page and try again."],
    [429, "The server is busy or unavailable right now. Try again in a moment."],
    [502, "The server is busy or unavailable right now. Try again in a moment."],
    [503, "The server is busy or unavailable right now. Try again in a moment."],
    [500, "The server ran into a problem. Try again in a moment; if it keeps happening, contact support."],
    [400, "The server didn't accept this request. Reload the page and try again; if it keeps happening, contact support."],
  ])("explains HTTP %i in plain words", (status, text) => {
    expect(userMessage(api(status))).toBe(text);
  });

  it("has a fallback for anything else", () => {
    expect(userMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again; if it keeps happening, reload the page.",
    );
    expect(userMessage("not even an error")).toContain("Something went wrong");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/api/errorText.test.ts`
Expected: FAIL (no `errorText.ts`, no `NetworkError`).

- [ ] **Step 3: Add `NetworkError` and the console-friendly `ApiError` message to `src/api/client.ts`**

Replace the `ApiError` doc comment, and add `NetworkError` after `TimeoutError`:

```ts
/** The server answered with an HTTP error status (4xx/5xx). The message is for
 *  the console: the request, the status code and text, and the server's own
 *  `{ "error": … }` text if it sent one. Users are shown `userMessage`
 *  (src/api/errorText.ts) instead. */
export class ApiError extends Error {
```

```ts
/** No answer at all: the server is down or unreachable, or the connection
 *  broke. (fetch rejects with a bare TypeError, "Failed to fetch", for all of
 *  these; this names the request so the console says which one.) */
export class NetworkError extends Error {
  constructor(source: string, cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    super(`${source} failed: no answer from the server (${why})`);
    this.name = "NetworkError";
  }
}

/** `err` as a NetworkError if it is fetch's "no answer" TypeError. An abort
 *  (ours, or the timeout's TimeoutError) is not a TypeError and passes through. */
function asNetworkError(err: unknown, source: string): unknown {
  return err instanceof TypeError ? new NetworkError(source, err) : err;
}
```

In `send`, replace `const res = await fetch(url, init);` with:

```ts
    const res = await fetch(url, init).catch((err: unknown) => {
      throw asNetworkError(err, source);
    });
```

In `readJson`, replace `await res.text()` with:

```ts
  const text = await res.text().catch((err: unknown) => {
    throw asNetworkError(err, source);
  });
  return ResponseValue.parse(text, source);
```

In `readLines`, replace `const { value, done } = await reader.read();` with:

```ts
      const { value, done } = await reader.read().catch((err: unknown) => {
        throw asNetworkError(err, source); // the connection broke mid-stream
      });
```

Replace `errorFromResponse` with:

```ts
/** The request, the status line and, when the answer has the usual
 *  `{ "error": "…" }` body, that text: everything someone debugging needs. */
async function errorFromResponse(res: Response, source: string): Promise<ApiError> {
  const statusLine = `${source} failed: ${res.status} ${res.statusText}`.trim();
  let serverText = "";
  try {
    const error = (JSON.parse(await res.text()) as { error?: unknown } | null)?.error;
    if (typeof error === "string") serverText = error.trim();
  } catch {
    /* no JSON error body: the status line says enough */
  }
  return new ApiError(res.status, serverText ? `${statusLine}: ${serverText}` : statusLine);
}
```

- [ ] **Step 4: Write `src/api/errorText.ts`**

```ts
import { ApiError, NetworkError, TimeoutError } from "./client";
import { ContractError } from "./contract";

/**
 * What a panel tells the user when a request failed (docs/ARCHITECTURE.md,
 * "Error and loading model"). Plain words for the kind of failure, and what
 * the user can do about it. Never the server's own text, a status code or a
 * URL: they mean nothing to a user and can show internals (a stack trace, a
 * table name). Those are in the error's message, which app.ts logs to the
 * console with `console.error`.
 *
 * The panel around this text already says WHAT failed ("Couldn't get
 * statistics"), so this only says why.
 */
export function userMessage(err: unknown): string {
  if (err instanceof NetworkError) {
    return "The server can't be reached. Check your network connection, then try again.";
  }
  if (err instanceof TimeoutError) {
    return "The server took too long to answer. Try again in a moment.";
  }
  if (err instanceof ContractError) {
    return "The server sent an answer this app doesn't understand. Reload the page; if that doesn't help, contact support.";
  }
  if (err instanceof ApiError) return statusMessage(err.status);
  return "Something went wrong. Try again; if it keeps happening, reload the page.";
}

/** Busy or unreachable for a moment: trying again later can work. */
const TRY_LATER = new Set([408, 429, 502, 503, 504]);

function statusMessage(status: number): string {
  if (status === 401) return "Your login has expired. Log in again, then try again.";
  if (status === 403) {
    return "You don't have permission to do this. If you think you should, contact support.";
  }
  if (status === 404) {
    return "The server couldn't find what was asked for. Reload the page and try again.";
  }
  if (TRY_LATER.has(status)) {
    return "The server is busy or unavailable right now. Try again in a moment.";
  }
  if (status >= 500) {
    return "The server ran into a problem. Try again in a moment; if it keeps happening, contact support.";
  }
  return "The server didn't accept this request. Reload the page and try again; if it keeps happening, contact support.";
}
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run tests/api/errorText.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the client tests**

In `tests/api/client.test.ts`, import `NetworkError`. Replace the test "throws an ApiError carrying the response status" with:

```ts
  it("throws an ApiError whose message carries everything the console needs", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(401, { error: "nope" }));
    await expect(getDatabases()).rejects.toBeInstanceOf(ApiError);
    await expect(getDatabases()).rejects.toMatchObject({
      status: 401,
      message: "GET /api/v1/databases failed: 401 STATUS: nope",
    });
  });

  it("turns a request that got no answer into a NetworkError naming it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(getDatabases()).rejects.toBeInstanceOf(NetworkError);
    await expect(getDatabases()).rejects.toThrow(
      "GET /api/v1/databases failed: no answer from the server (Failed to fetch)",
    );
  });
```

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS, including the existing timeout and abort tests. They prove that an abort is not turned into a `NetworkError`.

- [ ] **Step 7: Write the failing app tests**

In `tests/app.test.ts`:

1. In `setup`, add `const showError = vi.fn();`, pass it to `createApp({ store, api, navigate, announce, showError })`, and return it.
2. Replace the expected error texts (the panels now show plain words):
   - "a 403 for another reason shows its message instead of redirecting" → rename it to "a 403 for another reason shows a plain message instead of redirecting", and expect `{ status: "error", error: "You don't have permission to do this. If you think you should, contact support." }`.
   - "a 403 whose compliance check fails shows the 403's message" → same expected text.
   - "shows any other error" (Run) → `error: "Something went wrong. Try again; if it keeps happening, reload the page."`.
   - "shows a failed request's error" (stats) → `toMatchObject({ status: "error", error: "Something went wrong. Try again; if it keeps happening, reload the page." })`.
   - "shows a failed list load and loads again on retry" (`ApiError(500, "down")`) → `error: "The server ran into a problem. Try again in a moment; if it keeps happening, contact support."`.
   - "shows any other error in the dialog" (`ApiError(500, "disk full")`) → the same 500 text.
3. Replace "shows a failed delete in the list" with:

```ts
  it("a delete whose query is already gone counts as deleted", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(404, "gone"))),
      listSavedQueries: vi.fn(async () => []),
    });
    const { app, store, showError } = setup(
      { ...loggedIn, ...ready(), savedDialog: "list", savedList: { status: "ok", queries: [a] } },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(showError).not.toHaveBeenCalled();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [] });
  });

  it("a failed delete keeps the list and says so in a toast", async () => {
    const api = fakeApi({
      deleteSavedQuery: vi.fn(async () => Promise.reject(new ApiError(503, "down"))),
    });
    const { app, store, showError } = setup(
      { ...loggedIn, ...ready(), savedDialog: "list", savedList: { status: "ok", queries: [a] } },
      api,
    );
    app.askDeleteSaved("a");
    app.confirmSavedAction();
    await flushPromises();
    expect(store.getState().savedList).toEqual({ status: "ok", queries: [a] });
    expect(showError).toHaveBeenCalledWith(
      `Couldn't delete “${a.name}”. The server is busy or unavailable right now. Try again in a moment.`,
    );
  });
```

4. Add to the logout / compliance tests (find the `describe` that calls `app.onLogout()`):

```ts
  it("says so when logging out fails", async () => {
    const api = fakeApi({ logout: vi.fn(async () => Promise.reject(new ApiError(500, "x"))) });
    const { app, store, showError } = setup({ ...ready(), ...loggedIn }, api);
    app.onLogout();
    await flushPromises();
    expect(store.getState().auth.status).toBe("authenticated");
    expect(showError).toHaveBeenCalledWith("Couldn't log out. Try again.");
  });

  it("says so when invalidating the compliance reason fails", async () => {
    const api = fakeApi({
      invalidateCompliance: vi.fn(async () => Promise.reject(new ApiError(500, "x"))),
    });
    const { app, showError } = setup({ ...ready(), ...loggedIn }, api);
    app.onInvalidateCompliance();
    await flushPromises();
    expect(showError).toHaveBeenCalledWith("Couldn't invalidate the compliance reason. Try again.");
  });
```

(`loggedIn` and `a` are existing fixtures of the saved-queries tests. If the logout tests live above them, move those two `const`s to the fixtures section at the top.)

Run: `npx vitest run tests/app.test.ts`
Expected: FAIL. TypeScript rejects `showError`, and the texts differ.

- [ ] **Step 8: Change `src/app.ts`**

1. Imports: `import { ApiError, COMPLIANCE_START_URL, LOGIN_URL } from "./api/client";` stays; add `import { userMessage } from "./api/errorText";`.
2. Delete `errorMessage` and its doc comment.
3. In `AppDeps`, add:

```ts
  /** Tell the user that something they asked for failed, when no panel has a
   *  place for it (logging out, a delete): a short toast, also spoken. */
  showError(message: string): void;
```

and destructure it: `export function createApp({ store, api, navigate, announce, showError }: AppDeps) {`.

4. Every `errorMessage(err)` that ends up in state becomes `userMessage(err)`: `showError` inside `runPreview` (rename that local to `showRunError`, so it does not shadow the new dependency), `refreshStats`, and `savedCallFailed`. Every `console.error(…, errorMessage(err))` logs `err` itself, so the console shows the request, the status and the stack: in the two `start()` catches, in `onLogout` and in `onInvalidateCompliance`.
5. `onLogout`'s catch:

```ts
      .catch((err) => {
        console.error("Logout failed:", err);
        // The menu still shows the user: say why nothing happened.
        showError("Couldn't log out. Try again.");
      });
```

6. `onInvalidateCompliance`'s catch:

```ts
      .catch((err) => {
        console.error("Invalidate compliance failed:", err);
        showError("Couldn't invalidate the compliance reason. Try again.");
      });
```

7. Replace `deleteSaved` with:

```ts
  function deleteSaved(id: string): void {
    const name = listedQuery(id)?.name;
    const deleted = () => {
      const { openSaved, savedDialog } = store.getState();
      // The query on screen stays; it just no longer belongs to a saved one.
      if (openSaved?.id === id) store.setState({ openSaved: null });
      if (name !== undefined) announce(`Deleted “${name}”.`);
      if (savedDialog === "list") loadSavedList();
    };
    api
      .deleteSavedQuery(id)
      .then(deleted)
      .catch((err) => {
        // Already gone (deleted in another tab): that is what the user wanted.
        if (err instanceof ApiError && err.status === 404) return deleted();
        // Keep the list on screen: replacing it with an error would hide every
        // other saved query because one delete failed.
        savedCallFailed(err, (error) =>
          showError(`Couldn't delete “${name ?? "the saved query"}”. ${error}`),
        );
      });
  }
```

- [ ] **Step 9: A toast that can say "error", and the wiring in `src/main.ts`**

In `src/ui/fomantic.ts`, change `showToast`:

```ts
/** A small, self-dismissing message at the top of the page. `kind` sets its
 *  colour: green for good news, red for a failure. */
export function showToast(message: string, kind: "success" | "error" = "success"): void {
  // preserveHTML: false shows the message as plain text, never as markup.
  $("body").toast({
    message,
    class: kind,
    displayTime: kind === "error" ? 6000 : 3000,
    showProgress: false,
    preserveHTML: false,
  });
}
```

(An error stays longer: it has to be read, not just noticed.)

In `src/main.ts`: import `userMessage` from `./api/errorText` instead of `errorMessage`. Pass the new dependency where `createApp` is called:

```ts
  // A failure with no panel to show it in: a red toast, and the same words
  // for screen readers (a Fomantic toast is not a live region).
  showError: (message) => {
    showToast(message, "error");
    shell.announce(message);
  },
```

In `showFatalError`, change the paragraph to:

```ts
      <p>${escapeHtml(userMessage(err))}</p>
      <p class="qb-muted">Technical details are in the browser console.</p>
```

- [ ] **Step 10: Run all tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 11: Check in the browser**

Start the private servers from "Global Constraints", the mock with `MOCK_HTTP_ERRORS="POST /saved-queries=500, POST /stats=503:html"`. In Chromium (Playwright), log in through the mock, add a dictionary item, and check:
- The statistics card says "Couldn't get statistics · The server is busy or unavailable right now. Try again in a moment." The console has one `console.error` line containing `POST /api/v1/stats failed: 503`.
- **Save…** → Save shows "The server ran into a problem. …" in the dialog, with no "Simulated" or "/api/v1".
- With `page.route("**/api/v1/auth/logout", r => r.fulfill({ status: 500 }))`: **Log out** shows a red toast "Couldn't log out. Try again.".
- With `page.route("**/api/v1/databases", r => r.abort("connectionrefused"))`: the fatal page says "The server can't be reached. …" and "Technical details are in the browser console.", and **Reload** has the focus.

Stop only the servers you started.

- [ ] **Step 12: Update the architecture doc**

- "API contract", first paragraph: replace "which the client throws as an `ApiError` carrying the HTTP `status` (without such a body, the message names the request and the status line: `GET /api/v1/databases failed: 502 Bad Gateway`)" with: "which the client throws as an `ApiError` carrying the HTTP `status`. Its message is for the console: the request, the status line and the server's text (`POST /api/v1/saved-queries failed: 500 Internal Server Error: …`). A request that gets no answer at all (server down, network gone) rejects with a `NetworkError` that names the request."
- "Reading responses": replace "It is shown where any failed request is shown (the full-page startup error, the statistics panel, Matching events) and logged to the console with its stack." with "It is logged to the console with its stack; the panel that made the request shows the plain message for it (\"Error and loading model\")."
- "Error and loading model", second bullet: replace "The panel then shows a `ui negative message` with the text; no old data is kept" with: "The panel then shows a `ui negative message` with `userMessage(err)` (`src/api/errorText.ts`): plain words for the kind of failure (no answer, too slow, an answer the app can't read, or the HTTP status's meaning), never the server's text, a status code or a URL (users found those confusing, 2026-10-13). No old data is kept." Change "The error itself, with its stack, is logged to the console." to "The error itself, with the request, the status code and text, the server's text and the stack, is logged to the console." Add a bullet: "An action with no panel of its own (**Log out**, **Invalidate**, **Delete** in the saved-queries list) reports a failure with a red toast, also spoken (`AppDeps.showError`). Deleting a saved query that is already gone (`404`) counts as deleted." In the bullet about the fatal startup error, add that it shows `userMessage` and "Technical details are in the browser console."
- `src/api/` in "Directory layout": add the line `errorText.ts       userMessage(err) — the plain words a panel shows for a failed request.` and change `ApiError` in the `client.ts` line to `ApiError, NetworkError`.
- "How do I… find out why the app says "Unexpected response from …"?": retitle the question to `**…find out why the app says "The server sent an answer this app doesn't understand"?**` (it is a bold line, not a heading), and start the answer with "Open the browser console: the `ContractError` logged there names the request and the field." Keep the rest.
- "State and the render loop", first table row: the startup failure text is unchanged in meaning; no edit is needed beyond the above.

- [ ] **Step 13: Check, read the diff, commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git diff
git add -A
git commit -m "Show plain error messages; keep status codes and server text in the console

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /users/me` and `display_name` (point 1)

Read first: `docs/ARCHITECTURE.md`, "Data model", "Auth", "Mock server". Send question 1 of "Questions for the backend team" first. If the answer changes a spelling, change the mock's keys in Step 6 to match; nothing else depends on them.

**Files:**
- Modify: `src/api/types.ts` (`AuthUser` → `UserResponse`)
- Modify: `src/api/response.ts` (`toUser`)
- Modify: `src/api/client.ts` (`getMe` path)
- Modify: `mock-server/auth.ts`, `mock-server/server.ts`, `mock-server/audit.ts` call site
- Modify: `src/state.ts` (comment on `auth`)
- Test: `tests/api/response.test.ts`, `tests/api/client.test.ts`, `tests/mock-server/server.test.ts`, `tests/mock-server/auth.test.ts` (if it builds sessions)
- Docs: `docs/ARCHITECTURE.md` "API contract" table, "Data model", "Auth", "Mock server"

**Interfaces:**
- Produces: `interface UserResponse { sub?: string; user_id?: string; preferred_username?: string | null; username?: string | null; email?: string | null; authorizations: string[]; display_name: string }`. The model's `User` stays `{ name: string }`.

- [ ] **Step 1: Write the failing mapping test**

In `tests/api/response.test.ts`, change the import of `AuthUser` to `UserResponse`, and replace `describe("toUser", …)` with:

```ts
describe("toUser", () => {
  it("shows the display name the backend chose", () => {
    const user = read<UserResponse>({
      sub: "u-1",
      preferred_username: "pat",
      email: null,
      authorizations: [],
      display_name: "pat",
    });
    expect(toUser(user)).toEqual({ name: "pat" });
  });

  it("shows the user's id when the display name is blank, either spelling", () => {
    expect(
      toUser(read<UserResponse>({ sub: "u-1", authorizations: [], display_name: " " })),
    ).toEqual({ name: "u-1" });
    expect(
      toUser(read<UserResponse>({ user_id: "u-2", authorizations: [], display_name: "" })),
    ).toEqual({ name: "u-2" });
  });
});
```

Run: `npx vitest run tests/api/response.test.ts`
Expected: FAIL (no `UserResponse`).

- [ ] **Step 2: Replace the wire type in `src/api/types.ts`**

Replace `AuthUser` with:

```ts
/**
 * Who's logged in, returned by GET /api/users/me. The backend accepts two
 * spellings of two keys (`user_id` is another name for `sub`, `username` for
 * `preferred_username`), so either may arrive. The app reads only
 * `display_name`, which the backend fills from the username, else the email,
 * else the user id, and falls back to the id itself only if that is blank.
 */
export interface UserResponse {
  /** The user's id. Also sent as `user_id`. */
  sub?: string;
  user_id?: string;
  /** Also sent as `username`. */
  preferred_username?: string | null;
  username?: string | null;
  email?: string | null;
  /** What the user may do. Not used by the frontend yet. */
  authorizations: string[];
  /** The text to show for the user. */
  display_name: string;
}
```

- [ ] **Step 3: `toUser` and `getMe`**

`src/api/response.ts` (and change the `AuthUser` import to `UserResponse`):

```ts
export function toUser(u: ResponseObject<UserResponse>): User {
  // The backend already picked the best name (username, else email, else id).
  // A blank one shows the id, as a nameless database does.
  return { name: u.text("display_name") || u.optionalText("sub") || u.optionalText("user_id") };
}
```

`src/api/client.ts`: import `UserResponse` instead of `AuthUser`; in `getMe`, `const body = await getJson("/users/me");` and `return toUser(body.object<UserResponse>());`. Update its doc comment's wording if it names the old path.

- [ ] **Step 4: Run the mapping test**

Run: `npx vitest run tests/api/response.test.ts`
Expected: PASS.

- [ ] **Step 5: Client test**

In `tests/api/client.test.ts`, "getMe returns the user when logged in":

```ts
    const f = mockFetchOnce(200, { sub: "u-1", authorizations: [], display_name: "demo.user" });
    …
    expect(f).toHaveBeenCalledWith("/api/v1/users/me", {
```

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS.

- [ ] **Step 6: The mock**

`mock-server/auth.ts`: import `UserResponse` instead of `AuthUser`; `interface Session { user: UserResponse; … }`. Add above `exchangeCodeForSession`:

```ts
/** The one user every mock login becomes. Fictional, like all mock data. */
const MOCK_USER: UserResponse = {
  sub: "mock-user-0001",
  preferred_username: "demo.user",
  email: "demo.user@example.test",
  authorizations: [],
  display_name: "demo.user",
};
```

and in `exchangeCodeForSession`, `SESSIONS.set(sessionId, { user: MOCK_USER });`.

`mock-server/server.ts`: the route `GET ${api}/auth/me` becomes `GET ${api}/users/me` (same `currentUser` handler). In `forSessionUser`, the saved queries now belong to the user's id, the stable identifier a real backend has:

```ts
    const answer = await act(session.user.sub ?? session.user.user_id ?? "", req, res);
```

In `queryEvents`, `logQueryAudit(session.user.display_name, session.compliance.reason);`.

`tests/mock-server/server.test.ts`: rename the describe to `"GET /api/users/me and /api/compliance/status"`, use `${API}/users/me` in both requests, and make the logged-in expectation `expect(await res.json()).toMatchObject({ display_name: "demo.user", sub: "mock-user-0001" });`. Run `grep -rn "auth/me\|AuthUser\|user.name" mock-server tests src` and update every remaining hit the same way.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS (`tests/api/mockContract.test.ts` runs the real client against the mock, so it proves the two agree).

- [ ] **Step 8: Docs**

- `src/state.ts`: the `auth` comment says "via GET /api/users/me".
- "API contract" table: split the row into `| GET {prefix}/users/me | Who's logged in (`UserResponse`; the app shows `display_name`). `401` when anonymous. |` and `| GET {prefix}/auth/login, /callback, POST /logout | Login (below). |`.
- "Data model", the list of quirks: add "**The user's name** is the backend's `display_name` (it already falls back from the username to the email to the id); a blank one shows `sub` / `user_id`."
- "Auth": "`GET /api/auth/me` answers `200 AuthUser` or `401`" → "`GET /api/users/me` answers `200 UserResponse` or `401`".
- "Mock server", "Saved queries" bullet: "The user is the session's user name, the only stable user identifier the mock has, so every mock login shares one list." → "The user is the session user's `sub`; every mock login is the same fictional user, so they all share one list."

- [ ] **Step 9: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Read the user from GET /users/me and show its display_name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /filter/execute` with the new event shape (point 2)

Read first: `docs/ARCHITECTURE.md`, "Naming", "Data model", "Under the query — `dataPreview.ts` (Matching events)", "Mock server".

**Gate:** start only after the backend team has answered question 2. If they confirm the draft (a list of occurrences), follow this task as written. If `values` becomes a single object, keep `EventRecord.values` as `Record<string, Record<string, Scalar>>`, read it with `item.object<…>("values").scalars()`, and skip `fieldValues` (Step 7). Apply snake_case or camelCase key names exactly as they confirm. If they add `truncated`, add it as `truncated?: boolean` in `EventsResponse` and say "Showing the first N" in the panel. That is a small extra step: write its test like the others.

**Files:**
- Modify: `src/api/types.ts` (`EntrysetResponse` → `EventResponse`, `EventItemResponse`; `EventsResponse.events`)
- Modify: `src/model.ts` (`EventRecord`)
- Modify: `src/api/response.ts` (`toEvent`), `src/api/client.ts` (`runQuery`)
- Modify: `src/ui/dataPreview.ts` (`fieldValues`, `rowCell`, `shortId`, row id, grid)
- Create: `mock-server/events.ts`; Modify: `mock-server/vehicleData.ts`, `mock-server/server.ts`, any mock file importing `EntrysetResponse`
- Test: `tests/api/response.test.ts`, `tests/api/client.test.ts`, `tests/ui/dataPreview.test.ts`, `tests/app.test.ts` (fixture), `tests/mock-server/events.test.ts` (new), `tests/mock-server/server.test.ts`
- Docs: `docs/ARCHITECTURE.md` (sections above plus "API contract", "Compliance", "Auth", "Correctness invariant" wherever `/api/query` appears)

**Interfaces:**
- Produces: `interface EventResponse { id: string; items: EventItemResponse[] }`, `interface EventItemResponse { facet_label: string; values: Record<string, string | number | boolean | null>[] }`, `interface EventsResponse { events: EventResponse[] }`. Model: `EventRecord { id: string; values: Record<string, Record<string, Scalar>[]> }`. `fieldValues(event, facetId, fieldId): Scalar[]`, `shortId(id: string): string` (dataPreview.ts). Mock: `eventGuid(id: number): string`, `toEventResponse(e: Entryset): EventResponse`.

- [ ] **Step 1: Write the failing `toEvent` tests**

In `tests/api/response.test.ts`, change the `EntrysetResponse` import to `EventResponse` and replace `describe("toEvent", …)`:

```ts
describe("toEvent", () => {
  it("keeps the id and every occurrence of each facet, keyed by facet id then field id", () => {
    const body = {
      id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10",
      items: [{ facet_label: "thing", values: [{ size: 5 }, { size: 7, color: "red" }] }],
    };
    expect(toEvent(read<EventResponse>(body))).toEqual({
      id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10",
      values: { thing: [{ size: 5 }, { size: 7, color: "red" }] },
    });
  });

  it("leaves out a null value", () => {
    const body = { id: "e1", items: [{ facet_label: "thing", values: [{ size: 5, color: null }] }] };
    expect(toEvent(readBroken<EventResponse>(body)).values).toEqual({ thing: [{ size: 5 }] });
  });

  it("merges a facet listed twice instead of losing one", () => {
    const body = {
      id: "e1",
      items: [
        { facet_label: "thing", values: [{ size: 5 }] },
        { facet_label: "thing", values: [{ size: 6 }] },
      ],
    };
    expect(toEvent(read<EventResponse>(body)).values).toEqual({ thing: [{ size: 5 }, { size: 6 }] });
  });

  it("throws a ContractError when the id is missing", () => {
    expect(() => toEvent(readBroken<EventResponse>({ items: [] }))).toThrow('"id"');
  });

  it("throws a ContractError when a facet's values are not a list", () => {
    const body = { id: "e1", items: [{ facet_label: "thing", values: { size: 5 } }] };
    expect(() => toEvent(readBroken<EventResponse>(body))).toThrow(
      '"items[0].values" should be a list, but it is an object.',
    );
  });
});
```

Run: `npx vitest run tests/api/response.test.ts -t toEvent`
Expected: FAIL. (If the exact wording of the last message differs from what `contract.ts` writes for a list read, keep its real wording: the test checks the path `items[0].values`.)

- [ ] **Step 2: Types and model**

`src/api/types.ts`, replace `EntrysetResponse` and `EventsResponse`:

```ts
/**
 * An event matching the query (POST /api/filter/execute): one record, holding
 * values for some of the individuals returned by GET /api/individuals.
 */
export interface EventResponse {
  /** The event's unique id (a GUID), read by the backend from a metadata individual. */
  id: string;
  /** One item per individual the event holds values for. */
  items: EventItemResponse[];
}

export interface EventItemResponse {
  /** `IndividualResponse.label`. */
  facet_label: string;
  /** One object per occurrence of the individual in this event (usually
   *  one), each keyed by `IndividualFieldResponse.label`. A field without a
   *  value is left out or `null`. */
  values: Record<string, string | number | boolean | null>[];
}

/** The events matching the current query in the selected databases, capped
 *  by the backend. No pagination. */
export interface EventsResponse {
  events: EventResponse[];
}
```

Update the comment block `// ---- the body of POST …/stats and POST …/query` and `QueryRequest`'s doc to say `POST {prefix}/filter/execute`.

`src/model.ts`, replace `EventRecord`:

```ts
/** One record: something that happened, holding values for some facets. */
export interface EventRecord {
  /** The event's own id (a GUID): long, so the panel shows its start. */
  id: string;
  /** Keyed by `Facet.id`: one entry per occurrence of the facet in this event
   *  (usually one), each keyed by `Field.id` within that facet. */
  values: Record<string, Record<string, Scalar>[]>;
}
```

- [ ] **Step 3: `toEvent` and `runQuery`**

`src/api/response.ts` (import `EventItemResponse`, `EventResponse`):

```ts
export function toEvent(e: ResponseObject<EventResponse>): EventRecord {
  const values: EventRecord["values"] = {};
  for (const item of e.list<EventItemResponse>("items")) {
    const facetId = item.id("facet_label");
    // Each occurrence is keyed by the backend's own field ids, so its keys are
    // read as they come rather than by name; a null value is left out.
    const occurrences = item
      .list<Record<string, Scalar | null>>("values")
      .map((occurrence) => occurrence.scalars());
    // The same facet listed twice: keep every occurrence rather than drop one.
    values[facetId] = [...(values[facetId] ?? []), ...occurrences];
  }
  return { id: e.id("id"), values };
}
```

`src/api/client.ts`:

```ts
/** POST …/filter/execute: the events matching `query` in `databaseIds`
 *  (capped by the backend). Like getStats, an unfinished query rejects
 *  without sending. */
export async function runQuery(
  query: Group,
  databaseIds: string[],
  signal?: AbortSignal,
): Promise<EventRecord[]> {
  const body = await postJson("/filter/execute", toQueryRequest(query, databaseIds), signal);
  return body.object<EventsResponse>().list<EventResponse>("events").map(toEvent);
}
```

Fix the imports (`EventResponse` instead of `EntrysetResponse`). In `tests/api/client.test.ts`, the `runQuery` test answers `{ events: [{ id: "e4", items: [{ facet_label: "a", values: [{ b: 1 }] }] }] }`, expects `[{ id: "e4", values: { a: [{ b: 1 }] } }]`, and its URL expectation becomes `"/api/v1/filter/execute"`.

Run: `npx vitest run tests/api`
Expected: PASS (except `mockContract.test.ts`, which needs Step 5).

- [ ] **Step 4: Write the failing mock tests**

`tests/mock-server/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eventGuid, toEventResponse } from "../../mock-server/events";

describe("eventGuid", () => {
  it("is a GUID made from the numeric id, the same every time", () => {
    expect(eventGuid(26)).toBe("00000000-0000-4000-8000-00000000001a");
    expect(eventGuid(26)).toBe(eventGuid(26));
  });
});

describe("toEventResponse", () => {
  it("lists one item per individual, each with one occurrence", () => {
    expect(toEventResponse({ id: 1, items: { thing: { size: 5 }, other: { on: true } } })).toEqual({
      id: eventGuid(1),
      items: [
        { facet_label: "thing", values: [{ size: 5 }] },
        { facet_label: "other", values: [{ on: true }] },
      ],
    });
  });
});
```

In `tests/mock-server/server.test.ts`, the `describe("POST /api/query", …)` becomes `describe("POST /api/filter/execute", …)`, every `${API}/query` becomes `${API}/filter/execute`, and the success test checks the new body:

```ts
    const json = (await res.json()) as { events: { id: string; items: unknown[] }[] };
    expect(json.events.length).toBeGreaterThan(0);
    expect(json.events.length).toBeLessThanOrEqual(QUERY_RESULT_CAP);
    for (const event of json.events) {
      expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(Array.isArray(event.items)).toBe(true);
    }
```

(Keep the file's other assertions on that test, such as the cap, unless they read `entrysets`.)

Run: `npx vitest run tests/mock-server`
Expected: FAIL.

- [ ] **Step 5: The mock**

`mock-server/vehicleData.ts`: stop importing `EntrysetResponse`; declare the stored format:

```ts
/** One event as stored in data/entrysets.json: the mock's own format, kept as
 *  it was. The API answers with `EventResponse` (src/api/types.ts), built by
 *  `toEventResponse` (events.ts). */
export interface Entryset {
  id: number;
  items: Record<string, Record<string, string | number | boolean>>;
}
```

and make `loadEntrysets` return `Record<string, Entryset>`. Run `grep -rn "EntrysetResponse" mock-server tests` and point every hit at this `Entryset`.

`mock-server/events.ts`:

```ts
import type { EventResponse } from "../src/api/types";
import type { Entryset } from "./vehicleData";

/**
 * The GUID the mock gives an event. Made from its numeric id, so it is the
 * same on every run and in every test. (The real backend reads the id from a
 * metadata individual; the mock data has none, so it makes one up.)
 */
export function eventGuid(id: number): string {
  return `00000000-0000-4000-8000-${id.toString(16).padStart(12, "0")}`;
}

/** An event in the shape POST …/filter/execute answers with. The sample data
 *  holds each individual once, so every item has one occurrence. */
export function toEventResponse(e: Entryset): EventResponse {
  return {
    id: eventGuid(e.id),
    items: Object.entries(e.items).map(([facet_label, values]) => ({
      facet_label,
      values: [values],
    })),
  };
}
```

`mock-server/server.ts`: the route `POST ${api}/query` becomes `POST ${api}/filter/execute`. In `queryEvents`, `sendJson(res, 200, { events: entrysets.map(toEventResponse) });`. Update the `QUERY_RESULT_CAP` comment to `POST /api/filter/execute`.

Run: `npx vitest run tests/mock-server tests/api`
Expected: PASS.

- [ ] **Step 6: Write the failing panel tests**

In `tests/ui/dataPreview.test.ts`, change the event fixtures to the new model (`id: "e-1"`; `values: { thing: [{ kind: "alpha", count: 3, on: false, blank: "", at: "not a date" }] }`, and `values: { thing: [{ at: "2024-11-07T08:15:00Z" }] }` in the date test), import `fieldValues` and `shortId`, and add:

```ts
describe("fieldValues", () => {
  const event = {
    id: "e",
    values: { thing: [{ size: 5, color: "red" }, { size: 5 }, { size: 7, color: "" }] },
  };
  it("collects a field's values from every occurrence, without blanks or repeats", () => {
    expect(fieldValues(event, "thing", "size")).toEqual([5, 7]);
    expect(fieldValues(event, "thing", "color")).toEqual(["red"]);
  });
  it("is empty for a facet or field the event lacks", () => {
    expect(fieldValues(event, "other", "size")).toEqual([]);
    expect(fieldValues(event, "thing", "weight")).toEqual([]);
  });
});

describe("shortId", () => {
  it("cuts a GUID to its first 8 characters", () => {
    expect(shortId("6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10")).toBe("6f1c2a9e…");
  });
  it("keeps a short id as it is", () => {
    expect(shortId("e-12")).toBe("e-12");
  });
});
```

Add to the `rowCell` tests:

```ts
  it("joins the values of several occurrences", () => {
    const twice = { id: "e", values: { thing: [{ kind: "a" }, { kind: "b" }] } };
    expect(rowCell(twice, { heading: "Kind", facet: "thing", field: "kind" })).toBe("a, b");
  });
```

`tests/app.test.ts`: `const events: EventRecord[] = [{ id: "e-1", values: {} }];`.

Run: `npx vitest run tests/ui/dataPreview.test.ts`
Expected: FAIL.

- [ ] **Step 7: The panel**

In `src/ui/dataPreview.ts` (import `Scalar` from `../model`):

```ts
/**
 * Every value `event` holds for one field, across all occurrences of its
 * facet (usually one), without blanks or repeats, in the order they come.
 */
export function fieldValues(event: EventRecord, facetId: string, fieldId: string): Scalar[] {
  const seen = new Set<string>();
  const out: Scalar[] = [];
  for (const occurrence of event.values[facetId] ?? []) {
    const v = occurrence[fieldId];
    if (v === undefined || v === "" || seen.has(String(v))) continue;
    seen.add(String(v));
    out.push(v);
  }
  return out;
}

/** The text of one configured column for one event ("—" when absent). */
export function rowCell(event: EventRecord, col: RowColumn): string {
  const values = fieldValues(event, col.facet, col.field);
  if (values.length === 0) return "—";
  return values
    .map((v) => (col.format === "datetime" ? formatWhen(String(v)) : String(v)))
    .join(", ");
}

/** The start of a long event id (a GUID has 36 characters). The row's tooltip
 *  and its JSON show the whole id. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
```

In `eventRowHtml`:

```ts
        <span class="qb-er-id" title="Event ${escapeHtml(event.id)}">#${escapeHtml(shortId(event.id))}</span>
```

In `rowGrid`, the first track `"3rem"` becomes `"6rem"`; update its test in `dataPreview.test.ts` to match.

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Check in the browser**

Private servers; log in and give a compliance reason through the mock pages; add a field; **Run query**. Check that each row starts with `#00000000…` and that its tooltip is the whole GUID. The id column must not overlap the badges at a 512 px wide window or at 1400 px; if `6rem` is too narrow or too wide, adjust it and its test. Open a row: the JSON shows `"id": "00000000-0000-4000-8000-…"` and `values` with lists.

- [ ] **Step 9: Docs**

Run `grep -n "api/query\|/query\`\|entrysets\|EntrysetResponse\|EventsResponse" docs/ARCHITECTURE.md README.md src mock-server` and update every hit:
- "Naming" table, event row: `| event, `EventRecord` | `EventResponse`, `EventsResponse.events` | `Entryset`, `ENTRYSETS`, `data/entrysets.json` (stored format; answered as `EventResponse`, `events.ts`) |`; the "an event's values" row: `| an event's values, `EventRecord.values` (by facet id, then a list of occurrences keyed by field id) | `EventResponse.items` (`facet_label` + `values`, one object per occurrence) | `Entryset.items` |`.
- Rule 3: "(`EventsResponse` is the exception: it is the whole `/api/query` body.)" → "… the whole `/api/filter/execute` body.)".
- "API contract" table: `| POST {prefix}/filter/execute | Body: a `QueryRequest` ("Wire format of the query"). The matching events (`EventsResponse`: `{ events: [{ id, items: [{ facet_label, values: [ … ] }] }] }`), capped by the backend (25 in the mock), no pagination. Needs a session (`401`) and a compliance reason (`403`). |`.
- "Auth": "Everything except `POST /api/query` is anonymous" → `POST /api/filter/execute`. "Compliance": "Every successful `POST /api/query`" → `POST /api/filter/execute`. "Wire format of the query": "Both `/stats` and `/query` take a `QueryRequest`" → "`/stats` and `/filter/execute`". "Correctness invariant" and "Mock server" likewise.
- "Data model", quirks list: add "**An event's id** is a GUID (text); its values are kept per occurrence, because the backend may list a facet more than once in one event."
- "Under the query — `dataPreview.ts`": "id" in the row description → "the id's first 8 characters (all of it in the tooltip and the JSON)"; mention that a `ROW_COLUMNS` cell joins the values of every occurrence.
- "Mock server": "**`/api/query`** returns the matching events themselves" → "**`/api/filter/execute`** returns the matching events themselves, as `EventResponse`s (`events.ts`: a GUID made from the stored numeric id, one occurrence per individual)". Add `events.ts` to the file list under "Directory layout".
- `README.md`: update any mention of `/query`.

- [ ] **Step 10: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Run queries through POST /filter/execute with GUID events and facet item lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hover info in every query-builder box (point 3)

Read first: `docs/ARCHITECTURE.md`, "The Fomantic discipline" and "Centre — `queryBuilder.ts`".

**Files:**
- Modify: `src/ui/fomantic.ts` (`showFullChoice`)
- Modify: `src/ui/valueControl.ts` (`scalarInput`)
- Modify: `src/ui/queryBuilder.ts` (`wireQueryBuilder`: an `input` listener)
- Test: `tests/ui/valueControl.test.ts`
- Docs: `docs/ARCHITECTURE.md` "The Fomantic discipline", "Centre — `queryBuilder.ts`"

**Interfaces:** none new. The `title` attribute only.

- [ ] **Step 1: Write the failing value-box test**

In `tests/ui/valueControl.test.ts` (it already has `field()` and `op()` helpers):

```ts
  it("a value box carries its value as a hover title, so a cut-off value can be read", () => {
    const html = renderValueControl(field(), op("one", "contains"), "a long value");
    expect(html).toContain('title="a long value"');
  });

  it("an empty value box has no title", () => {
    expect(renderValueControl(field(), op("one", "contains"), null)).not.toContain("title=");
  });

  it("each box of a range has its own title", () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two", "between"), [1, 9]);
    expect(html).toContain('title="1"');
    expect(html).toContain('title="9"');
  });
```

(If `field()` defaults to a field with a pick-list, pass `field({ options: undefined })` so the text box is drawn, not the dropdown.)

Run: `npx vitest run tests/ui/valueControl.test.ts`
Expected: FAIL.

- [ ] **Step 2: The title in `scalarInput`**

```ts
function scalarInput(field: CatalogField, current: unknown, attrs: string): string {
  const type = field.valueType === "number" ? "number" : "text";
  const extra = field.valueType === "date" ? ` ${DATE_ATTRS}` : "";
  const text = current === null || current === undefined ? "" : String(current);
  // A long value is cut off by the box: hovering shows all of it. The builder
  // keeps the title in step while the user types (wireQueryBuilder).
  const title = text ? ` title="${escapeHtml(text)}"` : "";
  return `<div class="ui input"><input type="${type}" data-part="value" ${attrs}${extra}${title} value="${escapeHtml(text)}" /></div>`;
}
```

(`escapeHtml(current ?? "")` was used before; check that `escapeHtml` takes a string, and that the old behaviour for numbers is kept: `String(3)` is `"3"`.)

Run: `npx vitest run tests/ui/valueControl.test.ts`
Expected: PASS.

- [ ] **Step 3: Keep the title in step while typing**

In `wireQueryBuilder` (`src/ui/queryBuilder.ts`), next to the existing `change` listener:

```ts
  // The hover title of a value box follows what is typed: the box is only
  // repainted when the value is committed (on change), and until then the
  // title would show the old value.
  container.addEventListener("input", (e) => {
    const box = e.target;
    if (box instanceof HTMLInputElement && box.dataset.part === "value") box.title = box.value;
  });
```

- [ ] **Step 4: Dropdowns: a title on the element the pointer hits**

In `src/ui/fomantic.ts`, update the `describeDropdown` comment ("Put its full text in a `title` so hovering reads it" → "Put its full text in a `title` on what the pointer is over (see showFullChoice).") and replace `showFullChoice`:

```ts
/**
 * (Re)write the hover title that shows a dropdown's full choice: the shown text
 * is cut off with "…" when it is longer than the box. Called on activation and
 * after every change.
 *
 * In a search dropdown the typing box (`input.search`) lies on top of the
 * shown text, so the pointer is always over the box: the title must be there
 * too (a title on the text alone never showed). A placeholder ("Choose…") gets
 * no title: it is not a choice. In a multi-select each chosen value is a
 * label, cut off the same way, so each label gets its own.
 */
function showFullChoice(node: HTMLElement): void {
  const shown = node.querySelector<HTMLElement>(":scope > .text");
  const placeholder = !shown || shown.classList.contains("default");
  const title = placeholder ? "" : (shown.textContent ?? "").trim();
  for (const el of [shown, node.querySelector<HTMLElement>(":scope > input.search")]) {
    if (!el) continue;
    if (title) el.title = title;
    else el.removeAttribute("title");
  }
  node.querySelectorAll<HTMLElement>(":scope > a.ui.label").forEach((label) => {
    label.title = (label.dataset.value ?? label.textContent ?? "").trim();
  });
}
```

- [ ] **Step 5: Check in the browser (this part has no Node test)**

Private servers. In Chromium:
1. Add a field from the dictionary whose facet name is long ("Add" on a field row). For each of Facet, Field and Operator, take the `.text` rectangle, run `document.elementFromPoint` at its middle, and check that the element hit, or its nearest ancestor with a `title`, has the full name. Before this task it is `INPUT.search` with no title.
2. `page.hover()` the Facet dropdown and confirm that the `title` is the full facet name.
3. A blank row's "Facet…" / "Operator…" placeholders have no `title`.
4. Choose "Is any of" on a string field and add two long values: each label has its value as its title.
5. Type into a value box: its `title` follows each keystroke.
6. Open a dropdown menu with a long facet name and check whether menu items are cut off (`scrollWidth > clientWidth` on `.menu > .item`). If they are, add to `describeDropdown`: `dropdown.querySelectorAll<HTMLElement>(".menu > .item").forEach((item) => (item.title = (item.textContent ?? "").trim()));` with a comment saying why, and check again. If they wrap, add nothing.
7. Keyboard: Tab through a row. Nothing changes for keyboard users (a title is mouse-only). Record this as a known limit in the doc (Step 6).

- [ ] **Step 6: Docs**

- "The Fomantic discipline", the `activate` description: replace "and it puts the shown choice's full text in a `title`, so a name cut off with "…" can be read on hover (kept in step on every change)." with "and it puts the shown choice's full text in a `title` on the typing box and the shown text (the typing box lies on top of the text, so the pointer is always over it), never on a placeholder, and one on each chosen label of a multi-select, so a name cut off with "…" can be read on hover (kept in step on every change)."
- "Centre — `queryBuilder.ts`", after "Every control has an accessible name.": "Every box shows its full content on hover (users asked, 2026-10-13): the dropdowns through `fomantic.ts`, the value boxes through a `title` that follows the typing. A tooltip is mouse-only; keyboard and screen-reader users get the same text from the control itself."

- [ ] **Step 7: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Show every query-builder box's full content on hover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The dictionary preview stays inside its row (point 8)

Read first: `docs/ARCHITECTURE.md`, "Left — `docsSidebar.ts` (data dictionary)".

**Files:**
- Modify: `src/styles.css` (`.qb-doc-field-blurb`, `.qb-doc-desc`, `.qb-doc-comment`)
- Docs: `docs/ARCHITECTURE.md` "Left — `docsSidebar.ts` (data dictionary)"

**Interfaces:** none.

- [ ] **Step 1: Reproduce in the browser first**

Private servers. In Chromium at 1400 × 1000, open every tag section and facet card (`document.querySelectorAll("details.qb-doc-group, details.qb-doc-facet").forEach(d => d.open = true)`). For every `.qb-doc-field-blurb`, compare its `getBoundingClientRect().right` with its field's. Expected before the fix: at least one blurb sticks out (the mock's `speed_kmh` by 34 px).

- [ ] **Step 2: Fix the box**

In `src/styles.css`, `.qb-doc-field-blurb`:

```css
.qb-doc-field-blurb {
  flex: 1 0 100%;
  /* The 100% basis must include the indent below, or the text sticks out of
     the row by that much (Fomantic does not set border-box on plain
     elements). */
  box-sizing: border-box;
  min-width: 0;
  /* Lines up under the field name: the row's padding (0.5rem) + this = the name's
     left edge (chevron + grip + their gaps; measured in the browser). */
  padding-left: 3rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
  /* A long word (an identifier, a URL) breaks instead of widening the row. */
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

And to the shared rule for the opened texts:

```css
.qb-doc-desc,
.qb-doc-comment,
.qb-doc-count {
  margin: 0.25rem 0;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 3: Check in the browser**

Repeat Step 1 at dictionary widths 20rem, 26rem and 40rem (set `--qb-docs-w` on `document.documentElement`) and at a 512 px window. Expected: no blurb, comment, description or facet name sticks out, closed or open. Inject a facet with a 300-character unbroken word into the page through `page.route` on `**/api/v1/individuals` (append one fictional facet to the mock's JSON), and check that it wraps too.

- [ ] **Step 4: Docs**

"Left — `docsSidebar.ts`", the "Field rows" item: add "The one-line blurb stays inside its row at every width (its `box-sizing` includes its indent; a long word breaks: `overflow-wrap: anywhere`)."

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Keep the data dictionary's field preview inside its row

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Logos in front of descriptions (point 4)

Read first: `docs/ARCHITECTURE.md`, "Left — `docsSidebar.ts`", "Offline-first", "Pickle theme and mascot" (replaceable files).

**Files:**
- Modify: `src/config.ts` (`TEXT_SOURCES`)
- Create: `public/sources/third-party.svg`
- Modify: `src/ui/docsSidebar.ts` (`sourceLogo`, the comment / description / group lines)
- Modify: `src/styles.css` (`.qb-source-logo`)
- Test: `tests/ui/docsSidebar.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Left — `docsSidebar.ts`", "Directory layout" (`config.ts`, `public/`), "How do I…"

**Interfaces:**
- Produces: `TEXT_SOURCES: { ours: { logo: string; label: string }; thirdParty: { logo: string; label: string } }` (config.ts); `type TextSource = keyof typeof TEXT_SOURCES`; `sourceLogo(source: TextSource): string` (docsSidebar.ts, exported for tests and Task 8).

- [ ] **Step 1: Write the failing tests**

In `tests/ui/docsSidebar.test.ts` (it builds facets with a `facet(...)` / field helper; use those), import `sourceLogo` and `TEXT_SOURCES`:

```ts
describe("source logos", () => {
  it("a logo names its source for screen readers and on hover", () => {
    const html = sourceLogo("thirdParty");
    expect(html).toContain(`src="${TEXT_SOURCES.thirdParty.logo}"`);
    expect(html).toContain(`alt="${TEXT_SOURCES.thirdParty.label}"`);
    expect(html).toContain(`title="${TEXT_SOURCES.thirdParty.label}"`);
  });

  it("an opened field's texts start with their source's logo, without the word 'Third-party:'", () => {
    const html = facetHtml(facetWithField({ comment: "Ours.", description: "Theirs." }), 10, null, "t");
    expect(html).toContain(`${sourceLogo("ours")}Ours.`);
    expect(html).toContain(`${sourceLogo("thirdParty")}Theirs.`);
    expect(html).not.toContain("Third-party:");
  });

  it("a facet's own texts and its third-party group get logos too", () => {
    const html = facetHtml(
      { ...facetWithField({}), comment: "Ours.", description: "Theirs.", group: "grp" },
      10,
      null,
      "t",
    );
    expect(html).toContain(`${sourceLogo("ours")}Ours.`);
    expect(html).toContain(`${sourceLogo("thirdParty")}Theirs.`);
    expect(html).toMatch(new RegExp(`qb-doc-source[^>]*>${escapeRegExp(sourceLogo("thirdParty"))}Group:`));
  });
});
```

with these helpers at the top of the new `describe` (or the file's fixtures section):

```ts
const facetWithField = (over: Partial<Facet["fields"][number]>): Facet => ({
  id: "thing",
  name: "Thing",
  tags: ["t"],
  group: "",
  comment: "",
  description: "",
  eventCount: 1,
  fields: [{ id: "size", name: "size", typeName: "BIGINT", comment: "", description: "", values: [], ...over }],
});
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
```

Run: `npx vitest run tests/ui/docsSidebar.test.ts`
Expected: FAIL.

- [ ] **Step 2: The setting in `src/config.ts`**

```ts
/**
 * Who wrote a text in the data dictionary. Each description starts with a
 * small logo, and the label is its hover text and its text for screen readers
 * (users found the words "Third-party:" confusing, 2026-10-13).
 *
 * - `ours`: the backend's own, always-correct `comment`. By default the app's
 *   own logo (`MASCOT.neutral`), so a deployment that replaces that file gets
 *   its logo here too.
 * - `thirdParty`: the third party's `description`, which may contain errors.
 *   A neutral placeholder by default: put the company's logo in
 *   public/sources/third-party.svg (same rules as the mascot files: a
 *   self-contained plain SVG), or point `logo` at another file in public/,
 *   and name the company in `label`.
 */
export const TEXT_SOURCES = {
  ours: { logo: "/pickle/logo.svg", label: "Our description" },
  thirdParty: {
    logo: "/sources/third-party.svg",
    label: "Third-party description; may contain errors",
  },
} as const;

export type TextSource = keyof typeof TEXT_SOURCES;
```

- [ ] **Step 3: The placeholder file**

`public/sources/third-party.svg` (self-contained, only the SVG namespace, the theme's mustard and dark green):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="1" y="1" width="14" height="14" rx="3" fill="#ecd48a" stroke="#7d5800" stroke-width="1.5"/>
  <path d="M5 11 L11 5 M7 5 H11 V9" fill="none" stroke="#23301f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

(An outlined square with an "external" arrow: it reads as "from outside", names no company.)

- [ ] **Step 4: Draw the logos in `src/ui/docsSidebar.ts`**

Import `TEXT_SOURCES, type TextSource` from `../config` and add:

```ts
/**
 * The small logo in front of a text, saying who wrote it (`TEXT_SOURCES` in
 * src/config.ts). Its label is both the hover text and the `alt`, so a
 * screen reader reads "Third-party description; may contain errors" before
 * the text. Not draggable: the row's grip is what drags.
 */
export function sourceLogo(source: TextSource): string {
  const { logo, label } = TEXT_SOURCES[source];
  return `<img class="qb-source-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(label)}" title="${escapeHtml(label)}" width="14" height="14" draggable="false" />`;
}
```

In `fieldHtml`'s body:

```ts
        ${f.comment ? `<p class="qb-doc-comment">${sourceLogo("ours")}${escapeHtml(f.comment)}</p>` : ""}
        ${f.description ? `<p class="qb-doc-desc">${sourceLogo("thirdParty")}${escapeHtml(f.description)}</p>` : ""}
```

In `facetHtml`'s body:

```ts
        ${group ? `<p class="qb-doc-source">${sourceLogo("thirdParty")}Group: ${escapeHtml(displayLabel(group))}</p>` : ""}
        ${comment ? `<p class="qb-doc-comment">${sourceLogo("ours")}${escapeHtml(comment)}</p>` : ""}
        ${description ? `<p class="qb-doc-desc">${sourceLogo("thirdParty")}${escapeHtml(description)}</p>` : ""}
```

(The field's closed-row blurb gets its logo in Task 8, which rewrites that row.)

- [ ] **Step 5: Style**

In `src/styles.css`, in the data dictionary section:

```css
/* Who wrote a text (docsSidebar.ts sourceLogo): a small logo in front of it,
   on the text's first line. */
.qb-source-logo {
  width: 14px;
  height: 14px;
  margin-right: 0.35em;
  vertical-align: -2px;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/ui/docsSidebar.test.ts tests/noBackendDataInSrc.test.ts`
Expected: PASS.

- [ ] **Step 7: Check in the browser**

Private servers. Open a facet with both texts and a field with both texts: each line starts with its logo at text height; hovering a logo shows its label. Both files load (no broken-image icon; `naturalWidth > 0`). `npm run build` succeeds, so `check:offline` accepts the new SVG.

- [ ] **Step 8: Docs**

- "Left — `docsSidebar.ts`", item 2 (facet cards): "the third-party group (if not blank), `comment`, `description`" → "the third-party group (if not blank), `comment` and `description`, each starting with a small logo saying who wrote it (`TEXT_SOURCES`, below)". Add a paragraph after the four items:

  "**Who wrote a text.** A comment (ours, always correct) starts with our logo; a description and a group (the third party's, which may contain errors) start with the third party's logo (`sourceLogo`, `TEXT_SOURCES` in `src/config.ts`). The logo's label is its hover text and its `alt`, so a screen reader reads it before the text. **Decided 2026-10-13:** logos replaced the words "Third-party:", which confused users. The comment also stays italic, so the two can be told apart without the logo."
- "Directory layout": add `TEXT_SOURCES` to the `config.ts` line, and `public/sources/third-party.svg — the third party's logo in the dictionary (a placeholder; replace it)` under `public/`.
- "How do I…": add "**…show the third party's logo in the dictionary?** Replace `public/sources/third-party.svg` (a self-contained plain SVG, see "Pickle theme and mascot") and put the company's name in `TEXT_SOURCES.thirdParty.label` in `src/config.ts`."
- "Nothing needed to read the dictionary is behind a hover: names, types and blurbs are visible text, and a `title` only labels a button or repeats a number." → add ", or names a text's source (also in its `alt`)".

- [ ] **Step 9: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Mark dictionary texts with their source's logo instead of 'Third-party:'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: A field row says whether opening it shows more (point 9)

Read first: `docsSidebar.ts` item 3 "Field rows" in `docs/ARCHITECTURE.md`. Needs Task 6 (CSS) and Task 7 (`sourceLogo`).

**Files:**
- Create: `src/ui/docsField.ts`
- Modify: `src/ui/docsSidebar.ts` (`fieldHtml`)
- Modify: `src/styles.css` (`.qb-doc-field-text`, `.qb-doc-field-more`)
- Test: `tests/ui/docsField.test.ts` (new), `tests/ui/docsSidebar.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Left — `docsSidebar.ts`"

**Interfaces:**
- Consumes: `sourceLogo(source: TextSource)` (Task 7), `TextSource` (config.ts).
- Produces: `interface FieldPreview { text: { body: string; source: TextSource } | null; more: string[] }` and `fieldPreview(field: Pick<Field, "comment" | "description">, valueCount: number): FieldPreview`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/docsField.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fieldPreview } from "../../src/ui/docsField";

describe("fieldPreview", () => {
  it("a field with nothing has nothing to show or open", () => {
    expect(fieldPreview({ comment: "", description: "" }, 0)).toEqual({ text: null, more: [] });
  });

  it("one text and no values: show it, nothing more to open", () => {
    expect(fieldPreview({ comment: "", description: "Theirs." }, 0)).toEqual({
      text: { body: "Theirs.", source: "thirdParty" },
      more: [],
    });
  });

  it("our comment is the one shown when there are both; opening adds theirs", () => {
    expect(fieldPreview({ comment: "Ours.", description: "Theirs." }, 0)).toEqual({
      text: { body: "Ours.", source: "ours" },
      more: ["third-party description"],
    });
  });

  it("known values are always more", () => {
    expect(fieldPreview({ comment: "Ours.", description: "" }, 1).more).toEqual([
      "1 previously seen value",
    ]);
    expect(fieldPreview({ comment: "Ours.", description: "Theirs." }, 12).more).toEqual([
      "third-party description",
      "12 previously seen values",
    ]);
  });
});
```

Run: `npx vitest run tests/ui/docsField.test.ts`
Expected: FAIL.

- [ ] **Step 2: Write `src/ui/docsField.ts`**

```ts
import type { Field } from "../model";
import type { TextSource } from "../config";
import { countLabel } from "./format";

/** What a field's row in the data dictionary shows closed, and what opening adds. */
export interface FieldPreview {
  /** The text shown in the closed row, and who wrote it; null when it has none. */
  text: { body: string; source: TextSource } | null;
  /** What opening the row adds, in words. Empty: the row has nothing more and
   *  does not open (it is a plain row showing its text in full). */
  more: string[];
}

/**
 * Users opened fields only to read the same text again (2026-10-13), so a row
 * opens only when opening shows something new: a second text or known values.
 * A field with one text and no values shows that text in full instead, and a
 * row that opens says what opening adds. No character count is involved: how
 * much fits depends on the dictionary's width, which the user can change.
 *
 * Our comment is shown when there is one (it is always correct); the third
 * party's description is then what opening adds.
 */
export function fieldPreview(
  field: Pick<Field, "comment" | "description">,
  valueCount: number,
): FieldPreview {
  const { comment, description } = field;
  const text = comment
    ? { body: comment, source: "ours" as const }
    : description
      ? { body: description, source: "thirdParty" as const }
      : null;
  const more: string[] = [];
  if (comment && description) more.push("third-party description");
  if (valueCount > 0) {
    more.push(countLabel(valueCount, "previously seen value", "previously seen values"));
  }
  return { text, more };
}
```

Check `countLabel`'s signature in `src/ui/format.ts` (it takes `(n, singular, plural?)` and writes the number with the locale's separators); if `countLabel(1, …)` writes "1 previously seen value", the tests pass as written.

Run: `npx vitest run tests/ui/docsField.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing row tests**

In `tests/ui/docsSidebar.test.ts` (using `facetWithField` from Task 7):

```ts
describe("field rows", () => {
  it("a field with one text and no values is a plain row showing the whole text", () => {
    const html = facetHtml(facetWithField({ description: "A long text. ".repeat(20) }), 10, null, "t");
    expect(html).toContain('class="qb-doc-field is-leaf"');
    expect(html).toContain(`class="qb-doc-field-text">${sourceLogo("thirdParty")}A long text.`);
    expect(html).not.toContain("<details class=\"qb-doc-field\"");
  });

  it("a field that opens says what opening adds", () => {
    const html = facetHtml(facetWithField({ comment: "Ours.", description: "Theirs." }), 10, null, "t");
    expect(html).toContain('<details class="qb-doc-field"');
    expect(html).toContain(`class="qb-doc-field-blurb">${sourceLogo("ours")}Ours.`);
    expect(html).toContain('class="qb-doc-field-more">More: third-party description</span>');
  });
});
```

Update the existing tests that expect a field with only a comment, or only a description, to be a `<details>`. They are now plain rows; that change is the point of this task.

Run: `npx vitest run tests/ui/docsSidebar.test.ts`
Expected: FAIL.

- [ ] **Step 4: Rewrite `fieldHtml`**

`valuesHtml` already finds the field's options. Compute the count once and pass it on: change `valuesHtml`'s signature to take `options: string[]` instead of looking them up, and look them up in `fieldHtml`:

```ts
function fieldHtml(
  facet: Facet,
  f: Facet["fields"][number],
  catalog: FieldCatalog | null,
  section: string,
): string {
  const item = dragData({ type: "field", facetId: facet.id, fieldId: f.id });
  const options =
    findField(catalog ?? { facets: [], fields: [] }, facet.id, f.id)?.options ?? [];
  const { text, more } = fieldPreview(f, options.length);
  const textHtml = (cls: string) =>
    text ? `<span class="${cls}">${sourceLogo(text.source)}${escapeHtml(text.body)}</span>` : "";
  const head = `
        ${grip}
        <code class="qb-doc-field-name">${escapeHtml(f.name)}</code>
        <span class="qb-field-type">${escapeHtml(f.typeName)}</span>
        ${addButton(f.name, "Add")}`;
  // Nothing more to see when opened: a plain row, not a <details>, showing
  // its text in full. An arrow that opens onto the same text again taught
  // users to distrust the arrows (2026-10-13).
  if (more.length === 0) {
    return `<div class="qb-doc-field is-leaf" data-field-id="${escapeHtml(f.id)}" data-item="${item}">
      <div class="qb-doc-field-row">
        ${chevronSpacer}${head}
        ${textHtml("qb-doc-field-text")}
      </div>
    </div>`;
  }
  return `<details class="qb-doc-field" data-field-id="${escapeHtml(f.id)}" data-item="${item}">
      <summary>
        ${chevron}${head}
        ${textHtml("qb-doc-field-blurb")}
        <span class="qb-doc-field-more">More: ${escapeHtml(more.join(" · "))}</span>
      </summary>
      <div class="qb-doc-field-body">
        ${f.comment ? `<p class="qb-doc-comment">${sourceLogo("ours")}${escapeHtml(f.comment)}</p>` : ""}
        ${f.description ? `<p class="qb-doc-desc">${sourceLogo("thirdParty")}${escapeHtml(f.description)}</p>` : ""}
        ${valuesHtml(facet, f, options, section)}
      </div>
    </details>`;
}
```

with `valuesHtml(facet, field, options, section)` starting `if (options.length === 0) return "";` (its body is otherwise unchanged). Import `fieldPreview` from `./docsField`.

- [ ] **Step 5: Style**

In `src/styles.css`, next to `.qb-doc-field-blurb`:

```css
/* A plain field row's only text, in full: nothing is hidden behind an arrow,
   so nothing may be cut off either. Same indent as the blurb. */
.qb-doc-field-text {
  flex: 1 0 100%;
  box-sizing: border-box;
  min-width: 0;
  padding-left: 3rem;
  font-size: 0.8rem;
  color: var(--qb-muted);
  overflow-wrap: anywhere;
}
/* What opening a field adds ("More: 12 previously seen values"): says that the
   arrow shows something new. Gone once the row is open. */
.qb-doc-field-more {
  flex: 1 0 100%;
  box-sizing: border-box;
  padding-left: 3rem;
  font-size: 0.72rem;
  color: var(--qb-subtle);
}
.qb-doc-field[open] .qb-doc-field-more {
  display: none;
}
```

`--qb-subtle` on `--qb-surface-2` (the field row's background) is not in `PAIRS` yet. Add `["qb-subtle", "qb-surface-2"]` to `PAIRS` in `tests/themeContrast.test.ts` and run it. If it fails, use `--qb-muted` instead.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/ui tests/themeContrast.test.ts`
Expected: PASS.

- [ ] **Step 7: Check in the browser**

Private servers, dictionary at 20rem, 26rem and 40rem:
- A field with one text and no known values has no arrow; its text is complete (no "…"), stays inside the row (Task 6's measurement), and its logo shows.
- A field with values shows "More: N previously seen values" while closed; opened, the hint is gone and the values are there.
- Search (type a field name): the matching row is still highlighted (`is-match` works on `.qb-doc-field-row` and on `summary`).
- Drag a plain row's grip and press its **Add**: both still add the field.

- [ ] **Step 8: Docs**

"Left — `docsSidebar.ts`", item 3 "Field rows", becomes:

"3. **Field rows** — name, type and our comment (else the third party's description), with the source's logo, in plain sight. A row opens only when opening shows something new (`fieldPreview`, `docsField.ts`): a second text, or known values. Then its closed line is cut to two lines and followed by what opening adds ("More: third-party description · 12 previously seen values"); opened, it shows both texts and the known values. A field with one text and no known values is a plain row (`is-leaf`, a `<div>`, not a `<details>`) that shows that text in full, wrapped, with no arrow but a spacer of the arrow's width (`.qb-chevron-spacer`) so its grip and name line up with the other rows. **Decided 2026-10-13:** users kept opening fields only to read the same short text again; no character limit is used, because how much fits depends on the dictionary's width."

Under "Directory layout", add `docsField.ts       fieldPreview — what a dictionary field row shows closed, and what opening adds (pure).`

- [ ] **Step 9: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Open a dictionary field only when it shows more, and say what

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A login dialog instead of the note above the builder (point 10)

Read first: `docs/ARCHITECTURE.md` "Saved queries — `savedQueries.ts`", "Centre — `queryBuilder.ts`" (title row), "Saved query across the login/compliance redirect", "State and the render loop".

**Files:**
- Modify: `src/state.ts` (`SavedDialog`)
- Modify: `src/app.ts` (`mayUseSavedQueries`, `logInToSave`)
- Modify: `src/ui/savedQueries.ts` (`loginHtml`, `savedDialogHtml`, `OPENER_ACTION`, wiring, `SavedDialogActions`)
- Modify: `src/ui/queryBuilder.ts` (`queryTitleHtml`: no note), `src/ui/dataPreview.ts` (`LOGIN_FIRST_NOTE` comment), `src/main.ts` (renderer keys), `src/styles.css` (remove `.qb-login-note`)
- Test: `tests/app.test.ts`, `tests/ui/savedQueries.test.ts`, `tests/ui/queryBuilder.test.ts`
- Docs: `docs/ARCHITECTURE.md` (sections above, and "Screen layout")

**Interfaces:**
- Produces: `type SavedDialog = null | "save" | "list" | "login-to-save" | "login-to-list"`; app action `logInToSave(): void`; dialog button `data-action="log-in-to-save"`.

- [ ] **Step 1: Write the failing app tests**

In `tests/app.test.ts`, replace the first two tests of `describe("saved queries: opening the dialogs", …)`:

```ts
  it("asks an anonymous visitor to log in first instead of leaving at once", () => {
    const { app, navigate, store } = setup({ ...ready(emptyQuery()), auth: { status: "anonymous" } });
    app.openSaveDialog();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().savedDialog).toBe("login-to-save");
  });

  it("does the same for the list, without asking the server", () => {
    const { app, navigate, api, store } = setup({ ...ready(), auth: { status: "anonymous" } });
    app.openSavedList();
    expect(navigate).not.toHaveBeenCalled();
    expect(api.listSavedQueries).not.toHaveBeenCalled();
    expect(store.getState().savedDialog).toBe("login-to-list");
  });

  it("Log in in that dialog goes to log in, keeping the query (even a blank one)", () => {
    const { app, navigate, store } = setup({
      ...ready(emptyQuery()),
      auth: { status: "anonymous" },
      savedDialog: "login-to-save",
    });
    app.logInToSave();
    expect(navigate).toHaveBeenCalledWith(LOGIN_URL);
    expect(takePendingQuery()).toEqual({
      query: store.getState().query,
      selectedDatabaseIds: ["alpha", "beta"],
    });
  });
```

Run: `npx vitest run tests/app.test.ts -t "opening the dialogs"`
Expected: FAIL.

- [ ] **Step 2: State and app**

`src/state.ts`:

```ts
/** Which saved-queries dialog is open: "save" (name and note), "list", or, for
 *  a logged-out user, the question whether to log in first ("login-to-save" /
 *  "login-to-list" say which button asked, so the focus can go back to it). */
export type SavedDialog = null | "save" | "list" | "login-to-save" | "login-to-list";
```

`src/app.ts`, replace `mayUseSavedQueries` and add `logInToSave`:

```ts
  /** Whether the dialogs may open. A logged-out visitor is asked to log in
   *  first instead (`kind`: which button they pressed). A redirect without a
   *  word surprised users (2026-10-08), and a note always on screen read as
   *  if the whole builder needed a login (maintainers' decision, 2026-10-13).
   *  While the login state is still loading the visitor counts as logged in: a
   *  401 from the API redirects. */
  function mayUseSavedQueries(kind: "save" | "list"): boolean {
    if (store.getState().auth.status !== "anonymous") return true;
    store.setState({ savedDialog: kind === "save" ? "login-to-save" : "login-to-list" });
    return false;
  }

  /** "Log in" in that dialog: keep the query, even a blank one (they asked to
   *  save it), and leave for the login flow. */
  function logInToSave(): void {
    redirectInto(LOGIN_URL);
  }
```

Call `mayUseSavedQueries("save")` in `openSaveDialog` and `mayUseSavedQueries("list")` in `openSavedList`. Add `logInToSave` to the returned object.

Run: `npx vitest run tests/app.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing dialog tests**

In `tests/ui/savedQueries.test.ts`:

```ts
describe("the login dialog", () => {
  const at = (savedDialog: AppState["savedDialog"]) => ({ ...initialState, savedDialog });

  it.each([
    ["login-to-save", "Log in to save queries"],
    ["login-to-list", "Log in to see saved queries"],
  ] as const)("%s has its own title, Log in and Cancel", (kind, title) => {
    const html = savedDialogHtml(at(kind));
    expect(html).toContain(`>${title}</h2>`);
    expect(html).toContain('data-action="log-in-to-save" data-initial-focus>Log in</button>');
    expect(html).toContain('data-action="close-saved-dialog">Cancel</button>');
    expect(html).toContain("the query you are building is kept");
  });

  it("Escape closes it", () => {
    expect(escapeAction(at("login-to-save"))).toBe("close-saved-dialog");
  });

  it("opening it puts the focus on Log in", () => {
    expect(focusAfterRepaint(null, at("login-to-list"))).toBe("initial");
  });
});
```

(`at(...)` builds a full `AppState`, which `savedDialogHtml` needs and which also fits `DialogView`. Import `initialState` and `AppState` if the file does not already.)

Run: `npx vitest run tests/ui/savedQueries.test.ts`
Expected: FAIL.

- [ ] **Step 4: The dialog in `src/ui/savedQueries.ts`**

```ts
/** The query card button that opens each dialog, by its `data-action`: the
 *  focus goes back to it when the dialog closes. */
const OPENER_ACTION = {
  save: "open-save-dialog",
  list: "open-saved-list",
  "login-to-save": "open-save-dialog",
  "login-to-list": "open-saved-list",
} as const;

type LoginDialog = "login-to-save" | "login-to-list";

/**
 * For a logged-out user: saved queries belong to an account, so ask before
 * leaving for the login page (maintainers' decision, 2026-10-13). Log in keeps
 * the query on screen for the return trip ("Saved query across the
 * login/compliance redirect"); Cancel and Escape just close.
 */
function loginHtml(kind: LoginDialog): string {
  const what =
    kind === "login-to-save"
      ? "Saved queries are kept in your account."
      : "Your saved queries are kept in your account.";
  return `<p>${what} You'll leave this page to log in and come back here; the query you are building is kept.</p>
    <div class="qb-dialog-actions">
      <button type="button" class="ui small primary button" data-action="log-in-to-save" data-initial-focus>Log in</button>
      <button type="button" class="ui small basic button" data-action="close-saved-dialog">Cancel</button>
    </div>`;
}

/** Each dialog's title. */
const TITLES = {
  save: "Save query",
  list: "Saved queries",
  "login-to-save": "Log in to save queries",
  "login-to-list": "Log in to see saved queries",
} as const;

export function savedDialogHtml(state: AppState, typed: TypedDraft | null = null): string {
  const dialog = state.savedDialog;
  if (dialog === null) return "";
  const body =
    dialog === "save"
      ? saveFormHtml(state, typed)
      : dialog === "list"
        ? savedListHtml(state)
        : loginHtml(dialog);
  return `<h2 class="qb-dialog-title" id="${SAVED_TITLE_ID}">${TITLES[dialog]}</h2>${body}`;
}
```

Add `| "logInToSave"` to `SavedDialogActions`, and in `wireSavedDialog`'s switch:

```ts
      case "log-in-to-save":
        return app.logInToSave();
```

Update the file's top comment: "Both are drawn in ONE native `<dialog>`" → "All of them (save, list, and the login question for a logged-out user) are drawn in ONE native `<dialog>`".

Run: `npx vitest run tests/ui/savedQueries.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove the note from the title row**

In `src/ui/queryBuilder.ts`, `queryTitleHtml`: delete `LOGIN_NOTE_ID`, `warnsLogin`, `describedBy`, `note` and their comments, so the buttons have no `aria-describedby`, and delete `${note}` from the template and the `LOGIN_FIRST_NOTE` import. Update the function's doc comment: drop the sentence "A logged-out user also gets the note…" and add "A logged-out user who presses either button is asked to log in first, in the saved-queries dialog (`loginHtml`, savedQueries.ts)."

In `src/main.ts`, remove `"auth", // the Save… / Saved queries note for a logged-out user` from the query builder's keys (the card no longer reads `auth`).

In `src/styles.css`, delete the `.qb-query-head .qb-login-note` rule and its comment.

In `src/ui/dataPreview.ts`, the `LOGIN_FIRST_NOTE` comment becomes: "Said next to Run query, the one button that sends a logged-out user to log in without asking first (Save… and Saved queries ask in a dialog, savedQueries.ts)." Run `grep -rn LOGIN_FIRST_NOTE src tests`; if only `dataPreview.ts` and tests use it, keep the `export` for the test.

In `tests/ui/queryBuilder.test.ts`, replace the `describe` that holds "uses the sentence Run shows" with:

```ts
  describe("for a logged-out user", () => {
    it("draws the buttons without any login note: the dialog asks instead", () => {
      const html = queryTitleHtml(anonymous);
      expect(html).toContain('data-action="open-save-dialog"');
      expect(html).not.toContain("log in");
      expect(html).not.toContain("aria-describedby");
    });
  });
```

Remove the now-unused `LOGIN_FIRST_NOTE` / `NOTE` imports and constants from that file.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Check in the browser**

Private servers, logged out:
- No "You'll be asked to log in first." above the builder, at 1400 px and at 512 px. **Run query** still shows it under the button.
- **Save…** opens "Log in to save queries" with the focus on **Log in**. Escape closes it and the focus returns to **Save…**. **Cancel** does the same.
- **Saved queries** → "Log in to see saved queries"; **Log in** goes to the mock IdP. After logging in, the app comes back (`/?resume=1`) with the query that was on screen.

- [ ] **Step 8: Docs**

- "Screen layout", main-column bullet: replace "A logged-out user sees the same advisory note as on **Run query** under them ("You'll be asked to log in first.")." with "A logged-out user who presses either button is first asked to log in, in the dialog (Run query keeps its note "You'll be asked to log in first.")."
- "State and the render loop": `savedDialog` bullet becomes "`savedDialog`: `null`, `"save"`, `"list"`, or `"login-to-save"` / `"login-to-list"` (the login question for a logged-out user): which dialog is open." In the paragraph after it, replace "as does opening either dialog while anonymous (the buttons first show the same advisory note as Run, `LOGIN_FIRST_NOTE`: "Centre — `queryBuilder.ts`")" with "while opening either dialog anonymously asks first whether to log in (`mayUseSavedQueries`, "Saved queries — `savedQueries.ts`")".
- "Saved query across the login/compliance redirect", item 1: replace "**Save…** and **Saved queries** redirect a logged-out user to log in the same way (the query is saved even when blank: they asked to save it), and so does a `401` … Both buttons warn first with the same advisory note as Run (`LOGIN_FIRST_NOTE`): a redirect without a warning surprised users (maintainer's decision, 2026-10-08)." with "**Log in** in the dialog that **Save…** and **Saved queries** show a logged-out user redirects the same way (the query is saved even when blank: they asked to save it), and so does a `401` from any saved-queries request ("Saved queries"). A redirect without a warning surprised users (2026-10-08); a note always above the builder read as if building a query needed a login (2026-10-13), so the question is asked when the button is pressed."
- "Centre — `queryBuilder.ts`": delete the paragraph "While `auth.status` is `"anonymous"` the row also draws the muted note …" and replace it with "A logged-out user's press on either button opens the login question in the saved-queries dialog ("Saved queries — `savedQueries.ts`"); the title row draws no note. **Decided 2026-10-13:** the note under the buttons (2026-10-08) read as if the whole builder needed a login."
- "Saved queries — `savedQueries.ts`", the "**Logged out**" bullet: "both buttons open a small dialog instead: "Log in to save queries" / "Log in to see saved queries", "… You'll leave this page to log in and come back here; the query you are building is kept.", **Log in** (focused; `app.logInToSave`, the query is saved first: "Saved query across the login/compliance redirect") and **Cancel**. Escape closes it; closing returns the focus to the button that opened it."
- "Under the query — `dataPreview.ts`": "(… the exported `LOGIN_FIRST_NOTE`, which the query card's **Save…** and **Saved queries** show too)" → "(`LOGIN_FIRST_NOTE`)".

- [ ] **Step 9: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Ask a logged-out user to log in from a dialog instead of a note above the builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Red bars instead of "Not counted…" in the statistics (points 11 and 13)

Read first: `docs/ARCHITECTURE.md`, "Statistics lines", "Right — `statsPanel.ts`", "Above the builder — `databasePicker.ts`" (the failure reasons), "Pickle theme and mascot" (contrast tokens).

**Files:**
- Modify: `src/ui/databasePicker.ts` (export `failureReasons`, used by `failedDatabases`)
- Modify: `src/ui/statsPanel.ts` (`splitResults`, `splitLabel`, `splitBar`, `headlineHtml`, `failureRowHtml`, `showProblemButton` replacing `queryProblemsLine`)
- Modify: `src/styles.css` (bar segments, failed rows, the button; remove `.qb-stat-failed`, `.qb-stat-problems`; new token)
- Test: `tests/ui/statsPanel.test.ts`, `tests/ui/databasePicker.test.ts`, `tests/themeContrast.test.ts`
- Docs: `docs/ARCHITECTURE.md` (sections above)

**Interfaces:**
- Produces: `failureReasons(r: Extract<DatabaseResult, { status: "failed" }>): string[]` (databasePicker.ts); `interface Split { matched: number; counted: number; notCounted: number; failedDatabases: number }`, `splitResults(results: DatabaseResult[], databases: Database[] | null): Split`, `splitLabel(s: Split): string`, `showProblemButton(state: AppState): string` (statsPanel.ts). Removes `queryProblemsLine`.

- [ ] **Step 1: Share the failure reasons (refactor, tests first)**

In `tests/ui/databasePicker.test.ts`, add:

```ts
describe("failureReasons", () => {
  it("prefers errors without a node, then notes, then node errors, then 'Failed.'", () => {
    expect(failureReasons({ ...failed("a", dbError(null, "Down."), dbError("c1", "Bad.")), notes: ["Slow."] })).toEqual(["Down."]);
    expect(failureReasons({ ...failed("a", dbError("c1", "Bad.")), notes: ["Slow."] })).toEqual(["Slow."]);
    expect(failureReasons(failed("a", dbError("c1", "Bad.")))).toEqual(["Bad."]);
    expect(failureReasons(failed("a"))).toEqual(["Failed."]);
  });
});
```

(`failed` / `dbError` come from `tests/statsFixtures.ts`; the spread works because `failed(...)` returns a failed result. Cast with `as Extract<DatabaseResult, { status: "failed" }>` if TypeScript cannot narrow it.)

In `src/ui/databasePicker.ts`, take the loop body out of `failedDatabases`:

```ts
type FailedResult = Extract<DatabaseResult, { status: "failed" }>;

/**
 * Why a database failed, in the user's words: its errors without a node, else
 * its notes (a timeout, an unreachable server), else its node errors'
 * messages (a node error that only some databases report is about that
 * database), else "Failed.". Its pill's tooltip and its statistics row say this.
 */
export function failureReasons(r: FailedResult): string[] {
  const nodeless = r.errors.filter((e) => e.nodeId === null).map((e) => e.message);
  const nodeErrors = r.errors.filter((e) => e.nodeId !== null).map((e) => e.message);
  return [nodeless, r.notes, nodeErrors].find((list) => list.length > 0) ?? ["Failed."];
}
```

and in `failedDatabases`: `if (r.status === "failed") failed.set(r.databaseId, failureReasons(r));`. Shorten its doc comment to point at `failureReasons`.

Run: `npx vitest run tests/ui/databasePicker.test.ts`
Expected: PASS (the old `failedDatabases` tests prove nothing changed).

- [ ] **Step 2: Write the failing statistics tests**

In `tests/ui/statsPanel.test.ts`, import `splitResults`, `splitLabel`, `showProblemButton` (instead of `queryProblemsLine`), and add:

```ts
describe("splitResults", () => {
  it("counts matches over the databases that answered, and sets failed ones apart", () => {
    expect(splitResults([ok("a", 10), failed("b", dbError(null, "down"))], databases)).toEqual({
      matched: 10,
      counted: 1000,
      notCounted: 1000,
      failedDatabases: 1,
    });
  });
});

describe("splitLabel", () => {
  it("says the ratio, and how many databases are not counted", () => {
    expect(splitLabel({ matched: 10, counted: 1000, notCounted: 0, failedDatabases: 0 })).toBe(
      "1.0% of the counted events match.",
    );
    expect(splitLabel({ matched: 10, counted: 1000, notCounted: 1000, failedDatabases: 1 })).toBe(
      "1.0% of the counted events match. 1 database failed and is not counted.",
    );
    expect(splitLabel({ matched: 0, counted: 0, notCounted: 2000, failedDatabases: 2 })).toBe(
      "2 databases failed and are not counted.",
    );
  });
});
```

Replace the headline test "notes how many databases the total excludes when some failed" with:

```ts
  it("shows failed databases as a red end of the bar instead of words", () => {
    const html = headline("ok", [ok("a", 5), failed("b", dbError(null, "timeout"))]);
    expect(html).toContain('<span class="qb-stat-big">5</span>');
    expect(html).toContain("of 1,000");
    expect(html).toContain('class="qb-bar-failed" style="width:max(50%, 2px)"');
    expect(html).toContain('aria-label="0.5% of the counted events match. 1 database failed and is not counted."');
    expect(html).not.toContain("Excludes");
  });

  it("a bar that is all red when every database failed", () => {
    const html = headline("ok", [failed("a"), failed("b")]);
    expect(html).toContain("No database returned a result");
    expect(html).toContain('class="qb-bar-failed" style="width:max(100%, 2px)"');
  });
```

(Check the exact ratio text against `matchRatio`: 5 of 1,000 is 0.5% → `"0.5%"`; 10 of 1,000 → `"1.0%"`. Adjust the expectations if `matchRatio` writes them otherwise. The test is about the sentence around them.)

Replace the `queryProblemsLine` tests with:

```ts
describe("showProblemButton", () => {
  const root = emptyQuery();
  const problem = (message: string) => ({ nodeId: root.id, message, kind: "invalid" as const });

  it("is empty when the databases found no problem in the query", () => {
    expect(showProblemButton({ ...initialState, query: root })).toBe("");
  });

  it("points at the first problem, with no 'Not counted' text", () => {
    const html = showProblemButton({
      ...initialState,
      query: root,
      serverIssues: [problem("Too long."), problem("Bad date.")],
    });
    expect(html).toContain(`data-action="show-issue" data-target-id="${root.id}"`);
    expect(html).toContain(">Show problem</button>");
    expect(html).toContain('aria-label="Show the first of 2 problems in the query"');
    expect(html).not.toContain("Not counted");
  });
});
```

Replace any failure-row test that expected "Not counted" or the red message text with a test of the row itself (export `failureRowHtml` from `statsPanel.ts` for it, and its `Failed` type):

```ts
describe("failureRowHtml", () => {
  it("is a red bar whose label and tooltip say why, with no text on the row", () => {
    const result = failed("b", dbError(null, "Unreachable.")) as Failed;
    const html = failureRowHtml(result, databases[1]);
    expect(html).toContain(
      '<span class="qb-bar is-failed" role="img" aria-label="B failed and is not counted: Unreachable."',
    );
    expect(html).toContain('title="B failed and is not counted: Unreachable."');
    expect(html).not.toContain("Not counted");
  });
});
```

(`databases[1]` is the file's `db("b", 1000)`, named "B".)

Run: `npx vitest run tests/ui/statsPanel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `src/ui/statsPanel.ts`**

Import `failureReasons` from `./databasePicker`. Export the file's `Failed` type (`export type Failed = …`) for the test. Delete `queryProblemsLine` and the old `failedNote` logic. Add:

```ts
/** How the events of the databases that have answered split up. */
export interface Split {
  /** Events that match, in the databases that answered. */
  matched: number;
  /** Events in the databases that answered: what `matched` is a share of. */
  counted: number;
  /** Events in the databases that failed: nobody counted them. */
  notCounted: number;
  failedDatabases: number;
}

export function splitResults(results: DatabaseResult[], databases: Database[] | null): Split {
  const split: Split = { matched: 0, counted: 0, notCounted: 0, failedDatabases: 0 };
  for (const r of results) {
    const size = databaseFor(databases, r.databaseId)?.eventCount ?? 0;
    if (r.status === "ok") {
      split.matched += r.matchCount;
      split.counted += size;
    } else {
      split.notCounted += size;
      split.failedDatabases += 1;
    }
  }
  return split;
}

/** The bar's words, for screen readers and the tooltip. */
export function splitLabel(s: Split): string {
  const ratio = s.counted > 0 ? `${matchRatio(s.matched, s.counted)} of the counted events match.` : "";
  if (s.failedDatabases === 0) return ratio;
  const failed = `${countLabel(s.failedDatabases, "database")} failed and ${s.failedDatabases === 1 ? "is" : "are"} not counted.`;
  return ratio ? `${ratio} ${failed}` : failed;
}

/**
 * The headline's bar: every event of the databases that have answered. Green
 * (left) is what matches; the striped red end is the events of databases that
 * failed, which nobody counted. Users found the words "Excludes N databases"
 * and "Not counted" confusing and asked for a picture (2026-10-13); the words
 * are still there for screen readers (`splitLabel`). A failed database whose
 * size is unknown still shows a sliver.
 */
function splitBar(s: Split): string {
  const all = s.counted + s.notCounted;
  const failedWidth =
    s.failedDatabases === 0 ? null : s.notCounted > 0 ? barWidth(s.notCounted, all) : "2px";
  const failed = failedWidth ? `<i class="qb-bar-failed" style="width:${failedWidth}"></i>` : "";
  return `<span class="qb-bar" role="img" aria-label="${escapeHtml(splitLabel(s))}"><i style="width:${barWidth(s.matched, all)}"></i>${failed}</span>`;
}
```

Replace `headlineHtml`:

```ts
/**
 * The combined headline sums only the databases that succeeded: a failed
 * database has no count at all, so it is never shown as "0 matched". The bar
 * shows the failed share in red (`splitBar`); with no success yet there is no
 * number, and the bar is all red if every answer so far failed.
 */
export function headlineHtml(
  { status, results }: StatsWithResults,
  databases: Database[] | null,
): string {
  const s = splitResults(results, databases);
  if (s.failedDatabases === results.length) {
    const text =
      status === "loading" ? "No results yet." : "No database returned a result for this query.";
    const bar = s.failedDatabases > 0 ? splitBar(s) : "";
    return `<div class="qb-stat-headline"><p class="qb-stat-sub">${text}</p>${bar}</div>`;
  }
  const title = `${exact(s.matched)} of ${exact(s.counted)}${s.failedDatabases ? ` · not counted: ${exact(s.notCounted)} in ${countLabel(s.failedDatabases, "database")} that failed` : ""}`;
  return `<div class="qb-stat-headline" title="${escapeHtml(title)}">
    <span class="qb-stat-big">${escapeHtml(compact(s.matched))}</span>
    <div class="qb-stat-label">matching events</div>
    <div class="qb-stat-sub">${escapeHtml(matchRatio(s.matched, s.counted))} of ${escapeHtml(compact(s.counted))}</div>
    ${splitBar(s)}
  </div>`;
}
```

(With `results` empty, `failedDatabases === results.length` is `0 === 0`: it shows "No results yet." with no bar, as before. Check that the old test "says 'no results yet' while only failures have streamed in" still passes.)

Replace `failureRowHtml`:

```ts
/**
 * A failed database's row: a red, striped bar where the ratio bar would be,
 * and an icon. Why it failed (`failureReasons`) is its tooltip and its text
 * for screen readers, not text on the row (users asked for a picture,
 * 2026-10-13). A problem in the query itself is also drawn in the builder,
 * where it can be fixed.
 */
export function failureRowHtml(result: Failed, db: Database | undefined): string {
  const name = db?.name ?? result.databaseId;
  const label = `${name} failed and is not counted: ${failureReasons(result).join(" ")}`;
  return `<div class="qb-db-row is-failed" title="${escapeHtml(label)}">
    <span class="qb-db-name">${escapeHtml(name)}</span>
    <span class="qb-bar is-failed" role="img" aria-label="${escapeHtml(label)}"></span>
    <i class="exclamation circle icon qb-db-failed-icon" aria-hidden="true"></i>
  </div>`;
}
```

Add `showProblemButton` where `queryProblemsLine` was:

```ts
/**
 * "⚠ Show problem", when the databases found a problem in the query: the one
 * way to jump to it from here (kept by the maintainers, 2026-10-13, when the
 * "Not counted: N problems are marked in the query" line went). The messages
 * are drawn in the builder, next to what is wrong. It points at the node drawn
 * for the first problem (`placeIssues`), so a problem inside a collapsed group
 * points at that group. The id goes in `data-target-id`, not `data-node-id`:
 * that attribute means "this element is a query node", and keyboard focus
 * memory (focusMemory.ts) would take the button for one.
 */
export function showProblemButton(state: AppState): string {
  const count = state.serverIssues.length;
  if (count === 0) return "";
  const first = placeIssues(state.query, state.serverIssues)[0]!;
  const label =
    count === 1 ? "Show the problem in the query" : `Show the first of ${count} problems in the query`;
  return `<button type="button" class="ui mini basic button qb-show-problem" data-action="show-issue" data-target-id="${escapeHtml(first.nodeId)}" aria-label="${label}" title="${label}"><i class="exclamation triangle icon" aria-hidden="true"></i>Show problem</button>`;
}
```

In `statsPanelHtml`, `queryProblemsLine(state)` becomes `showProblemButton(state)`. Delete `messagesHtml`'s use in failed rows (keep it for the ok rows' notes).

- [ ] **Step 4: Style and tokens**

In `src/styles.css`, `:root`, under `--qb-danger`:

```css
  --qb-danger-stripe: #e7b3a4; /* the light stripes of a failed (red) bar segment */
```

Replace `.qb-bar` / `.qb-bar > i` and remove `.qb-stat-failed` and `.qb-stat-problems` (and its `.ui.button` rule):

```css
.qb-bar {
  display: flex;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--qb-track);
}
.qb-bar > i {
  flex: none;
  height: 100%;
  background: var(--qb-and);
}
/* Data from databases that failed: red with stripes, so it is told apart from
   the green without relying on colour (WCAG 1.4.1). It sits at the right end. */
.qb-bar > .qb-bar-failed,
.qb-bar.is-failed {
  background: repeating-linear-gradient(
    -45deg,
    var(--qb-danger) 0 3px,
    var(--qb-danger-stripe) 3px 5px
  );
}
.qb-bar > .qb-bar-failed {
  margin-left: auto;
}
.qb-stat-headline .qb-bar {
  height: 10px; /* tall enough for the stripes to show */
  margin-top: 0.4rem;
}
.qb-db-failed-icon.icon {
  margin: 0;
  color: var(--qb-danger);
}
.qb-show-problem.ui.button {
  margin: 0 0 0.6rem;
}
.qb-show-problem .icon {
  color: var(--qb-warn);
}
```

(Remove the old `.qb-stat-headline .qb-bar { margin-top: 0.4rem; }` rule; the new one above replaces it. Keep `.qb-db-error` and `.qb-db-msg` only if something still uses them: `grep -n "qb-db-error\|qb-db-msg" src`.)

In `tests/themeContrast.test.ts`, add after `FOCUS_INDICATORS`:

```ts
// Not text: the statistics bars carry meaning by colour and must stand out
// 3:1 from the empty track and the card (WCAG 1.4.11).
const GRAPHICS: [string, string][] = [
  ["qb-and", "qb-track"],
  ["qb-danger", "qb-track"],
  ["qb-danger", "qb-surface"],
];

describe("statistics bars", () => {
  it.each(GRAPHICS)("%s against %s meets WCAG 1.4.11 (3:1)", (mark, neighbour) => {
    expect(ratio(token(mark), token(neighbour))).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/ui tests/themeContrast.test.ts`
Expected: PASS.

- [ ] **Step 6: Check in the browser**

Private servers, mock with `MOCK_FAIL_RATE=0.5` (half the databases fail) and a field condition:
- The headline bar is green on the left and has a striped red end; hovering the headline shows "… · not counted: … in N databases that failed". There is no "Excludes…" text.
- Each failed database's row is one striped red bar with a red icon; hovering says "X failed and is not counted: …".
- A text value longer than 100 characters (it fails in every database with a node error): every row is red, the headline bar is all red, **⚠ Show problem** is under the headline, and pressing it scrolls to and focuses the condition.
- At 512 px (statistics between the query and Matching events), nothing overflows the card.
- With the system's dark/high-contrast settings unchanged: the stripes are visible at the 10px headline height.

- [ ] **Step 7: Docs**

- "Statistics lines", last sentence: "The headline sums the successful databases only and says how many it excludes." → "The headline sums the successful databases only; the databases that failed are the striped red end of its bar ("Right — `statsPanel.ts`")."
- "Above the builder — `databasePicker.ts`": "and the statistics column says "Not counted: …" once" → "and the statistics column offers **Show problem** once". "Its reasons (`failedDatabases`)" → "Its reasons (`failureReasons`, also used by its statistics row)".
- "Right — `statsPanel.ts`", replace the sentence "Top to bottom: the headline (sum of successful databases, ratio, bar, "Excludes N databases that failed"), the query-problems line (below), then **By database** …" with "Top to bottom: the headline (sum of successful databases, ratio, and a bar of every answered database's events: green for the matches, a striped red end for the events of databases that failed, `splitBar`; its words are its `aria-label` and tooltip), **⚠ Show problem** when the query has a problem (below), then **By database** (one row per streamed result: a ratio bar, or for a failed database a striped red bar and an icon whose tooltip and label say why, `failureReasons`), then "Waiting on N more databases…" while loading."
  In the table: row 1's last cell becomes "in the builder (…); here the failed databases' rows are red and **⚠ Show problem** jumps to the first one"; row 2's becomes "that database's row is a red bar; the reason is its tooltip and its label for screen readers (a failed row with no reason says "Failed.")". Replace "**Show** carries the id …" with "**Show problem** carries the id …" and keep the rest of that paragraph.
  Add a decision after "Decision: no duplication.": "**Decided 2026-10-13: bars, not words.** Users found "Not counted: N problems are marked in the query" and "Excludes N databases that failed" confusing and asked for a picture. The red parts are striped (not colour alone, WCAG 1.4.1) and carry their words for screen readers and on hover. **Show problem** stayed, because it is the only way to jump to the problem."
- "Pickle theme and mascot": the list of what the contrast test checks gains "and that the statistics bars (green, red) stand out 3:1 from the track and the card".

- [ ] **Step 8: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Show failed databases as red bar segments instead of 'Not counted' text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Highlight every problem the databases find (point 12)

Read first: `docs/ARCHITECTURE.md`, "The query model" (`validate.ts`, `issues.ts`), "Centre — `queryBuilder.ts`" (issues), "Mock server" (the group error).

**Files:**
- Modify: `src/query/types.ts` (`Issue.fromServer`), `src/query/issues.ts` (`serverIssues`)
- Modify: `src/ui/queryBuilder.ts` (`issuesHtml`)
- Modify: `src/styles.css` (`.qb-server-warning`)
- Test: `tests/query/issues.test.ts` (or wherever `serverIssues` is tested: `grep -rln serverIssues tests`), `tests/ui/queryBuilder.test.ts`
- Docs: `docs/ARCHITECTURE.md` (sections above)

**Interfaces:**
- Produces: `Issue.fromServer?: boolean`. `serverIssues` sets it to `true`; `validate.ts` never sets it.

- [ ] **Step 1: Write the failing tests**

Where `serverIssues` is tested, add:

```ts
  it("marks every issue as found by the server", () => {
    const stats = { status: "ok" as const, results: [failed("a", dbError("g1", "Group contains no valid conditions.", "incomplete"))] };
    expect(serverIssues(stats)).toEqual([
      { nodeId: "g1", message: "Group contains no valid conditions.", kind: "incomplete", fromServer: true },
    ]);
  });
```

Update the existing `serverIssues` expectations to include `fromServer: true`.

In `tests/ui/queryBuilder.test.ts`, test `issuesHtml` directly (export it from `queryBuilder.ts` in Step 2):

```ts
describe("issuesHtml", () => {
  const warning = "Group contains no valid conditions.";

  it("a problem the databases found is highlighted even when it is only incomplete", () => {
    const html = issuesHtml("g1", [
      { nodeId: "g1", message: warning, kind: "incomplete", fromServer: true },
    ]);
    expect(html).toBe(
      `<div class="qb-server-warning"><i class="exclamation triangle icon" aria-hidden="true"></i>${warning}</div>`,
    );
  });

  it("the user's own unfinished parts stay a quiet grey hint", () => {
    const html = issuesHtml("g1", [
      { nodeId: "g1", message: "Add a condition to this group.", kind: "incomplete" },
    ]);
    expect(html).toBe('<div class="qb-hint">Add a condition to this group.</div>');
  });

  it("only shows the issues of the node it is asked about", () => {
    expect(issuesHtml("g2", [{ nodeId: "g1", message: "x", kind: "invalid" }])).toBe("");
  });
});
```

Run: `npx vitest run tests/query tests/ui/queryBuilder.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/query/types.ts`, in `Issue`, after `kind`:

```ts
  /**
   * True for a problem a database found (src/query/issues.ts, serverIssues).
   * Those are always highlighted, whatever their kind: unlike a row the user
   * has not finished, nothing else on screen tells the user about them.
   */
  fromServer?: boolean;
```

`src/query/issues.ts`, in `serverIssues`: `issues.push({ nodeId, message, kind, fromServer: true });`.

`src/ui/queryBuilder.ts`, replace `issuesHtml` and its comment:

```ts
/**
 * The issues under a row or group. The user's own unfinished parts are quiet
 * grey hints: they simply aren't done yet. Anything the databases found is
 * highlighted with an icon in the warning colour even when it is only
 * "incomplete" (such as "Group contains no valid conditions."): nothing else
 * on screen says it, and users missed it in grey (2026-10-13). Invalid is red.
 * Every kind blocks running (validate.ts). Issues come from validate.ts and
 * from the backend (src/query/issues.ts).
 */
export function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const text = (pick: (i: Issue) => boolean) =>
    mine
      .filter(pick)
      .map((i) => escapeHtml(i.message))
      .join(" ");
  const hint = text((i) => i.kind === "incomplete" && !i.fromServer);
  const warning = text((i) => i.kind === "incomplete" && i.fromServer === true);
  const invalid = text((i) => i.kind === "invalid");
  return (
    (hint ? `<div class="qb-hint">${hint}</div>` : "") +
    (warning
      ? `<div class="qb-server-warning"><i class="exclamation triangle icon" aria-hidden="true"></i>${warning}</div>`
      : "") +
    (invalid
      ? `<div class="qb-invalid"><i class="exclamation circle icon"></i>${invalid}</div>`
      : "")
  );
}
```

`src/styles.css`, after `.qb-invalid`:

```css
/* A problem a database found that is "incomplete" rather than "invalid"
   (queryBuilder.ts issuesHtml): highlighted, not a grey hint. Mustard, not
   yellow: yellow text on the cream cards would be unreadable (about 1.5:1). */
.qb-server-warning {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--qb-warn);
}
```

`placeIssues` and `withoutRepeats` copy issues with `...issue`, so `fromServer` survives placement. Check that `tests/query/issues.test.ts` still passes.

- [ ] **Step 3: Run the tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Check in the browser**

Private servers. Build a group with one condition whose text value is longer than 100 characters (the mock fails it everywhere and adds "Group contains no valid conditions." to the group). The condition's message is red with its icon; the group's message is mustard with a ⚠ icon; a blank row elsewhere still has its grey "Choose a facet." hint.

- [ ] **Step 5: Docs**

- "The query model", `validate.ts` bullet: after "(not filled in yet, shown as a quiet grey hint)" add "(a database's "incomplete" problem is highlighted instead, below)". `issues.ts` bullet: "turns each stats error that points at a node into an `Issue`, once" → "… into an `Issue` marked `fromServer`, once; the builder always highlights those (mustard with ⚠ for "incomplete", red for "invalid"), because nothing else on screen tells the user about them (users missed them in grey, 2026-10-13)".
- "Centre — `queryBuilder.ts`": "Issues — the local ones and the backend's — show under their row or group (`placeIssues`)" → add ": the user's own unfinished parts as a grey hint, the backend's "incomplete" ones in mustard with ⚠, anything invalid in red".
- "Mock server": "It is `incomplete` so that it shows as a grey hint while the condition errors that cause it stay red." → "It is `incomplete`, like the real backend's; the builder still highlights it (mustard, ⚠), and the condition errors that cause it stay red."

- [ ] **Step 6: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Highlight every problem the databases find, even an incomplete one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The loading logo spins (point 5)

Read first: `docs/ARCHITECTURE.md`, "Pickle theme and mascot".

**Files:**
- Modify: `src/styles.css` (the pickle mascot section)
- Docs: `docs/ARCHITECTURE.md` "Pickle theme and mascot"

**Interfaces:** none (`data-state="loading"` is set by `setMascot` already).

- [ ] **Step 1: Replace the wobble with a spin**

In `src/styles.css`, replace everything from `.qb-logo {` to the end of its `@media (prefers-reduced-motion: reduce)` block:

```css
.qb-logo {
  width: 28px;
  height: 28px;
  cursor: pointer;
  /* Turns around its middle: the normal logo may be round. */
  transform-origin: 50% 50%;
}
/* Busy: the loading face turns, so the user sees the app is working. Done
   here, not inside the SVG: the files are meant to be replaced, and an
   animation inside one would be lost with it. */
.qb-logo[data-state="loading"] {
  animation: qb-spin 1.2s linear infinite;
}
@keyframes qb-spin {
  to {
    transform: rotate(360deg);
  }
}
/* No turning for people who ask for less motion; a slow fade still says "busy". */
@media (prefers-reduced-motion: reduce) {
  .qb-logo[data-state="loading"] {
    animation: qb-pulse 1.6s ease-in-out infinite alternate;
  }
}
@keyframes qb-pulse {
  to {
    opacity: 0.45;
  }
}
```

Run `grep -rn "wobble" src tests docs` and remove or update every remaining mention.

- [ ] **Step 2: Check in the browser**

Private servers with `MOCK_STREAM_DELAY_MS=800` (so loading lasts). Add a condition. While statistics load, the logo's computed `animation-name` is `qb-spin` and it visibly turns around its centre. Toggle the easter egg (five clicks): the egg loading face spins too. With `page.emulateMedia({ reducedMotion: "reduce" })`, `animation-name` is `qb-pulse`. After loading, `animation-name` is `none`.

- [ ] **Step 3: Docs**

"Pickle theme and mascot", the `loading.svg` row: "The top bar while statistics or Matching events are loading. It turns around its middle (CSS, `qb-spin`, so a replaced file turns too); under reduced motion it slowly fades in and out instead."

- [ ] **Step 4: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Spin the loading logo (a fade under reduced motion)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The disappointed pickle (point 6)

Read first: `docs/ARCHITECTURE.md`, "Pickle theme and mascot".

**Files:**
- Modify: `src/ui/mascot.ts`
- Test: `tests/ui/mascot.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Pickle theme and mascot"

**Interfaces:** `mascotFor(s: Pick<AppState, "issues" | "stats" | "preview">): MascotState`, unchanged signature. `main.ts`'s row already repaints on `issues`, `stats` and `preview`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/ui/mascot.test.ts` (import `ok`, `failed`, `dbError` from `../statsFixtures`):

```ts
  it("is disappointed when the query matches nothing", () => {
    expect(mascotFor({ ...base, stats: { status: "ok", results: [ok("a", 0), ok("b", 0)] } })).toBe(
      "disappointed",
    );
    expect(mascotFor({ ...base, preview: { status: "ok", events: [] } })).toBe("disappointed");
  });

  it("is disappointed when a database failed or found a problem in the query", () => {
    const results = [ok("a", 5), failed("b", dbError(null, "Unreachable."))];
    expect(mascotFor({ ...base, stats: { status: "ok", results } })).toBe("disappointed");
    const rejected = [failed("a", dbError("c1", "Too long."))];
    expect(mascotFor({ ...base, stats: { status: "ok", results: rejected } })).toBe("disappointed");
  });

  it("is disappointed when a request failed", () => {
    expect(mascotFor({ ...base, stats: { status: "error", error: "x" } })).toBe("disappointed");
    expect(mascotFor({ ...base, preview: { status: "error", error: "x" } })).toBe("disappointed");
  });

  it("is neutral when there are matches", () => {
    expect(mascotFor({ ...base, stats: { status: "ok", results: [ok("a", 3)] } })).toBe("neutral");
    expect(mascotFor({ ...base, preview: { status: "ok", events: [{ id: "e", values: {} }] } })).toBe(
      "neutral",
    );
  });

  it("loading wins over everything", () => {
    expect(
      mascotFor({ ...base, stats: { status: "loading", results: [failed("a")] }, preview: { status: "error", error: "x" } }),
    ).toBe("loading");
  });
```

Keep the existing test "an unfinished query is not a reason to be sad": it is the decision.

Run: `npx vitest run tests/ui/mascot.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
import type { AppState } from "../state";

export type MascotState = "neutral" | "disappointed" | "loading";

type MascotInputs = Pick<AppState, "issues" | "stats" | "preview">;

/**
 * Which face the logo pickle shows (docs/ARCHITECTURE.md, "Pickle theme and
 * mascot"):
 * - busy while statistics or Matching events load;
 * - disappointed when something went wrong or nothing was found (`letDown`);
 * - neutral otherwise, also while the query is merely unfinished: every query
 *   starts as a blank row, and a pickle that is sad from page load would mean
 *   nothing (maintainers' decision, 2026-10-13).
 */
export function mascotFor(s: MascotInputs): MascotState {
  if (s.stats.status === "loading" || s.preview.status === "loading") return "loading";
  return letDown(s) ? "disappointed" : "neutral";
}

/**
 * The query is invalid (a red message); a request failed; a database failed
 * or found a problem in the query (a failed result: `serverIssues` come from
 * those, so they need no check of their own); or the query matches nothing.
 */
function letDown({ issues, stats, preview }: MascotInputs): boolean {
  if (issues.some((i) => i.kind === "invalid")) return true;
  if (stats.status === "error" || preview.status === "error") return true;
  if (preview.status === "ok" && preview.events.length === 0) return true;
  if (stats.status !== "ok") return false;
  if (stats.results.some((r) => r.status === "failed")) return true;
  return stats.results.every((r) => r.status === "ok" && r.matchCount === 0);
}
```

Run: `npx vitest run tests/ui/mascot.test.ts`
Expected: PASS.

- [ ] **Step 3: Check in the browser**

Private servers, `MOCK_FAIL_RATE=0`. Fresh page: neutral face (the blank row is unfinished). "Add all" on a tag whose facets never occur together: disappointed once statistics finish (0 matches). A condition that matches: neutral. `MOCK_FAIL_RATE=1`: disappointed. Run query with `page.route` on `**/filter/execute` answering `{ "events": [] }`: disappointed.

- [ ] **Step 4: Docs**

"Pickle theme and mascot", the `disappointed.svg` row: "The top bar when something went wrong or nothing was found: the query is invalid (a red message), a database failed or found a problem in the query, a statistics or events request failed, or the query matches no events. Loading wins when both apply. A merely unfinished query keeps the normal face: every query starts as a blank row (maintainers' decision, 2026-10-13)."

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Disappoint the pickle on no matches, failed databases and failed requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: "Add all" creates a group (point 14)

Read first: `docs/ARCHITECTURE.md`, "The query model" (`drop.ts`, `tree.ts` placement), "Centre — `queryBuilder.ts`" (drag and drop, "Keyboard and the "+" buttons", "Announcements").

**Files:**
- Modify: `src/query/tree.ts` (`groupOf`)
- Modify: `src/query/drop.ts` (tag case, `addedNodesMessage`)
- Modify: `src/app.ts` (`onDropItem` announcement)
- Test: `tests/query/tree.test.ts`, `tests/query/drop.test.ts`, `tests/app.test.ts`
- Docs: `docs/ARCHITECTURE.md` (sections above)

**Interfaces:**
- Produces: `groupOf(children: QueryNode[], operator?: LogicalOperator): Group` (tree.ts); `addedNodesMessage(nodes: QueryNode[]): string` (drop.ts).

- [ ] **Step 1: Write the failing tests**

`tests/query/tree.test.ts`:

```ts
describe("groupOf", () => {
  it("makes a new open ALL group around the given nodes, with its own id", () => {
    const a = newCondition();
    const b = newCondition();
    const g = groupOf([a, b]);
    expect(g).toMatchObject({ kind: "group", operator: "AND", children: [a, b] });
    expect(g.collapsed).toBeUndefined();
    expect(groupOf([a]).id).not.toBe(g.id);
  });
});
```

`tests/query/drop.test.ts`, replace the two tag tests ("a tag becomes one 'present' per facet carrying it", "every created condition has its own id"):

```ts
  it("a tag with several facets becomes one ALL group of 'present' conditions", () => {
    const r = nodesForItem({ type: "tag", tag: "t1" }, facets, catalog);
    expect(r.problems).toEqual([]);
    expect(r.nodes).toHaveLength(1);
    const group = r.nodes[0]!;
    if (group.kind !== "group") throw new Error("expected a group");
    expect(group.operator).toBe("AND");
    expect(conds({ nodes: group.children }).map((c) => [c.facetId, c.operatorId])).toEqual([
      ["a", "present"],
      ["b", "present"],
    ]);
    expect(new Set(group.children.map((c) => c.id)).size).toBe(2);
  });

  it("a tag with one facet adds just that condition", () => {
    const withSolo = [...facets, facet("solo", ["only"])];
    const r = nodesForItem({ type: "tag", tag: "only" }, withSolo, buildFieldCatalog(withSolo));
    expect(conds(r).map((c) => c.facetId)).toEqual(["solo"]);
  });

  it("says a group was added, and how many conditions it holds", () => {
    const r = nodesForItem({ type: "tag", tag: "t1" }, facets, catalog);
    expect(addedNodesMessage(r.nodes)).toBe("Added a group of 2 conditions to the query.");
    expect(addedNodesMessage([newCondition(), newCondition()])).toBe("Added 2 conditions to the query.");
  });
```

(Import `addedNodesMessage` and `newCondition`.)

`tests/app.test.ts`: add a test in the "Add to query" describe that uses its own facets with a shared tag:

```ts
  it("Add all on a tag puts one ALL group at the end of the root and says so", () => {
    const tagged: Facet[] = [
      { ...facets[0]!, id: "one", name: "One", tags: ["t"] },
      { ...facets[0]!, id: "two", name: "Two", tags: ["t"] },
    ];
    const { app, store, announce } = setup({
      ...ready(),
      facets: tagged,
      catalog: buildFieldCatalog(tagged),
    });
    const before = store.getState().query.children.length;
    app.onAddItem({ type: "tag", tag: "t" });
    const { children } = store.getState().query;
    expect(children).toHaveLength(before + 1);
    expect(children.at(-1)).toMatchObject({ kind: "group", operator: "AND" });
    expect(announce).toHaveBeenCalledWith("Added a group of 2 conditions to the query.");
  });
```

Run: `npx vitest run tests/query tests/app.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/query/tree.ts` (import `LogicalOperator` from `./types`), after `newGroup`:

```ts
/** A new, open group holding `children`: how a tag's facets arrive ("Add
 *  all"), so a misplaced or unwanted "Add all" is moved or removed in one go. */
export function groupOf(children: QueryNode[], operator: LogicalOperator = "AND"): Group {
  return { kind: "group", id: id("g"), operator, children };
}
```

`src/query/drop.ts` (import `countConditions, groupOf, newCondition` from `./tree`), the tag case:

```ts
    case "tag": {
      const tagged = facets.filter((f) => f.tags.includes(item.tag));
      if (tagged.length === 0) {
        return { nodes: [], problems: [`The tag “${item.tag}” has no facets.`] };
      }
      const conditions = tagged.map((f) => facetPresent(f.id));
      // Two or more facets arrive as one ALL group, so a misplaced "Add all"
      // is dragged or removed in one go instead of row by row (users' request,
      // 2026-10-13; ALL kept by the maintainers). One facet needs no group.
      return { nodes: conditions.length > 1 ? [groupOf(conditions)] : conditions, problems: [] };
    }
```

and after `addedMessage`:

```ts
/** What a screen reader hears after a drop or "+" added `nodes`: a tag's group
 *  says what it holds, anything else counts its conditions. */
export function addedNodesMessage(nodes: QueryNode[]): string {
  const [only] = nodes;
  if (nodes.length === 1 && only?.kind === "group") {
    return `Added a group of ${countConditions(only)} conditions to the query.`;
  }
  return addedMessage(nodes.length);
}
```

`src/app.ts`, in `onDropItem`: `announce(addedNodesMessage(nodes));` (import it from `./query/drop`). Update `onAddItem`'s comment: "The keyboard path: "Add to query" puts the item in the root group (or, if that holds just a blank row, in its place); a tag's facets arrive as one group."

Run: `npm run typecheck && npm test`
Expected: PASS. (`placeNodes` treats the single group like any node: it replaces a lone blank row, or goes at the end of the target group, or before the target row.)

- [ ] **Step 3: Check in the browser**

Private servers. **Add all N** on a tag: one new ALL bracket appears at the end of the query (or in place of the blank starting row) holding N "is present" rows. Its grip moves it, its ✕ removes it, and **Ungroup** puts its rows back into the root (both are ALL). Drag a tag's grip onto a condition: the group lands just before it. A tag with one facet adds one plain row. A screen reader live region gets "Added a group of N conditions to the query."

- [ ] **Step 4: Docs**

- "The query model", `drop.ts` bullet: "a tag becomes one facet-level `present` per facet carrying it" → "a tag becomes one new ALL group holding a facet-level `present` per facet carrying it (just the condition when only one facet carries it)". Replace the paragraph "**Tag drops and "Add all N" are ANDed on purpose (decided 2026-10-07).** …" with: "**Tag drops and "Add all N" arrive as one ALL group (decided 2026-10-13).** Users complained about removing a dozen rows one by one after a misplaced "Add all", so the facets now arrive in their own group (`groupOf`), which can be moved, ungrouped or removed in one go. It stays ALL (decided 2026-10-07, confirmed 2026-10-13): a query then matches only events that hold every one of those facets, which can be rare (in the mock, often none). Switching the group to ANY is one click."
- "Centre — `queryBuilder.ts`", "Keyboard and the "+" buttons": add "A tag's **Add all N** adds its group the same way."
- "Announcements": add the example "Added a group of 12 conditions to the query." (`addedNodesMessage`).
- "Directory layout": add `groupOf` to the `tree.ts` line and `addedNodesMessage` to the `drop.ts` line.

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Add a tag's facets as one group, so a misplaced Add all is removed in one go

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Final check, doc sweep and push

**Files:** `docs/ARCHITECTURE.md` (sweep only), the plan file.

- [ ] **Step 1: Sync with `origin/main`**

```bash
git fetch origin
git log --oneline HEAD..origin/main
```

If `origin/main` moved: `git merge origin/main`, resolve conflicts, and re-run Step 2. Write down what changed upstream for the report.

- [ ] **Step 2: All checks**

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all pass.

- [ ] **Step 3: Sweep the doc for words that no longer describe the code**

```bash
grep -n "Not counted\|Excludes\|auth/me\|AuthUser\|api/query\|EntrysetResponse\|entrysets\b\|Third-party:\|wobble\|qb-login-note\|queryProblemsLine\|errorMessage(" docs/ARCHITECTURE.md README.md src mock-server
```

Every hit must be a deliberate mention (for example a "Decided …" note quoting the old text, or `data/entrysets.json`), not a description of current behaviour. Fix the rest. Then confirm `tests/docReferences.test.ts` passes (no cited heading was renamed).

- [ ] **Step 4: One full browser pass**

Private servers, Chromium, windows of 1400 px and 512 px, logged out and then logged in. Walk through every point once: the users/me name in the chip (1), Run query results with short GUIDs (2), hover titles (3), logos (4), spinning logo (5), disappointed face (6), friendly errors with `MOCK_HTTP_ERRORS="* /stats=503, POST /saved-queries=500"` (7), no overflow (8), plain rows and "More: …" (9), the login dialog (10), red bars and **Show problem** (11, 13), the mustard backend warning (12), "Add all" as a group (14). Take screenshots of 7, 10 and 11/13 for the report. Stop only the servers you started.

- [ ] **Step 5: Delete the plan, push, report**

The plans folder holds a plan "while it is being built; deleted once it is merged". Leave the plan on the branch until the maintainers merge, then delete it in the merge or right after.

```bash
git push -u origin claude/user-feedback-round
```

Do not open a pull request unless the maintainers ask for one now. Report: what each task changed, what was checked (the four commands, the browser pass, the screenshots), what changed upstream if `origin/main` moved, and the answers still missing from the backend team (if Task 3 or 4 went ahead on assumptions, say which).
