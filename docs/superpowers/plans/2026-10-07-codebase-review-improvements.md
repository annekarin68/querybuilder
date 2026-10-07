# Codebase review improvements — implementation plan

**Spec:** none. The authority is `CLAUDE.md` and `docs/ARCHITECTURE.md`. Provisional rulings apply (see below).

**Source of findings:** four read-only reviews, one file each in
`/tmp/claude-1000/-home-annek-repos-query-builder--claude-worktrees-eager-banach-12fc99/2f1e2e87-2a38-4af7-8d63-eefe2f4bcdb3/scratchpad/review/`:
`ui.md` (UI-n), `tooling.md` (T-n), `api.md` (API-n), `query.md` (Q-n). Each finding there has file:line, scenario and a suggested fix. Read the cited findings before you start; verify each claim in the code first, and if one turns out to be wrong, say so in your report instead of "fixing" it.

## Global constraints (every task)

- Follow `CLAUDE.md`. Maintainers are junior developers: comments explain _why_, names say what a thing is, logic in small pure functions the Node-only tests can reach.
- `src/` never names backend data (facet, field, tag, group, database from mock or real backend), not even in a comment or test example. `tests/noBackendDataInSrc.test.ts` enforces it. The frontend never rewrites a condition.
- Only `src/ui/fomantic.ts` uses jQuery. `src/` never imports `mock-server/`. No CDN, web font or remote image.
- Do NOT rename any heading in `docs/ARCHITECTURE.md`. If code behaviour changes, update that doc in the same commit (a disagreement is a bug). Do not touch `docs/CHANGELOG.md`.
- The worktree already has `npm ci` done. Before every commit run `npm run typecheck && npm test && npm run lint && npm run build` and report the result. Run `npx prettier --write` on files you touched.
- Do not merge, push, open a PR, or dispatch subagents. Commit on the current branch, one or a few focused commits per task, with message ending `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- UI changes: also verify in a real browser (Playwright + Chromium) on your OWN ports, never the ones others use: `DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts` and `DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort`. Stop only the processes you started (find by port + cwd); never `pkill` by name. Write throwaway scripts outside the repo (scratchpad `/tmp/claude-1000/-home-annek-repos-query-builder--claude-worktrees-eager-banach-12fc99/2f1e2e87-2a38-4af7-8d63-eefe2f4bcdb3/scratchpad/`).
- Prefer a test-first approach for every pure-logic change (fail, then pass).

## Rulings made before execution

- Ruling: API-1 (getStats completeness check) is NOT implemented — real-backend behaviour (does it always send one line per database?) is unknown, and a wrong guess would turn a working stats panel into an error. Surfaced as a question to the maintainers.
- Ruling: Q-4, T-12, API-6 `isObject` merge, UI-10 behaviour change are skipped (low value or speculative). UI-10 gets a why-comment only.
- Ruling: T-9 — add `permissions: contents: read` only; the Node version in CI is a maintainer decision, surfaced as a question.
- Ruling: task order is fixed (1 → 5) because tasks share `src/main.ts`, `src/ui/queryBuilder.ts`, `src/styles.css` and `docs/ARCHITECTURE.md`.

## Task 1: Keep keyboard focus across repaints (UI-1, UI-2)

Findings: `ui.md` UI-1 and UI-2 (both reproduced in Chromium by the reviewer). Files: `src/ui/panel.ts`, `src/ui/queryBuilder.ts` (the `change` listener ~509-523), `src/ui/databasePicker.ts`, `src/ui/dataPreview.ts`, possibly `src/ui/accountMenu.ts`; `docs/ARCHITECTURE.md` next to "Focus after a toggle" (find it; keep the heading).

Goal, observable in a browser:

1. Typing a value in a value box or a Between "From" box and then pressing Tab (or clicking "To") leaves focus on the target control, and typing there works. Today focus lands on BODY.
2. Activating with Enter/Space a database checkbox (and All/None), the ALL/ANY toggle, "+ Condition", "+ Group", a row/group remove button leaves keyboard focus on a sensible element (the same control if it still exists, otherwise the nearest sensible one — e.g. the next row's control or the add button; decide and document).
3. "Run query": when the preview goes loading and when the result or error appears, the user is told (a live region or moved focus). Do not steal focus from a user who is elsewhere.
4. The builder's own "+ Condition"/"+ Group" announce to screen readers like the dictionary's "+" buttons do (`announce(...)`, see commit "Adding to a group … announce adds to screen readers (#62)"). Check first whether they already do; the reviewer said no.

Design guidance: prefer ONE generic mechanism in `paint()` (remember a stable key of the focused element before `destroy`, re-find and focus after `activate`) over per-control fixes, and then delete the one-off `focusCollapseButton` if the generic one covers it. For UI-1 the `change` event fires before focus moves, so the generic key alone is not enough: think about it, test it in the browser, and pick the simplest approach that works (options in the finding). Put any pure part (building/looking up the key) in a small function with a Node test if it can be made DOM-free; otherwise explain why not. Update ARCHITECTURE.md to describe what you built.

Acceptance: a Playwright script (kept out of the repo) that demonstrates items 1-3 before/after, with the output quoted in your report; all existing tests pass.

## Task 2: Small UI correctness and a11y fixes (UI-3 … UI-10)

Findings: `ui.md` UI-3, UI-4, UI-5, UI-6, UI-7, UI-8, UI-9, UI-10. Files: `src/ui/docsSidebar.ts`, `src/main.ts`, `src/app.ts`, `src/ui/queryBuilder.ts`, `src/ui/statsPanel.ts`, tests in `tests/`.

- UI-3: Escape in the dictionary search must clear the text and NOT also close the floating dictionary; a second Escape closes it. Extract the "should Escape close the dictionary" decision into a small pure function with a Node test.
- UI-4: announce a new drop notice via `announce()` in `setNotice` (app.ts); add a test in `tests/app.test.ts`.
- UI-5: a drop/move that leaves the tree identical announces nothing; add a small `sameTree` helper (or equivalent) with tests, covering the "collapsed counts as a visible change" note.
- UI-6: the dictionary filter result count / "no match" must reach screen readers (live region that exists before its text changes); string built in `applyFilter`.
- UI-7: the fatal start-up error page gets `role="alert"` and the Reload button gets focus.
- UI-8: remove or fix the useless `aria-label` on the role-less span.
- UI-9: remove the unused `extra` parameter of `iconButton`.
- UI-10: no behaviour change; add a one-line _why_ comment on the `dragstart` cancel.

If Task 1 already changed any of these lines, build on its result. Acceptance: tests for the pure parts, browser check of UI-3 (at ~1000 px wide) and UI-7, docs updated where behaviour is described ("Announcements", "dropNotice", dictionary search).

Carried over from the Task 1 review (verify each in the code, then fix):

- Deferred value commit (`src/ui/queryBuilder.ts`, the `setTimeout` in the `change` listener): a click whose press and release both land inside that tick runs its handler on the OLD query. Concrete regression: `saveQueryBeforeRedirect()` (`src/main.ts`) before login / compliance check can save a query without the just-typed value, and a fast Run is cancelled by the late commit. Fix by keeping the pending row in a variable and flushing it synchronously before `runPreview` and `saveQueryBeforeRedirect` (or a capture-phase click listener on `document`), plus a note in the ARCHITECTURE.md "known gap" paragraph. Keep it small and explain _why_.
- `docs/ARCHITECTURE.md` (~lines 248-250): the sentence saying the dictionary filter avoids `paint()` because a repaint would lose the input's focus and caret is no longer true (`paint()` now keeps both). Give the real reason (cost per keystroke, open `<details>`, scroll position) or remove it.
- `docs/ARCHITECTURE.md` (~line 429): "focusable by script only" for `tabindex="-1"` is inaccurate (a mouse click also focuses it); say "not in the Tab order".

## Task 3: Styles and contrast (T-1, T-5, T-6, T-10, T-11)

Findings: `tooling.md` T-1, T-5, T-6, T-10, T-11. Files: `src/styles.css`, `tests/themeContrast.test.ts`, `docs/ARCHITECTURE.md` if it lists the tokens.

- T-1: the compliance badge text in the account chip must reach WCAG AA 4.5:1; use opaque `#rrggbb` tokens so `themeContrast.test.ts` can cover them, and add the pairs to `PAIRS`. Keep the look (green = ok, amber = warn) recognisable.
- T-5: visible keyboard focus (>= 3:1 against both neighbours) on the dictionary resize handle.
- T-6: keep a single `.qb-muted` rule. Decide where the smaller size is wanted (dictionary "and N more"), keep other places at the size their own rules intend (`.qb-preview-note` 0.85rem; the query footer). Check in the browser that the footer text no longer changes size when a query becomes valid.
- T-10: merge the split `.is-collapsed > .qb-group-head` and `.qb-er-count` rule pairs without changing the cascade result.
- T-11: pointer comment both ways between the 1100px media query and `NARROW_SCREEN` in `src/main.ts`.

Acceptance: contrast test passes with the new pairs; screenshots (before/after) of the account chip and the query footer viewed by you and described in the report.

## Task 4: Tooling, CI, docs hygiene (T-2, T-3, T-4, T-7, T-8, T-9, T-13)

Findings: `tooling.md` T-2, T-3, T-4, T-7, T-8, T-9 (permissions only, see rulings), T-13. Files: `THIRD-PARTY-NOTICES.txt`, `eslint.config.js`, `tests/docReferences.test.ts`, `scripts/check-offline.mjs` (+ new test), `package.json`, `README.md`, `.github/workflows/ci.yml`, `docs/ARCHITECTURE.md` ("Offline-first", "Directory layout").

- T-2: make the notices file agree with `vite.config.ts`, the README and `dist/` (verify the banner claim against a fresh build), the real Vite version, and the real ESLint packages.
- T-3: ESLint must ignore `.claude/` (check `eslint . ` still passes; do not break the lintRules tests).
- T-4: widen `docReferences` so README, `.env`, CLAUDE.md and the other spellings are checked; the test must still pass on the current repo, and a deliberately wrong title in a scratch copy must make it fail (show that).
- T-7: make the offline check catch protocol-relative URLs and `ws(s)://`; export a pure `findOffOrigin(text)` (keep the script runnable via `npm run check:offline`), add `tests/offlineCheck.test.ts`, and say "text file" in the doc.
- T-8: add a `format` script and a README table row.
- T-9: `permissions: contents: read` in the workflow.
- T-13: complete the tool-config list in "Directory layout".

Acceptance: full pre-commit command passes; show the T-4 and T-7 negative checks.

## Task 5: Logic robustness, error isolation, tests (API-2, API-3, API-4, API-5, API-6, Q-1, Q-2, Q-3, Q-5, Q-6)

Findings: `api.md` API-2 … API-6 (not API-1, see rulings; for API-6 do only `toDatabaseError` export and the `config.ts` header sentence), `query.md` Q-1, Q-2, Q-3, Q-5, Q-6. Files: `src/main.ts`, `src/api/response.ts`, `src/util/pendingQuery.ts`, `src/config.ts`, `src/query/validate.ts`, `src/query/fieldCatalog.ts`, `tests/api/client.test.ts`, `tests/query/*`, `tests/dateCases.ts`, `docs/ARCHITECTURE.md`.

- API-2: one throwing panel renderer must not stop the others repainting (try/catch + `console.error` around each renderer in `main.ts`, or the smallest equivalent); explain _why_ in a comment.
- API-3: add the six streaming/timeout tests listed (fake timers where needed). They pin existing behaviour; if any fails, that is a real bug: report it, fix it minimally.
- API-4: add `optionalList` to the "Reading responses" table.
- API-5: why-comment on the unchecked `value` in `isQueryNode`; type `savePendingQuery`'s parameter as `Group` (check callers).
- Q-1: a blank item in an "Is any of" list is flagged by `validateQuery`, with a message that fits both causes and a test.
- Q-2: `valueTypeFor` treats `UNSIGNED`/`SIGNED`/`ZEROFILL` suffixes as the base type (do NOT add vendor-specific aliases such as INT4/FLOAT8 — the real backend's types are unknown; mention that in your report) + tests.
- Q-3: remove the unreachable `TIMESTAMP` table entry, keep the comment truthful.
- Q-5: doc sentence for `moveNode`/`insertNodes` unknown target.
- Q-6: the missing `moveNode` and leap-year (1900, 2000) tests; check the mock accepts the shared date cases (`npm test` covers it).

Acceptance: full pre-commit command passes; list which new tests failed first (TDD) and which only pin existing behaviour.
