import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { FIELDS, OPERATORS } from "./catalog";

const PORT = 3001;

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
    // POST /api/stats and /api/query are added in Tasks 9 and 10.
    sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

// Exported for potential integration tests; also starts when run directly.
export { server, readJson, sendJson };
server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
