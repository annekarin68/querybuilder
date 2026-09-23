import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
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

const PORT = 3001;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    if (req.method === "GET" && url.pathname === "/api/databases") {
      // Every field on DatabaseDef IS the wire contract now — send the array directly.
      sendJson(res, 200, DATABASES);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/individuals") {
      sendJson(res, 200, INDIVIDUALS);
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

// Exported for potential integration tests; also starts when run directly.
export { server, readJson, sendJson };
const isEntry = argv[1] && argv[1].endsWith("index.ts");
if (isEntry) server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
