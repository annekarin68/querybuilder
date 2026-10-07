# Instructions for Claude

A query-builder frontend (TypeScript, Vite, Vitest, Fomantic UI) with a mock
backend for development. `docs/ARCHITECTURE.md` is the living design document:
start with "What we are building", and read the section for whatever you are
about to change (a panel, the API contract, the state) before changing it.

## Challenge the maintainers

The maintainers want to be challenged. Raise inconsistencies and ask critical
questions instead of just complying: it makes the product better for its
users. Do it early (while clarifying a request, choosing a design, reviewing
your own result), say what you noticed, why it matters to the end user, what
you recommend, and ask one sharp question. Typical targets: two names for one
thing, labels or flows a first-time user would not understand, requirements
that conflict with each other or with the backend, scope bigger than the goal,
missing cases (empty states, errors, narrow windows below 1024 px, keyboard use). If they
decide otherwise, follow the decision and write down why. Do not interrupt
settled or trivial choices, and do not turn every task into a questionnaire.

## Code for a junior team

The maintainers are junior developers ("The audience constraint" in the
architecture doc). Comments explain _why_, names say what a thing is, and
logic lives in small pure functions that the Node-only tests can reach.

## Git

- `git fetch origin` before you start and again before you push or open a
  pull request. Base work on `origin/main`, never on the local `main`, which
  can be stale. If `origin/main` has moved, merge it in, re-run the checks and
  tell the maintainers what changed upstream.
- A new worktree needs its own `npm ci`. A symlinked `node_modules` makes Vite
  answer 403 for Fomantic's fonts, so icons show as squares.
- Do not open a pull request unless you are asked to in that moment. Push the
  branch and say so.

## Before you commit

Run `npm run typecheck && npm test && npm run lint && npm run build`, the same
steps as CI (the build also runs `check:offline`). Then read your whole diff:

- Is it easy for a junior developer to maintain?
- Could it have broken something in the code it touches (including Fomantic's
  behaviour)?
- Does `docs/ARCHITECTURE.md` still describe the code? A disagreement between
  the two is a bug: fix the doc in the same change. `docs/CHANGELOG.md` is an
  archive and is not updated any more.

Say in your report what you checked. The tests run in Node without a DOM, so
check UI changes in a real browser too (Playwright with Chromium). To run a
second dev server beside someone else's, give it its own ports:
`DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts` and
`DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort`. Stop
only processes you started, found by port and working directory. Never `pkill`
by name: it can kill your own shell or somebody else's server.

## Rules the code relies on

- **The backend interprets the query.** The frontend sends the query exactly as
  the user built it; it never rewrites conditions ("Wire format of the query").
- **`src/` never names backend data**: no facet, field, tag, group or database
  from the mock or the real backend, not even in a comment or an example. The
  mock dataset is fictional. Anything deployment-specific goes in
  `src/config.ts`, which ships empty. `tests/noBackendDataInSrc.test.ts`
  enforces this. Prefer our own `tags` over the third-party `group`.
- **Offline-first**: no CDN, web font or remote image ("Offline-first").
  `npm run check:offline` fails the build if the output reaches off-origin.
- **Only `src/ui/fomantic.ts` uses jQuery** ("The Fomantic discipline"), and
  `src/` never imports `mock-server/`. ESLint enforces both.
- **Desktop only.** Phones and tablets are not supported and never will be
  (decided 2026-10-07; "Supported screens" in the architecture doc): do not
  design, test or ask about phone or tablet layouts or touch input. The minimum
  is a desktop browser window 1024 px wide.
- **Do not rename headings in `docs/ARCHITECTURE.md`**: code and tests cite
  them by title (`tests/docReferences.test.ts`).
