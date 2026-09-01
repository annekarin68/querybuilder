import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { argv } from "node:process";
import { FIELDS, OPERATORS } from "./catalog";
import { RECORDS } from "./data";
import { matches, computeBlocks, type JsonNode } from "./evaluate";

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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/schema") {
      sendJson(res, 200, { fields: FIELDS, operators: OPERATORS });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stats") {
      const body = (await readJson(req)) as { query?: JsonNode };
      if (!body.query || typeof body.query !== "object") {
        sendJson(res, 400, { error: "Body must include a `query` tree." });
        return;
      }
      const matchCount = RECORDS.filter((r) => matches(body.query as JsonNode, r)).length;
      sendJson(res, 200, {
        matchCount,
        totalCount: RECORDS.length,
        blocks: computeBlocks(body.query as JsonNode, RECORDS),
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/query") {
      const body = (await readJson(req)) as { query?: JsonNode; page?: number; pageSize?: number };
      if (!body.query || typeof body.query !== "object") {
        sendJson(res, 400, { error: "Body must include a `query` tree." });
        return;
      }
      const all = RECORDS.filter((r) => matches(body.query as JsonNode, r));
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
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// Exported for potential integration tests; also starts when run directly.
export { server, readJson, sendJson };
const isEntry = argv[1] && argv[1].endsWith("index.ts");
if (isEntry) server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
