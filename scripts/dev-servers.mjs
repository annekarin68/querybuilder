// Start or stop a second pair of dev servers (mock backend + Vite) on their
// own ports, for browser checks beside someone else's `npm run dev`
// (CLAUDE.md, "Before you commit"). Usage:
//
//   node scripts/dev-servers.mjs start [appPort] [backendPort]   (default 5191 3091)
//   node scripts/dev-servers.mjs stop  [appPort]
//
// `start` returns once both servers answer. The process ids go to
// test-results/dev-servers-<appPort>.json, and `stop` stops exactly those
// processes, never anything found by name: a `pkill` can kill somebody
// else's server or your own shell.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, openSync } from "node:fs";

const [command, appPort = "5191", backendPort = "3091"] = process.argv.slice(2);
const pidFile = `test-results/dev-servers-${appPort}.json`;

/** Resolves once `url` answers at all (any status), or rejects after `ms`. */
async function waitFor(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} did not answer within ${ms / 1000} s`);
}

/** Starts `args` detached in its own process group, logging to `log`. */
function startDetached(args, log) {
  const out = openSync(log, "w");
  const child = spawn("npx", args, {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, DEV_BACKEND_URL: `http://localhost:${backendPort}` },
  });
  child.unref();
  return child.pid;
}

async function start() {
  mkdirSync("test-results", { recursive: true });
  const mock = startDetached(
    ["tsx", "mock-server/index.ts"],
    `test-results/mock-${backendPort}.log`,
  );
  const app = startDetached(
    ["vite", "--port", appPort, "--strictPort"],
    `test-results/vite-${appPort}.log`,
  );
  writeFileSync(pidFile, JSON.stringify({ mock, app, cwd: process.cwd() }));
  await waitFor(`http://localhost:${backendPort}/`);
  await waitFor(`http://localhost:${appPort}/`);
  console.log(`Servers up: app http://localhost:${appPort}, backend :${backendPort}.`);
  console.log(`Stop them with: node scripts/dev-servers.mjs stop ${appPort}`);
}

function stop() {
  let pids;
  try {
    pids = JSON.parse(readFileSync(pidFile, "utf8"));
  } catch {
    console.log(`No ${pidFile}: nothing started from here on port ${appPort}.`);
    return;
  }
  for (const pid of [pids.mock, pids.app]) {
    try {
      // The minus sign signals the whole group: npx and the server it started.
      process.kill(-pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  rmSync(pidFile);
  console.log("Servers stopped.");
}

if (command === "start") await start();
else if (command === "stop") stop();
else {
  console.error("Usage: node scripts/dev-servers.mjs start|stop [appPort] [backendPort]");
  process.exit(2);
}
