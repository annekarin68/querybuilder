import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
import { buildFields, OPERATORS } from "./schema";
import { DATABASES } from "./databases";
import {
  matches,
  computeBlocks,
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

const FIELDS = buildFields(INDIVIDUALS);

const PORT = 3001;

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const size = Math.min(Math.max(1, Math.floor(pageSize) || 1), 100);
  const p = Math.max(1, Math.floor(page) || 1);
  const start = (p - 1) * size;
  return {
    slice: items.slice(start, start + size),
    page: p,
    pageSize: size,
    totalRows: items.length,
  };
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

/** Parses an application/x-www-form-urlencoded request body — the mock
 *  compliance page's form POST, parallel to readJson for the JSON routes. */
async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

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
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
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
    if (req.method === "GET" && url.pathname === "/api/schema") {
      sendJson(res, 200, { fields: FIELDS, operators: OPERATORS });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/databases") {
      // `size` is mock-internal (drives the reported magnitudes) — not part of the contract.
      sendJson(res, 200, { databases: DATABASES.map(({ id, label }) => ({ id, label })) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/individuals") {
      sendJson(res, 200, { individuals: INDIVIDUALS });
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
        sendJson(res, 400, { error: "Invalid or expired login attempt." });
        return;
      }
      const outcome = exchangeCodeForSession(code, state);
      if (!outcome.ok) {
        sendJson(res, 400, { error: outcome.error });
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

      // The sample drives match RATES; DATABASES[].size drives the
      // MAGNITUDE the API reports, so the UI sees realistic large numbers.
      const perDatabase = perDatabaseCounts(query, ROWS, ids).map((c) => {
        const size = DATABASES.find((d) => d.id === c.id)?.size ?? 0;
        return {
          id: c.id,
          label: DATABASES.find((d) => d.id === c.id)?.label ?? c.id,
          totalCount: size,
          matchCount: scaleCount(c.matchCount, c.totalCount, size),
        };
      });
      const totalCount = perDatabase.reduce((s, d) => s + d.totalCount, 0);
      const matchCount = perDatabase.reduce((s, d) => s + d.matchCount, 0);

      const scoped = filterByDatabases(ROWS, ids);
      const sampleMatch = scoped.filter((r) => matches(query, r)).length;
      const blocks = computeBlocks(query, scoped, FIELDS, {
        total: scoped.length ? totalCount / scoped.length : 1,
        match: sampleMatch ? matchCount / sampleMatch : 1,
      });

      sendJson(res, 200, { matchCount, totalCount, blocks, perDatabase });
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
    sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  } catch (err) {
    if (err instanceof BadBodyError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// Exported for potential integration tests; also starts when run directly.
export { server, readJson, sendJson };
const isEntry = argv[1] && argv[1].endsWith("index.ts");
if (isEntry) server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
