# Query Builder (frontend)

A single-page query-builder UI. Build a filter with nested AND/OR groups; see live
match statistics; browse a summary list of matching entrysets. All data comes from our
API (`/api/schema`, `/api/databases`, `/api/stats`, `/api/query`). A dev-only mock
server implements those endpoints so the app runs end to end locally. The query
can be scoped to one or more "databases" (7 arbitrary, content-agnostic partitions
of the sample vehicle-telemetry data, ALPHA through ETA).

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
| `npm run test` | Vitest tests: pure-logic modules (query model, validation, summary, API client, store, debounce, the mock catalog + evaluator) plus one view smoke test (`renderValueControl`). No DOM/component tests by design. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint + Prettier check. |
| `npm run check:offline` | Scan `dist/` for off-origin `http(s)` URLs. |

## Must-know rules for maintainers

1. **Offline only.** The app must run on the LAN with no internet. Never add a CDN
   link, web font, analytics snippet, or any `fetch`/`<script>` to a non-`/api`
   host. `npm run check:offline` is the backstop and runs inside `npm run build`.
2. **jQuery airlock.** `import $ from "jquery"` appears in only two files:
   `src/ui/fomantic.ts` (all real jQuery use — the Fomantic plugin activate/destroy
   airlock) and the top of `src/main.ts`, which does nothing but the sanctioned
   `window.jQuery = window.$ = $` bootstrap that Fomantic's JS requires. To make
   new markup interactive, add its selector to `activate()` and `destroy()` in
   `src/ui/fomantic.ts`. ESLint blocks `jquery` imports anywhere else.
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
