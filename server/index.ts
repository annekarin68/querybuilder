import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { FIELDS } from "./fields.js";
import { RECORDS } from "./mock-data.js";
import { evaluate } from "./evaluate.js";
import type { JsonExpression } from "./types.js";

const PORT = Number(process.env.PORT ?? 5173);
const ROOT = fileURLToPath(new URL("../..", import.meta.url)); // project root (this compiled file lives in server/dist/)

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = pathname === "/" ? "/public/index.html" : pathname.startsWith("/dist/") ? pathname : `/public${pathname}`;
  const filePath = normalize(join(ROOT, relative));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return true;
  }
  try {
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/fields") {
      sendJson(res, 200, { fields: FIELDS });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/query") {
      const body = (await readJsonBody(req)) as { dsl?: string; expression?: JsonExpression };
      if (!body.expression) {
        sendJson(res, 400, { error: "Request body must include an `expression` tree." });
        return;
      }
      const results = RECORDS.filter((record) => evaluate(body.expression as JsonExpression, record, FIELDS));
      sendJson(res, 200, { query: body.dsl ?? null, matchCount: results.length, results });
      return;
    }

    const served = await serveStatic(req, res, url.pathname);
    if (!served) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Query builder demo running at http://localhost:${PORT}`);
});
