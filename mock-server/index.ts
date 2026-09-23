import { createMockServer } from "./server";

// Starts the dev-only mock API (`npm run mock`, or `npm run dev` with Vite).
// The server itself is in server.ts; this file only reads the settings below
// from the environment and listens.

/** Override with MOCK_PORT to run a second copy (e.g. another checkout) side by side. */
const PORT = Number(process.env.MOCK_PORT) || 3001;

/** A number from the environment variable `name`, or undefined when it isn't set. */
function envNumber(name: string, min: number, max: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}, got "${raw}".`);
  }
  return n;
}

const failRate = envNumber("MOCK_FAIL_RATE", 0, 1);
const lineDelay = envNumber("MOCK_STREAM_DELAY_MS", 0, 60_000);

createMockServer({
  // By default about 5% of /api/stats lines fail, so the UI's per-database
  // failure path gets exercised without a real backend. MOCK_FAIL_RATE=0 turns
  // that off.
  failRate: failRate ?? 0.05,
  // By default each streamed line waits a random 150–400 ms, so the streaming
  // is visible in dev. MOCK_STREAM_DELAY_MS sets a fixed delay (0 = none).
  lineDelayMs: lineDelay === undefined ? () => 150 + Math.random() * 250 : () => lineDelay,
}).listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
