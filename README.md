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

## Licenses

Third-party license texts for every bundled dependency are in
`THIRD-PARTY-NOTICES.txt` at the repo root.
