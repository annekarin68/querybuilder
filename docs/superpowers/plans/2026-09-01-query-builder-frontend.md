# Query Builder Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page query-builder frontend (Fomantic UI + TypeScript, no framework) that talks only to our own API, with a live statistics panel, a schema-driven docs sidebar, and a paged data preview — plus a dev-only mock server so it runs end to end.

**Architecture:** One plain `AppState` object in a tiny store; four independent panels, each with one `render()` that rebuilds its own container via a `paint()` helper. Approach C: Fomantic's jQuery components with full re-render, with all jQuery access confined to one "airlock" file. Pure logic (query tree, validation, summary, API client, store) is TDD'd with Vitest; the view layer is verified manually by design.

**Tech Stack:** Vite 5, TypeScript 5 (strict), Vitest 2, Fomantic UI (`fomantic-ui-css`), jQuery 3, `@fontsource/lato` (self-hosted font), plain Node `http` for the mock server (run with `tsx`), `concurrently`, ESLint + Prettier.

**Spec:** `docs/ARCHITECTURE.md` (living design doc — read it before starting and re-read §6 before Tasks 12–15).

## Global Constraints

- **Node 18.19** on the dev/build machine → pin **Vite `^5`**, **Vitest `^2`** (do not use Vite 6/7, which require Node 20).
- **Offline-first (spec §2):** the app makes network calls **only** to our own API at `VITE_API_BASE` (default `/api`, same origin). No CDNs, Google Fonts, analytics, remote error tracking, or `<script src="http…">`. All third-party code is installed from npm and bundled into a self-contained `dist/`.
- **Fonts self-hosted:** Fomantic's CSS `@import` of Google Fonts is stripped at build time by a Vite plugin; Lato comes from `@fontsource/lato`.
- **`npm run check:offline` must pass** — it scans `dist/` for any off-origin `http(s)` URL and exits non-zero if it finds one. It runs in `build` is **not** automatic; run it after every `npm run build`.
- **jQuery airlock (spec §3):** `import ... 'jquery'` (or `$`) appears in **exactly one file**, `src/ui/fomantic.ts`. ESLint enforces this.
- **Panels are independent (spec §5):** a change to one panel's state never repaints another panel.
- **Stats & preview never show stale data (spec §6):** editing the query immediately clears both in the same `setState`; slow responses are discarded by a stale-query guard.
- **The view layer is not unit-tested (spec §12).** For UI tasks, the "test" is the written manual-verification step. Do not add jsdom/DOM component tests.
- **Wire format:** the query tree is sent as-is via `JSON.stringify`. No DSL string.
- **Commit after every task** (and at the step marked "Commit"). Conventional Commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

**Deleted at the start (Task 1):** the entire inherited implementation — `src/app/`, `src/components/`, `src/core/`, `src/state/`, `server/`, `public/`, `dist/`, `server/dist/`, `tests/*.test.ts`. `docs/` and `README.md` are kept (README rewritten in Task 16).

**Created:**

| Path | Responsibility |
|---|---|
| `package.json` | Rewritten: scripts + deps for the new stack. |
| `tsconfig.json` | Strict TS, `moduleResolution: "bundler"`, `types: ["vite/client"]`. |
| `vite.config.ts` | Dev `/api` proxy to the mock server; the `stripRemoteCss` plugin (offline). |
| `vitest.config.ts` | Test globs `tests/**/*.test.ts`. |
| `.eslintrc.cjs` | `eslint:recommended` + `@typescript-eslint`; `no-restricted-imports` for `jquery` outside `src/ui/fomantic.ts`. |
| `.prettierrc.json` | Formatting. |
| `scripts/check-offline.mjs` | Scans `dist/` for off-origin `http(s)` URLs. |
| `index.html` | `<div id="app">` + `<script type="module" src="/src/main.ts">`. |
| `src/main.ts` | Bootstrap: set `window.jQuery`; import Lato + Fomantic CSS/JS; create store; render layout; load schema; wire subscriptions; hold the `refreshStats` / `runPreview` orchestrators. |
| `src/state.ts` | `AppState` type, `initialState`, `createStore`, singleton `store`. |
| `src/util/debounce.ts` | `debounce(fn, ms)`. |
| `src/api/types.ts` | `SchemaResponse`, `StatsResponse`, `StatBlock`, `QueryResponse`, `ApiError`. The contract. |
| `src/api/client.ts` | `getSchema`, `getStats`, `runQuery`. The only `fetch()` caller. |
| `src/query/types.ts` | `Condition`, `Group`, `QueryNode`, `LogicalOperator`, `Issue`. |
| `src/query/tree.ts` | Pure tree ops: `emptyQuery`, `newCondition`, `newGroup`, `addChild`, `updateNode`, `removeNode`, `findNode`, `countConditions`. |
| `src/query/validate.ts` | `validateQuery(tree, schema): Issue[]`. |
| `src/query/summary.ts` | `queryToText(tree, schema): string`. |
| `src/ui/fomantic.ts` | The jQuery airlock: `activate(container)`, `destroy(container)`, `onDropdownChange`. |
| `src/ui/panel.ts` | `paint(container, html)`; `escapeHtml(s)`. |
| `src/ui/layout.ts` | `renderShell()`, `setActiveView`, `setSidebarCollapsed`, panel container accessors. |
| `src/ui/docsSidebar.ts` | `renderDocsSidebar(state)`. |
| `src/ui/queryBuilder.ts` | `renderQueryBuilder(state)` (recursive) + `wireQueryBuilder(onQueryChange)`. |
| `src/ui/valueControl.ts` | `renderValueControl(field, operator, value)` + `readValueControl(row, arity, valueType)`. |
| `src/ui/statsPanel.ts` | `renderStatsPanel(state)` + one renderer per `StatBlock.kind`. |
| `src/ui/dataPreview.ts` | `renderDataPreview(state)` + `wireDataPreview(handlers)`. |
| `mock-server/index.ts` | Dev-only HTTP server: routing + JSON I/O. |
| `mock-server/catalog.ts` | `FIELDS`, `OPERATORS` (with descriptions + arity). |
| `mock-server/data.ts` | `RECORDS` — ~200 generated in-memory rows. |
| `mock-server/evaluate.ts` | `matches(node, record)`; `computeBlocks(query, rows)`. |
| `tests/**` | Vitest specs mirroring `src/query`, `src/api`, `src/state`, `src/util`, and `mock-server/evaluate`. |

---

## Task 1: Project scaffolding (Vite + TS + Vitest + offline-safe Fomantic)

**Files:**
- Delete: `src/app/`, `src/components/`, `src/core/`, `src/state/`, `server/`, `public/`, `dist/`, `server/dist/`, `tests/ast.test.ts`, `tests/commands.test.ts`, `tests/serializer.test.ts`, `tests/validator.test.ts`
- Create: `package.json` (rewrite), `tsconfig.json` (rewrite), `vite.config.ts`, `vitest.config.ts`, `.eslintrc.cjs`, `.prettierrc.json`, `.gitignore` (extend), `scripts/check-offline.mjs`, `index.html`, `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable Vite app (`npm run dev`), a passing empty test run (`npm run test`), a working `npm run build` + `npm run check:offline`.

- [ ] **Step 1: Remove the inherited implementation**

```bash
git rm -r src server public tests
git rm -r --cached dist server/dist 2>/dev/null || true
rm -rf dist
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "query-builder",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -k -n mock,web -c blue,green \"npm:mock\" \"vite\"",
    "mock": "tsx watch mock-server/index.ts",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "check:offline": "node scripts/check-offline.mjs",
    "lint": "eslint . && prettier --check ."
  },
  "dependencies": {
    "@fontsource/lato": "^5.0.0",
    "fomantic-ui-css": "^2.9.3",
    "jquery": "^3.7.1"
  },
  "devDependencies": {
    "@types/jquery": "^3.5.30",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "concurrently": "^9.0.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: completes; `package-lock.json` updated.

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "mock-server", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Write `vite.config.ts`** (the offline CSS plugin + dev proxy)

```ts
import { defineConfig, type Plugin } from "vite";

/**
 * Offline-first (docs/ARCHITECTURE.md §2): Fomantic's prebuilt CSS contains an
 * `@import url(https://fonts.googleapis.com/...)` for Lato. Nothing may load from
 * the internet, so we strip every off-origin @import / url() from bundled CSS.
 * Lato itself is provided locally by @fontsource/lato (imported in src/main.ts).
 */
function stripRemoteCss(): Plugin {
  return {
    name: "strip-remote-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".css")) return null;
      const cleaned = code
        .replace(/@import\s+url\(\s*['"]?https?:\/\/[^)]+\)\s*;?/gi, "")
        .replace(/url\(\s*['"]?https?:\/\/[^)'"]+['"]?\s*\)/gi, "local(x)");
      return cleaned === code ? null : { code: cleaned, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripRemoteCss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 7: Write `scripts/check-offline.mjs`**

```js
// Fails if the built dist/ references any off-origin http(s) URL.
// See docs/ARCHITECTURE.md §2 (Offline-first).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const URL_RE = /https?:\/\/[^\s"'`)]+/gi;
// Allowed: nothing off-origin. (Our API is same-origin, referenced as "/api/...".)
const ALLOW = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|css|html|map)$/.test(name)) out.push(p);
  }
  return out;
}

let bad = 0;
let files;
try {
  files = walk(DIST);
} catch {
  console.error(`check:offline — "${DIST}/" not found. Run "npm run build" first.`);
  process.exit(2);
}
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (ALLOW.some((a) => url.startsWith(a))) continue;
    console.error(`OFF-ORIGIN URL in ${file}\n  ${url}`);
    bad++;
  }
}
if (bad) {
  console.error(`\ncheck:offline FAILED — ${bad} off-origin URL(s). The app must run on the LAN with no internet.`);
  process.exit(1);
}
console.log("check:offline OK — no off-origin URLs in dist/.");
```

- [ ] **Step 8: Write `.eslintrc.cjs`** (jQuery airlock enforcement)

```cjs
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2022: true, node: true },
  rules: {
    "no-restricted-imports": ["error", { paths: [{ name: "jquery", message: "jQuery may only be imported in src/ui/fomantic.ts (the airlock). See docs/ARCHITECTURE.md §3." }] }],
  },
  overrides: [
    { files: ["src/ui/fomantic.ts"], rules: { "no-restricted-imports": "off" } },
    { files: ["tests/**/*.ts", "mock-server/**/*.ts", "*.config.ts", "scripts/**"], env: { node: true } },
  ],
  ignorePatterns: ["dist/", "node_modules/"],
};
```

- [ ] **Step 9: Write `.prettierrc.json`**

```json
{ "printWidth": 100, "singleQuote": false, "trailingComma": "all" }
```

- [ ] **Step 10: Extend `.gitignore`**

Append these lines (keep existing entries):

```
# Vite
.vite/
*.local
```

- [ ] **Step 11: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Query Builder</title>
    <link rel="icon" href="data:," />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 12: Write `src/styles.css`** (minimal; layout tweaks only — Fomantic does the rest)

```css
/* System-font override kept out of scope: Fomantic + @fontsource/lato handle typography. */
html, body { height: 100%; }
body { margin: 0; }
#app { min-height: 100%; }

/* Layout helpers used by src/ui/layout.ts */
.qb-body { display: flex; gap: 1rem; padding: 1rem; align-items: flex-start; }
.qb-col-docs { flex: 0 0 20rem; }
.qb-col-center { flex: 1 1 auto; min-width: 0; }
.qb-col-stats { flex: 0 0 20rem; }
.qb-body.qb-docs-collapsed .qb-col-docs { display: none; }
.qb-preview { padding: 0 1rem 2rem; }
.qb-col-docs .ui.accordion { max-height: 70vh; overflow-y: auto; }
```

- [ ] **Step 13: Write a temporary `src/main.ts`** (replaced in Task 10; proves the toolchain + offline font path)

```ts
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "fomantic-ui-css/semantic.min.css";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  app.innerHTML = `<div class="ui container" style="padding-top:2rem">
    <h1 class="ui header">Query Builder</h1>
    <p>Toolchain scaffolding is working.</p>
  </div>`;
}
```

- [ ] **Step 14: Verify dev server**

Run: `npm run dev`
Expected: Vite serves on `http://localhost:5173`; the page shows the Fomantic-styled heading in the Lato font; the browser Network tab shows **no** request to `fonts.googleapis.com` or any non-localhost host. (The mock script will fail to start — that's fine; Task 2 adds it.) Stop with Ctrl+C.

- [ ] **Step 15: Verify build + offline guard + empty test run**

```bash
npm run build
npm run check:offline
npm run test
```
Expected: `build` writes `dist/`; `check:offline` prints `check:offline OK`; `test` reports "no test files found" (exit 0 for Vitest 2 with `passWithNoTests` — if it errors, add `"passWithNoTests": true` under `test:` in `vitest.config.ts`).

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + TS + Vitest with offline-safe Fomantic setup"
```

---

## Task 2: Mock server — catalog, data, and `GET /api/schema`

**Files:**
- Create: `mock-server/catalog.ts`, `mock-server/data.ts`, `mock-server/index.ts`
- Test: `tests/mock-server/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mock-server/catalog.ts` → `export const FIELDS: FieldDef[]`, `export const OPERATORS: OperatorDef[]`, and the types `FieldDef` (`{ id, label, valueType: "string"|"number"|"boolean"|"date"|"enum", description, options?: {value,label}[], operatorIds: string[] }`) and `OperatorDef` (`{ id, label, description, arity: "none"|"one"|"two"|"many" }`).
  - `mock-server/data.ts` → `export const RECORDS: Record<string, string|number|boolean|null>[]` (~200 rows keyed by field id).
  - `mock-server/index.ts` → an HTTP server on port `3001` serving `GET /api/schema` → `{ fields: FIELDS, operators: OPERATORS }`.

- [ ] **Step 1: Write the failing test** — `tests/mock-server/catalog.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FIELDS, OPERATORS } from "../../mock-server/catalog";

describe("catalog", () => {
  it("every field references only real operator ids", () => {
    const ids = new Set(OPERATORS.map((o) => o.id));
    for (const f of FIELDS) {
      for (const opId of f.operatorIds) expect(ids.has(opId)).toBe(true);
    }
  });

  it("enum fields have options", () => {
    for (const f of FIELDS) {
      if (f.valueType === "enum") expect(f.options && f.options.length).toBeTruthy();
    }
  });

  it("operator arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-server/catalog.test.ts`
Expected: FAIL — cannot resolve `mock-server/catalog`.

- [ ] **Step 3: Write `mock-server/catalog.ts`**

```ts
export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Arity = "none" | "one" | "two" | "many";

export interface FieldDef {
  id: string;
  label: string;
  valueType: ValueType;
  description: string;
  options?: { value: string; label: string }[];
  operatorIds: string[];
}

export interface OperatorDef {
  id: string;
  label: string;
  description: string;
  arity: Arity;
}

export const OPERATORS: OperatorDef[] = [
  { id: "eq", label: "Equals", description: "The field exactly matches the value.", arity: "one" },
  { id: "neq", label: "Not equals", description: "The field is anything other than the value.", arity: "one" },
  { id: "gt", label: "Greater than", description: "The field is strictly greater than the value.", arity: "one" },
  { id: "gte", label: "Greater than or equal", description: "The field is at least the value.", arity: "one" },
  { id: "lt", label: "Less than", description: "The field is strictly less than the value.", arity: "one" },
  { id: "lte", label: "Less than or equal", description: "The field is at most the value.", arity: "one" },
  { id: "before", label: "Before", description: "The date is earlier than the value.", arity: "one" },
  { id: "after", label: "After", description: "The date is later than the value.", arity: "one" },
  { id: "contains", label: "Contains", description: "The text includes the value.", arity: "one" },
  { id: "between", label: "Between", description: "The field is within the inclusive range [from, to].", arity: "two" },
  { id: "in", label: "Is any of", description: "The field matches one of several values.", arity: "many" },
  { id: "isEmpty", label: "Is empty", description: "The field has no value.", arity: "none" },
  { id: "isNotEmpty", label: "Is not empty", description: "The field has a value.", arity: "none" },
];

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"]
  .map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }));

export const FIELDS: FieldDef[] = [
  {
    id: "species", label: "Species", valueType: "enum",
    description: "The kind of plant. One of a fixed list.",
    options: [
      { value: "fern", label: "Fern" }, { value: "oak", label: "Oak" },
      { value: "rose", label: "Rose" }, { value: "cactus", label: "Cactus" },
      { value: "bamboo", label: "Bamboo" },
    ],
    operatorIds: ["eq", "neq", "in", "isEmpty", "isNotEmpty"],
  },
  { id: "branches", label: "Branch count", valueType: "number",
    description: "How many branches the plant has. Whole number.",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"] },
  { id: "heightCm", label: "Height (cm)", valueType: "number",
    description: "Height above soil in centimetres.",
    operatorIds: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"] },
  { id: "foliage", label: "Has foliage", valueType: "boolean",
    description: "Whether the plant currently has leaves.",
    operatorIds: ["eq", "neq"] },
  { id: "flowering", label: "Flowering month", valueType: "enum", options: MONTHS,
    description: "The month the plant flowers, if any.",
    operatorIds: ["eq", "neq", "between", "in", "isEmpty", "isNotEmpty"] },
  { id: "plantedOn", label: "Planted on", valueType: "date",
    description: "Calendar date the plant was put in the ground (YYYY-MM-DD).",
    operatorIds: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"] },
  { id: "notes", label: "Notes", valueType: "string",
    description: "Free-text notes from the gardener.",
    operatorIds: ["eq", "neq", "contains", "isEmpty", "isNotEmpty"] },
];
```

- [ ] **Step 4: Write `mock-server/data.ts`**

```ts
import { FIELDS } from "./catalog";

type Row = Record<string, string | number | boolean | null>;

const SPECIES = ["fern", "oak", "rose", "cactus", "bamboo"];
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const NOTE_WORDS = ["healthy", "needs water", "repotted", "pest damage", "new growth", "leggy", "dormant"];

// Deterministic pseudo-random so tests and the UI are stable across restarts.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export const RECORDS: Row[] = (() => {
  const rand = rng(42);
  const rows: Row[] = [];
  for (let i = 0; i < 200; i++) {
    const missing = rand() < 0.08; // ~8% of some fields are null, so isEmpty/nullCount are meaningful
    rows.push({
      id: i + 1,
      species: SPECIES[Math.floor(rand() * SPECIES.length)],
      branches: missing ? null : Math.floor(rand() * 40),
      heightCm: Math.floor(rand() * 300),
      foliage: rand() < 0.7,
      flowering: rand() < 0.5 ? null : MONTHS[Math.floor(rand() * MONTHS.length)],
      plantedOn: `20${10 + Math.floor(rand() * 15)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
      notes: NOTE_WORDS[Math.floor(rand() * NOTE_WORDS.length)],
    });
  }
  return rows;
})();

// Guard: every field id (except the synthetic "id") exists on every row.
for (const f of FIELDS) {
  if (!(f.id in RECORDS[0])) throw new Error(`data.ts is missing column "${f.id}"`);
}
```

- [ ] **Step 5: Write `mock-server/index.ts`** (routing + `GET /api/schema` only for now)

```ts
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/mock-server/catalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Manual check the endpoint**

```bash
npx tsx mock-server/index.ts &
sleep 1
curl -s http://localhost:3001/api/schema | head -c 300
kill %1
```
Expected: JSON beginning `{"fields":[{"id":"species"...`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: mock server catalog, data, and GET /api/schema"
```

---

## Task 3: Query model — types + `tree.ts`

**Files:**
- Create: `src/query/types.ts`, `src/query/tree.ts`
- Test: `tests/query/tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/query/types.ts` → `LogicalOperator = "AND"|"OR"`; `Condition = { kind:"condition"; id:string; fieldId:string|null; operatorId:string|null; value:unknown }`; `Group = { kind:"group"; id:string; operator:LogicalOperator; children:(Group|Condition)[]; collapsed?:boolean }`; `QueryNode = Group|Condition`; `Issue = { nodeId:string; message:string; severity:"error"|"warning" }`.
  - `src/query/tree.ts` → `emptyQuery(): Group`; `newCondition(): Condition`; `newGroup(): Group`; `addChild(tree: Group, parentId: string, node: QueryNode): Group`; `updateNode(tree: Group, nodeId: string, patch: Partial<Condition & Group>): Group`; `removeNode(tree: Group, nodeId: string): Group`; `findNode(tree: QueryNode, nodeId: string): QueryNode | null`; `countConditions(tree: QueryNode): number`. All return **new** trees; inputs are never mutated.

- [ ] **Step 1: Write the failing test** — `tests/query/tree.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { emptyQuery, newCondition, newGroup, addChild, updateNode, removeNode, findNode, countConditions } from "../../src/query/tree";

describe("tree", () => {
  it("emptyQuery is an AND group with no children", () => {
    const q = emptyQuery();
    expect(q).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(typeof q.id).toBe("string");
  });

  it("new nodes get unique ids", () => {
    expect(newCondition().id).not.toBe(newCondition().id);
    expect(newGroup().id).not.toBe(newGroup().id);
  });

  it("addChild returns a new tree with the node appended, original unchanged", () => {
    const root = emptyQuery();
    const c = newCondition();
    const next = addChild(root, root.id, c);
    expect(root.children).toHaveLength(0); // original untouched
    expect(next.children).toHaveLength(1);
    expect(next.children[0]).toBe(c);
  });

  it("addChild can target a nested group", () => {
    const root = emptyQuery();
    const g = newGroup();
    const withGroup = addChild(root, root.id, g);
    const c = newCondition();
    const next = addChild(withGroup, g.id, c);
    const found = findNode(next, g.id) as import("../../src/query/types").Group;
    expect(found.children[0]).toBe(c);
  });

  it("updateNode shallow-merges a patch into one node only", () => {
    const root = emptyQuery();
    const c = newCondition();
    const t1 = addChild(root, root.id, c);
    const t2 = updateNode(t1, c.id, { fieldId: "species", operatorId: "eq", value: "oak" });
    const updated = findNode(t2, c.id) as import("../../src/query/types").Condition;
    expect(updated).toMatchObject({ fieldId: "species", operatorId: "eq", value: "oak" });
    // original still null
    expect((findNode(t1, c.id) as any).fieldId).toBeNull();
  });

  it("removeNode deletes the node wherever it is", () => {
    const root = emptyQuery();
    const c = newCondition();
    const t1 = addChild(root, root.id, c);
    const t2 = removeNode(t1, c.id);
    expect(t2.children).toHaveLength(0);
    expect(findNode(t2, c.id)).toBeNull();
  });

  it("countConditions counts leaves at any depth", () => {
    const root = emptyQuery();
    const g = newGroup();
    let t = addChild(root, root.id, newCondition());
    t = addChild(t, root.id, g);
    t = addChild(t, g.id, newCondition());
    t = addChild(t, g.id, newCondition());
    expect(countConditions(t)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/query/tree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/query/types.ts`**

```ts
export type LogicalOperator = "AND" | "OR";

export interface Condition {
  kind: "condition";
  id: string;
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}

export interface Group {
  kind: "group";
  id: string;
  operator: LogicalOperator;
  children: (Group | Condition)[];
  collapsed?: boolean;
}

export type QueryNode = Group | Condition;

export interface Issue {
  nodeId: string;
  message: string;
  severity: "error" | "warning";
}
```

- [ ] **Step 4: Write `src/query/tree.ts`**

```ts
import type { Condition, Group, QueryNode } from "./types";

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function emptyQuery(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

export function newCondition(): Condition {
  return { kind: "condition", id: id("c"), fieldId: null, operatorId: null, value: null };
}

export function newGroup(): Group {
  return { kind: "group", id: id("g"), operator: "AND", children: [] };
}

/** Return a copy of `node` with `fn` applied to every node in the tree (post-order). */
function mapTree(node: QueryNode, fn: (n: QueryNode) => QueryNode): QueryNode {
  if (node.kind === "group") {
    const mapped: Group = { ...node, children: node.children.map((c) => mapTree(c, fn) as Group | Condition) };
    return fn(mapped);
  }
  return fn({ ...node });
}

export function addChild(tree: Group, parentId: string, node: QueryNode): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === parentId ? { ...n, children: [...n.children, node as Group | Condition] } : n,
  ) as Group;
}

export function updateNode(tree: Group, nodeId: string, patch: Partial<Condition & Group>): Group {
  return mapTree(tree, (n) => (n.id === nodeId ? ({ ...n, ...patch } as QueryNode) : n)) as Group;
}

export function removeNode(tree: Group, nodeId: string): Group {
  return mapTree(tree, (n) =>
    n.kind === "group" ? { ...n, children: n.children.filter((c) => c.id !== nodeId) } : n,
  ) as Group;
}

export function findNode(tree: QueryNode, nodeId: string): QueryNode | null {
  if (tree.id === nodeId) return tree;
  if (tree.kind === "group") {
    for (const child of tree.children) {
      const hit = findNode(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

export function countConditions(tree: QueryNode): number {
  if (tree.kind === "condition") return 1;
  return tree.children.reduce((sum, c) => sum + countConditions(c), 0);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/query/tree.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: query tree model with pure immutable operations"
```

---

## Task 4: Query validation — `validate.ts`

**Files:**
- Create: `src/query/validate.ts`
- Test: `tests/query/validate.test.ts`

**Interfaces:**
- Consumes: `src/query/types.ts` (`QueryNode`, `Group`, `Condition`, `Issue`); `src/query/tree.ts` (`emptyQuery`, `newCondition`, `newGroup`, `addChild`, `updateNode`).
- Produces: `src/query/validate.ts` → `validateQuery(tree: QueryNode, schema: ValidationSchema): Issue[]` where `ValidationSchema = { fields: { id: string; valueType: string }[]; operators: { id: string; arity: "none"|"one"|"two"|"many" }[] }`. Also `hasBlockingErrors(issues: Issue[]): boolean` (true if any `severity === "error"`).

- [ ] **Step 1: Write the failing test** — `tests/query/validate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateQuery, hasBlockingErrors } from "../../src/query/validate";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const schema = {
  fields: [
    { id: "species", valueType: "enum" },
    { id: "branches", valueType: "number" },
  ],
  operators: [
    { id: "eq", arity: "one" as const },
    { id: "between", arity: "two" as const },
    { id: "in", arity: "many" as const },
    { id: "isEmpty", arity: "none" as const },
  ],
};

function root1(patch: Record<string, unknown>) {
  const c = newCondition();
  return { tree: updateNode(addChild(emptyQuery(), emptyQuery().id, c), c.id, patch as any), cid: c.id };
}

describe("validateQuery", () => {
  it("empty root query has no issues", () => {
    expect(validateQuery(emptyQuery(), schema)).toEqual([]);
  });

  it("condition without a field is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    const tree = addChild(root, root.id, c);
    const issues = validateQuery(tree, schema);
    expect(issues).toContainEqual({ nodeId: c.id, message: "Choose a field.", severity: "error" });
  });

  it("condition with a field but no operator is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species" });
    expect(validateQuery(tree, schema)).toContainEqual({ nodeId: c.id, message: "Choose an operator.", severity: "error" });
  });

  it("arity 'one' with an empty value is an error", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "eq", value: "" });
    expect(validateQuery(tree, schema)).toContainEqual({ nodeId: c.id, message: "Enter a value.", severity: "error" });
  });

  it("arity 'two' needs exactly two non-empty values", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "branches", operatorId: "between", value: [1] });
    expect(validateQuery(tree, schema)).toContainEqual({ nodeId: c.id, message: "Enter both values.", severity: "error" });
  });

  it("arity 'many' needs at least one value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "in", value: [] });
    expect(validateQuery(tree, schema)).toContainEqual({ nodeId: c.id, message: "Choose at least one value.", severity: "error" });
  });

  it("arity 'none' ignores the value", () => {
    const root = emptyQuery();
    const c = newCondition();
    let tree = addChild(root, root.id, c);
    tree = updateNode(tree, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(validateQuery(tree, schema)).toEqual([]);
  });

  it("a non-root empty group is an error", () => {
    const root = emptyQuery();
    const g = newGroup();
    const tree = addChild(root, root.id, g);
    expect(validateQuery(tree, schema)).toContainEqual({ nodeId: g.id, message: "Add a condition to this group.", severity: "error" });
  });

  it("hasBlockingErrors is true only when an error-severity issue is present", () => {
    expect(hasBlockingErrors([{ nodeId: "x", message: "m", severity: "warning" }])).toBe(false);
    expect(hasBlockingErrors([{ nodeId: "x", message: "m", severity: "error" }])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/query/validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/query/validate.ts`**

```ts
import type { Condition, Issue, QueryNode } from "./types";

export interface ValidationSchema {
  fields: { id: string; valueType: string }[];
  operators: { id: string; arity: "none" | "one" | "two" | "many" }[];
}

export function hasBlockingErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

function isEmptyScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function checkCondition(c: Condition, schema: ValidationSchema, out: Issue[]): void {
  if (!c.fieldId) {
    out.push({ nodeId: c.id, message: "Choose a field.", severity: "error" });
    return;
  }
  if (!c.operatorId) {
    out.push({ nodeId: c.id, message: "Choose an operator.", severity: "error" });
    return;
  }
  const op = schema.operators.find((o) => o.id === c.operatorId);
  if (!op) {
    out.push({ nodeId: c.id, message: "Unknown operator.", severity: "error" });
    return;
  }
  if (op.arity === "one" && isEmptyScalar(c.value)) {
    out.push({ nodeId: c.id, message: "Enter a value.", severity: "error" });
  }
  if (op.arity === "two") {
    const v = c.value;
    if (!Array.isArray(v) || v.length !== 2 || v.some(isEmptyScalar)) {
      out.push({ nodeId: c.id, message: "Enter both values.", severity: "error" });
    }
  }
  if (op.arity === "many") {
    const v = c.value;
    if (!Array.isArray(v) || v.length === 0) {
      out.push({ nodeId: c.id, message: "Choose at least one value.", severity: "error" });
    }
  }
}

function walk(node: QueryNode, isRoot: boolean, schema: ValidationSchema, out: Issue[]): void {
  if (node.kind === "condition") {
    checkCondition(node, schema, out);
    return;
  }
  if (!isRoot && node.children.length === 0) {
    out.push({ nodeId: node.id, message: "Add a condition to this group.", severity: "error" });
  }
  for (const child of node.children) walk(child, false, schema, out);
}

export function validateQuery(tree: QueryNode, schema: ValidationSchema): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, schema, out);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/query/validate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: query validation with per-node issues"
```

---

## Task 5: Query summary — `summary.ts`

**Files:**
- Create: `src/query/summary.ts`
- Test: `tests/query/summary.test.ts`

**Interfaces:**
- Consumes: `src/query/types.ts`; `src/query/tree.ts`.
- Produces: `src/query/summary.ts` → `queryToText(tree: QueryNode, schema: SummarySchema): string` where `SummarySchema = { fields: { id: string; label: string; options?: { value: string; label: string }[] }[]; operators: { id: string; label: string; arity: "none"|"one"|"two"|"many" }[] }`. Empty root → `"(empty query)"`.

- [ ] **Step 1: Write the failing test** — `tests/query/summary.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { queryToText } from "../../src/query/summary";
import { emptyQuery, newCondition, newGroup, addChild, updateNode } from "../../src/query/tree";

const schema = {
  fields: [
    { id: "heightCm", label: "Height (cm)" },
    { id: "foliage", label: "Has foliage" },
    { id: "species", label: "Species", options: [{ value: "oak", label: "Oak" }, { value: "fern", label: "Fern" }] },
  ],
  operators: [
    { id: "gte", label: "≥", arity: "one" as const },
    { id: "eq", label: "is", arity: "one" as const },
    { id: "in", label: "is any of", arity: "many" as const },
    { id: "isEmpty", label: "is empty", arity: "none" as const },
  ],
};

describe("queryToText", () => {
  it("empty query", () => {
    expect(queryToText(emptyQuery(), schema)).toBe("(empty query)");
  });

  it("single condition, no parens at root", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "heightCm", operatorId: "gte", value: 20 });
    expect(queryToText(t, schema)).toBe("Height (cm) ≥ 20");
  });

  it("enum value uses the option label; nested group gets parens", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const g = newGroup();
    const c2 = newCondition();
    const c3 = newCondition();
    let t = addChild(root, root.id, c1);
    t = updateNode(t, c1.id, { fieldId: "heightCm", operatorId: "gte", value: 20 });
    t = addChild(t, root.id, g);
    t = updateNode(t, g.id, { operator: "OR" });
    t = addChild(t, g.id, c2);
    t = updateNode(t, c2.id, { fieldId: "foliage", operatorId: "eq", value: true });
    t = addChild(t, g.id, c3);
    t = updateNode(t, c3.id, { fieldId: "species", operatorId: "in", value: ["oak", "fern"] });
    expect(queryToText(t, schema)).toBe("Height (cm) ≥ 20 AND (Has foliage is true OR Species is any of Oak, Fern)");
  });

  it("arity none prints just field + operator", () => {
    const root = emptyQuery();
    const c = newCondition();
    let t = addChild(root, root.id, c);
    t = updateNode(t, c.id, { fieldId: "species", operatorId: "isEmpty", value: null });
    expect(queryToText(t, schema)).toBe("Species is empty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/query/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/query/summary.ts`**

```ts
import type { Condition, Group, QueryNode } from "./types";

export interface SummarySchema {
  fields: { id: string; label: string; options?: { value: string; label: string }[] }[];
  operators: { id: string; label: string; arity: "none" | "one" | "two" | "many" }[];
}

function optionLabel(schema: SummarySchema, fieldId: string | null, raw: unknown): string {
  const field = schema.fields.find((f) => f.id === fieldId);
  const opt = field?.options?.find((o) => o.value === raw);
  if (opt) return opt.label;
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}

function formatValue(schema: SummarySchema, c: Condition, arity: string): string {
  if (arity === "none") return "";
  if (arity === "two" && Array.isArray(c.value)) {
    return `${optionLabel(schema, c.fieldId, c.value[0])} to ${optionLabel(schema, c.fieldId, c.value[1])}`;
  }
  if (arity === "many" && Array.isArray(c.value)) {
    return c.value.map((v) => optionLabel(schema, c.fieldId, v)).join(", ");
  }
  return optionLabel(schema, c.fieldId, c.value);
}

function conditionText(schema: SummarySchema, c: Condition): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const op = schema.operators.find((o) => o.id === c.operatorId);
  const parts = [field?.label ?? "(field?)", op?.label ?? "(operator?)"];
  const val = op ? formatValue(schema, c, op.arity) : "";
  if (val) parts.push(val);
  return parts.join(" ");
}

function nodeText(schema: SummarySchema, node: QueryNode, isRoot: boolean): string {
  if (node.kind === "condition") return conditionText(schema, node);
  const group = node as Group;
  if (group.children.length === 0) return isRoot ? "(empty query)" : "()";
  const inner = group.children.map((c) => nodeText(schema, c, false)).join(` ${group.operator} `);
  return isRoot ? inner : `(${inner})`;
}

export function queryToText(tree: QueryNode, schema: SummarySchema): string {
  return nodeText(schema, tree, true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/query/summary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: human-readable query summary text"
```

---

## Task 6: API contract types + client

**Files:**
- Create: `src/api/types.ts`, `src/api/client.ts`
- Test: `tests/api/client.test.ts`

**Interfaces:**
- Consumes: `src/query/types.ts` (`QueryNode`).
- Produces:
  - `src/api/types.ts` → exactly the shapes in spec §7: `SchemaResponse`, `StatsResponse`, `StatBlock` (union of `number-summary` | `distribution` | `date-range`), `QueryResponse`.
  - `src/api/client.ts` → `getSchema(): Promise<SchemaResponse>`, `getStats(query: QueryNode): Promise<StatsResponse>`, `runQuery(query: QueryNode, page: number, pageSize: number): Promise<QueryResponse>`. On any non-2xx, throws `Error` whose `.message` is the response body's `error` string when present, else `"<status> <statusText>"`. Base URL: `import.meta.env.VITE_API_BASE ?? "/api"`.

- [ ] **Step 1: Write `src/api/types.ts`**

```ts
export interface SchemaResponse {
  fields: {
    id: string;
    label: string;
    valueType: "string" | "number" | "boolean" | "date" | "enum";
    description: string;
    options?: { value: string; label: string }[];
    operatorIds: string[];
  }[];
  operators: {
    id: string;
    label: string;
    description: string;
    arity: "none" | "one" | "two" | "many";
  }[];
}

export type StatBlock =
  | { kind: "number-summary"; fieldLabel: string; min: number; max: number; avg: number; nullCount: number }
  | { kind: "distribution"; fieldLabel: string; buckets: { label: string; count: number }[]; nullCount: number }
  | { kind: "date-range"; fieldLabel: string; earliest: string; latest: string; nullCount: number };

export interface StatsResponse {
  matchCount: number;
  totalCount: number;
  blocks: StatBlock[];
}

export interface QueryResponse {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | boolean | null>[];
  page: number;
  pageSize: number;
  totalRows: number;
}
```

- [ ] **Step 2: Write the failing test** — `tests/api/client.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getSchema, getStats, runQuery } from "../../src/api/client";
import { emptyQuery } from "../../src/query/tree";

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "STATUS",
    json: async () => body,
  } as Response);
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("getSchema GETs /api/schema and returns the parsed body", async () => {
    const f = mockFetchOnce(200, { fields: [], operators: [] });
    vi.stubGlobal("fetch", f);
    const out = await getSchema();
    expect(out).toEqual({ fields: [], operators: [] });
    expect(f).toHaveBeenCalledWith("/api/schema", undefined);
  });

  it("getStats POSTs the query tree as JSON", async () => {
    const f = mockFetchOnce(200, { matchCount: 1, totalCount: 2, blocks: [] });
    vi.stubGlobal("fetch", f);
    const q = emptyQuery();
    await getStats(q);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: JSON.parse(JSON.stringify(q)) });
  });

  it("runQuery POSTs query + paging", async () => {
    const f = mockFetchOnce(200, { columns: [], rows: [], page: 2, pageSize: 25, totalRows: 0 });
    vi.stubGlobal("fetch", f);
    await runQuery(emptyQuery(), 2, 25);
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ page: 2, pageSize: 25 });
  });

  it("throws the server's error message on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(400, { error: "bad query tree" }));
    await expect(getStats(emptyQuery())).rejects.toThrow("bad query tree");
  });

  it("falls back to status text when there is no error field", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(500, {}));
    await expect(getSchema()).rejects.toThrow("500 STATUS");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api/client.test.ts`
Expected: FAIL — `src/api/client` not found.

- [ ] **Step 4: Write `src/api/client.ts`**

```ts
import type { QueryNode } from "../query/types";
import type { QueryResponse, SchemaResponse, StatsResponse } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* keep the status-line message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function postJson(path: string, payload: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }) as unknown as Promise<Response>;
}

export function getSchema(): Promise<SchemaResponse> {
  return request<SchemaResponse>("/schema");
}

export function getStats(query: QueryNode): Promise<StatsResponse> {
  return request<StatsResponse>("/stats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

export function runQuery(query: QueryNode, page: number, pageSize: number): Promise<QueryResponse> {
  return request<QueryResponse>("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, page, pageSize }),
  });
}
```

> Note: `postJson` is intentionally unused — delete it; it is shown here only so an executor who prefers a helper sees the shape. Keep `getStats`/`runQuery` inline as written.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: typed API client and contract types"
```

---

## Task 7: State store + debounce util

**Files:**
- Create: `src/state.ts`, `src/util/debounce.ts`
- Test: `tests/state.test.ts`, `tests/util/debounce.test.ts`

**Interfaces:**
- Consumes: `src/query/types.ts` (`QueryNode`, `Issue`); `src/query/tree.ts` (`emptyQuery`); `src/api/types.ts` (`SchemaResponse`, `StatsResponse`, `QueryResponse`).
- Produces:
  - `src/state.ts` → `AppState` (exactly spec §5 shape + `activeView`), `initialState: AppState`, `createStore(initial: AppState)` returning `{ getState(): AppState; setState(patch: Partial<AppState>): void; subscribe(fn: (s: AppState, changed: Set<keyof AppState>) => void): () => void }`, and a module singleton `export const store = createStore(initialState)`.
  - `src/util/debounce.ts` → `debounce<F extends (...a: any[]) => void>(fn: F, ms: number): F & { cancel(): void }`.

- [ ] **Step 1: Write the failing tests**

`tests/util/debounce.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { debounce } from "../../src/util/debounce";

describe("debounce", () => {
  it("calls once after the quiet period, with the latest args", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 400);
    d(1); d(2); d(3);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    vi.useRealTimers();
  });

  it("cancel() prevents a pending call", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const d = debounce(spy, 400);
    d(); d.cancel();
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

`tests/state.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createStore, initialState } from "../../src/state";

describe("store", () => {
  it("setState shallow-merges and keeps other keys", () => {
    const s = createStore(initialState);
    s.setState({ sidebarCollapsed: true });
    expect(s.getState().sidebarCollapsed).toBe(true);
    expect(s.getState().activeView).toBe("filter");
  });

  it("subscribers receive the new state and the set of changed keys", () => {
    const s = createStore(initialState);
    const seen: string[] = [];
    s.subscribe((_state, changed) => seen.push(...changed));
    s.setState({ activeView: "review" });
    expect(seen).toEqual(["activeView"]);
  });

  it("unsubscribe stops notifications", () => {
    const s = createStore(initialState);
    const spy = vi.fn();
    const off = s.subscribe(spy);
    off();
    s.setState({ sidebarCollapsed: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("initialState has an empty AND-group query and idle panels", () => {
    expect(initialState.query).toMatchObject({ kind: "group", operator: "AND", children: [] });
    expect(initialState.stats.status).toBe("idle");
    expect(initialState.preview.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/state.test.ts tests/util/debounce.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/util/debounce.ts`**

```ts
export function debounce<F extends (...args: any[]) => void>(fn: F, ms: number): F & { cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: Parameters<F>) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  }) as F & { cancel(): void };
  wrapped.cancel = () => {
    if (handle) clearTimeout(handle);
    handle = undefined;
  };
  return wrapped;
}
```

- [ ] **Step 4: Write `src/state.ts`**

```ts
import type { Issue, QueryNode } from "./query/types";
import { emptyQuery } from "./query/tree";
import type { QueryResponse, SchemaResponse, StatsResponse } from "./api/types";

export type ActiveView = "filter" | "review" | "approval" | "done";
export type AsyncStatus = "idle" | "loading" | "ok" | "error";

export interface AppState {
  schema: SchemaResponse | null;
  activeView: ActiveView;

  query: QueryNode;
  issues: Issue[];

  stats: { status: AsyncStatus; data: StatsResponse | null; error: string | null };
  preview: { status: AsyncStatus; data: QueryResponse | null; error: string | null; page: number };

  sidebarCollapsed: boolean;
}

export const initialState: AppState = {
  schema: null,
  activeView: "filter",
  query: emptyQuery(),
  issues: [],
  stats: { status: "idle", data: null, error: null },
  preview: { status: "idle", data: null, error: null, page: 1 },
  sidebarCollapsed: false,
};

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: (): AppState => state,
    setState(patch: Partial<AppState>): void {
      const changed = new Set(Object.keys(patch) as (keyof AppState)[]);
      state = { ...state, ...patch };
      for (const l of listeners) l(state, changed);
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const store = createStore(initialState);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/state.test.ts tests/util/debounce.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Full suite + typecheck + commit**

```bash
npm run test
npm run typecheck
git add -A
git commit -m "feat: app state store and debounce utility"
```

---

## Task 8: Mock server — `matches()` evaluator

**Files:**
- Create: `mock-server/evaluate.ts`
- Test: `tests/mock-server/evaluate.test.ts`

**Interfaces:**
- Consumes: `mock-server/catalog.ts` (`FIELDS`, `OPERATORS`, `FieldDef`, `Arity`).
- Produces: `mock-server/evaluate.ts` → `matches(node: JsonNode, row: Row): boolean` where `JsonNode` is the wire shape (`{ kind:"condition"; fieldId; operatorId; value } | { kind:"group"; operator:"AND"|"OR"; children:JsonNode[] }`) and `Row = Record<string, string|number|boolean|null>`. An empty group returns `true` (matches everything — the "no filter" case).

- [ ] **Step 1: Write the failing test** — `tests/mock-server/evaluate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { matches } from "../../mock-server/evaluate";

const row = { species: "oak", branches: 12, heightCm: 200, foliage: true, flowering: null, plantedOn: "2018-05-01", notes: "healthy" };

const cond = (fieldId: string, operatorId: string, value: unknown) => ({ kind: "condition" as const, fieldId, operatorId, value });
const group = (operator: "AND" | "OR", ...children: any[]) => ({ kind: "group" as const, operator, children });

describe("matches", () => {
  it("empty group matches everything", () => {
    expect(matches(group("AND"), row)).toBe(true);
  });
  it("eq / neq on strings and numbers", () => {
    expect(matches(cond("species", "eq", "oak"), row)).toBe(true);
    expect(matches(cond("species", "neq", "oak"), row)).toBe(false);
    expect(matches(cond("branches", "eq", 12), row)).toBe(true);
  });
  it("numeric comparisons", () => {
    expect(matches(cond("branches", "gte", 12), row)).toBe(true);
    expect(matches(cond("branches", "gt", 12), row)).toBe(false);
    expect(matches(cond("heightCm", "lt", 300), row)).toBe(true);
  });
  it("between is inclusive", () => {
    expect(matches(cond("branches", "between", [10, 12]), row)).toBe(true);
    expect(matches(cond("branches", "between", [0, 11]), row)).toBe(false);
  });
  it("in", () => {
    expect(matches(cond("species", "in", ["oak", "fern"]), row)).toBe(true);
    expect(matches(cond("species", "in", ["fern"]), row)).toBe(false);
  });
  it("contains on text", () => {
    expect(matches(cond("notes", "contains", "health"), row)).toBe(true);
  });
  it("date before / after", () => {
    expect(matches(cond("plantedOn", "before", "2019-01-01"), row)).toBe(true);
    expect(matches(cond("plantedOn", "after", "2019-01-01"), row)).toBe(false);
  });
  it("isEmpty / isNotEmpty", () => {
    expect(matches(cond("flowering", "isEmpty", null), row)).toBe(true);
    expect(matches(cond("species", "isNotEmpty", null), row)).toBe(true);
  });
  it("AND / OR groups", () => {
    expect(matches(group("AND", cond("species", "eq", "oak"), cond("branches", "gte", 12)), row)).toBe(true);
    expect(matches(group("AND", cond("species", "eq", "oak"), cond("branches", "gt", 12)), row)).toBe(false);
    expect(matches(group("OR", cond("species", "eq", "fern"), cond("branches", "gte", 12)), row)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-server/evaluate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `mock-server/evaluate.ts`** (`matches` only; `computeBlocks` added in Task 9)

```ts
type Row = Record<string, string | number | boolean | null>;

export interface JsonCondition {
  kind: "condition";
  fieldId: string | null;
  operatorId: string | null;
  value: unknown;
}
export interface JsonGroup {
  kind: "group";
  operator: "AND" | "OR";
  children: JsonNode[];
}
export type JsonNode = JsonCondition | JsonGroup;

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function conditionMatches(c: JsonCondition, row: Row): boolean {
  if (!c.fieldId || !c.operatorId) return false;
  const v = row[c.fieldId];
  switch (c.operatorId) {
    case "eq": return v === c.value;
    case "neq": return v !== c.value;
    case "gt": return v != null && cmp(v, c.value) > 0;
    case "gte": return v != null && cmp(v, c.value) >= 0;
    case "lt": return v != null && cmp(v, c.value) < 0;
    case "lte": return v != null && cmp(v, c.value) <= 0;
    case "before": return v != null && String(v) < String(c.value);
    case "after": return v != null && String(v) > String(c.value);
    case "contains": return v != null && String(v).includes(String(c.value));
    case "between": {
      if (!Array.isArray(c.value) || c.value.length !== 2 || v == null) return false;
      return cmp(v, c.value[0]) >= 0 && cmp(v, c.value[1]) <= 0;
    }
    case "in": return Array.isArray(c.value) && c.value.includes(v as never);
    case "isEmpty": return v === null || v === undefined || v === "";
    case "isNotEmpty": return !(v === null || v === undefined || v === "");
    default: return false;
  }
}

export function matches(node: JsonNode, row: Row): boolean {
  if (node.kind === "condition") return conditionMatches(node, row);
  if (node.children.length === 0) return true;
  return node.operator === "AND"
    ? node.children.every((c) => matches(c, row))
    : node.children.some((c) => matches(c, row));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-server/evaluate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: mock server query-tree evaluator"
```

---

## Task 9: Mock server — `POST /api/stats`

**Files:**
- Modify: `mock-server/evaluate.ts` (add `computeBlocks`), `mock-server/index.ts` (add the route)
- Test: `tests/mock-server/stats.test.ts`

**Interfaces:**
- Consumes: `mock-server/evaluate.ts` (`matches`, `JsonNode`); `mock-server/catalog.ts` (`FIELDS`); `mock-server/data.ts` (`RECORDS`).
- Produces:
  - `computeBlocks(query: JsonNode, rows: Row[]): StatBlock[]` — one block per field **referenced anywhere in the query tree**, typed by the field's `valueType`: `number` → `number-summary`, `date` → `date-range`, `enum`/`boolean`/`string` → `distribution` (buckets = value → count among matching rows; for `string` cap at the top 10 buckets by count).
  - `POST /api/stats` body `{ query }` → `200 { matchCount, totalCount, blocks }`; malformed body → `400 { error }`.

- [ ] **Step 1: Write the failing test** — `tests/mock-server/stats.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { computeBlocks } from "../../mock-server/evaluate";

const rows = [
  { species: "oak", branches: 10, heightCm: 100, foliage: true, flowering: "april", plantedOn: "2015-01-01", notes: "a" },
  { species: "oak", branches: 20, heightCm: 200, foliage: false, flowering: null, plantedOn: "2019-06-01", notes: "b" },
  { species: "fern", branches: null, heightCm: 300, foliage: true, flowering: "may", plantedOn: "2012-03-01", notes: "c" },
];

const cond = (fieldId: string, operatorId: string, value: unknown) => ({ kind: "condition" as const, fieldId, operatorId, value });
const group = (operator: "AND" | "OR", ...children: any[]) => ({ kind: "group" as const, operator, children });

describe("computeBlocks", () => {
  it("number field -> number-summary with nullCount", () => {
    const blocks = computeBlocks(cond("branches", "gte", 0), rows);
    expect(blocks).toContainEqual(
      expect.objectContaining({ kind: "number-summary", fieldLabel: "Branch count", min: 10, max: 20, nullCount: 1 }),
    );
  });

  it("enum field -> distribution buckets over matching rows", () => {
    const blocks = computeBlocks(cond("species", "in", ["oak", "fern"]), rows);
    const dist = blocks.find((b) => b.kind === "distribution" && b.fieldLabel === "Species") as any;
    expect(dist.buckets).toEqual(expect.arrayContaining([{ label: "oak", count: 2 }, { label: "fern", count: 1 }]));
  });

  it("date field -> date-range", () => {
    const blocks = computeBlocks(cond("plantedOn", "after", "2000-01-01"), rows);
    expect(blocks).toContainEqual(
      expect.objectContaining({ kind: "date-range", fieldLabel: "Planted on", earliest: "2012-03-01", latest: "2019-06-01" }),
    );
  });

  it("one block per referenced field, nested groups included", () => {
    const q = group("AND", cond("species", "eq", "oak"), group("OR", cond("branches", "gte", 5), cond("heightCm", "lt", 999)));
    const labels = computeBlocks(q, rows).map((b) => b.fieldLabel).sort();
    expect(labels).toEqual(["Branch count", "Height (cm)", "Species"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-server/stats.test.ts`
Expected: FAIL — `computeBlocks` not exported.

- [ ] **Step 3: Add `computeBlocks` to `mock-server/evaluate.ts`**

```ts
import { FIELDS } from "./catalog";
import type { StatBlock } from "../src/api/types";

function referencedFieldIds(node: JsonNode, acc = new Set<string>()): Set<string> {
  if (node.kind === "condition") {
    if (node.fieldId) acc.add(node.fieldId);
  } else {
    for (const c of node.children) referencedFieldIds(c, acc);
  }
  return acc;
}

export function computeBlocks(query: JsonNode, rows: Row[]): StatBlock[] {
  const matching = rows.filter((r) => matches(query, r));
  const blocks: StatBlock[] = [];

  for (const fieldId of referencedFieldIds(query)) {
    const field = FIELDS.find((f) => f.id === fieldId);
    if (!field) continue;
    const values = matching.map((r) => r[fieldId]);
    const present = values.filter((v) => v !== null && v !== undefined && v !== "");
    const nullCount = values.length - present.length;

    if (field.valueType === "number") {
      const nums = present.map(Number);
      blocks.push({
        kind: "number-summary",
        fieldLabel: field.label,
        min: nums.length ? Math.min(...nums) : 0,
        max: nums.length ? Math.max(...nums) : 0,
        avg: nums.length ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : 0,
        nullCount,
      });
    } else if (field.valueType === "date") {
      const dates = present.map(String).sort();
      blocks.push({
        kind: "date-range",
        fieldLabel: field.label,
        earliest: dates[0] ?? "",
        latest: dates[dates.length - 1] ?? "",
        nullCount,
      });
    } else {
      const counts = new Map<string, number>();
      for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      let buckets = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
      if (field.valueType === "string") buckets = buckets.slice(0, 10);
      blocks.push({ kind: "distribution", fieldLabel: field.label, buckets, nullCount });
    }
  }
  return blocks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-server/stats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route in `mock-server/index.ts`**

Add imports at the top:

```ts
import { RECORDS } from "./data";
import { matches, computeBlocks, type JsonNode } from "./evaluate";
```

Add this branch inside the request handler, before the `404`:

```ts
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
```

- [ ] **Step 6: Manual check**

```bash
npx tsx mock-server/index.ts &
sleep 1
curl -s -XPOST localhost:3001/api/stats -H 'content-type: application/json' \
  -d '{"query":{"kind":"group","operator":"AND","children":[{"kind":"condition","fieldId":"species","operatorId":"eq","value":"oak"}]}}' | head -c 400
curl -s -XPOST localhost:3001/api/stats -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}\n'
kill %1
```
Expected: first curl → JSON with `matchCount`, `totalCount`, `blocks`; second → `400`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: mock server POST /api/stats with rich stat blocks"
```

---

## Task 10: Mock server — `POST /api/query`

**Files:**
- Modify: `mock-server/index.ts`
- Test: `tests/mock-server/query.test.ts` (pure paging helper)

**Interfaces:**
- Consumes: `mock-server/evaluate.ts` (`matches`); `mock-server/data.ts` (`RECORDS`).
- Produces:
  - a pure `paginate<T>(items: T[], page: number, pageSize: number): { slice: T[]; page: number; pageSize: number; totalRows: number }` exported from `mock-server/index.ts` (clamps `page` to `>= 1`, `pageSize` to `1..100`).
  - `POST /api/query` body `{ query, page, pageSize }` → `200 { columns, rows, page, pageSize, totalRows }`. Fixed columns: `id, species, branches, heightCm, foliage, flowering, plantedOn` (labels from `FIELDS`, with `id` → `"ID"`). Malformed body → `400 { error }`.

- [ ] **Step 1: Write the failing test** — `tests/mock-server/query.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { paginate } from "../../mock-server/index";

describe("paginate", () => {
  const items = Array.from({ length: 57 }, (_, i) => i);
  it("returns the requested page", () => {
    const r = paginate(items, 2, 25);
    expect(r.slice).toEqual(items.slice(25, 50));
    expect(r).toMatchObject({ page: 2, pageSize: 25, totalRows: 57 });
  });
  it("clamps page below 1 and huge pageSize", () => {
    expect(paginate(items, 0, 1000).page).toBe(1);
    expect(paginate(items, 0, 1000).pageSize).toBe(100);
  });
});
```

> Importing `mock-server/index.ts` starts the HTTP server as a side effect. Guard the `server.listen(...)` call so it only runs when the file is the entrypoint:
> ```ts
> import { argv } from "node:process";
> const isEntry = argv[1] && argv[1].endsWith("index.ts");
> if (isEntry) server.listen(PORT, () => console.log(`Mock API on http://localhost:${PORT}`));
> ```
> Apply that change as part of Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-server/query.test.ts`
Expected: FAIL — `paginate` not exported.

- [ ] **Step 3: Edit `mock-server/index.ts`**

Add the helper (module scope):

```ts
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const size = Math.min(Math.max(1, Math.floor(pageSize) || 1), 100);
  const p = Math.max(1, Math.floor(page) || 1);
  const start = (p - 1) * size;
  return { slice: items.slice(start, start + size), page: p, pageSize: size, totalRows: items.length };
}

const PREVIEW_COLUMNS = ["id", "species", "branches", "heightCm", "foliage", "flowering", "plantedOn"];
```

Add the route branch before the `404`:

```ts
if (req.method === "POST" && url.pathname === "/api/query") {
  const body = (await readJson(req)) as { query?: JsonNode; page?: number; pageSize?: number };
  if (!body.query || typeof body.query !== "object") {
    sendJson(res, 400, { error: "Body must include a `query` tree." });
    return;
  }
  const all = RECORDS.filter((r) => matches(body.query as JsonNode, r));
  const { slice, page, pageSize, totalRows } = paginate(all, body.page ?? 1, body.pageSize ?? 25);
  const columns = PREVIEW_COLUMNS.map((key) => ({
    key,
    label: key === "id" ? "ID" : (FIELDS.find((f) => f.id === key)?.label ?? key),
  }));
  const rows = slice.map((r) => Object.fromEntries(PREVIEW_COLUMNS.map((k) => [k, r[k] ?? null])));
  sendJson(res, 200, { columns, rows, page, pageSize, totalRows });
  return;
}
```

Apply the `isEntry` guard from Step 1's note to the `server.listen` call.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run tests/mock-server/query.test.ts && npm run test`
Expected: PASS (all suites).

- [ ] **Step 5: Manual check**

```bash
npx tsx mock-server/index.ts &
sleep 1
curl -s -XPOST localhost:3001/api/query -H 'content-type: application/json' \
  -d '{"query":{"kind":"group","operator":"AND","children":[]},"page":1,"pageSize":5}' | head -c 500
kill %1
```
Expected: JSON with `columns` (7), `rows` (5), `page:1`, `pageSize:5`, `totalRows:200`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mock server POST /api/query with paging"
```

---

## Task 11: UI foundation — `fomantic.ts`, `panel.ts`, `layout.ts`, real `main.ts`

**Files:**
- Create: `src/ui/fomantic.ts`, `src/ui/panel.ts`, `src/ui/layout.ts`
- Rewrite: `src/main.ts`
- Test: none (view layer — manual verification per spec §12)

**Interfaces:**
- Consumes: `src/state.ts` (`store`, `AppState`, `ActiveView`).
- Produces:
  - `src/ui/fomantic.ts` → `activate(container: HTMLElement): void`, `destroy(container: HTMLElement): void`, `onDropdownChange(container: HTMLElement, handler: (el: HTMLElement, value: string) => void): void`. **Only file importing `jquery`.**
  - `src/ui/panel.ts` → `paint(container: HTMLElement, html: string): void`, `escapeHtml(s: unknown): string`.
  - `src/ui/layout.ts` → `renderShell(root: HTMLElement): void` (builds the fixed DOM: top menu, secondary menu, `.qb-body` with three panel containers + `.qb-preview`); `panelEls(): { docs, center, stats, preview }` returning the container elements; `setActiveView(v: ActiveView): void`; `setSidebarCollapsed(collapsed: boolean): void`; `onMenu(handler: { view(v: ActiveView): void; toggleSidebar(): void; run(): void }): void`.

- [ ] **Step 1: Write `src/ui/fomantic.ts`**

```ts
// The ONLY file allowed to import jQuery. See docs/ARCHITECTURE.md §3.
import $ from "jquery";

export function activate(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown({ fullTextSearch: true });
  $(container).find(".ui.checkbox").checkbox();
  $(container).find(".ui.accordion").accordion();
}

export function destroy(container: HTMLElement): void {
  $(container).find(".ui.dropdown").dropdown("destroy");
  $(container).find(".ui.checkbox").checkbox("destroy");
  $(container).find(".ui.accordion").accordion("destroy");
}

/**
 * Bind Fomantic dropdowns' onChange within `container`. Fomantic dropdowns do not
 * emit a native "change" event, so panels cannot rely on delegated listeners for them.
 * Call this AFTER activate(). `el` is the .ui.dropdown element; read data-node-id / data-part off it.
 */
export function onDropdownChange(container: HTMLElement, handler: (el: HTMLElement, value: string) => void): void {
  $(container).find(".ui.dropdown").each((_i, node) => {
    $(node).dropdown("setting", "onChange", (value: string) => handler(node as HTMLElement, value));
  });
}
```

- [ ] **Step 2: Write `src/ui/panel.ts`**

```ts
import { activate, destroy } from "./fomantic";

/** Replace a panel's contents: tear down old Fomantic plugins, swap markup, init new ones. */
export function paint(container: HTMLElement, html: string): void {
  destroy(container);
  container.innerHTML = html;
  activate(container);
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}
```

- [ ] **Step 3: Write `src/ui/layout.ts`**

```ts
import type { ActiveView } from "../state";

const VIEWS: { id: ActiveView; label: string }[] = [
  { id: "filter", label: "Filter" },
  { id: "review", label: "Review" },
  { id: "approval", label: "Approval" },
  { id: "done", label: "Done" },
];

let els: { docs: HTMLElement; center: HTMLElement; stats: HTMLElement; preview: HTMLElement };
let bodyEl: HTMLElement;

export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="ui borderless menu" style="margin:0;border-radius:0">
      <span class="header item">Query Builder</span>
      <div class="right menu">
        <a class="item" data-menu="toggle-sidebar"><i class="bars icon"></i> Docs</a>
        <div class="item"><button class="ui primary button" data-menu="run" disabled>Run / Refresh</button></div>
      </div>
    </div>
    <div class="ui pointing secondary menu" data-menu="views" style="margin:0 1rem">
      ${VIEWS.map((v) => `<a class="item${v.id === "filter" ? " active" : ""}" data-view="${v.id}">${v.label}</a>`).join("")}
    </div>
    <div class="qb-body">
      <aside class="qb-col-docs" data-panel="docs"></aside>
      <main class="qb-col-center" data-panel="center"></main>
      <aside class="qb-col-stats" data-panel="stats"></aside>
    </div>
    <section class="qb-preview" data-panel="preview"></section>
  `;
  bodyEl = root.querySelector<HTMLElement>(".qb-body")!;
  els = {
    docs: root.querySelector<HTMLElement>('[data-panel="docs"]')!,
    center: root.querySelector<HTMLElement>('[data-panel="center"]')!,
    stats: root.querySelector<HTMLElement>('[data-panel="stats"]')!,
    preview: root.querySelector<HTMLElement>('[data-panel="preview"]')!,
  };
}

export function panelEls() {
  return els;
}

export function setActiveView(v: ActiveView): void {
  document.querySelectorAll('[data-menu="views"] .item').forEach((a) => {
    a.classList.toggle("active", (a as HTMLElement).dataset.view === v);
  });
  const filtering = v === "filter";
  bodyEl.style.display = filtering ? "" : "none";
  panelEls().preview.style.display = filtering ? "" : "none";
  let placeholder = document.getElementById("qb-coming-soon");
  if (!filtering) {
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.id = "qb-coming-soon";
      placeholder.className = "ui placeholder segment";
      placeholder.style.margin = "2rem";
      placeholder.innerHTML = `<div class="ui icon header"><i class="clock outline icon"></i> Coming soon</div>`;
      bodyEl.parentElement!.insertBefore(placeholder, bodyEl.nextSibling);
    }
    placeholder.style.display = "";
  } else if (placeholder) {
    placeholder.style.display = "none";
  }
}

export function setSidebarCollapsed(collapsed: boolean): void {
  bodyEl.classList.toggle("qb-docs-collapsed", collapsed);
}

export function onMenu(handler: { view(v: ActiveView): void; toggleSidebar(): void; run(): void }): void {
  document.querySelector('[data-menu="views"]')!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (item) handler.view(item.dataset.view as ActiveView);
  });
  document.querySelector('[data-menu="toggle-sidebar"]')!.addEventListener("click", () => handler.toggleSidebar());
  document.querySelector('[data-menu="run"]')!.addEventListener("click", () => handler.run());
}
```

- [ ] **Step 4: Rewrite `src/main.ts`**

```ts
// Fomantic's JS expects a global jQuery. Set it BEFORE importing Fomantic's JS.
// (docs/ARCHITECTURE.md §3 — the bootstrap wrinkle.)
import $ from "jquery";
(window as unknown as { jQuery: typeof $; $: typeof $ }).jQuery = $;
(window as unknown as { jQuery: typeof $; $: typeof $ }).$ = $;

import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "fomantic-ui-css/semantic.min.css";
import "fomantic-ui-css/semantic.min.js";
import "./styles.css";

import { store } from "./state";
import { onMenu, panelEls, renderShell, setActiveView, setSidebarCollapsed } from "./ui/layout";

const root = document.querySelector<HTMLElement>("#app")!;
renderShell(root);

onMenu({
  view: (v) => store.setState({ activeView: v }),
  toggleSidebar: () => store.setState({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
  run: () => {
    /* wired in Task 15 */
  },
});

store.subscribe((state, changed) => {
  if (changed.has("activeView")) setActiveView(state.activeView);
  if (changed.has("sidebarCollapsed")) setSidebarCollapsed(state.sidebarCollapsed);
  // panel renders are wired in Tasks 12–15.
});

// Temporary placeholder content so the columns are visibly present until Tasks 12–15.
panelEls().docs.innerHTML = `<div class="ui segment">Docs sidebar (Task 12)</div>`;
panelEls().center.innerHTML = `<div class="ui segment">Query builder (Tasks 13–14)</div>`;
panelEls().stats.innerHTML = `<div class="ui segment">Statistics (Task 14)</div>`;
panelEls().preview.innerHTML = `<div class="ui segment">Data preview (Task 15)</div>`;
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open `http://localhost:5173`. Confirm:
- Top menu shows "Query Builder", a "Docs" toggle, and a disabled "Run / Refresh" button.
- A pointing secondary menu shows **Filter · Review · Approval · Done**, with Filter active.
- Three columns (docs / center / stats) with placeholder segments, and a preview segment below.
- Clicking **Review / Approval / Done** hides the columns and shows a "Coming soon" placeholder; clicking **Filter** brings the columns back.
- Clicking **Docs** toggles the left column's visibility.
- DevTools Network tab: no off-origin requests (the `/api/schema` call is added next task; ignore its absence).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add -A
git commit -m "feat: UI foundation - jQuery airlock, paint helper, layout shell"
```

---

## Task 12: Docs sidebar panel

**Files:**
- Create: `src/ui/docsSidebar.ts`
- Modify: `src/main.ts` (load schema on startup; render docs on `schema` change)
- Test: none (view layer)

**Interfaces:**
- Consumes: `src/state.ts` (`store`, `AppState`); `src/api/client.ts` (`getSchema`); `src/api/types.ts` (`SchemaResponse`); `src/ui/panel.ts` (`paint`, `escapeHtml`); `src/ui/layout.ts` (`panelEls`).
- Produces: `src/ui/docsSidebar.ts` → `renderDocsSidebar(state: AppState): void`. Renders: a filter `<input>` (id `qb-docs-filter`) + a Fomantic `ui styled accordion` with one section per field (label, a `ui label` type badge, description, and a nested list of that field's operators with each operator's description). Filtering is a plain `input` listener that hides non-matching `.title`/`.content` pairs by field label substring (case-insensitive). If `state.schema` is null, render a `ui loader`.

- [ ] **Step 1: Write `src/ui/docsSidebar.ts`**

```ts
import type { AppState } from "../state";
import type { SchemaResponse } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

function sectionHtml(schema: SchemaResponse, field: SchemaResponse["fields"][number]): string {
  const ops = field.operatorIds
    .map((id) => schema.operators.find((o) => o.id === id))
    .filter((o): o is SchemaResponse["operators"][number] => Boolean(o));
  return `
    <div class="title" data-field-label="${escapeHtml(field.label.toLowerCase())}">
      <i class="dropdown icon"></i> ${escapeHtml(field.label)}
      <span class="ui mini label">${escapeHtml(field.valueType)}</span>
    </div>
    <div class="content" data-field-label="${escapeHtml(field.label.toLowerCase())}">
      <p>${escapeHtml(field.description)}</p>
      <div class="ui relaxed list">
        ${ops
          .map(
            (o) => `<div class="item"><div class="content">
              <div class="header">${escapeHtml(o.label)}</div>
              <div class="description">${escapeHtml(o.description)}</div>
            </div></div>`,
          )
          .join("")}
      </div>
    </div>`;
}

export function renderDocsSidebar(state: AppState): void {
  const el = panelEls().docs;
  if (!state.schema) {
    paint(el, `<div class="ui segment"><div class="ui active inline loader"></div> Loading fields…</div>`);
    return;
  }
  const { schema } = state;
  paint(
    el,
    `<h4 class="ui header">Fields &amp; operators</h4>
     <div class="ui fluid icon input" style="margin-bottom:.5rem">
       <input type="text" id="qb-docs-filter" placeholder="Filter fields…" />
       <i class="search icon"></i>
     </div>
     <div class="ui styled fluid accordion">
       ${schema.fields.map((f) => sectionHtml(schema, f)).join("")}
     </div>`,
  );

  const filter = el.querySelector<HTMLInputElement>("#qb-docs-filter");
  filter?.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    el.querySelectorAll<HTMLElement>("[data-field-label]").forEach((node) => {
      node.style.display = node.dataset.fieldLabel!.includes(q) ? "" : "none";
    });
  });
}
```

- [ ] **Step 2: Wire into `src/main.ts`**

Replace the temporary `panelEls().docs.innerHTML = ...` line with nothing, add near the other imports:

```ts
import { getSchema } from "./api/client";
import { renderDocsSidebar } from "./ui/docsSidebar";
```

In the `store.subscribe` callback add:

```ts
if (changed.has("schema")) renderDocsSidebar(state);
```

After the subscribe block, add the startup load:

```ts
renderDocsSidebar(store.getState()); // initial loader
getSchema()
  .then((schema) => store.setState({ schema }))
  .catch((err) => {
    root.innerHTML = `<div class="ui negative message" style="margin:2rem">
      <div class="header">Could not load field list</div>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <button class="ui button" onclick="location.reload()">Reload</button>
    </div>`;
  });
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Confirm:
- Left sidebar briefly shows a loader, then a styled accordion with 7 field sections.
- Clicking a section expands it to show the description and a list of operators with descriptions.
- Typing "he" in the filter narrows the list to "Height (cm)"; clearing it restores all.
- Stop the mock server (kill the `mock` process) and reload → the whole page is replaced by a red "Could not load field list" message with a Reload button.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: schema-driven docs sidebar with live filter"
```

---

## Task 13: Query builder panel — recursive render (read-only)

**Files:**
- Create: `src/ui/valueControl.ts`, `src/ui/queryBuilder.ts`
- Modify: `src/main.ts` (seed the query with one empty condition; render builder on `query`/`issues`/`schema` change)
- Test: none (view layer)

**Interfaces:**
- Consumes: `src/state.ts`; `src/query/types.ts`; `src/api/types.ts` (`SchemaResponse`); `src/ui/panel.ts`; `src/ui/layout.ts`.
- Produces:
  - `src/ui/valueControl.ts` → `renderValueControl(field, operator, value): string` (markup only; every control carries `data-part="value"` and, for range, `data-range="from"|"to"`); `readValueControl(row: HTMLElement, arity, valueType): unknown` (reads the current value(s) out of a rendered condition row).
  - `src/ui/queryBuilder.ts` → `renderQueryBuilder(state: AppState): void` — recursive render of `state.query` into the center panel. This task renders only; editing is Task 14. Each condition row and group carries `data-node-id`; buttons carry `data-action`. Invalid nodes (present in `state.issues`) get a `ui pointing red basic label` under the row.

- [ ] **Step 1: Write `src/ui/valueControl.ts`**

```ts
import type { SchemaResponse } from "../api/types";
import { escapeHtml } from "./panel";

type Field = SchemaResponse["fields"][number];
type Operator = SchemaResponse["operators"][number];

function enumDropdown(field: Field, current: unknown, multiple: boolean): string {
  const values = multiple ? (Array.isArray(current) ? current.map(String) : []) : [String(current ?? "")];
  const opts = (field.options ?? [])
    .map((o) => `<option value="${escapeHtml(o.value)}"${values.includes(o.value) ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
  return `<select class="ui ${multiple ? "multiple " : ""}selection dropdown" data-part="value"${multiple ? " multiple" : ""}>
    ${multiple ? "" : `<option value="">Choose…</option>`}${opts}
  </select>`;
}

function scalarInput(field: Field, current: unknown, part: string): string {
  const v = escapeHtml(current ?? "");
  if (field.valueType === "number") return `<input type="number" data-part="${part}" value="${v}" />`;
  if (field.valueType === "date") return `<input type="date" data-part="${part}" value="${v}" />`;
  return `<input type="text" data-part="${part}" value="${v}" />`;
}

export function renderValueControl(field: Field | undefined, operator: Operator | undefined, value: unknown): string {
  if (!field || !operator || operator.arity === "none") return "";
  if (operator.arity === "many") {
    if (field.valueType === "enum") return enumDropdown(field, value, true);
    return `<div class="ui multiple search selection dropdown" data-part="value" data-allow-additions="1">
      <input type="hidden" value="${escapeHtml(Array.isArray(value) ? value.join(",") : "")}" />
      <div class="default text">Add values…</div>
    </div>`;
  }
  if (operator.arity === "two") {
    if (field.valueType === "enum") {
      const from = Array.isArray(value) ? value[0] : undefined;
      const to = Array.isArray(value) ? value[1] : undefined;
      return `${enumDropdown(field, from, false).replace('data-part="value"', 'data-part="value" data-range="from"')}
              <span style="margin:0 .4rem">to</span>
              ${enumDropdown(field, to, false).replace('data-part="value"', 'data-part="value" data-range="to"')}`;
    }
    const from = Array.isArray(value) ? value[0] : "";
    const to = Array.isArray(value) ? value[1] : "";
    return `<div class="ui input" style="margin-right:.3rem">${scalarInput(field, from, "value")
      .replace('data-part="value"', 'data-part="value" data-range="from"')}</div>
      <span style="margin:0 .4rem">to</span>
      <div class="ui input">${scalarInput(field, to, "value").replace('data-part="value"', 'data-part="value" data-range="to"')}</div>`;
  }
  // arity "one"
  if (field.valueType === "boolean") {
    return `<div class="ui toggle checkbox" data-part="value">
      <input type="checkbox"${value === true ? " checked" : ""} /><label>true</label>
    </div>`;
  }
  if (field.valueType === "enum") return enumDropdown(field, value, false);
  return `<div class="ui input">${scalarInput(field, value, "value")}</div>`;
}

export function readValueControl(row: HTMLElement, arity: Operator["arity"], valueType: Field["valueType"]): unknown {
  if (arity === "none") return null;
  if (arity === "two") {
    const from = row.querySelector<HTMLElement>('[data-range="from"]');
    const to = row.querySelector<HTMLElement>('[data-range="to"]');
    return [readOne(from, valueType), readOne(to, valueType)];
  }
  if (arity === "many") {
    const sel = row.querySelector<HTMLSelectElement>('select[multiple][data-part="value"]');
    if (sel) return Array.from(sel.selectedOptions).map((o) => o.value);
    const hidden = row.querySelector<HTMLInputElement>('[data-part="value"] input[type="hidden"]');
    return (hidden?.value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return readOne(row.querySelector<HTMLElement>('[data-part="value"]'), valueType);
}

function readOne(el: HTMLElement | null, valueType: Field["valueType"]): unknown {
  if (!el) return null;
  if (el.matches(".ui.checkbox")) return el.querySelector("input")!.checked;
  if (el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLInputElement) return valueType === "number" && el.value !== "" ? Number(el.value) : el.value;
  const inner = el.querySelector("input, select");
  return inner ? readOne(inner as HTMLElement, valueType) : null;
}
```

- [ ] **Step 2: Write `src/ui/queryBuilder.ts`** (render only)

```ts
import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { SchemaResponse } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { renderValueControl } from "./valueControl";

function issuesFor(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  if (!mine.length) return "";
  return `<div class="ui pointing red basic label">${mine.map((i) => escapeHtml(i.message)).join(" · ")}</div>`;
}

function fieldDropdown(schema: SchemaResponse, c: Condition): string {
  const opts = schema.fields
    .map((f) => `<option value="${f.id}"${f.id === c.fieldId ? " selected" : ""}>${escapeHtml(f.label)}</option>`)
    .join("");
  return `<select class="ui selection dropdown" data-part="field"><option value="">Field…</option>${opts}</select>`;
}

function operatorDropdown(schema: SchemaResponse, c: Condition): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const ops = field
    ? field.operatorIds.map((id) => schema.operators.find((o) => o.id === id)).filter(Boolean as unknown as (o: unknown) => o is SchemaResponse["operators"][number])
    : [];
  const opts = ops
    .map((o) => `<option value="${o.id}"${o.id === c.operatorId ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}>
    <option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(schema: SchemaResponse, c: Condition, issues: Issue[]): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const operator = schema.operators.find((o) => o.id === c.operatorId);
  return `<div class="qb-condition" data-node-id="${c.id}" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.35rem 0">
    ${fieldDropdown(schema, c)}
    ${operatorDropdown(schema, c)}
    <span class="qb-value">${renderValueControl(field, operator, c.value)}</span>
    <button class="ui mini icon button" data-action="remove-node" title="Remove"><i class="trash icon"></i></button>
    ${issuesFor(c.id, issues)}
  </div>`;
}

function groupHtml(schema: SchemaResponse, g: Group, issues: Issue[], isRoot: boolean): string {
  const body = g.collapsed
    ? ""
    : `<div class="qb-children" style="padding-left:${isRoot ? 0 : 1}rem">
        ${g.children.map((child) => nodeHtml(schema, child, issues, false)).join("")}
      </div>`;
  return `<div class="ui segment qb-group" data-node-id="${g.id}">
    <div class="qb-group-head" style="display:flex;gap:.5rem;align-items:center">
      <button class="ui mini icon button" data-action="toggle-collapse" title="Collapse">
        <i class="${g.collapsed ? "caret right" : "caret down"} icon"></i>
      </button>
      <div class="ui mini buttons" data-part="logical">
        <button class="ui button ${g.operator === "AND" ? "primary" : ""}" data-action="set-and">AND</button>
        <button class="ui button ${g.operator === "OR" ? "primary" : ""}" data-action="set-or">OR</button>
      </div>
      <button class="ui mini button" data-action="add-condition"><i class="plus icon"></i> Condition</button>
      <button class="ui mini button" data-action="add-group"><i class="plus icon"></i> Group</button>
      ${isRoot ? "" : `<button class="ui mini icon button" data-action="remove-node" title="Remove group"><i class="trash icon"></i></button>`}
    </div>
    ${issuesFor(g.id, issues)}
    ${body}
  </div>`;
}

function nodeHtml(schema: SchemaResponse, node: QueryNode, issues: Issue[], _isRoot: boolean): string {
  return node.kind === "group" ? groupHtml(schema, node, issues, _isRoot) : conditionHtml(schema, node, issues);
}

export function renderQueryBuilder(state: AppState): void {
  const el = panelEls().center;
  if (!state.schema) {
    paint(el, `<div class="ui segment"><div class="ui active inline loader"></div></div>`);
    return;
  }
  paint(el, `<h4 class="ui header">Build your query</h4>${nodeHtml(state.schema, state.query, state.issues, true)}`);
}
```

- [ ] **Step 3: Wire render into `src/main.ts`**

Add import:

```ts
import { renderQueryBuilder } from "./ui/queryBuilder";
```

In `store.subscribe`:

```ts
if (changed.has("schema") || changed.has("query") || changed.has("issues")) renderQueryBuilder(state);
```

After the initial `getSchema()` resolves, also seed one empty condition so the user sees a starting row. Change the `.then` to:

```ts
.then((schema) => {
  const seeded = addChild(store.getState().query as Group, (store.getState().query as Group).id, newCondition());
  store.setState({ schema, query: seeded });
})
```

Add imports for `addChild`, `newCondition` from `./query/tree` and the `Group` type from `./query/types`.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. Confirm:
- Center panel shows "Build your query", a root segment with AND/OR buttons (AND highlighted), "+ Condition", "+ Group", a collapse caret, and one condition row.
- The condition row shows a "Field…" dropdown, a disabled "Operator…" dropdown, a trash button.
- Dropdowns are Fomantic-styled and searchable. (They do nothing yet — editing is Task 14.)
- No console errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: recursive query-builder rendering (read-only)"
```

---

## Task 14: Query builder — editing (events, tree ops, resets)

**Files:**
- Modify: `src/ui/queryBuilder.ts` (add `wireQueryBuilder`), `src/main.ts` (wire it; compute issues; reset stats/preview on edit)
- Test: none (view layer) — but re-run `npm run test` to confirm nothing regressed

**Interfaces:**
- Consumes: `src/query/tree.ts` (all ops); `src/query/validate.ts` (`validateQuery`); `src/ui/valueControl.ts` (`readValueControl`); `src/ui/fomantic.ts` (`onDropdownChange`).
- Produces: `src/ui/queryBuilder.ts` → `wireQueryBuilder(container: HTMLElement, onChange: (nextQuery: Group) => void): void`. Installs **one** delegated `click` listener + one delegated `change` listener on `container`, plus `onDropdownChange` for the Fomantic dropdowns. Each interaction computes the next query tree with `tree.ts` helpers and calls `onChange`. `onChange` is responsible for validation + state reset (done in `main.ts`).

- [ ] **Step 1: Add `wireQueryBuilder` to `src/ui/queryBuilder.ts`**

```ts
import { addChild, findNode, newCondition, newGroup, removeNode, updateNode } from "../query/tree";
import type { Group } from "../query/types";
import { onDropdownChange } from "./fomantic";
import { readValueControl } from "./valueControl";

// Called by main.ts after each renderQueryBuilder(), because paint() replaces the DOM.
export function wireQueryBuilder(container: HTMLElement, onChange: (next: Group) => void): void {
  const getQuery = () => currentQuery;
  // main.ts sets this before calling wire; kept in module scope so handlers see the latest.
  const rootId = () => currentQuery.id;

  function nodeIdFrom(el: HTMLElement): string | null {
    return el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
  }

  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action!;
    const nodeId = nodeIdFrom(btn);
    if (!nodeId) return;
    const q = getQuery();
    switch (action) {
      case "add-condition": return onChange(addChild(q, nodeId, newCondition()));
      case "add-group": return onChange(addChild(q, nodeId, newGroup()));
      case "remove-node": return onChange(nodeId === rootId() ? q : removeNode(q, nodeId));
      case "set-and": return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or": return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "toggle-collapse": {
        const node = findNode(q, nodeId);
        return onChange(updateNode(q, nodeId, { collapsed: !(node && "collapsed" in node && node.collapsed) }));
      }
    }
  });

  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.qb-condition[data-node-id]');
    if (!row) return;
    handleRowChange(row);
  });

  // Fomantic dropdowns don't fire native change — route them through the same path.
  onDropdownChange(container, (el) => {
    const row = el.closest<HTMLElement>('.qb-condition[data-node-id]');
    if (row) handleRowChange(row);
  });

  function handleRowChange(row: HTMLElement): void {
    const nodeId = row.dataset.nodeId!;
    const q = getQuery();
    const cond = findNode(q, nodeId);
    if (!cond || cond.kind !== "condition") return;

    const fieldSel = row.querySelector<HTMLSelectElement>('[data-part="field"]');
    const opSel = row.querySelector<HTMLSelectElement>('[data-part="operator"]');
    const newFieldId = fieldSel ? fieldSel.value || null : cond.fieldId;
    const fieldChanged = newFieldId !== cond.fieldId;
    let newOperatorId = opSel ? opSel.value || null : cond.operatorId;
    if (fieldChanged) newOperatorId = null; // operators depend on field

    const field = schemaRef?.fields.find((f) => f.id === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.id === newOperatorId);
    let value: unknown = cond.value;
    if (fieldChanged || !operator) {
      value = null;
    } else {
      value = readValueControl(row, operator.arity, field?.valueType ?? "string");
    }
    onChange(updateNode(q, nodeId, { fieldId: newFieldId, operatorId: newOperatorId, value }));
  }
}

// module-scope refs set by renderQueryBuilder / main wiring
let currentQuery: Group;
let schemaRef: import("../api/types").SchemaResponse | null = null;
export function _setBuilderRefs(query: Group, schema: import("../api/types").SchemaResponse | null): void {
  currentQuery = query;
  schemaRef = schema;
}
```

Then, at the end of `renderQueryBuilder`, call `_setBuilderRefs(state.query as Group, state.schema)` so handlers always see the current tree/schema.

- [ ] **Step 2: Wire in `src/main.ts`**

Add imports:

```ts
import { renderQueryBuilder, wireQueryBuilder } from "./ui/queryBuilder";
import { validateQuery } from "./query/validate";
import type { Group } from "./query/types";
```

Define the change handler and re-wire after every builder render:

```ts
function onQueryChange(nextQuery: Group): void {
  const schema = store.getState().schema;
  const issues = schema
    ? validateQuery(nextQuery, { fields: schema.fields, operators: schema.operators })
    : [];
  // Spec §6: editing the query immediately clears stats & preview in the SAME setState.
  store.setState({
    query: nextQuery,
    issues,
    stats: { status: "idle", data: null, error: null },
    preview: { status: "idle", data: null, error: null, page: 1 },
  });
}
```

In `store.subscribe`, after `renderQueryBuilder(state)` runs, wire the fresh DOM:

```ts
if (changed.has("schema") || changed.has("query") || changed.has("issues")) {
  renderQueryBuilder(state);
  wireQueryBuilder(panelEls().center, onQueryChange);
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Confirm:
- Picking a field enables the operator dropdown and populates it with that field's operators.
- Picking an operator renders the right value control: text/number input, enum dropdown, boolean toggle, two inputs for "Between", multi-dropdown for "Is any of".
- Editing a value and blurring updates the query (add a temporary `console.log(store.getState().query)` in `onQueryChange` to confirm, then remove).
- "+ Condition" adds a row; "+ Group" adds a nested segment with its own AND/OR; trash removes; AND/OR buttons toggle highlight; collapse caret hides/shows a group's children.
- Changing the field of a condition that had an operator/value resets both.
- `npm run test` still green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: query-builder editing via delegated events and tree ops"
```

---

## Task 15: Statistics panel + live fetch orchestration

**Files:**
- Create: `src/ui/statsPanel.ts`
- Modify: `src/main.ts` (debounced `refreshStats`, stale-guard, subscribe on `stats`)
- Test: none (view layer)

**Interfaces:**
- Consumes: `src/state.ts`; `src/api/client.ts` (`getStats`); `src/api/types.ts` (`StatBlock`, `StatsResponse`); `src/query/validate.ts` (`hasBlockingErrors`); `src/query/tree.ts` (`countConditions`); `src/util/debounce.ts`.
- Produces: `src/ui/statsPanel.ts` → `renderStatsPanel(state: AppState): void` with one internal renderer per `StatBlock.kind`. States (spec §6): `schema` loading → nothing; `issues` blocking or zero conditions → neutral hint "Fix the errors in your query to see statistics." / "Add a condition to see statistics."; `stats.status==="loading"` → `ui loader`, nothing behind it; `"error"` → `ui negative message` with `stats.error`, no numbers; `"ok"` → match count + `ui progress` + the blocks.

- [ ] **Step 1: Write `src/ui/statsPanel.ts`**

```ts
import type { AppState } from "../state";
import type { StatBlock } from "../api/types";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

function hint(text: string): string {
  return `<div class="ui info message">${escapeHtml(text)}</div>`;
}

function numberSummary(b: Extract<StatBlock, { kind: "number-summary" }>): string {
  return `<div class="ui tiny statistics">
    <div class="statistic"><div class="value">${b.min}</div><div class="label">min</div></div>
    <div class="statistic"><div class="value">${b.max}</div><div class="label">max</div></div>
    <div class="statistic"><div class="value">${b.avg}</div><div class="label">avg</div></div>
  </div><div class="ui small text">${b.nullCount} empty</div>`;
}

function distribution(b: Extract<StatBlock, { kind: "distribution" }>): string {
  const max = Math.max(1, ...b.buckets.map((x) => x.count));
  return `<div class="ui relaxed list">
    ${b.buckets
      .map(
        (x) => `<div class="item">
          <div class="ui tiny progress" data-percent="${Math.round((x.count / max) * 100)}" style="margin:.15rem 0">
            <div class="bar" style="width:${Math.round((x.count / max) * 100)}%"></div>
            <div class="label" style="text-align:left">${escapeHtml(x.label)} — ${x.count}</div>
          </div>
        </div>`,
      )
      .join("")}
  </div><div class="ui small text">${b.nullCount} empty</div>`;
}

function dateRange(b: Extract<StatBlock, { kind: "date-range" }>): string {
  return `<div>${escapeHtml(b.earliest)} → ${escapeHtml(b.latest)}</div><div class="ui small text">${b.nullCount} empty</div>`;
}

function blockHtml(b: StatBlock): string {
  const inner = b.kind === "number-summary" ? numberSummary(b) : b.kind === "distribution" ? distribution(b) : dateRange(b);
  return `<div class="ui segment"><h5 class="ui header">${escapeHtml(b.fieldLabel)}</h5>${inner}</div>`;
}

export function renderStatsPanel(state: AppState): void {
  const el = panelEls().stats;
  if (!state.schema) {
    paint(el, "");
    return;
  }
  if (countConditions(state.query) === 0) {
    paint(el, `<h4 class="ui header">Statistics</h4>${hint("Add a condition to see statistics.")}`);
    return;
  }
  if (hasBlockingErrors(state.issues)) {
    paint(el, `<h4 class="ui header">Statistics</h4>${hint("Fix the errors in your query to see statistics.")}`);
    return;
  }
  const s = state.stats;
  if (s.status === "loading" || s.status === "idle") {
    paint(el, `<h4 class="ui header">Statistics</h4><div class="ui segment"><div class="ui active inline loader"></div> Updating…</div>`);
    return;
  }
  if (s.status === "error") {
    paint(el, `<h4 class="ui header">Statistics</h4><div class="ui negative message"><div class="header">Statistics failed</div><p>${escapeHtml(s.error)}</p></div>`);
    return;
  }
  const d = s.data!;
  const pct = d.totalCount ? Math.round((d.matchCount / d.totalCount) * 100) : 0;
  paint(
    el,
    `<h4 class="ui header">Statistics</h4>
     <div class="ui segment">
       <div class="ui tiny statistic"><div class="value">${d.matchCount.toLocaleString()}</div>
         <div class="label">of ${d.totalCount.toLocaleString()} match</div></div>
       <div class="ui progress"><div class="bar" style="width:${pct}%"></div><div class="label">${pct}%</div></div>
     </div>
     ${d.blocks.map(blockHtml).join("")}`,
  );
}
```

- [ ] **Step 2: Orchestrate in `src/main.ts`**

Add imports:

```ts
import { getStats } from "./api/client";
import { renderStatsPanel } from "./ui/statsPanel";
import { hasBlockingErrors } from "./query/validate";
import { countConditions } from "./query/tree";
import { debounce } from "./util/debounce";
```

Add the debounced fetch with a stale-query guard:

```ts
const refreshStats = debounce(() => {
  const { query, issues, schema } = store.getState();
  if (!schema || hasBlockingErrors(issues) || countConditions(query) === 0) return;
  const key = JSON.stringify(query);
  store.setState({ stats: { status: "loading", data: null, error: null } });
  getStats(query)
    .then((data) => {
      if (key !== JSON.stringify(store.getState().query)) return; // stale — a newer edit won
      store.setState({ stats: { status: "ok", data, error: null } });
    })
    .catch((err) => {
      if (key !== JSON.stringify(store.getState().query)) return;
      store.setState({ stats: { status: "error", data: null, error: err instanceof Error ? err.message : String(err) } });
    });
}, 400);
```

In `onQueryChange`, after `store.setState({...})`, call `refreshStats()`.

In `store.subscribe`, add:

```ts
if (changed.has("schema") || changed.has("query") || changed.has("issues") || changed.has("stats")) renderStatsPanel(state);
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Confirm:
- With the seed condition incomplete, the stats panel shows "Fix the errors…" or "Add a condition…" hint.
- Completing a condition (field + operator + value) → after ~0.4s the panel shows "N of 200 match", a progress bar, and one segment per referenced field (number summary / distribution bars / date range).
- Editing the query again immediately blanks the stats (loader), then updates — old numbers never linger under a changed query.
- Introduce an error (clear a value) → stats immediately show the hint, no stale numbers.
- Kill the mock server, edit to a valid query → stats show a red "Statistics failed" message, no numbers.
- Rapidly change the query several times → only the final result is shown (stale guard).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: live statistics panel with debounced fetch and stale-guard"
```

---

## Task 16: Data preview panel + Run/paging orchestration

**Files:**
- Create: `src/ui/dataPreview.ts`
- Modify: `src/main.ts` (`runPreview`, stale-guard, Run button enable/disable, subscribe on `preview`)
- Test: none (view layer)

**Interfaces:**
- Consumes: `src/state.ts`; `src/api/client.ts` (`runQuery`); `src/query/summary.ts` (`queryToText`); `src/query/validate.ts` (`hasBlockingErrors`); `src/query/tree.ts` (`countConditions`); `src/ui/panel.ts`; `src/ui/layout.ts`.
- Produces: `src/ui/dataPreview.ts` → `renderDataPreview(state: AppState): void` + `wireDataPreview(container: HTMLElement, handlers: { run(): void; prev(): void; next(): void }): void`. States (spec §6): `idle` → "Build a query and press Run." (or "Query changed — press Run to refresh." when `data` exists but is stale — see note); `loading` → `ui loader`; `error` → `ui negative message`; `ok` → summary line + `ui celled table` + Prev/Next with "Showing X–Y of Z". The **Run** button lives in the top menu (Task 11); `main.ts` enables it only when `schema && !hasBlockingErrors(issues) && countConditions(query) > 0 && preview.status !== "loading"`.

> Stale-preview text: `onQueryChange` already resets `preview` to `{ status: "idle", data: null, page: 1 }`. So "idle with data" never occurs; the idle message is always "Build a query and press Run." Keep it simple — one idle message.

- [ ] **Step 1: Write `src/ui/dataPreview.ts`**

```ts
import type { AppState } from "../state";
import { countConditions } from "../query/tree";
import { hasBlockingErrors } from "../query/validate";
import { queryToText } from "../query/summary";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";

export function renderDataPreview(state: AppState): void {
  const el = panelEls().preview;
  const p = state.preview;

  if (p.status === "idle") {
    paint(el, `<h4 class="ui header">Data preview</h4><div class="ui message">Build a query and press <b>Run / Refresh</b>.</div>`);
    return;
  }
  if (p.status === "loading") {
    paint(el, `<h4 class="ui header">Data preview</h4><div class="ui segment"><div class="ui active inline loader"></div> Loading rows…</div>`);
    return;
  }
  if (p.status === "error") {
    paint(el, `<h4 class="ui header">Data preview</h4><div class="ui negative message"><div class="header">Could not load rows</div><p>${escapeHtml(p.error)}</p></div>`);
    return;
  }

  const d = p.data!;
  const summary = state.schema ? queryToText(state.query, { fields: state.schema.fields, operators: state.schema.operators }) : "";
  const from = d.totalRows === 0 ? 0 : (d.page - 1) * d.pageSize + 1;
  const to = Math.min(d.page * d.pageSize, d.totalRows);
  const body = d.rows.length
    ? `<table class="ui celled compact table">
        <thead><tr>${d.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${d.rows
          .map((r) => `<tr>${d.columns.map((c) => `<td>${escapeHtml(r[c.key])}</td>`).join("")}</tr>`)
          .join("")}</tbody>
      </table>`
    : `<div class="ui message">No rows match this query.</div>`;

  paint(
    el,
    `<h4 class="ui header">Data preview</h4>
     <p class="ui small text"><b>Query:</b> ${escapeHtml(summary)}</p>
     <p>Showing ${from}–${to} of ${d.totalRows.toLocaleString()}</p>
     ${body}
     <div class="ui buttons">
       <button class="ui button" data-preview="prev" ${d.page <= 1 ? "disabled" : ""}>Prev</button>
       <button class="ui button" data-preview="next" ${to >= d.totalRows ? "disabled" : ""}>Next</button>
     </div>`,
  );
}

export function wireDataPreview(container: HTMLElement, handlers: { run(): void; prev(): void; next(): void }): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-preview]");
    if (!btn) return;
    if (btn.dataset.preview === "prev") handlers.prev();
    if (btn.dataset.preview === "next") handlers.next();
  });
}
```

- [ ] **Step 2: Orchestrate in `src/main.ts`**

Add imports:

```ts
import { runQuery } from "./api/client";
import { renderDataPreview, wireDataPreview } from "./ui/dataPreview";
```

Add `runPreview` with a stale-guard and a page argument:

```ts
const PAGE_SIZE = 25;

function runPreview(page: number): void {
  const { query, issues, schema } = store.getState();
  if (!schema || hasBlockingErrors(issues) || countConditions(query) === 0) return;
  const key = JSON.stringify(query);
  store.setState({ preview: { status: "loading", data: null, error: null, page } });
  runQuery(query, page, PAGE_SIZE)
    .then((data) => {
      if (key !== JSON.stringify(store.getState().query)) return; // query changed since Run
      store.setState({ preview: { status: "ok", data, error: null, page: data.page } });
    })
    .catch((err) => {
      if (key !== JSON.stringify(store.getState().query)) return;
      store.setState({ preview: { status: "error", data: null, error: err instanceof Error ? err.message : String(err), page } });
    });
}
```

Replace the `run: () => {}` stub in `onMenu({...})` with `run: () => runPreview(1)`.

Wire the Prev/Next buttons once (they live in the preview container, which is re-painted, so wire after each render — same pattern as the builder):

```ts
if (changed.has("preview") || changed.has("query") || changed.has("issues") || changed.has("schema")) {
  renderDataPreview(state);
  wireDataPreview(panelEls().preview, {
    run: () => runPreview(1),
    prev: () => runPreview(store.getState().preview.page - 1),
    next: () => runPreview(store.getState().preview.page + 1),
  });
}
```

Add a helper to enable/disable the top-menu Run button, called from `subscribe` on any relevant change:

```ts
function syncRunButton(state = store.getState()): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-menu="run"]');
  if (!btn) return;
  const ready =
    !!state.schema &&
    !hasBlockingErrors(state.issues) &&
    countConditions(state.query) > 0 &&
    state.preview.status !== "loading";
  btn.disabled = !ready;
}
```

Call `syncRunButton(state)` inside `subscribe` for `query`/`issues`/`schema`/`preview` changes.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Confirm:
- Preview panel starts with "Build a query and press Run / Refresh."
- Run button in the top menu is disabled until the query is valid with ≥1 condition.
- Press Run → a celled table of 25 rows with 7 columns; "Showing 1–25 of N".
- Next / Prev page through; buttons disable at the ends.
- Edit the query after running → the table clears back to the idle message; Run must be pressed again.
- Kill the mock server, press Run → red "Could not load rows" message.
- No off-origin network calls at any point (check DevTools Network).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: paged data-preview panel with Run and stale-guard"
```

---

## Task 17: Final wiring, offline verification, README

**Files:**
- Create: `README.md` (rewrite)
- Modify: `docs/ARCHITECTURE.md` (§13 change log), `package.json` (ensure `build` chains `check:offline` — see step)
- Test: full suite + build + offline scan

**Interfaces:**
- Consumes: everything.
- Produces: a documented, verified, offline-safe build.

- [ ] **Step 1: Chain the offline check into the build**

In `package.json`, change:

```json
"build": "tsc --noEmit && vite build && npm run check:offline",
```

- [ ] **Step 2: Rewrite `README.md`**

````markdown
# Query Builder (frontend)

A single-page query-builder UI. Build a filter with nested AND/OR groups; see live
match statistics; page through a sample of matching rows. All data comes from our
API (`/api/schema`, `/api/stats`, `/api/query`). A dev-only mock server implements
those three endpoints so the app runs end to end locally.

## Run it

```bash
npm ci
npm run dev        # mock API on :3001, app on http://localhost:5173
```

Other scripts:

| Script | What |
|---|---|
| `npm run build` | Type-check, bundle to `dist/`, then fail if any off-origin URL leaked in. |
| `npm run preview` | Serve the built `dist/`. |
| `npm run test` | Vitest unit tests (query model, validation, summary, API client, store, mock evaluator). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint + Prettier check. |
| `npm run check:offline` | Scan `dist/` for off-origin `http(s)` URLs. |

## Must-know rules for maintainers

1. **Offline only.** The app must run on the LAN with no internet. Never add a CDN
   link, web font, analytics snippet, or any `fetch`/`<script>` to a non-`/api`
   host. `npm run check:offline` is the backstop and runs inside `npm run build`.
2. **jQuery airlock.** `import $ from "jquery"` appears in exactly one file:
   `src/ui/fomantic.ts`. To make new markup interactive, add its selector to
   `activate()` and `destroy()` there. ESLint blocks `jquery` imports elsewhere.
3. **Update a panel by building an HTML string and calling `paint()`** — never
   hand-mutate a panel's DOM. `paint()` tears down old Fomantic plugins first.
4. **One state object.** `src/state.ts`. Change it with `store.setState({...})`;
   panels react in `src/main.ts`'s `subscribe`.
5. **Stats & preview always match the on-screen query.** Editing the query clears
   both immediately; slow responses are dropped by a `JSON.stringify(query)` guard.
6. The full design lives in `docs/ARCHITECTURE.md`. Keep it updated with any
   architectural change.

## Layout of the code

See `docs/ARCHITECTURE.md` §4.
````

- [ ] **Step 3: Update `docs/ARCHITECTURE.md` §13**

Add a row:

```
| 2026-09-01 | Frontend implemented per plan 2026-09-01-query-builder-frontend.md (Tasks 1–17). |
```

- [ ] **Step 4: Full verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
Expected: all pass; `build` ends with `check:offline OK — no off-origin URLs in dist/.`

- [ ] **Step 5: Manual smoke of the built app**

```bash
npm run preview
```
Open the printed URL. With the mock server **not** running, the schema load fails with the red message (expected — `preview` doesn't start the mock). Then in another terminal `npm run mock` and reload: full flow works (build query → stats → Run → table → paging). In DevTools Network, confirm every request is same-origin `/api/...` or a bundled asset — nothing to `fonts.googleapis.com` or any external host.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: README, offline check in build, docs changelog"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 layout, secondary menu (Filter/Review/Approval/Done), non-goals | 11 (shell + menu + Coming-soon), 13–16 (Filter panels) |
| §2 tech choices | 1 |
| §2 offline-first (no external hosts, bundled assets, font strip, `check:offline`, `npm ci`) | 1 (plugin, script), 17 (chained into build, README) |
| §3 Fomantic discipline (`fomantic.ts` airlock, `paint()`, no `$` elsewhere, bootstrap global) | 11 (+ ESLint rule in 1) |
| §4 directory layout | 1–16 create exactly those files (`src/util/debounce.ts` and `src/ui/valueControl.ts` added — noted in §13 update, step for ARCHITECTURE edit in Task 17; **add a line there**) |
| §5 state shape, store, narrow subscriptions, debounce helper | 7 (store, debounce), 12–16 (per-panel subscribe on changed keys) |
| §6 stats/preview never stale: reset in same `setState`, hint on error, no fetch on invalid, loader with nothing behind, stale-guard | 14 (`onQueryChange` reset), 15 (stats states + guard), 16 (preview states + guard) |
| §7 API contract (three endpoints, exact response shapes, `{error}` unwrap) | 6 (types + client), 2/9/10 (mock server implements them) |
| §8 query model (types, pure `tree.ts`, `validate.ts`, `summary.ts`, JSON wire format) | 3, 4, 5 |
| §9 panels (docs accordion + filter; recursive builder; value control by arity×type; stats block renderers; celled table + Prev/Next) | 12, 13, 14, 15, 16 |
| §10 mock server (plain http, ~200 records, recursive `matches`, blocks, paging, 400 on bad query, no shared code) | 2, 8, 9, 10 |
| §11 error model (client throws, panels show `ui negative message` with nulled data, fatal schema failure → full-page message + Reload) | 6, 12 (fatal), 15, 16 |
| §12 tests: Vitest on pure modules only, no component tests | 3–10 have tests; 11–16 explicitly "none (view layer)" |
| §12 scripts + config (strict tsconfig, ESLint no-jquery rule, Prettier) | 1 |

Gap found & resolved: `src/util/debounce.ts` and `src/ui/valueControl.ts` are not in the spec §4 file list. **In Task 17 Step 3, also add these two files to `docs/ARCHITECTURE.md` §4** and note them in the changelog row.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" left. The one "wired in Task 15" comment in Task 11's `main.ts` `run` stub is replaced explicitly in Task 16 Step 2. The unused `postJson` in Task 6 is called out with a delete instruction.

**3. Type consistency:** `AppState` shape in Task 7 matches every `store.setState({...})` call in Tasks 12–16 (`stats: { status, data, error }`, `preview: { status, data, error, page }`). `StatBlock` union in Task 6 matches `computeBlocks` output in Task 9 and the renderers in Task 15. `validateQuery(tree, { fields, operators })` signature in Task 4 matches call sites in Tasks 14/15/16. Mock server `JsonNode` (Task 8) is structurally the same as the client `QueryNode` serialized — both `{kind:"condition",fieldId,operatorId,value}` / `{kind:"group",operator,children}`. `readValueControl(row, arity, valueType)` in Task 13 is consumed in Task 14's `handleRowChange`.

Fixes applied inline above. Plan is ready to execute.
