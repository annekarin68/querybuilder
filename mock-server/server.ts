import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DATABASES } from "./databases";
import {
  matches,
  buildStatsLine,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
} from "./evaluate";
import { ENTRYSETS, INDIVIDUALS, type Entryset } from "./vehicleData";
import { ROWS } from "./rows";
import { queryProblem } from "./requestBody";
import type { QueryRequest } from "../src/api/types";
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

/**
 * The dev-only mock API: every route of the real API (docs/ARCHITECTURE.md,
 * "API contract") plus stand-in pages for the identity provider and the
 * compliance service. Plain Node `http`: one table maps "METHOD /path" to a
 * handler function (`routes` at the bottom). index.ts starts it; tests call
 * createMockServer directly (tests/mock-server/server.test.ts).
 */

/** Behaviour that index.ts reads from the environment and tests pin down. */
export interface MockConfig {
  /** The API prefix every route and redirect goes under, e.g. "/api/v1" (VITE_API_BASE in .env). */
  apiBase: string;
  /** Share (0–1) of /api/stats lines that simulate an unreachable database. */
  failRate: number;
  /** Pause before each streamed /api/stats line, in ms. */
  lineDelayMs(): number;
}

/** POST /api/query returns at most this many events. There is no pagination. */
export const QUERY_RESULT_CAP = 25;

// ---- responses ------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string, cookie?: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, cookies?: string | string[]): void {
  res.writeHead(
    302,
    cookies ? { Location: location, "Set-Cookie": cookies } : { Location: location },
  );
  res.end();
}

/** Escapes text for HTML content or a double-quoted attribute. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * A small server-rendered page, for the stand-in services and error pages.
 * Never bundled by Vite and never in dist/, so the offline check doesn't
 * apply to it.
 */
function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <head><title>${escapeHtml(title)}</title></head>
  <body style="font-family: sans-serif; max-width: 28rem; margin: 4rem auto;">
    ${bodyHtml}
  </body>
</html>`;
}

/**
 * The login/compliance callbacks are browser NAVIGATIONS, not fetches, so a
 * failure there must be a page the user can read and leave — not raw JSON.
 * Also clears the flow's state-binding cookie, which is useless after a failure.
 */
function sendFlowError(res: ServerResponse, message: string, clearCookie: string): void {
  const body = `<h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>
    <p><a href="/">Back to the Query Builder</a> and try again.</p>`;
  sendHtml(res, 400, page("Something went wrong", body), clearCookie);
}

// ---- requests -------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Thrown by readJson when the request body is not valid JSON — mapped to 400. */
class BadBodyError extends Error {}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed body is the caller's fault, not ours — 400, never 500.
    throw new BadBodyError("Request body must be valid JSON.");
  }
}

/**
 * Reads and checks a …/stats or …/query body: `query` must be a well-formed
 * query tree whose root is a group (requestBody.ts), and `databases` a
 * non-empty string[]. For a bad body this sends the 400 itself and returns
 * null.
 */
async function readQueryBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<QueryRequest | null> {
  const body = await readJson(req);
  const { query, databases } = (typeof body === "object" && body !== null ? body : {}) as {
    query?: unknown;
    databases?: unknown;
  };
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    sendJson(res, 400, { error: "Body must include a `query` tree." });
    return null;
  }
  if (
    !Array.isArray(databases) ||
    databases.length === 0 ||
    !databases.every((d) => typeof d === "string")
  ) {
    sendJson(res, 400, { error: "Select at least one database." });
    return null;
  }
  const problem =
    (query as { kind?: unknown }).kind === "group" ? queryProblem(query) : "query must be a group.";
  if (problem) {
    sendJson(res, 400, { error: `Malformed query: ${problem}` });
    return null;
  }
  return { query: query as QueryRequest["query"], databases };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- data and queries -----------------------------------------------------

/**
 * POST /api/stats: newline-delimited JSON, one StatsResponse line per selected
 * database, written one at a time with a short pause so the streaming is
 * visible in dev.
 */
async function streamStats(req: IncomingMessage, res: ServerResponse, config: MockConfig) {
  const body = await readQueryBody(req, res);
  if (!body) return;
  // Compute before committing the response header: if this (pure, cheap)
  // computation ever threw, the server's catch block must still be able to
  // send a normal JSON error response — which requires no header sent yet.
  const counts = perDatabaseCounts(body.query, ROWS, body.databases);
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
  for (const c of counts) {
    const totalEntrysets = DATABASES.find((d) => d.label === c.label)?.totalEntrysets ?? 0;
    // Dev-only: now and then (config.failRate) simulate a database that can't
    // answer, so the UI's per-database failure path gets exercised.
    const line = buildStatsLine(
      Math.random() < config.failRate
        ? {
            label: c.label,
            fail: {
              errorMessages: [],
              infoMessages: ["This database could not be reached. Try again shortly."],
            },
          }
        : {
            label: c.label,
            // The sample drives match RATES; DATABASES[].totalEntrysets drives
            // the MAGNITUDE the API reports, so the UI sees realistic numbers.
            matchCount: scaleCount(c.matchCount, c.totalCount, totalEntrysets),
          },
    );
    res.write(JSON.stringify(line) + "\n");
    await delay(config.lineDelayMs());
  }
  res.end();
}

/** POST /api/query: the matching events. Needs a session and a compliance reason. */
async function queryEvents(req: IncomingMessage, res: ServerResponse) {
  const session = sessionFor(req.headers.cookie);
  if (!session) return sendJson(res, 401, { error: "Log in to preview data." });
  if (!session.compliance) {
    return sendJson(res, 403, { error: "Compliance acknowledgment required." });
  }
  const body = await readQueryBody(req, res);
  if (!body) return;
  const entrysets = filterByDatabases(ROWS, body.databases)
    .filter((row) => matches(body.query, row))
    .map((row) => ENTRYSETS[String(row.id)])
    .filter((e): e is Entryset => e !== undefined)
    .slice(0, QUERY_RESULT_CAP);
  logQueryAudit(session.user.name, session.compliance.reason);
  sendJson(res, 200, { entrysets });
}

// ---- login: app → …/auth/login → mock IdP page → confirm → callback → app

/** Starts a login: a fresh CSRF state, bound to this browser by a cookie. */
function startLoginFlow(_req: IncomingMessage, res: ServerResponse) {
  const state = startLogin();
  redirect(
    res,
    `/mock-idp/authorize?state=${encodeURIComponent(state)}`,
    loginStateCookieHeader(state),
  );
}

/** Dev-only stand-in for a real IdP's login screen. */
function showIdpPage(_req: IncomingMessage, res: ServerResponse, url: URL) {
  const state = url.searchParams.get("state") ?? "";
  const body = `<h1>Mock Identity Provider</h1>
    <p>This stands in for a real internal IdP during local development.</p>
    <p><a href="/mock-idp/authorize/confirm?state=${encodeURIComponent(state)}">Log in as demo.user</a></p>`;
  sendHtml(res, 200, page("Mock IdP", body));
}

/** The user "logged in" at the mock IdP: hand back a code, as a real IdP would. */
function confirmIdpLogin(_req: IncomingMessage, res: ServerResponse, url: URL, apiBase: string) {
  const state = url.searchParams.get("state") ?? "";
  const code = issueFakeCode();
  redirect(
    res,
    `${apiBase}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}

function finishLogin(req: IncomingMessage, res: ServerResponse, url: URL) {
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (loginStateFromCookie(req.headers.cookie) !== state) {
    return sendFlowError(res, "Invalid or expired login attempt.", clearLoginStateCookieHeader());
  }
  const outcome = exchangeCodeForSession(code, state);
  if (!outcome.ok) return sendFlowError(res, outcome.error, clearLoginStateCookieHeader());
  redirect(res, "/?resume=1", [
    sessionCookieHeader(outcome.sessionId),
    clearLoginStateCookieHeader(),
  ]);
}

function currentUser(req: IncomingMessage, res: ServerResponse) {
  const session = sessionFor(req.headers.cookie);
  if (!session) return sendJson(res, 401, { error: "Not authenticated." });
  sendJson(res, 200, session.user);
}

function logOut(req: IncomingMessage, res: ServerResponse) {
  endSession(req.headers.cookie);
  res.writeHead(204, { "Set-Cookie": clearSessionCookieHeader() });
  res.end();
}

// ---- compliance: app → …/compliance/start → mock form → submit → callback → app

function startComplianceFlow(req: IncomingMessage, res: ServerResponse, apiBase: string) {
  // A navigation: without a session (e.g. it expired, or the mock was
  // restarted), send the browser to log in rather than to a JSON error.
  if (!sessionFor(req.headers.cookie)) return redirect(res, `${apiBase}/auth/login`);
  const state = startCompliance();
  redirect(
    res,
    `/mock-compliance/submit?state=${encodeURIComponent(state)}`,
    complianceStateCookieHeader(state),
  );
}

/** Dev-only stand-in for a real compliance/audit service's submission form. */
function complianceForm(state: string, error = ""): string {
  const body = `<h1>Compliance Logging</h1>
    <p>This stands in for a real internal compliance/audit service during local development.</p>
    ${error ? `<p style="color:#b00">${escapeHtml(error)}</p>` : ""}
    <form method="POST" action="/mock-compliance/submit">
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <label for="reason">Reason for this data extraction:</label><br/>
      <input type="text" id="reason" name="reason" required style="width:100%;margin:0.5rem 0;" />
      <button type="submit">Submit</button>
    </form>`;
  return page("Mock Compliance Logging Service", body);
}

function showComplianceForm(_req: IncomingMessage, res: ServerResponse, url: URL) {
  sendHtml(res, 200, complianceForm(url.searchParams.get("state") ?? ""));
}

/** The form's POST (application/x-www-form-urlencoded): hand back a token. */
async function submitComplianceForm(req: IncomingMessage, res: ServerResponse, apiBase: string) {
  const form = new URLSearchParams(await readBody(req));
  const state = form.get("state") ?? "";
  const reason = (form.get("reason") ?? "").trim();
  if (!reason) return sendHtml(res, 400, complianceForm(state, "Please enter a reason."));
  const token = issueFakeComplianceToken(reason);
  redirect(
    res,
    `${apiBase}/compliance/callback?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`,
  );
}

function finishCompliance(req: IncomingMessage, res: ServerResponse, url: URL) {
  const token = url.searchParams.get("token") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (complianceStateFromCookie(req.headers.cookie) !== state) {
    return sendFlowError(
      res,
      "Invalid or expired compliance attempt.",
      clearComplianceStateCookieHeader(),
    );
  }
  const outcome = exchangeComplianceToken(token, state, req.headers.cookie);
  if (!outcome.ok) return sendFlowError(res, outcome.error, clearComplianceStateCookieHeader());
  redirect(res, "/?resume=1", clearComplianceStateCookieHeader());
}

function invalidateCompliance(req: IncomingMessage, res: ServerResponse) {
  clearCompliance(req.headers.cookie);
  res.writeHead(204);
  res.end();
}

// ---- the server -------------------------------------------------------------

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>;

/** Every route, keyed by "METHOD /path". Add a route here. The API's own
 *  routes sit under `config.apiBase`; the stand-in services' pages don't. */
function routes(config: MockConfig): Record<string, Handler> {
  const api = config.apiBase;
  return {
    [`GET ${api}/databases`]: (_req, res) => sendJson(res, 200, DATABASES),
    [`GET ${api}/individuals`]: (_req, res) => sendJson(res, 200, INDIVIDUALS),
    [`POST ${api}/stats`]: (req, res) => streamStats(req, res, config),
    [`POST ${api}/query`]: queryEvents,

    [`GET ${api}/auth/login`]: startLoginFlow,
    "GET /mock-idp/authorize": showIdpPage,
    "GET /mock-idp/authorize/confirm": (req, res, url) => confirmIdpLogin(req, res, url, api),
    [`GET ${api}/auth/callback`]: finishLogin,
    [`GET ${api}/auth/me`]: currentUser,
    [`POST ${api}/auth/logout`]: logOut,

    [`GET ${api}/compliance/start`]: (req, res) => startComplianceFlow(req, res, api),
    "GET /mock-compliance/submit": showComplianceForm,
    "POST /mock-compliance/submit": (req, res) => submitComplianceForm(req, res, api),
    [`GET ${api}/compliance/callback`]: finishCompliance,
    [`GET ${api}/compliance/status`]: (req, res) =>
      sendJson(res, 200, complianceStatusFor(req.headers.cookie)),
    [`POST ${api}/compliance/invalidate`]: invalidateCompliance,
  };
}

/** The dev-only mock API. Not listening yet: call `.listen(port)`. */
export function createMockServer(config: MockConfig) {
  const table = routes(config);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handler = table[`${req.method} ${url.pathname}`];
    try {
      if (handler) await handler(req, res, url);
      else sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
    } catch (err) {
      // A throw after /api/stats has already written its 200 NDJSON header
      // (e.g. mid-stream) can't be turned into a JSON error response —
      // sendJson's own res.writeHead would throw ERR_HTTP_HEADERS_SENT. Just end
      // the response instead of trying (and failing) to report the error.
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof BadBodyError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
