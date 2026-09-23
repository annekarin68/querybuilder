# Query Builder (frontend)

A single-page query-builder UI. Build a filter with nested AND/OR groups; see live
match statistics; browse a summary list of matching events. Running a query
requires login (OAuth2, via the backend) and a compliance reason for the session.

All data comes from our API, under `VITE_API_BASE` (default `/api`): the facets
of the data model (`GET /individuals` — the backend's name for them), the
databases a query can be scoped to (`GET /databases`), live statistics
(`POST /stats`), the matching events (`POST /query`), and the login and
compliance flows (`/auth/*`, `/compliance/*`). The full contract is in
`docs/ARCHITECTURE.md` ("API contract"). A dev-only mock server implements all of it so the app
runs end to end locally, on fictional vehicle-telemetry sample data.

## Run it

Needs **Node 20.19 or newer**.

```bash
npm ci
npm run dev        # mock API on :3001, app on http://localhost:5173
```

In the mock, **Log in** signs you in as `demo.user`, and any non-blank reason
passes the compliance check. To run a second copy side by side (another
checkout), pick other ports: `MOCK_PORT=3011 npx concurrently -k "npm:mock" "vite --port 5181"`.

By default the mock streams statistics with a random 150–400 ms pause per
database and fails about 5% of them on purpose, to show the loading and
failure states. For reproducible behaviour (debugging, screenshots) turn both
off: `MOCK_FAIL_RATE=0 MOCK_STREAM_DELAY_MS=0 npm run dev`.

Other scripts:

| Script | What |
|---|---|
| `npm run build` | Type-check, bundle to `dist/`, then fail if any off-origin URL leaked in. |
| `npm run preview` | Serve the built `dist/`. |
| `npm run test` | Vitest unit tests, no DOM: the app's behaviour (`src/app.ts`, with a fake API), the query model, the API client, the store, utilities, the pure view helpers, the mock server (over real HTTP), the lint airlocks and the `noBackendDataInSrc` guard. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint + Prettier check. |
| `npm run check:offline` | Scan `dist/` for off-origin `http(s)` URLs. |

## Must-know rules for maintainers

1. **Offline only.** The app must run on the LAN with no internet. Never add a CDN
   link, web font, analytics snippet, or any `fetch`/`<script>` to a non-`/api`
   host. `npm run check:offline` is the backstop and runs inside `npm run build`.
2. **jQuery airlock.** `import $ from "jquery"` appears in only two files:
   `src/ui/fomantic.ts` (all real jQuery use — the Fomantic plugin activate/destroy
   airlock) and `src/setup-jquery.ts`, which does nothing but the
   `window.jQuery = window.$ = $` bootstrap that Fomantic's JS requires (it must
   stay the first import of `src/main.ts`). To make
   new markup interactive, add its selector to `activate()` and `destroy()` in
   `src/ui/fomantic.ts`. ESLint blocks `jquery` imports anywhere else.
3. **Update a panel by building an HTML string and calling `paint()`** — don't
   hand-mutate a panel's DOM. `paint()` tears down old Fomantic plugins first.
   The only exceptions are the data dictionary's search filter (a repaint
   would lose the input's focus) and the page frame in `src/ui/layout.ts`.
4. **One state object.** `src/state.ts`. Change it with `store.setState({...})`;
   each panel re-renders when a key it lists in `panelRenderers` (`src/main.ts`)
   changes.
5. **Stats & preview always match the on-screen query.** Editing the query or the
   database selection clears both immediately and cancels their requests; a
   response is only used while its request is still current (`src/app.ts`,
   `src/util/requestSlot.ts`). What the app does lives in `src/app.ts` and is
   tested in `tests/app.test.ts`; `src/main.ts` only wires it to the page.
6. **The frontend never names backend data.** Facets, fields, tags and groups are
   learned at runtime; the only place to name them is `src/config.ts`.
7. The full design lives in `docs/ARCHITECTURE.md`. Keep it updated with any
   architectural change.

## Layout of the code

See `docs/ARCHITECTURE.md`, "Directory layout". Its last section, "How do I…",
has checklists for the most common changes (a new operator, a new API
endpoint, a new panel, …).

CI (`.github/workflows/ci.yml`) runs typecheck, tests, lint and build on every
pull request and push to `main`.

## Deploying `dist/`

`npm run build` produces a self-contained static site. When serving it:

- **Serve it at the root of its host** (`https://host/`). Asset URLs are absolute
  (`/assets/...`), and the backend's login/compliance callbacks redirect the
  browser to `/?resume=1`. To host under a sub-path, build with
  `vite build --base=/sub/path/` and make the backend redirect there too.
- **API location.** Every request goes to `VITE_API_BASE` (default `/api`, same
  origin). The login and compliance links follow it too. It is fixed at build
  time: `VITE_API_BASE=/other npm run build`.
- **Caching.** Files under `assets/` have content-hashed names, so they can be
  cached forever (`Cache-Control: public, max-age=31536000, immutable`). Serve
  `index.html` with `Cache-Control: no-cache` so a new deploy takes effect
  immediately.
- **Content-Security-Policy.** The app needs no inline scripts and no
  off-origin hosts. Fomantic uses inline `style` attributes, so a workable
  policy is `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:`
  (Fomantic's CSS embeds a few small icon fonts and images as `data:` URIs).
- **Licence notice.** `dist/THIRD-PARTY-NOTICES.txt` is emitted by the build.
  Deploy it along with the rest of `dist/`.

## Licenses

Third-party license texts for every bundled dependency are in
`THIRD-PARTY-NOTICES.txt` at the repo root. The JS minifier does not preserve
vendor licence banners in the bundle, so the build copies that file into
`dist/` automatically (see `emitLicenseNotices` in `vite.config.ts`). It is the
licence notice for the bundled jQuery / Fomantic-UI / Lato code.
