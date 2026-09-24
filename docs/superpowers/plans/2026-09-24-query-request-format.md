# Query Request Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the query sent to `POST …/stats` and `POST …/query` its own typed, versioned contract: an API prefix from `.env`, a `QueryRequest` built by a pure converter, fields named by (facet, field) pairs, declared value types with free-entry pick-lists, and value validation.

**Architecture:** The UI keeps editing its own `Group`/`Condition` tree. `toQueryRequest` projects it into the new `QueryRequest` types in `src/api/types.ts` just before a request. Operators and values are never rewritten. `buildFieldCatalog` stops turning `values` into an `enum` type: `values` become suggestions (`options`) shown in a Fomantic dropdown that also accepts typed values. The mock server serves under the same `.env` prefix, and checks request bodies against the contract.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vite 8, Vitest 4 (node environment, no DOM), Fomantic-UI 2.9 via jQuery (only in `src/ui/fomantic.ts`), plain Node `http` mock server run by `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-24-query-request-format-design.md`. Read it before starting any task.

## Global Constraints

- Node 20.19 or newer. Run every command from the worktree root.
- Gates, all of which must pass at the end of every task: `npm test`, `npm run typecheck`, `npm run lint` (ESLint + `prettier --check .`). Task 1 and Task 6 also run `npm run build`.
- Before committing, run `npx prettier --write` on the changed `.ts`/`.json` files. `docs/` and `README.md` are prettier-ignored.
- **The frontend never rewrites a condition.** Operators and values go out exactly as the user built them. The only conversion allowed is typing an entry to the field's declared type (`"3"` → `3` for a number field).
- **`src/` never names the backend's data** (facets, fields, tags, groups, databases), not even in comments. `tests/noBackendDataInSrc.test.ts` enforces this. Frontend tests use the neutral fixtures: facet `thing`, fields `color`, `count`, `size`, `active`, `seenAt`, `note`, databases `alpha`, `beta`. Mock-server tests may name the mock's fictional data.
- **`src/` never imports `mock-server/`.** The mock imports only *types* from `src/api/types.ts` (`import type`).
- Naming: `label` is a machine id and `name` is display text. A `…Id` in state or a query node holds a `label`.
- Code comments that cite the architecture doc use `docs/ARCHITECTURE.md, "<section title>"`, and the title must exist (`tests/docReferences.test.ts`). Don't rename section titles in `docs/ARCHITECTURE.md`.
- Match the surrounding style: JSDoc on exports, short plain-English comments, no new dependencies.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit on the current branch. Don't push and don't open a pull request.

---

### Task 1: The API prefix, set in `.env`

**Files:**
- Create: `.env`, `tests/env.test.ts`
- Modify: `src/vendor.d.ts`, `src/api/client.ts`, `vite.config.ts`, `mock-server/index.ts`, `mock-server/server.ts`, `README.md`, `docs/ARCHITECTURE.md`
- Test: `tests/api/client.test.ts`, `tests/mock-server/server.test.ts`

**Interfaces:**
- Produces: `import.meta.env.VITE_API_BASE: string` (required, e.g. `"/api/v1"`, no trailing slash). `MockConfig.apiBase: string`: every mock route and redirect is built from it.

- [ ] **Step 1: Install and take a baseline**

```bash
npm ci
npm test
```

Expected: all tests pass. (The worktree has no `node_modules` until `npm ci` runs.)

- [ ] **Step 2: Write the failing tests**

Create `tests/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The API prefix lives in .env and nowhere else (docs/ARCHITECTURE.md, "API
// contract"): client.ts has no fallback, and vite.config.ts stops without it.
describe(".env", () => {
  const env = readFileSync(path.join(__dirname, "..", ".env"), "utf8");

  it("sets VITE_API_BASE: versioned, without a trailing slash", () => {
    expect(env).toMatch(/^VITE_API_BASE=\/api\/v\d+$/m);
  });

  it("is what import.meta.env holds in tests", () => {
    expect(import.meta.env.VITE_API_BASE).toBe("/api/v1");
  });
});
```

In `tests/api/client.test.ts`, every URL string gains the version. Replace each `"/api/` with `"/api/v1/`:

```bash
sed -i 's#"/api/#"/api/v1/#g' tests/api/client.test.ts
```

Test titles such as `"getDatabases GETs /api/databases …"` have no quote before `/api` and stay as they are.

In `tests/mock-server/server.test.ts`:

1. Replace the `beforeAll` block with:

```ts
/** A prefix no deployment uses, so a hard-coded "/api" in the mock can't pass. */
const API = "/test-api/v9";

beforeAll(async () => {
  server = createMockServer({ apiBase: API, failRate: 0, lineDelayMs: () => 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
```

2. Change every request path from `"/api/…"` to `` `${API}/…` ``. The request paths are in: `it.each(["/api/databases", "/api/individuals"])`, all `post("/api/stats", …)` and `post("/api/query", …)` calls, `get("/api/auth/login")`, `get("/api/auth/callback?code=x&state=y")`, `get("/api/compliance/start")`, `get("/api/auth/me"…)` and `get("/api/compliance/status"…)`. Also change the expected location in "starting compliance without a session goes to log in instead" to `` `${API}/auth/login` ``. Leave the last test (`get("/api/nope")` → 404) unchanged. Leave `describe`/`it` titles unchanged.

3. Add at the end of the file:

```ts
describe("the API prefix (MockConfig.apiBase)", () => {
  it("serves the API only under the prefix", async () => {
    expect((await get(`${API}/databases`)).status).toBe(200);
    expect((await get("/api/databases")).status).toBe(404);
  });

  it("the mock IdP sends the browser back to the login callback under the prefix", async () => {
    const res = await get("/mock-idp/authorize/confirm?state=s");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(`${API}/auth/callback?code=`);
  });

  it("the mock compliance form sends the browser back to the callback under the prefix", async () => {
    const res = await fetch(base + "/mock-compliance/submit", {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({ state: "s", reason: "testing" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(`${API}/compliance/callback?token=`);
  });
});
```

(`toMatch` with a string checks that the text contains it.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/env.test.ts tests/api/client.test.ts tests/mock-server/server.test.ts`
Expected: FAIL. `.env` doesn't exist, the client still calls `/api/…`, and `createMockServer` ignores `apiBase` (typecheck also complains that `apiBase` isn't in `MockConfig`).

- [ ] **Step 4: Implement**

Create `.env`:

```
# The API prefix: every request goes under it, the login and compliance flows
# included. It carries the API version, so moving to v2 is changing this line.
# No trailing slash. Override per deployment in .env.local or .env.production,
# or with an environment variable at build time (docs/ARCHITECTURE.md,
# "API contract").
VITE_API_BASE=/api/v1
```

In `src/vendor.d.ts`, replace the `ImportMetaEnv` block with:

```ts
// Our build-time settings on Vite's `import.meta.env` (the rest comes from
// `vite/client`, listed in tsconfig.json "types"). Set in .env.
interface ImportMetaEnv {
  /** The API prefix, e.g. "/api/v1" — no default: vite.config.ts stops without it. */
  readonly VITE_API_BASE: string;
}
```

In `src/api/client.ts`, replace

```ts
const BASE = import.meta.env.VITE_API_BASE ?? "/api";
```

with

```ts
/** The API prefix from .env (docs/ARCHITECTURE.md, "API contract"). No
 *  fallback here: vite.config.ts refuses to run without it. */
const BASE = import.meta.env.VITE_API_BASE;
```

In `vite.config.ts`:
- Change the import to `import { defineConfig, loadEnv, type Plugin } from "vite";`.
- Add this function above `const mockApi = …`:

```ts
/**
 * The API prefix from .env (docs/ARCHITECTURE.md, "API contract"). The app
 * has no default of its own, so a missing value — or one ending in "/", which
 * would double the slash in every URL — stops dev and build here, never in the
 * running app.
 */
function apiBase(mode: string): string {
  const base = loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE ?? "";
  if (!base || base.endsWith("/")) {
    throw new Error(
      `VITE_API_BASE must be set, without a trailing slash (see .env); got "${base}".`,
    );
  }
  return base;
}
```

- Replace `export default defineConfig({ … });` with a function config that reads the prefix once and proxies it. Keep `plugins` and `build` exactly as they are now:

```ts
export default defineConfig(({ mode }) => {
  const api = apiBase(mode);
  return {
    plugins: [stripRemoteCss(), stripRemoteJs(), emitLicenseNotices()],
    server: {
      port: 5173,
      // The API prefix goes to the mock. …/auth/login and …/compliance/start
      // both 302 the browser (a real navigation, not a fetch) to a mock-*/...
      // path on this same origin — each redirect target must be proxied too,
      // or the dev server serves the SPA shell instead of the mock service's page.
      proxy: {
        [api]: mockApi,
        "/mock-idp": mockApi,
        "/mock-compliance": mockApi,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Fomantic ships one prebuilt CSS file and one prebuilt JS file. Neither can
      // be tree-shaken, so the bundle is big on purpose. Raise the warning
      // threshold so a known, accepted size stops crying wolf on every build.
      chunkSizeWarningLimit: 1500,
    },
  };
});
```

In `mock-server/index.ts`:
- Add `import { loadEnv } from "vite";` above `import { createMockServer } from "./server";`.
- After the `PORT` constant add:

```ts
/** The API prefix, from .env like the app's own (docs/ARCHITECTURE.md, "API contract"). */
const apiBase = loadEnv("development", process.cwd(), "VITE_").VITE_API_BASE;
if (!apiBase) throw new Error("VITE_API_BASE must be set (see .env).");
```

- Pass it: `createMockServer({ apiBase, failRate: …, lineDelayMs: … })` (add `apiBase,` as the first property), and change the listen message to `` `Mock API on http://localhost:${PORT}${apiBase}` ``.

In `mock-server/server.ts`:
- Add as the first member of `interface MockConfig`:

```ts
  /** The API prefix every route and redirect goes under, e.g. "/api/v1" (VITE_API_BASE in .env). */
  apiBase: string;
```

- `confirmIdpLogin` gains a parameter and uses it:

```ts
/** The user "logged in" at the mock IdP: hand back a code, as a real IdP would. */
function confirmIdpLogin(_req: IncomingMessage, res: ServerResponse, url: URL, apiBase: string) {
  const state = url.searchParams.get("state") ?? "";
  const code = issueFakeCode();
  redirect(
    res,
    `${apiBase}/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}
```

- `startComplianceFlow(req: IncomingMessage, res: ServerResponse, apiBase: string)`: its no-session redirect becomes `return redirect(res, `${apiBase}/auth/login`);`.
- `submitComplianceForm(req: IncomingMessage, res: ServerResponse, apiBase: string)`: its redirect becomes `` `${apiBase}/compliance/callback?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}` ``.
- In the two section comments, change `app → /api/auth/login → …` to `app → …/auth/login → …` and `app → /api/compliance/start → …` to `app → …/compliance/start → …`.
- Replace `routes()` with:

```ts
/** Every route, keyed by "METHOD /path". Add a route here. The API's own
 *  routes sit under `config.apiBase`; the stand-in services' pages don't. */
function routes(config: MockConfig): Record<string, Handler> {
  const api = config.apiBase;
  return {
    [`GET ${api}/databases`]: (_req, res) => sendJson(res, 200, DATABASES),
    [`GET ${api}/individuals`]: (_req, res) => sendJson(res, 200, INDIVIDUALS),
    [`POST ${api}/stats`]: (req, res) => streamStats(req, res, config),
    [`POST ${api}/query`]: queryEvents,

    [`GET ${api}/auth/login`]: startLoginFlow,
    "GET /mock-idp/authorize": showIdpPage,
    "GET /mock-idp/authorize/confirm": (req, res, url) => confirmIdpLogin(req, res, url, api),
    [`GET ${api}/auth/callback`]: finishLogin,
    [`GET ${api}/auth/me`]: currentUser,
    [`POST ${api}/auth/logout`]: logOut,

    [`GET ${api}/compliance/start`]: (req, res) => startComplianceFlow(req, res, api),
    "GET /mock-compliance/submit": showComplianceForm,
    "POST /mock-compliance/submit": (req, res) => submitComplianceForm(req, res, api),
    [`GET ${api}/compliance/callback`]: finishCompliance,
    [`GET ${api}/compliance/status`]: (req, res) =>
      sendJson(res, 200, complianceStatusFor(req.headers.cookie)),
    [`POST ${api}/compliance/invalidate`]: invalidateCompliance,
  };
}
```

- [ ] **Step 5: Run the tests and gates**

```bash
npx vitest run tests/env.test.ts tests/api/client.test.ts tests/mock-server/server.test.ts
npm test && npm run typecheck
npm run build
VITE_API_BASE= npx vite build; echo "exit=$?"
VITE_API_BASE=/api/v1/ npx vite build; echo "exit=$?"
```

Expected: tests PASS, and `npm run build` succeeds. Both deliberately broken builds fail with `VITE_API_BASE must be set, without a trailing slash (see .env)` and a non-zero exit.

- [ ] **Step 6: Update the docs**

`README.md`:
- Line 7, replace ``under `VITE_API_BASE` (default `/api`):`` with ``under the API prefix `VITE_API_BASE`, set in `.env` (`/api/v1`):``.
- Replace the **API location** bullet under "Deploying `dist/`" with:

```markdown
- **API location.** Every request goes under `VITE_API_BASE`, set in the
  committed `.env` (`/api/v1`, same origin). The login and compliance links
  follow it too. The prefix carries the API version: moving to v2 is changing
  that line. It is fixed at build time; override it per deployment in
  `.env.production` or `.env.local`, or inline:
  `VITE_API_BASE=/other/v1 npm run build`. The build stops if it is missing or
  ends in `/`.
```

`docs/ARCHITECTURE.md`:
- "Offline-first", item 1: replace ``under `VITE_API_BASE` (default `/api`, same origin)`` with ``under `VITE_API_BASE` (`/api/v1`, same origin — set in `.env`)``.
- §4 "Directory layout":
  - Change the `vite.config.ts` line's text to: `Dev proxy to the mock (under the API prefix), the offline plugins, emitting THIRD-PARTY-NOTICES.txt; stops if VITE_API_BASE is missing.`
  - Add a line directly below it: `.env                   VITE_API_BASE — the API prefix, and with it the API version ("API contract").`
  - Change the mock `index.ts` line's text to: `Reads VITE_API_BASE (.env), MOCK_PORT / MOCK_FAIL_RATE / MOCK_STREAM_DELAY_MS, starts the server.`
- §7 "API contract": in the first paragraph, replace ``one function per endpoint, all under `VITE_API_BASE` (default `/api`).`` with ``one function per endpoint, all under one **API prefix**, `VITE_API_BASE`.``. Then insert this paragraph after the first paragraph (before the endpoint table):

```markdown
**The API prefix** is set in one place, the committed `.env`
(`VITE_API_BASE=/api/v1`), and carries the API version: moving to v2 means
changing that line. A deployment overrides it with `.env.local`,
`.env.production` or an environment variable at build time. `client.ts` has no
fallback, and `vite.config.ts` stops dev and build when the prefix is missing
or ends in `/`. The whole API moves with it, the login and compliance flows
included, so the backend registers its callback URLs under the deployed
prefix. The mock server reads the same `.env`. In this document and in code
comments, `/api/stats` and the like are short for `{prefix}/stats`.
```

  In the endpoint table, write each endpoint with `{prefix}` in place of `/api`: `` `GET {prefix}/databases` ``, `` `GET {prefix}/individuals` ``, `` `POST {prefix}/stats` ``, `` `POST {prefix}/query` ``, `` `GET {prefix}/auth/login`, `/callback`, `/me`, `POST /logout` `` and `` `GET {prefix}/compliance/start`, `/callback`, `/status`, `POST /invalidate` ``.
- §10 "Mock server": in the first paragraph replace ``which proxies `/api/*`, `/mock-idp/*` and `/mock-compliance/*` to it`` with ``which proxies the API prefix, `/mock-idp/*` and `/mock-compliance/*` to it``. Add this bullet before the **Types, not code.** bullet:

```markdown
- **Prefix.** `index.ts` reads `VITE_API_BASE` from `.env` with Vite's
  `loadEnv`, as the app does, and passes it as `MockConfig.apiBase`. Every API
  route and every redirect the mock issues is built from it. The stand-in
  pages (`/mock-idp/*`, `/mock-compliance/*`) are not under it.
```

- [ ] **Step 7: Lint and commit**

```bash
npx prettier --write tests/env.test.ts tests/api/client.test.ts tests/mock-server/server.test.ts src/vendor.d.ts src/api/client.ts vite.config.ts mock-server/index.ts mock-server/server.ts
npm test && npm run typecheck && npm run lint
git add .env tests/env.test.ts tests/api/client.test.ts tests/mock-server/server.test.ts src/vendor.d.ts src/api/client.ts vite.config.ts mock-server/index.ts mock-server/server.ts README.md docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Set the API prefix in .env: /api/v1

The version lives in the path prefix, set once in the committed .env. The
client has no fallback, vite.config.ts stops without it, and the mock serves
every route and redirect under it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Name a field by its (facet, field) pair

**Files:**
- Modify: `src/query/fieldCatalog.ts`, `src/query/types.ts`, `src/query/conditionEdit.ts`, `src/query/validate.ts`, `src/query/summary.ts`, `src/ui/queryBuilder.ts`, `mock-server/evaluate.ts`, `mock-server/rows.ts`, `docs/ARCHITECTURE.md`
- Test: `tests/query/fieldCatalog.test.ts`, `tests/query/conditionEdit.test.ts`, `tests/query/validate.test.ts`, `tests/query/summary.test.ts`, `tests/ui/valueControl.test.ts`, `tests/app.test.ts`, `tests/mock-server/evaluate.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `CatalogField` loses `label` and gains `facetLabel: string` (the `Facet.label`) and `fieldLabel: string` (the `FacetField.label`).
  - `findField(catalog: FieldCatalog, facetId: string | null, fieldId: string | null): CatalogField | undefined`
  - `fieldsOfFacet(catalog: FieldCatalog, facetId: string | null): CatalogField[]`
  - `Condition.fieldId` holds the field's own label (`"size"`, not `"thing.size"`).
  - Mock: `rowKey(facetId: string, fieldId: string): string` exported from `mock-server/evaluate.ts`. `JsonCondition` gains `facetId: string | null`.

- [ ] **Step 1: Write the failing tests**

`tests/query/fieldCatalog.test.ts`:
1. Add `fieldsOfFacet` to the import from `../../src/query/fieldCatalog`.
2. Directly after the `facets` fixture, add:

```ts
/** The catalog field for (facet label, field label), built from `facets`. */
const pick = (facetLabel: string, fieldLabel: string) =>
  findField(buildFieldCatalog(facets), facetLabel, fieldLabel);
```

3. Replace the test `"labels are dotted facetLabel.fieldLabel"` with:

```ts
  it("names each field by its facet's label and its own label", () => {
    const { fields } = buildFieldCatalog(facets);
    expect(fields.map((f) => [f.facetLabel, f.fieldLabel])).toEqual([
      ["engine_rpm", "value_rpm"],
      ["engine_rpm", "redline_rpm"],
      ["engine_rpm", "is_over_rev"],
      ["vehicle_identity", "vin"],
      ["vehicle_identity", "vehicle_type"],
    ]);
  });
```

4. In the tests built from `facets`, replace each ``fields.find((f) => f.label === "<facet>.<field>")`` with ``pick("<facet>", "<field>")``, and delete any `const { fields } = buildFieldCatalog(facets);` line that is then unused. For example, `fields.find((f) => f.label === "engine_rpm.value_rpm")?.valueType` becomes `pick("engine_rpm", "value_rpm")?.valueType`. In "a field with non-empty values becomes an enum field …", which builds from `withValues`, replace `fields.find((f) => f.label === "vehicle_identity.vehicle_type")` with `fields[0]`.
5. Replace the test `"findField looks a field up by its dotted label"` with:

```ts
  it("findField needs both labels", () => {
    const catalog = buildFieldCatalog(facets);
    expect(findField(catalog, "vehicle_identity", "vin")?.valueType).toBe("string");
    expect(findField(catalog, "vehicle_identity", null)).toBeUndefined();
    expect(findField(catalog, null, "vin")).toBeUndefined();
    expect(findField(catalog, "engine_rpm", "vin")).toBeUndefined();
  });
```

6. Add a new `describe` after the `buildFieldCatalog` one:

```ts
describe("field identity: the (facet label, field label) pair", () => {
  // Joined with a dot, both of these fields would be "a.b.c".
  const dotted: Facet[] = [
    {
      ...facets[0]!,
      label: "a.b",
      name: "A.B",
      fields: [{ ...facets[0]!.fields[0]!, label: "c", type: "BIGINT" }],
    },
    {
      ...facets[0]!,
      label: "a",
      name: "A",
      fields: [{ ...facets[0]!.fields[0]!, label: "b.c", type: "BOOLEAN" }],
    },
  ];

  it("findField matches both labels, so dotted labels can't collide", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(findField(catalog, "a.b", "c")?.valueType).toBe("number");
    expect(findField(catalog, "a", "b.c")?.valueType).toBe("boolean");
    expect(findField(catalog, "a", "c")).toBeUndefined();
  });

  it("fieldsOfFacet lists only that facet's fields, even when another facet's label starts the same", () => {
    const catalog = buildFieldCatalog(dotted);
    expect(fieldsOfFacet(catalog, "a").map((f) => f.fieldLabel)).toEqual(["b.c"]);
    expect(fieldsOfFacet(catalog, "a.b").map((f) => f.fieldLabel)).toEqual(["c"]);
    expect(fieldsOfFacet(catalog, null)).toEqual([]);
  });
});
```

`tests/query/conditionEdit.test.ts`: replace the `field` helper and the catalog with the following, then replace `"thing.size"` → `"size"`, `"thing.name"` → `"name"` and `"thing.active"` → `"active"` everywhere in the file (`sed -i 's/"thing\.\(size\|name\|active\)"/"\1"/g' tests/query/conditionEdit.test.ts`):

```ts
const field = (fieldLabel: string, valueType: CatalogField["valueType"]): CatalogField => ({
  facetLabel: "thing",
  fieldLabel,
  name: fieldLabel,
  fieldName: fieldLabel,
  valueType,
  operatorIds: [],
});
const catalog: FieldCatalog = {
  fields: [field("size", "number"), field("active", "boolean"), field("name", "string")],
};
```

`tests/query/validate.test.ts`:
1. Replace the `field` helper with:

```ts
const field = (
  fieldLabel: string,
  valueType: CatalogField["valueType"],
  operatorIds: string[],
): CatalogField => ({
  facetLabel: "thing",
  fieldLabel,
  name: fieldLabel,
  fieldName: fieldLabel,
  valueType,
  operatorIds,
});
```

2. In `validateOne`, change the `updateNode` call to apply the facet first: `updateNode(addChild(root, root.id, c), c.id, { facetId: "thing", ...patch })`.
3. Add after `"a field that is not in the catalog is invalid"`:

```ts
  it("a field of another facet is unknown", () => {
    expectIssue(
      { facetId: "other", fieldId: "color", operatorId: "eq", value: "x" },
      "Unknown field.",
      "invalid",
    );
  });

  it("a condition without a facet is incomplete", () => {
    expectIssue({ facetId: null, fieldId: "color" }, "Choose a field.", "incomplete");
  });
```

`tests/query/summary.test.ts`:
1. Replace the `field` helper with:

```ts
const field = (fieldLabel: string, name: string, options?: string[]): CatalogField => ({
  facetLabel: "thing",
  fieldLabel,
  name,
  fieldName: name,
  valueType: options ? "enum" : "string",
  options,
  operatorIds: [],
});
```

2. Every condition patch needs the facet too:

```bash
sed -i 's/{ fieldId: /{ facetId: "thing", fieldId: /g; s/{ fieldId, operatorId, value }/{ facetId: "thing", fieldId, operatorId, value }/' tests/query/summary.test.ts
```

`tests/ui/valueControl.test.ts`: in the `field()` helper, replace `label: "f",` with `facetLabel: "t",` and `fieldLabel: "f",`.

`tests/app.test.ts`: in `runnableQuery`, change `fieldId: "thing.size",` to `fieldId: "size",`.

`tests/mock-server/evaluate.test.ts`: the rows are now keyed by `rowKey(facet, field)`, and conditions carry `facetId`.
1. Replace `row` and `cond` with:

```ts
const row = {
  "thing.color": "red",
  "thing.count": 12,
  "thing.size": 200,
  "thing.active": true,
  "thing.spare": null,
  "thing.madeOn": "2018-05-01",
  "thing.note": "all good",
};

const cond = (fieldId: string, operatorId: string, value: unknown) => ({
  kind: "condition" as const,
  facetId: "thing",
  fieldId,
  operatorId,
  value,
});
```

2. In the date tests, write stored rows with the same keys: `const seen = { "thing.seenAt": "2024-11-06T14:32:00Z" };`, `const late = { "thing.seenAt": "2024-11-06T23:30:00-02:00" };` and `const day = { "thing.madeOn": "2024-11-06" };`.
3. In the scoping fixtures, rename the `count` key to `"thing.count"` in all four `rows`, and give `countGte10`'s condition `facetId: "thing"`: `{ kind: "condition", facetId: "thing", fieldId: "count", operatorId: "gte", value: 10 }`.
4. Add to `describe("matches", …)`:

```ts
  it("reads the value stored under rowKey(facetId, fieldId)", () => {
    expect(rowKey("thing", "color")).toBe("thing.color");
    expect(matches({ ...cond("color", "eq", "red"), facetId: "other" }, row)).toBe(false);
  });
```

   Add `rowKey` to the import from `../../mock-server/evaluate`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query tests/ui/valueControl.test.ts tests/app.test.ts tests/mock-server/evaluate.test.ts`
Expected: FAIL (`fieldsOfFacet` and `rowKey` don't exist, `findField` takes one label, the catalog has no `facetLabel`).

- [ ] **Step 3: Implement**

`src/query/fieldCatalog.ts`:
- In `CatalogField`, replace the `label` member with:

```ts
  /** The facet's `Facet.label` — what a condition stores as `facetId`. */
  facetLabel: string;
  /** The field's own `FacetField.label`, within that facet — what a condition
   *  stores as `fieldId`. A field is named by this pair, never by one joined
   *  string: a label may itself contain a ".". */
  fieldLabel: string;
```

- Replace `findField` with:

```ts
export function findField(
  catalog: FieldCatalog,
  facetId: string | null,
  fieldId: string | null,
): CatalogField | undefined {
  return facetId && fieldId
    ? catalog.fields.find((f) => f.facetLabel === facetId && f.fieldLabel === fieldId)
    : undefined;
}

/** The fields of one facet, in catalog order — what the Field dropdown lists
 *  once a facet is chosen. */
export function fieldsOfFacet(catalog: FieldCatalog, facetId: string | null): CatalogField[] {
  return facetId ? catalog.fields.filter((f) => f.facetLabel === facetId) : [];
}
```

- In `buildFieldCatalog`, replace ``label: `${facet.label}.${f.label}`,`` with `facetLabel: facet.label,` and `fieldLabel: f.label,`. In its doc comment, replace the sentence "Field label is the dotted "facetLabel.fieldLabel" path, matching how an event nests its values." with "Each field is named by the pair (`facetLabel`, `fieldLabel`), matching how an event nests its values."

`src/query/types.ts`: replace the `facetId` and `fieldId` members of `Condition` with:

```ts
  /** The chosen facet's `Facet.label`, or null. With `fieldId`, names the
   *  field the condition targets. */
  facetId: string | null;
  /** The chosen field's own `FacetField.label` within that facet, or null. */
  fieldId: string | null;
```

`src/query/conditionEdit.ts`: `const field = findField(catalog, facetId, fieldId);`

`src/query/validate.ts`: the first checks of `checkCondition` become:

```ts
  if (!c.facetId || !c.fieldId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  const fieldDef = findField(catalog, c.facetId, c.fieldId);
```

`src/query/summary.ts`: `const field = findField(catalog, c.facetId, c.fieldId);`

`src/ui/queryBuilder.ts`:
- Import `fieldsOfFacet` alongside `findField`.
- Replace `fieldDropdown` with:

```ts
function fieldDropdown(catalog: FieldCatalog, c: Condition): string {
  const opts = optionsHtml(
    fieldsOfFacet(catalog, c.facetId),
    (f) => f.fieldLabel,
    (f) => f.fieldName,
    (f) => f.fieldLabel === c.fieldId,
  );
  return `<select class="ui selection dropdown" data-part="field" aria-label="Field"${c.facetId ? "" : " disabled"}><option value="">Field…</option>${opts}</select>`;
}
```

- In `operatorDropdown` and `conditionHtml`: `findField(catalog, c.facetId, c.fieldId)` / `findField(ctx.catalog, c.facetId, c.fieldId)`.

`mock-server/evaluate.ts`:
- `JsonCondition` gains `facetId: string | null;` above `fieldId`. In the comment above it, change "The tree also carries ids, `facetId` and `collapsed`, which the evaluator ignores." to "The tree also carries ids and `collapsed`, which the evaluator ignores."
- Add below the `JsonNode` type:

```ts
/** The key a facet's field value is stored under in a Row (mock-server/rows.ts).
 *  A dotted key is fine here: it never leaves the mock, and the fictional data
 *  has no dots in its labels. */
export function rowKey(facetId: string, fieldId: string): string {
  return `${facetId}.${fieldId}`;
}
```

- In `conditionMatches`, the first two lines become:

```ts
  if (!c.facetId || !c.fieldId || !c.operatorId) return false;
  const v = row[rowKey(c.facetId, c.fieldId)];
```

`mock-server/rows.ts`: change the import to `import { rowKey, type Row } from "./evaluate";` and the assignment to `row[rowKey(individualLabel, fieldLabel)] = value;`. In its doc comment, replace "into flat `"individualLabel.fieldLabel"` keys — the same dotted labels the frontend's field catalog gives its fields (src/query/fieldCatalog.ts), so a condition's `fieldId` is a key of the row —" with "into flat `rowKey(individualLabel, fieldLabel)` keys, so a condition's (facetId, fieldId) pair finds its value —".

- [ ] **Step 4: Run the tests and gates**

```bash
npm test && npm run typecheck
grep -rnF -e 'f.label ===' -e 'label.startsWith' -e '.label}.${' src tests/query tests/ui
```

Expected: tests PASS, typecheck clean, and the grep prints nothing: no dotted field ids are left in `src/` or the frontend tests.

- [ ] **Step 5: Update the docs** (`docs/ARCHITECTURE.md`)

- "Naming", rule 1: replace ``and for the frontend's own `CatalogField` and `CatalogOperator`.`` with ``and for the frontend's own `CatalogOperator`; a `CatalogField` has two, `facetLabel` and `fieldLabel`.``
- "Naming", rule 2: replace ``Condition.facetId`, `fieldId` and `operatorId` hold `Facet.label`, `CatalogField.label` (`"facetLabel.fieldLabel"`) and `CatalogOperator.label` (`"gt"`).`` with ``Condition.facetId`, `fieldId` and `operatorId` hold `Facet.label`, `FacetField.label` (the field's own label, within that facet) and `CatalogOperator.label` (`"gt"`). A field is always named by the pair (facet label, field label), never by one joined string: a label may itself contain a `.`.``
- "The field catalog": replace ``one `CatalogField` per (facet, field), with label `"facetLabel.fieldLabel"`.`` with ``one `CatalogField` per (facet, field), named by the pair `facetLabel` / `fieldLabel`.``
- §4, the `fieldCatalog.ts` line: `buildFieldCatalog(facets), OPERATORS, OPERATOR_PROFILE, TYPE_NAMES, findField / fieldsOfFacet / findOperator, fieldDisplayName.`
- §8: replace ``the leaves are `Condition`s (`fieldId`, `operatorId`, `value`, all `null` until chosen)`` with ``the leaves are `Condition`s (`facetId`, `fieldId`, `operatorId`, `value`, all `null` until chosen)``.
- "Centre": replace ``**Field** (that facet's fields, by `fieldDisplayName`)`` with ``**Field** (that facet's fields, `fieldsOfFacet`, by `fieldDisplayName`)``.
- §10: replace ``flattens every event into a `Row` with `"facetLabel.fieldLabel"` keys plus a `__db` key`` with ``flattens every event into a `Row` keyed by `rowKey(facetLabel, fieldLabel)` plus a `__db` key``.

- [ ] **Step 6: Lint and commit**

```bash
npx prettier --write src/query tests/query src/ui/queryBuilder.ts tests/ui/valueControl.test.ts tests/app.test.ts mock-server/evaluate.ts mock-server/rows.ts tests/mock-server/evaluate.test.ts
npm test && npm run typecheck && npm run lint
git add -A src tests mock-server docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Name a field by its (facet, field) pair instead of a dotted string

A dotted "facet.field" id collides when a label contains a dot, and the
Field dropdown's prefix filter listed another facet's fields. Conditions now
hold the field's own label next to facetId; findField and the new
fieldsOfFacet match the pair.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The request types and `toQueryRequest`

**Files:**
- Create: `src/query/request.ts`, `mock-server/requestBody.ts`, `tests/query/request.test.ts`, `tests/mock-server/requestBody.test.ts`
- Modify: `src/api/types.ts`, `src/api/client.ts`, `src/app.ts`, `mock-server/evaluate.ts`, `mock-server/server.ts`, `docs/ARCHITECTURE.md`
- Test: `tests/api/client.test.ts`, `tests/app.test.ts`, `tests/mock-server/evaluate.test.ts`, `tests/mock-server/server.test.ts`

**Interfaces:**
- Consumes: `Condition.facetId` / `fieldId` as a pair (Task 2); `BASE` from `.env` (Task 1).
- Produces:
  - In `src/api/types.ts`: `QueryRequest`, `RequestNode`, `RequestGroup`, `RequestCondition`, `RequestScalar`, `RequestValue` (shapes below).
  - `toQueryRequest(query: Group, databases: string[]): QueryRequest` in `src/query/request.ts`.
  - `getStats(body: QueryRequest, onLine: (line: StatsResponse) => void, signal?: AbortSignal): Promise<void>` and `runQuery(body: QueryRequest, signal?: AbortSignal): Promise<EventsResponse>`. `AppApi` changes to match.
  - `queryProblem(node: unknown, at?: string): string | null` in `mock-server/requestBody.ts`.
  - The mock drops `JsonNode` / `JsonCondition` / `JsonGroup`. `matches`, `perDatabaseCounts` take `RequestNode`.

- [ ] **Step 1: Write the failing tests**

Create `tests/query/request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toQueryRequest } from "../../src/query/request";
import { addChild, emptyQuery, newCondition, newGroup, updateNode } from "../../src/query/tree";
import type { NodePatch } from "../../src/query/tree";
import type { RequestCondition } from "../../src/api/types";

/** Root AND of: size > 3, and a collapsed OR group holding color in [red, blue]. */
function sample() {
  const root = emptyQuery();
  const c1 = newCondition();
  const g = { ...newGroup(), children: [] };
  const c2 = newCondition();
  let t = addChild(root, root.id, c1);
  t = updateNode(t, c1.id, { facetId: "thing", fieldId: "size", operatorId: "gt", value: 3 });
  t = addChild(t, root.id, g);
  t = updateNode(t, g.id, { operator: "OR", collapsed: true });
  t = addChild(t, g.id, c2);
  t = updateNode(t, c2.id, {
    facetId: "thing",
    fieldId: "color",
    operatorId: "in",
    value: ["red", "blue"],
  });
  return { tree: t, ids: { root: root.id, c1: c1.id, g: g.id, c2: c2.id } };
}

/** A query holding one condition with `patch` applied. */
function oneCondition(patch: NodePatch) {
  const root = emptyQuery();
  const c = newCondition();
  return updateNode(addChild(root, root.id, c), c.id, patch);
}

describe("toQueryRequest", () => {
  it("builds the body: the databases, and the tree with its ids, operators and values", () => {
    const { tree, ids } = sample();
    expect(toQueryRequest(tree, ["alpha", "beta"])).toEqual({
      databases: ["alpha", "beta"],
      query: {
        kind: "group",
        id: ids.root,
        operator: "AND",
        children: [
          {
            kind: "condition",
            id: ids.c1,
            facetId: "thing",
            fieldId: "size",
            operatorId: "gt",
            value: 3,
          },
          {
            kind: "group",
            id: ids.g,
            operator: "OR",
            children: [
              {
                kind: "condition",
                id: ids.c2,
                facetId: "thing",
                fieldId: "color",
                operatorId: "in",
                value: ["red", "blue"],
              },
            ],
          },
        ],
      },
    });
  });

  it("leaves out display state: no `collapsed` anywhere", () => {
    expect(JSON.stringify(toQueryRequest(sample().tree, ["alpha"]))).not.toContain("collapsed");
  });

  it("sends operators and values exactly as built", () => {
    const root = emptyQuery();
    const c1 = newCondition();
    const c2 = newCondition();
    const c3 = newCondition();
    let t = addChild(addChild(addChild(root, root.id, c1), root.id, c2), root.id, c3);
    t = updateNode(t, c1.id, { facetId: "thing", fieldId: "seenAt", operatorId: "eq", value: "2024-11" });
    t = updateNode(t, c2.id, { facetId: "thing", fieldId: "note", operatorId: "isEmpty", value: null });
    t = updateNode(t, c3.id, { facetId: "thing", fieldId: "active", operatorId: "eq", value: false });
    const sent = toQueryRequest(t, ["alpha"]).query.children as RequestCondition[];
    expect(sent.map((c) => [c.operatorId, c.value])).toEqual([
      ["eq", "2024-11"],
      ["isEmpty", null],
      ["eq", false],
    ]);
  });

  it.each([
    ["no facet", { facetId: null, fieldId: "size", operatorId: "gt", value: 3 }],
    ["no field", { facetId: "thing", fieldId: null, operatorId: "gt", value: 3 }],
    ["no operator", { facetId: "thing", fieldId: "size", operatorId: null, value: 3 }],
  ])("throws on an unfinished condition (%s)", (_label, patch) => {
    expect(() => toQueryRequest(oneCondition(patch), ["alpha"])).toThrow(/unfinished/);
  });

  it.each([
    ["an object", { from: 1 }],
    ["a list holding an object", [1, {}]],
    ["undefined", undefined],
  ])("throws on a value that is %s", (_label, value) => {
    const patch = { facetId: "thing", fieldId: "size", operatorId: "gt", value };
    expect(() => toQueryRequest(oneCondition(patch), ["alpha"])).toThrow(/cannot be sent/);
  });
});
```

Create `tests/mock-server/requestBody.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { queryProblem } from "../../mock-server/requestBody";

const condition = {
  kind: "condition",
  id: "c1",
  facetId: "thing",
  fieldId: "size",
  operatorId: "gt",
  value: 3,
};
const group = (...children: unknown[]) => ({ kind: "group", id: "g1", operator: "AND", children });

describe("queryProblem: is this a well-formed RequestNode?", () => {
  it("accepts a well-formed tree", () => {
    expect(queryProblem(group(condition, group(condition)))).toBeNull();
  });

  // One-element rows: it.each spreads an array row into arguments, so a list
  // value must be wrapped to arrive as one argument.
  it.each([[null], [3], ["x"], [["a"]], [[1, "b", true]], [true]])(
    "accepts the value %j",
    (value) => {
      expect(queryProblem(group({ ...condition, value }))).toBeNull();
    },
  );

  it.each([
    ["not an object", [], "query must be an object."],
    ["an unknown kind", { ...condition, kind: "rule" }, 'query.kind must be "group" or "condition".'],
    ["no id", { ...group(condition), id: 7 }, "query.id must be a string."],
    ["a bad operator", { ...group(condition), operator: "XOR" }, 'query.operator must be "AND" or "OR".'],
    ["an empty group", group(), "query.children must be a non-empty list."],
    [
      "a child's problem, with its path",
      group(condition, { ...condition, fieldId: "" }),
      "query.children[1].fieldId must be a non-empty string.",
    ],
    ["no facet", group({ ...condition, facetId: null }), "query.children[0].facetId must be a non-empty string."],
    ["no operator", group({ ...condition, operatorId: 5 }), "query.children[0].operatorId must be a non-empty string."],
    [
      "an object value",
      group({ ...condition, value: { from: 1 } }),
      "query.children[0].value must be null, a string, number or boolean, or a list of them.",
    ],
    [
      "a list value holding an object",
      group({ ...condition, value: [1, {}] }),
      "query.children[0].value must be null, a string, number or boolean, or a list of them.",
    ],
  ])("reports %s", (_label, node, problem) => {
    expect(queryProblem(node)).toBe(problem);
  });
});
```

`tests/api/client.test.ts`:
1. Remove the `import { emptyQuery } from "../../src/query/tree";` line. Add `import type { QueryRequest } from "../../src/api/types";` and this fixture below the imports:

```ts
const body: QueryRequest = {
  databases: ["alpha", "beta"],
  query: {
    kind: "group",
    id: "g1",
    operator: "AND",
    children: [
      { kind: "condition", id: "c1", facetId: "thing", fieldId: "size", operatorId: "gt", value: 3 },
    ],
  },
};
```

2. Replace the test "getStats POSTs the query tree + selected databases as JSON" with:

```ts
  it("getStats POSTs the request body as JSON", async () => {
    const f = mockStreamFetch(200, [""]);
    vi.stubGlobal("fetch", f);
    await getStats(body, () => {});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/stats");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });
```

3. Replace the test "runQuery POSTs just the query and databases" with:

```ts
  it("runQuery POSTs the request body as JSON", async () => {
    const f = mockFetchOnce(200, { entrysets: [] });
    vi.stubGlobal("fetch", f);
    await runQuery(body);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/v1/query");
    expect(JSON.parse(init.body)).toEqual(body);
  });
```

4. Change the remaining calls: `getStats(emptyQuery(), ["alpha", "beta"], (line) => received.push(line))` → `getStats(body, (line) => received.push(line))`; `getStats(emptyQuery(), ["alpha"], onLine)` → `getStats(body, onLine)`; `runQuery(emptyQuery(), ["a"], ctrl.signal)` → `runQuery(body, ctrl.signal)`; `getStats(emptyQuery(), ["a"], () => {}, ctrl.signal)` → `getStats(body, () => {}, ctrl.signal)`; `getStats(emptyQuery(), ["a"], () => {})` → `getStats(body, () => {})`.

`tests/app.test.ts`:
1. Add `import { toQueryRequest } from "../src/query/request";` and `import type { QueryRequest } from "../src/api/types";` (merge the latter into the existing `../src/api/types` type import). Remove `QueryNode` from the `../src/query/types` import if nothing else uses it.
2. In "shows a loader, then the matching events", the call expectation becomes:

```ts
    expect(api.runQuery).toHaveBeenCalledWith(
      toQueryRequest(store.getState().query, ["alpha", "beta"]),
      expect.any(AbortSignal),
    );
```

3. In `streamingApi`, the fake's signature becomes `(_body: QueryRequest, onLine: (l: StatsResponse) => void, signal?: AbortSignal) => { … }`.
4. In "fetches after the debounce and streams lines in as they arrive":

```ts
    expect(api.getStats).toHaveBeenCalledWith(
      toQueryRequest(next, ["alpha", "beta"]),
      expect.any(Function),
      expect.any(AbortSignal),
    );
```

`tests/mock-server/evaluate.test.ts`:
1. Remove `type JsonNode` from the evaluate import, and add `import type { RequestNode, RequestValue } from "../../src/api/types";`.
2. `cond` becomes `(fieldId: string, operatorId: string, value: RequestValue) => ({ kind: "condition" as const, id: "c", facetId: "thing", fieldId, operatorId, value })`.
3. `group` becomes `(operator: "AND" | "OR", ...children: RequestNode[]) => ({ kind: "group" as const, id: "g", operator, children })`.
4. Replace every `JsonNode` with `RequestNode`. Give `matchAll` `id: "g"`, and give `countGte10` and its condition `id`s (`"g"`, `"c"`).
5. Add to `describe("matches", …)`. This pins down behaviour the frontend now relies on (it sends numbers and booleans as such). It already passes:

```ts
  it("typed values match typed stored values, not their text", () => {
    expect(matches(cond("active", "eq", true), row)).toBe(true);
    expect(matches(cond("count", "in", [12, 13]), row)).toBe(true);
    expect(matches(cond("count", "eq", "12"), row)).toBe(false);
  });
```

`tests/mock-server/server.test.ts`:
1. Replace `const matchAll = …` with:

```ts
/** Every event has an observation window, so this query matches them all. */
const everyEvent = {
  kind: "group",
  id: "g1",
  operator: "AND",
  children: [
    {
      kind: "condition",
      id: "c1",
      facetId: "observation_window",
      fieldId: "from_timestamp",
      operatorId: "isNotEmpty",
      value: null,
    },
  ],
};
```

   and make `body` default to it: `const body = (databases: string[], query: unknown = everyEvent) => …`.
2. Add these rows to the `it.each` table in `describe("POST /api/stats")`, after the "query that is an array" row:

```ts
    [
      "query whose root is a condition",
      body(["alpha"], everyEvent.children[0]),
      "Malformed query: query must be a group.",
    ],
    [
      "query that is an empty group",
      body(["alpha"], { ...everyEvent, children: [] }),
      "Malformed query: query.children must be a non-empty list.",
    ],
    [
      "condition without a field",
      body(["alpha"], { ...everyEvent, children: [{ ...everyEvent.children[0], fieldId: "" }] }),
      "Malformed query: query.children[0].fieldId must be a non-empty string.",
    ],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query/request.test.ts tests/mock-server tests/api/client.test.ts tests/app.test.ts`
Expected: FAIL (`src/query/request.ts` and `mock-server/requestBody.ts` don't exist, the client still takes `(query, databases)`, and the mock accepts malformed queries).

- [ ] **Step 3: Implement**

Append to `src/api/types.ts`:

```ts
// ---- the body of POST …/stats and POST …/query ------------------------------

/**
 * The query and where to run it — the body of POST {prefix}/stats and POST
 * {prefix}/query (docs/ARCHITECTURE.md, "Wire format of the query"). Built by
 * `toQueryRequest` (src/query/request.ts) from the query on screen.
 */
export interface QueryRequest {
  /** `DatabasesResponse.label` of each database to run against. Never empty. */
  databases: string[];
  /** The query. Its root is always a group. */
  query: RequestGroup;
}

export type RequestNode = RequestGroup | RequestCondition;

export interface RequestGroup {
  kind: "group";
  /** The frontend's id for this node: opaque, unique within the request.
   *  Reserved so a later error response can point at a node. */
  id: string;
  operator: "AND" | "OR";
  /** Never empty. */
  children: RequestNode[];
}

export interface RequestCondition {
  kind: "condition";
  id: string;
  /** `Facet.label`. */
  facetId: string;
  /** `FacetField.label`, within that facet. */
  fieldId: string;
  /** An operator label, e.g. "gt". */
  operatorId: string;
  /** Shaped by the operator's arity: `null` (none), one value (one),
   *  `[from, to]` (two) or a non-empty list (many). */
  value: RequestValue;
}

export type RequestScalar = string | number | boolean;
export type RequestValue = null | RequestScalar | RequestScalar[];
```

Create `src/query/request.ts`:

```ts
import type {
  QueryRequest,
  RequestCondition,
  RequestGroup,
  RequestNode,
  RequestScalar,
  RequestValue,
} from "../api/types";
import type { Condition, Group, QueryNode } from "./types";

/**
 * The body of POST …/stats and POST …/query, built from the query on screen
 * (docs/ARCHITECTURE.md, "Wire format of the query"). A projection, never a
 * rewrite: every operator and value goes out exactly as the user built it, and
 * the backend interprets them. Only display state (`collapsed`) is left out.
 *
 * Call it only for a query that can run (`runBlocker` in src/state.ts returns
 * null). An unfinished condition, or a value that isn't JSON scalars, throws:
 * that is a bug, not a user mistake.
 */
export function toQueryRequest(query: Group, databases: string[]): QueryRequest {
  return { databases: [...databases], query: groupOf(query) };
}

function nodeOf(node: QueryNode): RequestNode {
  return node.kind === "group" ? groupOf(node) : conditionOf(node);
}

function groupOf(g: Group): RequestGroup {
  return { kind: "group", id: g.id, operator: g.operator, children: g.children.map(nodeOf) };
}

function conditionOf(c: Condition): RequestCondition {
  if (c.facetId === null || c.fieldId === null || c.operatorId === null) {
    throw new Error(`Condition ${c.id} is unfinished and cannot be sent.`);
  }
  return {
    kind: "condition",
    id: c.id,
    facetId: c.facetId,
    fieldId: c.fieldId,
    operatorId: c.operatorId,
    value: valueOf(c),
  };
}

const isScalar = (v: unknown): v is RequestScalar =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function valueOf(c: Condition): RequestValue {
  const v = c.value;
  if (v === null || isScalar(v)) return v;
  if (Array.isArray(v) && v.every(isScalar)) return [...v];
  throw new Error(`Condition ${c.id} has a value that cannot be sent.`);
}
```

`src/api/client.ts`:
- Replace `import type { QueryNode } from "../query/types";` with nothing, and add `QueryRequest` to the `./types` import.
- `getStats`: signature `export function getStats(body: QueryRequest, onLine: (line: StatsResponse) => void, signal?: AbortSignal): Promise<void>`, and its `send` call uses `postJson(body, signal)`. In its doc comment, change "POST /api/stats streams" to "POST …/stats (body: a QueryRequest) streams".
- `runQuery`:

```ts
/** POST …/query: the events matching `body` (capped by the backend). */
export function runQuery(body: QueryRequest, signal?: AbortSignal): Promise<EventsResponse> {
  return request<EventsResponse>("/query", postJson(body, signal));
}
```

`src/app.ts`:
- Imports: add `import { toQueryRequest } from "./query/request";`, add `QueryRequest` to the `./api/types` type import, and remove `QueryNode` from the `./query/types` import if it is now unused.
- In `AppApi`:

```ts
  getStats(
    body: QueryRequest,
    onLine: (line: StatsResponse) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  runQuery(body: QueryRequest, signal?: AbortSignal): Promise<EventsResponse>;
```

- In `runPreview`, build the body before anything else changes, right after `if (runBlocker(state)) return;`:

```ts
    const body = toQueryRequest(state.query, state.selectedDatabaseIds);
```

  and change `.runQuery(state.query, state.selectedDatabaseIds, req.signal)` to `.runQuery(body, req.signal)`. The body is built before `previewSlot.start()` and before the loading state is set, so a throw can't leave the panel stuck on "loading".
- In `refreshStats`, likewise add `const body = toQueryRequest(state.query, state.selectedDatabaseIds);` right after its `runBlocker` check. In the `api.getStats(…)` call, replace the first two arguments (`state.query,` and `state.selectedDatabaseIds,`) with `body,`, and keep the line callback and `req.signal` exactly as they are.

Create `mock-server/requestBody.ts`:

```ts
// Checks a request body's query against the contract (QueryRequest in
// src/api/types.ts) before anything reads it. The body is untrusted JSON; this
// is also a working reference for the real backend's own check.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const isNonEmptyString = (v: unknown) => typeof v === "string" && v !== "";

/**
 * What is wrong with `node` as a RequestNode, or null if nothing is. `at` names
 * the node in the message, e.g. "query.children[1]". The first problem found wins.
 */
export function queryProblem(node: unknown, at = "query"): string | null {
  if (!isObject(node)) return `${at} must be an object.`;
  if (node.kind !== "group" && node.kind !== "condition") {
    return `${at}.kind must be "group" or "condition".`;
  }
  if (typeof node.id !== "string") return `${at}.id must be a string.`;
  if (node.kind === "group") {
    if (node.operator !== "AND" && node.operator !== "OR") {
      return `${at}.operator must be "AND" or "OR".`;
    }
    if (!Array.isArray(node.children) || node.children.length === 0) {
      return `${at}.children must be a non-empty list.`;
    }
    for (const [i, child] of node.children.entries()) {
      const problem = queryProblem(child, `${at}.children[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  for (const key of ["facetId", "fieldId", "operatorId"] as const) {
    if (!isNonEmptyString(node[key])) return `${at}.${key} must be a non-empty string.`;
  }
  const v = node.value;
  if (v === null || isScalar(v) || (Array.isArray(v) && v.every(isScalar))) return null;
  return `${at}.value must be null, a string, number or boolean, or a list of them.`;
}
```

`mock-server/evaluate.ts`:
- Delete the `JsonCondition`, `JsonGroup` and `JsonNode` declarations and their comment. Put this in their place:

```ts
// The query arrives as a QueryRequest (src/api/types.ts). server.ts checks its
// shape (requestBody.ts) before anything here reads it.
```

- Change the type import to `import type { RequestCondition, RequestNode, StatsResponse } from "../src/api/types";`.
- `dateMatches(c: RequestCondition, …)`, `conditionMatches(c: RequestCondition, row: Row)`, `perDatabaseCounts(query: RequestNode, …)`, `matches(node: RequestNode, row: Row)`.
- In `conditionMatches`, the ids are now always strings. Replace its first two lines with `const v = row[rowKey(c.facetId, c.fieldId)];`.

`mock-server/server.ts`:
- Remove `type JsonNode` from the `./evaluate` import. Add `import { queryProblem } from "./requestBody";` and `import type { QueryRequest } from "../src/api/types";`.
- Delete the `QueryBody` interface. `readQueryBody` returns `Promise<QueryRequest | null>`, and its doc comment becomes: "Reads and checks a …/stats or …/query body: `query` must be a well-formed query tree whose root is a group (requestBody.ts), and `databases` a non-empty string[]. For a bad body this sends the 400 itself and returns null."
- In `readQueryBody`, after the existing "Body must include a `query` tree." check, add:

```ts
  const problem =
    (query as { kind?: unknown }).kind === "group" ? queryProblem(query) : "query must be a group.";
  if (problem) {
    sendJson(res, 400, { error: `Malformed query: ${problem}` });
    return null;
  }
```

  and return `{ query: query as QueryRequest["query"], databases }`.

- [ ] **Step 4: Run the tests and gates**

```bash
npm test && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Update the docs** (`docs/ARCHITECTURE.md`)

- Replace the whole body of "### Wire format of the query" (keep the heading) with:

```markdown
Both `/stats` and `/query` take a `QueryRequest` (`src/api/types.ts`):
`{ databases, query }`. `databases` holds `DatabasesResponse.label`s, and
`query` is a tree of `RequestGroup`s (`AND`/`OR` over `children`, never empty)
and `RequestCondition`s (`facetId`, `fieldId`, `operatorId`, `value`). Every
node carries the frontend's `id` for it. The backend treats it as opaque; it is
reserved so a later error response can point at a condition.

`toQueryRequest` (`src/query/request.ts`) builds the body from the query on
screen. It is a projection, not a rewrite: operators and values go out exactly
as the user built them, and only display state (`collapsed`) is left out. The
UI's own `QueryNode` is never sent, so a change to the UI's model can't
change the API. `app.ts` calls it only once `runBlocker` says the query can
run, so it never meets an unfinished condition (it throws if it does).

`value` is shaped by the operator's arity:

| Arity (operators) | `value` |
|---|---|
| `none` (`isEmpty`, `isNotEmpty`) | `null` |
| `one` (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `before`, `after`, `contains`) | one value |
| `two` (`between`) | `[from, to]` |
| `many` (`in`) | a non-empty list |

The mock answers a body that isn't a well-formed `QueryRequest` with `400`
and a message naming the first problem (`mock-server/requestBody.ts`). The
real backend should do the same.
```

- §7 endpoint table: in the `/stats` and `/query` rows, replace `Body `{ query, databases }`.` with `Body: a `QueryRequest` ("Wire format of the query").`. Replace the sentence "Both query bodies must have a `query` object and a non-empty `databases` array, or the answer is `400`." with "A body that isn't a well-formed `QueryRequest` is answered with `400`."
- §4: add under the `query/` block, after `types.ts`: `request.ts         toQueryRequest(query, databases) — the body sent to /stats and /query.` In the mock list, change `databases.ts, rows.ts, evaluate.ts, vehicleData.ts` / `The 7 mock databases, the flattened rows, the query evaluator, the data loader.` to `databases.ts, rows.ts, evaluate.ts, requestBody.ts, vehicleData.ts` / `The 7 mock databases, the flattened rows, the query evaluator, the request-body check, the data loader.`
- §8 "The query model": add a bullet after the `tree.ts` bullet:

```markdown
- **`request.ts`** — `toQueryRequest`, the one place the tree becomes the
  request body ("Wire format of the query").
```

- §10: add after the **`/api/query`** bullet:

```markdown
- **Request bodies** are checked against `QueryRequest` before anything reads
  them (`requestBody.ts`, `queryProblem`): a malformed one gets a `400` naming
  the first problem, e.g. `Malformed query: query.children[0].fieldId must be a
  non-empty string.`
```

- [ ] **Step 6: Lint and commit**

```bash
npx prettier --write src/api src/query/request.ts src/app.ts mock-server tests/query/request.test.ts tests/api/client.test.ts tests/app.test.ts tests/mock-server
npm test && npm run typecheck && npm run lint
git add -A src tests mock-server docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Send a typed QueryRequest instead of the UI's own tree

New request types in src/api/types.ts, built by toQueryRequest: no nulls,
no display state, operators and values untouched. The mock checks request
bodies against the contract and answers 400 naming the first problem.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Declared value types, with free-entry pick-lists

**Files:**
- Modify: `src/query/fieldCatalog.ts`, `src/ui/valueControl.ts`, `src/ui/fomantic.ts`, `src/api/types.ts`, `mock-server/data/individual.json`, `docs/ARCHITECTURE.md`
- Test: `tests/query/fieldCatalog.test.ts`, `tests/ui/valueControl.test.ts`, `tests/query/summary.test.ts`, `tests/query/validate.test.ts`, `tests/mock-server/data.test.ts`

**Interfaces:**
- Consumes: `CatalogField.facetLabel` / `fieldLabel` (Task 2).
- Produces:
  - `ValueType = "string" | "number" | "boolean" | "date"` (no `"enum"`).
  - `isNumberText(text: string): boolean` and `pickListFor(valueType: ValueType, values: string[]): string[] | undefined` in `src/query/fieldCatalog.ts`.
  - `parseEntry(text: string, valueType: ValueType): string | number` in `src/ui/valueControl.ts`.
  - The `data-free-entry` attribute on a `<select>`: `valueControl.ts` sets it, and `fomantic.ts` activates such a dropdown with `allowAdditions`.

- [ ] **Step 1: Write the failing tests**

`tests/query/fieldCatalog.test.ts`:
1. Add `isNumberText` and `pickListFor` to the import.
2. In "assigns operatorIds per valueType, all of which are real operator labels", keep the loop that checks every label is real, and delete the two `expect(pick(…)?.operatorIds).toEqual([…])` blocks after it. The new tests below cover them.
3. Delete the two tests "a field with non-empty values becomes an enum field …" and "a field with empty values is never valueType enum …", and add in their place:

```ts
  /** The one field of a facet whose only field has this declared type and these values. */
  const only = (type: string, values: string[]) =>
    buildFieldCatalog([
      {
        ...facets[1]!,
        fields: [
          { label: "f", type, description: "", comment: "", cardinality: 500, values, format: "" },
        ],
      },
    ]).fields[0]!;

  it("offers operators by value type only", () => {
    expect(only("VARCHAR", []).operatorIds).toEqual([
      "eq",
      "neq",
      "contains",
      "in",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(only("BIGINT", []).operatorIds).toEqual([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "in",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(only("BOOLEAN", []).operatorIds).toEqual(["eq", "neq"]);
    expect(only("TIMESTAMP", []).operatorIds).toEqual([
      "eq",
      "neq",
      "before",
      "after",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  describe("values: a pick-list, never a type", () => {
    it("a string field suggests all its values and keeps its type and operators", () => {
      const f = only("VARCHAR", ["sedan", "van"]);
      expect(f.valueType).toBe("string");
      expect(f.options).toEqual(["sedan", "van"]);
      expect(f.operatorIds).toContain("contains");
    });

    it("a number field with values stays a number field", () => {
      const f = only("BIGINT", ["1", "2", "3"]);
      expect(f.valueType).toBe("number");
      expect(f.options).toEqual(["1", "2", "3"]);
      expect(f.operatorIds).toContain("gt");
    });

    it("a number field suggests only its numeric values, written the JavaScript way", () => {
      expect(only("DECIMAL(4,1)", ["3.0", "3", "N/A", "", "-1.5"]).options).toEqual(["3", "-1.5"]);
      expect(only("BIGINT", ["N/A"]).options).toBeUndefined();
    });

    it("boolean and date fields never get a pick-list", () => {
      const b = only("BOOLEAN", ["false", "true"]);
      expect(b.valueType).toBe("boolean");
      expect(b.options).toBeUndefined();
      const d = only("TIMESTAMP", ["2024-11-06T14:32:00Z"]);
      expect(d.valueType).toBe("date");
      expect(d.options).toBeUndefined();
    });

    it("no values, no pick-list — whatever the cardinality", () => {
      expect(only("VARCHAR", []).options).toBeUndefined();
    });

    it("pickListFor copies, never shares, the backend's list", () => {
      const values = ["a"];
      expect(pickListFor("string", values)).not.toBe(values);
    });
  });
```

4. Add at the end of the file:

```ts
describe("isNumberText", () => {
  it.each(["3", "-1.5", "1e3", " 7 "])("%j is a number", (t) => {
    expect(isNumberText(t)).toBe(true);
  });

  it.each(["", "  ", "3x", "N/A", "Infinity", "NaN"])("%j is not", (t) => {
    expect(isNumberText(t)).toBe(false);
  });
});
```

`tests/ui/valueControl.test.ts`: replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import type { CatalogField, CatalogOperator } from "../../src/query/fieldCatalog";
import { parseEntry, renderValueControl } from "../../src/ui/valueControl";

function field(overrides: Partial<CatalogField> = {}): CatalogField {
  return {
    facetLabel: "t",
    fieldLabel: "f",
    name: "F",
    fieldName: "F",
    valueType: "string",
    operatorIds: [],
    ...overrides,
  };
}

function op(arity: CatalogOperator["arity"], label = "o"): CatalogOperator {
  return { label, name: "O", arity };
}

const withPickList = field({ options: ["Apple", "Banana"] });
const FREE_ENTRY = "data-free-entry";

describe("renderValueControl", () => {
  it('arity "none" renders nothing', () => {
    expect(renderValueControl(field(), op("none"), null)).toBe("");
  });

  it('arity "one" + boolean renders a toggle checkbox', () => {
    const html = renderValueControl(field({ valueType: "boolean" }), op("one", "eq"), true);
    expect(html).toContain("ui toggle checkbox");
  });

  it("Equals on a field with a pick-list is a free-entry dropdown of its values", () => {
    const html = renderValueControl(withPickList, op("one", "eq"), "Apple");
    expect(html).toContain(FREE_ENTRY);
    expect(html).toContain('class="ui search selection dropdown"');
    expect(html).toContain('<option value="Apple" selected>Apple</option>');
    expect(html).toContain('<option value="Banana">Banana</option>');
  });

  it("Not equals gets the same dropdown", () => {
    expect(renderValueControl(withPickList, op("one", "neq"), "")).toContain(FREE_ENTRY);
  });

  it("a value that isn't on the pick-list gets its own selected option", () => {
    const html = renderValueControl(withPickList, op("one", "eq"), "Cherry");
    expect(html).toContain('<option value="Cherry" selected>Cherry</option>');
  });

  it("a number field's pick-list marks the current number as chosen", () => {
    const numbers = field({ valueType: "number", options: ["1", "2"] });
    const html = renderValueControl(numbers, op("one", "eq"), 2);
    expect(html).toContain('<option value="2" selected>2</option>');
  });

  it("other operators on a field with a pick-list get a plain input", () => {
    const text = renderValueControl(withPickList, op("one", "contains"), "App");
    expect(text).toContain('<input type="text"');
    expect(text).not.toContain(FREE_ENTRY);
    const numbers = field({ valueType: "number", options: ["1", "2"] });
    expect(renderValueControl(numbers, op("one", "gt"), 1)).toContain('<input type="number"');
  });

  it("Equals on a field without a pick-list is a plain input", () => {
    const html = renderValueControl(field(), op("one", "eq"), "x");
    expect(html).toContain('<input type="text"');
    expect(html).not.toContain(FREE_ENTRY);
  });

  it('arity "many" is a free-entry multiple dropdown, with a pick-list…', () => {
    const html = renderValueControl(withPickList, op("many", "in"), ["Apple"]);
    expect(html).toContain('class="ui multiple search selection dropdown"');
    expect(html).toContain(" multiple");
    expect(html).toContain(FREE_ENTRY);
    expect(html.match(/<option /g) ?? []).toHaveLength(2);
  });

  it("…or without one, showing the values entered so far", () => {
    const html = renderValueControl(field({ valueType: "number" }), op("many", "in"), [3, 7]);
    expect(html).toContain(FREE_ENTRY);
    expect(html).toContain('<option value="3" selected>3</option>');
    expect(html).toContain('<option value="7" selected>7</option>');
  });

  it('arity "two" renders from/to ranges', () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('data-range="from"');
    expect(html).toContain('data-range="to"');
  });

  it("uses classes, not inline styles, for the range layout", () => {
    const num = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(num).not.toContain("style=");
    expect(num).toContain('class="qb-range"');
    expect(num).toContain('class="qb-range-to"');
  });
});

describe("renderValueControl accessible names", () => {
  it("labels single inputs, dropdowns and toggles as the value", () => {
    for (const html of [
      renderValueControl(field(), op("one", "eq"), "x"),
      renderValueControl(withPickList, op("one", "eq"), "Apple"),
      renderValueControl(withPickList, op("many", "in"), []),
      renderValueControl(field({ valueType: "boolean" }), op("one", "eq"), false),
    ]) {
      expect(html).toContain('aria-label="Value"');
    }
  });

  it("labels the two ends of a range", () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('aria-label="From"');
    expect(html).toContain('aria-label="To"');
  });

  it("a date field gets a text box for a (partial) UTC timestamp, not a date picker", () => {
    const html = renderValueControl(field({ valueType: "date" }), op("one", "eq"), "2024-11");
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="date"');
    expect(html).toContain('placeholder="YYYY-MM-DDTHH:mm:ssZ"');
    expect(html).toContain('value="2024-11"');
  });
});

describe("parseEntry", () => {
  it("turns a number field's numeric entry into a number", () => {
    expect(parseEntry("3", "number")).toBe(3);
    expect(parseEntry("-1.5", "number")).toBe(-1.5);
  });

  it("keeps any other entry as the text entered, for validation to report", () => {
    expect(parseEntry("3x", "number")).toBe("3x");
    expect(parseEntry("", "number")).toBe("");
    expect(parseEntry("3", "string")).toBe("3");
    expect(parseEntry("2024-11", "date")).toBe("2024-11");
  });
});
```

`tests/query/summary.test.ts`: in the `field` helper, `valueType: options ? "enum" : "string",` becomes `valueType: "string",`.

`tests/query/validate.test.ts`: in the catalog, `field("color", "enum", …)` becomes `field("color", "string", …)`.

`tests/mock-server/data.test.ts`: add to `describe("individual.json sample data", …)`:

```ts
  it("transmission_gear.current_gear's values are deliberately out of date: an event holds a gear not in them", () => {
    const gear = individualsByLabel
      .get("transmission_gear")!
      .fields.find((f) => f.label === "current_gear")!;
    expect(gear.type).toBe("BIGINT");
    expect(gear.values.length).toBeGreaterThan(0);
    const used = entrysets
      .map((e) => e.items.transmission_gear?.current_gear)
      .filter((v) => v !== undefined)
      .map(String);
    expect(used.some((v) => !gear.values.includes(v))).toBe(true);
  });

  it("transmission_gear.is_in_manual_mode is a BOOLEAN field that lists its values", () => {
    const manual = individualsByLabel
      .get("transmission_gear")!
      .fields.find((f) => f.label === "is_in_manual_mode")!;
    expect(manual.type).toBe("BOOLEAN");
    expect(manual.values).toEqual(["false", "true"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query tests/ui/valueControl.test.ts tests/mock-server/data.test.ts`
Expected: FAIL (`pickListFor`, `isNumberText` and `parseEntry` don't exist, a field with values is still an `enum`, and the mock data has no values on `transmission_gear`).

- [ ] **Step 3: Implement**

`src/query/fieldCatalog.ts`:
- `export type ValueType = "string" | "number" | "boolean" | "date";`
- In `CatalogField`, replace the `options` member's comment and type with:

```ts
  /** Known values to suggest, from the backend's `values` (see `pickListFor`).
   *  Only string and number fields have one. Suggestions only: the list can be
   *  out of date, so the user may always enter another value. */
  options?: string[];
```

- Replace `OPERATOR_PROFILE` with:

```ts
/**
 * Which operators apply to a field, keyed only by its valueType — never by
 * which specific field it is, nor by whether it has a pick-list.
 */
const OPERATOR_PROFILE: Record<ValueType, string[]> = {
  string: ["eq", "neq", "contains", "in", "isEmpty", "isNotEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "isEmpty", "isNotEmpty"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "before", "after", "between", "isEmpty", "isNotEmpty"],
};
```

- Add after `valueTypeFor`:

```ts
/** Whether `text` is a number as entered: not blank, and finite. */
export function isNumberText(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

/**
 * The pick-list for a field of `valueType`, from the backend's `values`: every
 * value for a string field; for a number field, the values that are numbers,
 * written the way JavaScript writes them ("3.0" → "3") and without repeats.
 * None for boolean and date fields — a toggle and a typed (partial) timestamp
 * serve those better — nor when no value is left.
 *
 * `values` is a static list built ahead of time and can be out of date, so it
 * only ever suggests: it never decides a field's type or which values are allowed.
 */
export function pickListFor(valueType: ValueType, values: string[]): string[] | undefined {
  const list =
    valueType === "string"
      ? [...values]
      : valueType === "number"
        ? [...new Set(values.filter(isNumberText).map((v) => String(Number(v))))]
        : [];
  return list.length > 0 ? list : undefined;
}
```

- In `buildFieldCatalog`, replace the `isEnum` / `valueType` lines and the `options:` / `operatorIds:` properties so the loop body reads:

```ts
      const valueType = valueTypeFor(f);
      const fieldName = fieldDisplayName(f);
      fields.push({
        facetLabel: facet.label,
        fieldLabel: f.label,
        name: `${facet.name}: ${fieldName}`,
        fieldName,
        valueType,
        options: pickListFor(valueType, f.values),
        operatorIds: OPERATOR_PROFILE[valueType],
      });
```

  In its doc comment, replace the paragraph starting "Enum detection is `values.length > 0` …" with: "A field's type always comes from its declared `type`/`format`; its `values` only feed the pick-list (`pickListFor`). `cardinality` decides nothing — when the backend fills `values` is its own implementation detail."

`src/ui/valueControl.ts`: replace the whole file with:

```ts
import { isNumberText, type CatalogField, type CatalogOperator, type ValueType } from "../query/fieldCatalog";
import { UTC_TIMESTAMP_HINT } from "../query/dates";
import { escapeHtml, optionsHtml } from "./panel";

/**
 * The value control(s) for a condition row, chosen by the operator × the
 * field's valueType. Only the combinations OPERATOR_PROFILE can produce are
 * handled (fieldCatalog.ts): `many` ("Is any of") exists only for strings and
 * numbers, and `two` ("Between") only for numbers and dates.
 */

/** Operators that compare with one exact value, where suggesting a field's
 *  known values helps. The rest (gt, contains, …) take a plain input. */
const PICK_OPERATORS = new Set(["eq", "neq"]);

/** The value(s) a control currently holds, as the strings its <option>s use. */
function chosenValues(current: unknown, multiple: boolean): string[] {
  if (multiple) return Array.isArray(current) ? current.map(String) : [];
  return current === null || current === undefined || current === "" ? [] : [String(current)];
}

/**
 * A free-entry dropdown: it lists the field's pick-list, if any, and accepts
 * any typed value too (`data-free-entry`, activated with allowAdditions in
 * fomantic.ts), because the pick-list is a static list that can be out of
 * date. A current value that isn't on the list gets its own selected option,
 * so it survives a repaint.
 */
function freeEntryDropdown(field: CatalogField, current: unknown, multiple: boolean): string {
  const chosen = chosenValues(current, multiple);
  const known = field.options ?? [];
  const opts = optionsHtml(
    [...known, ...chosen.filter((v) => !known.includes(v))],
    (o) => o,
    (o) => o,
    (o) => chosen.includes(o),
  );
  return `<select class="ui ${multiple ? "multiple " : ""}search selection dropdown" data-part="value" data-free-entry aria-label="Value"${
    multiple ? " multiple" : ""
  }>
    ${multiple ? "" : `<option value="">Choose or type…</option>`}${opts}
  </select>`;
}

/** A date is typed, not picked: a full or partial ISO UTC timestamp
 *  ("2024", "2024-11-06", "2024-11-06T14:30Z"; see src/query/dates.ts). */
const DATE_ATTRS = `placeholder="${UTC_TIMESTAMP_HINT}" spellcheck="false" autocomplete="off"`;

function scalarInput(field: CatalogField, current: unknown, attrs: string): string {
  const type = field.valueType === "number" ? "number" : "text";
  const extra = field.valueType === "date" ? ` ${DATE_ATTRS}` : "";
  return `<div class="ui input"><input type="${type}" data-part="value" ${attrs}${extra} value="${escapeHtml(current ?? "")}" /></div>`;
}

export function renderValueControl(
  field: CatalogField | undefined,
  operator: CatalogOperator | undefined,
  value: unknown,
): string {
  if (!field || !operator || operator.arity === "none") return "";
  if (operator.arity === "many") return freeEntryDropdown(field, value, true);
  if (operator.arity === "two") {
    const [from, to] = Array.isArray(value) ? value : ["", ""];
    return `<div class="qb-range">${scalarInput(field, from, 'data-range="from" aria-label="From"')}<span class="qb-range-to">to</span>${scalarInput(field, to, 'data-range="to" aria-label="To"')}</div>`;
  }
  // arity "one"
  if (field.valueType === "boolean") {
    return `<div class="ui toggle checkbox" data-part="value">
      <input type="checkbox" aria-label="Value"${value === true ? " checked" : ""} /><label>true</label>
    </div>`;
  }
  if (field.options && PICK_OPERATORS.has(operator.label)) {
    return freeEntryDropdown(field, value, false);
  }
  return scalarInput(field, value, 'aria-label="Value"');
}

/**
 * A picked or typed entry as the field's type: a number field's entry that is
 * a number becomes a `number` ("3" → 3). Anything else stays the text entered,
 * so validation can point at it instead of the value vanishing.
 */
export function parseEntry(text: string, valueType: ValueType): string | number {
  return valueType === "number" && isNumberText(text) ? Number(text) : text;
}

/** Reads back what `renderValueControl` rendered inside `row`. */
export function readValueControl(
  row: HTMLElement,
  arity: CatalogOperator["arity"],
  valueType: CatalogField["valueType"],
): unknown {
  if (arity === "none") return null;
  if (arity === "two") {
    return [
      readInput(row.querySelector<HTMLInputElement>('input[data-range="from"]'), valueType),
      readInput(row.querySelector<HTMLInputElement>('input[data-range="to"]'), valueType),
    ];
  }
  if (arity === "many") {
    const sel = row.querySelector<HTMLSelectElement>('select[data-part="value"]');
    return sel ? Array.from(sel.selectedOptions).map((o) => parseEntry(o.value, valueType)) : [];
  }
  const control = row.querySelector<HTMLElement>('[data-part="value"]');
  if (!control) return null;
  if (control instanceof HTMLSelectElement) return parseEntry(control.value, valueType);
  if (control instanceof HTMLInputElement) return readInput(control, valueType);
  // The boolean toggle: a .ui.checkbox wrapper around the real checkbox.
  return control.querySelector<HTMLInputElement>("input")?.checked ?? false;
}

function readInput(el: HTMLInputElement | null, valueType: CatalogField["valueType"]): unknown {
  return el ? parseEntry(el.value, valueType) : null;
}
```

`src/ui/fomantic.ts`: replace `activate` with:

```ts
/** Settings for every dropdown. A free-entry one (`data-free-entry`, set by
 *  valueControl.ts) also accepts values that aren't among its options, and
 *  shows an "Add" hint while the user types one. */
const DROPDOWN = { fullTextSearch: true };
const FREE_ENTRY_DROPDOWN = { ...DROPDOWN, allowAdditions: true, hideAdditions: false };

export function activate(container: HTMLElement): void {
  $(container)
    .find(".ui.dropdown")
    .each((_i, node) => {
      $(node).dropdown(node.hasAttribute("data-free-entry") ? FREE_ENTRY_DROPDOWN : DROPDOWN);
    });
  $(container).find(".ui.checkbox").checkbox();
}
```

`src/api/types.ts`, in `FacetField`:
- `cardinality` comment: replace "Informational only — NEVER branch on this to decide whether a field is enum-like; check `values.length` instead." with "Informational only — the frontend never branches on it."
- `values` comment:

```ts
  /** The field's known distinct values, when the backend chooses to supply
   *  them; empty otherwise. A static list built ahead of time, so it can be
   *  out of date: the frontend only suggests these (a pick-list), always lets
   *  the user enter other values, and never takes the field's type from them. */
  values: string[];
```

`mock-server/data/individual.json`, in the `transmission_gear` facet: for `current_gear`, change `"cardinality": 50000000,` to `"cardinality": 12,` and `"values": [],` to `"values": ["-1", "0", "1", "2", "3", "4", "5", "6"],`. For `is_in_manual_mode`, change `"values": [],` to `"values": ["false", "true"],`. (Use an exact-string edit on those lines; don't reformat the file.)

- [ ] **Step 4: Run the tests and gates**

```bash
npm test && npm run typecheck
grep -rn '"enum"' src tests mock-server
```

Expected: tests PASS, typecheck clean, and the grep prints nothing.

- [ ] **Step 5: Update the docs** (`docs/ARCHITECTURE.md`)

- "The field catalog": replace the sentence ``which ones a field offers depends only on its value type (`OPERATOR_PROFILE`).`` with ``which ones a field offers depends only on its value type (`OPERATOR_PROFILE`):`` followed by this table:

```markdown
| Value type | Operators |
|---|---|
| string | `eq`, `neq`, `contains`, `in`, `isEmpty`, `isNotEmpty` |
| number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `isEmpty`, `isNotEmpty` |
| boolean | `eq`, `neq` |
| date | `eq`, `neq`, `before`, `after`, `between`, `isEmpty`, `isNotEmpty` |
```

  Then replace the bullet starting ``**A field is an enum when `values.length > 0` — never by `cardinality`.**`` with:

```markdown
- **`values` is a pick-list, never a type.** `FacetField.values` is a static
  list built ahead of time and can be out of date, so `pickListFor` turns it
  into suggestions (`CatalogField.options`) and nothing more: every value for a
  string field, the numeric ones for a number field (`"3.0"` → `"3"`), none for
  boolean and date fields. The user may always enter a value that isn't on the
  list. `cardinality` is informational; the frontend never branches on it.
```

- "Wire format of the query": after the arity table, add:

```markdown
Each value has the field's type (the value control converts what the user
picks or types, `parseEntry`):

| Field type | Each value is |
|---|---|
| string | a JSON string |
| number | a JSON number |
| boolean | `true` or `false` |
| date | a partial ISO 8601 UTC string ("Dates") |
```

- "Centre": replace the sentence starting ``then the value control from `valueControl.ts`:`` and ending ``or a multi-select (enums).`` with:

```markdown
then the value control from `valueControl.ts`: nothing; for **Equals** /
**Not equals** on a field with a pick-list, a free-entry dropdown (its known
values, plus anything typed); otherwise one input, a boolean toggle or a
timestamp text box; a from–to pair (numbers and dates); or, for **Is any
of**, a free-entry multi-select. Free-entry dropdowns are Fomantic `search`
dropdowns with `allowAdditions` (`data-free-entry`, activated in
`fomantic.ts`). A picked or typed entry becomes the field's type
(`parseEntry`: `"3"` → `3` on a number field; anything else stays as typed,
for validation to report).
```

- §4: the `fieldCatalog.ts` line becomes `buildFieldCatalog(facets), OPERATORS, OPERATOR_PROFILE, TYPE_NAMES, pickListFor, findField / fieldsOfFacet / findOperator, fieldDisplayName.`, and the `valueControl.ts` line becomes `The value input(s) of a condition row, by operator × field valueType; parseEntry.`

- [ ] **Step 6: Lint and commit**

```bash
npx prettier --write src/query/fieldCatalog.ts src/ui/valueControl.ts src/ui/fomantic.ts src/api/types.ts mock-server/data/individual.json tests/query tests/ui/valueControl.test.ts tests/mock-server/data.test.ts
git diff --stat mock-server/data/individual.json
npm test && npm run typecheck && npm run lint
git add -A src tests mock-server docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Keep a field's declared type; offer its values as a free-entry pick-list

A field with values no longer becomes an "enum": numbers and booleans are
sent as numbers and booleans and keep their operators. The values are
suggestions in a dropdown that also accepts typed values, since the list can
be out of date. "Is any of" is offered on every string and number field.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git diff --stat` on the JSON should show only the three changed lines. If prettier reformatted the file, restore it with `git checkout mock-server/data/individual.json`, redo the three edits by hand, and leave prettier off it.)

---

### Task 5: Type-check values in `validate.ts`

**Files:**
- Modify: `src/query/validate.ts`, `docs/ARCHITECTURE.md`
- Test: `tests/query/validate.test.ts`

**Interfaces:**
- Consumes: `findField(catalog, facetId, fieldId)` (Task 2); `ValueType` without `enum` (Task 4).
- Produces: nothing new. `validateQuery(tree, catalog): Issue[]` keeps its signature and reports new `invalid` issues.

- [ ] **Step 1: Write the failing tests**

In `tests/query/validate.test.ts`:
1. Replace the `field` helper and catalog with:

```ts
const field = (
  fieldLabel: string,
  valueType: CatalogField["valueType"],
  operatorIds: string[],
  options?: string[],
): CatalogField => ({
  facetLabel: "thing",
  fieldLabel,
  name: fieldLabel,
  fieldName: fieldLabel,
  valueType,
  options,
  operatorIds,
});
const catalog: FieldCatalog = {
  fields: [
    field("color", "string", ["eq", "in", "isEmpty"], ["red", "blue"]),
    field("count", "number", ["eq", "between", "in", "isEmpty"]),
    field("seenAt", "date", ["eq", "between"]),
    field("active", "boolean", ["eq"]),
  ],
};
```

2. Add at the end of the outer `describe("validateQuery", …)`:

```ts
  describe("value types", () => {
    it.each([
      ["a number field holding text", { fieldId: "count", operatorId: "eq", value: "12abc" }, "Enter a number."],
      ["a number field holding a list", { fieldId: "count", operatorId: "eq", value: [3] }, "Enter a number."],
      ["a number range holding text", { fieldId: "count", operatorId: "between", value: [1, "x"] }, "Enter a number."],
      ["a number list holding text", { fieldId: "count", operatorId: "in", value: [1, "x"] }, "Enter a number."],
      ["a boolean field holding text", { fieldId: "active", operatorId: "eq", value: "true" }, "Choose true or false."],
      ["a string field holding a number", { fieldId: "color", operatorId: "eq", value: 3 }, "Enter text."],
      ["a string list holding a number", { fieldId: "color", operatorId: "in", value: ["red", 3] }, "Enter text."],
    ])("%s is invalid", (_label, patch, message) => {
      expectIssue(patch, message, "invalid");
    });

    it("accepts values of the field's type", () => {
      for (const patch of [
        { fieldId: "count", operatorId: "eq", value: 12 },
        { fieldId: "count", operatorId: "in", value: [1, 2] },
        { fieldId: "active", operatorId: "eq", value: false },
        { fieldId: "color", operatorId: "eq", value: "red" },
      ]) {
        expect(validateOne(patch).issues).toEqual([]);
      }
    });

    it("accepts a value that isn't on the pick-list — the list may be out of date", () => {
      expect(validateOne({ fieldId: "color", operatorId: "eq", value: "violet" }).issues).toEqual([]);
      const list = { fieldId: "color", operatorId: "in", value: ["red", "violet"] };
      expect(validateOne(list).issues).toEqual([]);
    });
  });

  describe("ranges", () => {
    it("a number range may not run backwards", () => {
      const patch = { fieldId: "count", operatorId: "between", value: [10, 5] };
      expectIssue(patch, "From must not be greater than To.", "invalid");
    });

    it("a number range may start and end on the same value", () => {
      expect(validateOne({ fieldId: "count", operatorId: "between", value: [5, 5] }).issues).toEqual([]);
    });

    it("a date range's order is left to the backend", () => {
      const patch = { fieldId: "seenAt", operatorId: "between", value: ["2025", "2024"] };
      expect(validateOne(patch).issues).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/query/validate.test.ts`
Expected: FAIL on the new "is invalid" cases and "a number range may not run backwards". The accepting cases already pass.

- [ ] **Step 3: Implement**

Replace `src/query/validate.ts` with:

```ts
import type { Condition, Issue, QueryNode } from "./types";
import { findField, findOperator, type Arity, type FieldCatalog, type ValueType } from "./fieldCatalog";
import { isUtcTimestamp } from "./dates";

function isEmptyScalar(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function incomplete(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "incomplete" };
}

function invalid(nodeId: string, message: string): Issue {
  return { nodeId, message, kind: "invalid" };
}

/** What the user still has to fill in for the operator's arity, or null. */
function shapeProblem(arity: Arity, v: unknown): string | null {
  switch (arity) {
    case "none":
      return null;
    case "one":
      return isEmptyScalar(v) ? "Enter a value." : null;
    case "two":
      return Array.isArray(v) && v.length === 2 && !v.some(isEmptyScalar)
        ? null
        : "Enter both values.";
    case "many":
      return Array.isArray(v) && v.length > 0 ? null : "Choose at least one value.";
  }
}

/**
 * Why a single value isn't of the field's type, or null. Values off a field's
 * pick-list are fine: the list can be out of date.
 */
function typeProblem(valueType: ValueType, v: unknown): string | null {
  switch (valueType) {
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "Enter a number.";
    case "boolean":
      return typeof v === "boolean" ? null : "Choose true or false.";
    case "string":
      return typeof v === "string" ? null : "Enter text.";
    case "date":
      return isUtcTimestamp(v)
        ? null
        : "Enter a UTC time such as 2024, 2024-11-06 or 2024-11-06T14:30Z.";
  }
}

function checkCondition(c: Condition, catalog: FieldCatalog, out: Issue[]): void {
  if (!c.facetId || !c.fieldId) {
    out.push(incomplete(c.id, "Choose a field."));
    return;
  }
  const fieldDef = findField(catalog, c.facetId, c.fieldId);
  if (!fieldDef) {
    out.push(invalid(c.id, "Unknown field."));
    return;
  }
  if (!c.operatorId) {
    out.push(incomplete(c.id, "Choose an operator."));
    return;
  }
  const op = findOperator(c.operatorId);
  if (!op) {
    out.push(invalid(c.id, "Unknown operator."));
    return;
  }
  if (!fieldDef.operatorIds.includes(c.operatorId)) {
    out.push(invalid(c.id, "That operator isn't available for this field."));
    return;
  }
  const shape = shapeProblem(op.arity, c.value);
  if (shape) {
    out.push(incomplete(c.id, shape));
    return;
  }
  // Each single value: the value itself, each end of a range, each list item.
  const values = op.arity === "none" ? [] : op.arity === "one" ? [c.value] : (c.value as unknown[]);
  const wrongType = values.map((v) => typeProblem(fieldDef.valueType, v)).find(Boolean);
  if (wrongType) {
    out.push(invalid(c.id, wrongType));
    return;
  }
  // A backwards number range matches nothing. A date range's order is the
  // backend's call: with partial timestamps, "in order" is its interpretation.
  if (op.arity === "two" && fieldDef.valueType === "number") {
    const [from, to] = c.value as [number, number];
    if (from > to) out.push(invalid(c.id, "From must not be greater than To."));
  }
}

function walk(node: QueryNode, isRoot: boolean, catalog: FieldCatalog, out: Issue[]): void {
  if (node.kind === "condition") {
    checkCondition(node, catalog, out);
    return;
  }
  if (!isRoot && node.children.length === 0) {
    out.push(incomplete(node.id, "Add a condition to this group."));
  }
  for (const child of node.children) walk(child, false, catalog, out);
}

export function validateQuery(tree: QueryNode, catalog: FieldCatalog): Issue[] {
  const out: Issue[] = [];
  walk(tree, true, catalog, out);
  return out;
}
```

- [ ] **Step 4: Run the tests and gates**

```bash
npm test && npm run typecheck
```

Expected: PASS, including the existing date tests ("rejects anything else" still reports the date message as `invalid`, and "an empty value is still just incomplete" still reports "Enter a value.").

- [ ] **Step 5: Update the docs** (`docs/ARCHITECTURE.md`)

In §8, replace the `validate.ts` bullet with:

```markdown
- **`validate.ts`** — `validateQuery` returns an `Issue` per problem:
  `incomplete` (not filled in yet, shown as a quiet grey hint) or `invalid`
  (can't work, shown in red). Besides a field, an operator and a value of the
  right shape, it checks every value against the field's type (a number,
  `true`/`false`, text, a partial UTC timestamp) and that a number range
  doesn't run backwards. A value that isn't on the field's pick-list is fine.
  These checks also cover a query restored after a redirect. **Any issue
  blocks running.**
```

- [ ] **Step 6: Lint and commit**

```bash
npx prettier --write src/query/validate.ts tests/query/validate.test.ts
npm test && npm run typecheck && npm run lint
git add src/query/validate.ts tests/query/validate.test.ts docs/ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
Check each value against its field's type before running

Numbers, booleans and text are type-checked like dates already were, and
a backwards number range is invalid. This also covers a query restored
after the login or compliance redirect.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: End-to-end check

**Files:** none changed, unless a check fails.

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: all pass. `npm run build` ends with the offline check passing.

- [ ] **Step 2: Drive the mock over HTTP**

Start the mock without random failures or delays, on a spare port, in the background:

```bash
MOCK_PORT=3099 MOCK_FAIL_RATE=0 MOCK_STREAM_DELAY_MS=0 npx tsx mock-server/index.ts
```

Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:3099/api/databases
curl -s -o /dev/null -w "%{http_code}\n" localhost:3099/api/v1/databases
curl -s -X POST localhost:3099/api/v1/stats -H 'content-type: application/json' \
  -d '{"databases":["alpha"],"query":{"kind":"group","id":"g","operator":"AND","children":[{"kind":"condition","id":"c","facetId":"transmission_gear","fieldId":"current_gear","operatorId":"in","value":[3,10]}]}}'
curl -s -X POST localhost:3099/api/v1/stats -H 'content-type: application/json' \
  -d '{"databases":["alpha"],"query":{"kind":"group","id":"g","operator":"AND","children":[]}}'
```

Expected, in order: `404`; `200`; one NDJSON line `{"label":"alpha","success":true,"matchCount":…}` (a number, the typed values 3 and 10 matched as numbers); `{"error":"Malformed query: query.children must be a non-empty list."}`. Stop the mock afterwards.

- [ ] **Step 3: Report**

Report the results of Steps 1–2. The free-entry dropdown needs a look in a browser, which the tests can't give (they run without a DOM). Tell the user to run `npm run dev` and check these on `http://localhost:5173`:
- Transmission gear → current gear → Equals lists −1…6, and typing `10` offers "Add 10". After picking it, the row keeps it, and the statistics count events with gear 10.
- Is in manual mode → Equals shows the true/false toggle, not a dropdown.
- Vehicle identity → vehicle type → Contains shows a text box.
- Typing `abc` into a number field's Equals dropdown shows "Enter a number." in red.
