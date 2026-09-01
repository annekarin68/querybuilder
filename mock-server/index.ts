import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
import { DATABASES, FIELDS, OPERATORS } from "./catalog";
import { RECORDS } from "./data";
import {
  matches,
  computeBlocks,
  filterByDatabases,
  perDatabaseCounts,
  scaleCount,
  type JsonNode,
} from "./evaluate";

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

const PREVIEW_COLUMNS = [
  "id",
  "species",
  "branches",
  "heightCm",
  "foliage",
  "flowering",
  "plantedOn",
];

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
    if (req.method === "GET" && url.pathname === "/api/schema") {
      sendJson(res, 200, { fields: FIELDS, operators: OPERATORS });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/databases") {
      // `size` is mock-internal (drives the reported magnitudes) — not part of the contract.
      sendJson(res, 200, { databases: DATABASES.map(({ id, label }) => ({ id, label })) });
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

      // The 200-row sample drives match RATES; DATABASES[].size drives the
      // MAGNITUDE the API reports, so the UI sees realistic large numbers.
      const perDatabase = perDatabaseCounts(query, RECORDS, ids).map((c) => {
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

      const scoped = filterByDatabases(RECORDS, ids);
      const sampleMatch = scoped.filter((r) => matches(query, r)).length;
      const blocks = computeBlocks(query, scoped, {
        total: scoped.length ? totalCount / scoped.length : 1,
        match: sampleMatch ? matchCount / sampleMatch : 1,
      });

      sendJson(res, 200, { matchCount, totalCount, blocks, perDatabase });
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
      const scoped = filterByDatabases(RECORDS, body.databases as string[]);
      const all = scoped.filter((r) => matches(body.query as JsonNode, r));
      const { slice, page, pageSize, totalRows } = paginate(
        all,
        body.page ?? 1,
        body.pageSize ?? 25,
      );
      const columns = PREVIEW_COLUMNS.map((key) => ({
        key,
        label: key === "id" ? "ID" : (FIELDS.find((f) => f.id === key)?.label ?? key),
      }));
      const rows = slice.map((r) =>
        Object.fromEntries(PREVIEW_COLUMNS.map((k) => [k, r[k as keyof typeof r] ?? null])),
      );
      sendJson(res, 200, { columns, rows, page, pageSize, totalRows });
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
