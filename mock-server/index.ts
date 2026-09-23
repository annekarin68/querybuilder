import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DATABASES } from "./databases";
import {
  matches,
  buildStatsLine,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
} from "./evaluate";
import { ENTRYSETS, INDIVIDUALS, type Entryset } from "./vehicleData";
import { ROWS } from "./rows";
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

/** Override with MOCK_PORT to run a second copy (e.g. another checkout) side by side. */
const PORT = Number(process.env.MOCK_PORT) || 3001;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses the mock compliance page's form POST (application/x-www-form-urlencoded). */
async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readBody(req));
}

/**
 * The login/compliance callbacks are browser NAVIGATIONS, not fetches, so a
 * failure there must be a page the user can read and leave — not raw JSON.
 * Also clears the flow's state-binding cookie, which is useless after a failure.
 */
function sendFlowError(res: ServerResponse, message: string, clearCookie: string): void {
  res.writeHead(400, { "content-type": "text/html; charset=utf-8", "Set-Cookie": clearCookie });
  res.end(`<!doctype html>
<html>
  <head><title>Something went wrong</title></head>
  <body style="font-family: sans-serif; max-width: 28rem; margin: 4rem auto;">
    <h1>Something went wrong</h1>
    <p>${escapeHtmlAttr(message)}</p>
    <p><a href="/">Back to the Query Builder</a> and try again.</p>
  </body>
</html>`);
}

/** Escapes text for HTML content or a double-quoted attribute. */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Dev-only stand-in for a real compliance/audit service's submission form.
 *  Server-rendered HTML — never bundled by Vite, never touches dist/. */
function mockComplianceSubmitPage(state: string, error = ""): string {
  return `<!doctype html>
<html>
  <head><title>Mock Compliance Logging Service</title></head>
  <body style="font-family: sans-serif; max-width: 28rem; margin: 4rem auto;">
    <h1>Compliance Logging</h1>
    <p>This stands in for a real internal compliance/audit service during local development.</p>
    ${error ? `<p style="color:#b00">${escapeHtmlAttr(error)}</p>` : ""}
    <form method="POST" action="/mock-compliance/submit">
      <input type="hidden" name="state" value="${escapeHtmlAttr(state)}" />
      <label for="reason">Reason for this data extraction:</label><br/>
      <input type="text" id="reason" name="reason" required style="width:100%;margin:0.5rem 0;" />
      <button type="submit">Submit</button>
    </form>
  </body>
</html>`;
}

/** Thrown by readJson when the request body is not valid JSON — mapped to 400. */
class BadBodyError extends Error {}

/** A valid `query` body is a non-array object; a valid `databases` is a non-empty string[]. */
function badQuery(body: { query?: unknown }): boolean {
  return !body.query || typeof body.query !== "object" || Array.isArray(body.query);
}
function badDatabases(body: { databases?: unknown }): boolean {
  return (
    !Array.isArray(body.databases) ||
    body.databases.length === 0 ||
    !body.databases.every((d) => typeof d === "string")
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    // §10: a malformed body is the caller's fault, not ours — 400, never 500.
    throw new BadBodyError("Request body must be valid JSON.");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/databases") {
      sendJson(res, 200, DATABASES);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/individuals") {
      sendJson(res, 200, INDIVIDUALS);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/auth/login") {
      const state = startLogin();
      res.writeHead(302, {
        Location: `/mock-idp/authorize?state=${encodeURIComponent(state)}`,
        "Set-Cookie": loginStateCookieHeader(state),
      });
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
      const boundState = loginStateFromCookie(req.headers.cookie);
      if (boundState !== state) {
        sendFlowError(res, "Invalid or expired login attempt.", clearLoginStateCookieHeader());
        return;
      }
      const outcome = exchangeCodeForSession(code, state);
      if (!outcome.ok) {
        sendFlowError(res, outcome.error, clearLoginStateCookieHeader());
        return;
      }
      res.writeHead(302, {
        Location: "/?resume=1",
        "Set-Cookie": [sessionCookieHeader(outcome.sessionId), clearLoginStateCookieHeader()],
      });
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
    if (req.method === "GET" && url.pathname === "/api/compliance/start") {
      // A navigation: without a session (e.g. it expired, or the mock was
      // restarted), send the browser to log in rather than to a JSON error.
      if (!sessionFor(req.headers.cookie)) {
        res.writeHead(302, { Location: "/api/auth/login" });
        res.end();
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
      const reason = (form.get("reason") ?? "").trim();
      if (!reason) {
        sendHtml(res, 400, mockComplianceSubmitPage(state, "Please enter a reason."));
        return;
      }
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
        sendFlowError(
          res,
          "Invalid or expired compliance attempt.",
          clearComplianceStateCookieHeader(),
        );
        return;
      }
      const outcome = exchangeComplianceToken(token, state, req.headers.cookie);
      if (!outcome.ok) {
        sendFlowError(res, outcome.error, clearComplianceStateCookieHeader());
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
    if (req.method === "POST" && url.pathname === "/api/stats") {
      const body = (await readJson(req)) as { query?: JsonNode; databases?: string[] };
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

      // Compute before committing the response header: if this (pure, cheap)
      // computation ever threw, the catch block below must still be able to
      // send a normal JSON error response — which requires no header sent yet.
      const counts = perDatabaseCounts(query, ROWS, ids);
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
      for (const c of counts) {
        const db = DATABASES.find((d) => d.label === c.label);
        const totalEntrysets = db?.totalEntrysets ?? 0;
        // Dev-only: occasionally (~5%) simulate a database that can't answer, so
        // the UI's per-database failure path gets exercised without a real backend.
        const line = buildStatsLine(
          Math.random() < 0.05
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
        await delay(150 + Math.random() * 250); // visibly stream in dev, roughly 150-400ms
      }
      res.end();
      return;
    }
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
      const body = (await readJson(req)) as { query?: JsonNode; databases?: string[] };
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
    sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  } catch (err) {
    // A throw after the /api/stats route has already written its 200 NDJSON
    // header (e.g. mid-stream) can't be turned into a JSON error response —
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

server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
