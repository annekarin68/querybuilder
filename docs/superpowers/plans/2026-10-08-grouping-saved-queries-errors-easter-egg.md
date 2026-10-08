# Grouping, saved queries, error display, dictionary values, easter egg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six changes in the spec: a reliable pickle-rain click, "Group contents"/"Ungroup", labelled previously seen values, an easter-egg mascot toggle, errors shown where they can be fixed (with failed-database markers), and saved queries backed by a mocked API.

**Architecture:** Pure logic goes in small functions that the Node-only tests reach (`src/query/`, `src/api/`, `mock-server/`, pure helpers exported from `src/ui/*`). Panels stay HTML-string renderers repainted from `AppState`; `app.ts` owns every action and request; only `src/api/` sees wire types; only `src/ui/fomantic.ts` touches jQuery. Each task updates `docs/ARCHITECTURE.md` in the same commit.

**Tech Stack:** TypeScript, Vite, Vitest (Node, no DOM), Fomantic UI (CSS + a few plugins), a Node mock server (`mock-server/`), Playwright (Chromium, Firefox) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-08-grouping-saved-queries-errors-easter-egg-design.md` — read the section for your task before starting; the spec's wording (labels, messages) is binding.

## Global Constraints

- Read `CLAUDE.md` and the `docs/ARCHITECTURE.md` sections named in your task first. Do **not** rename any heading in `docs/ARCHITECTURE.md` (`tests/docReferences.test.ts`). `docs/CHANGELOG.md` is not updated.
- Code for a junior team: comments explain *why*, names say what a thing is, logic lives in small pure functions with Node tests. Match the surrounding code's style and comment density.
- `src/` never names backend/mock data (no facet, field, tag, group or database names, even in comments or tests under `src/`); `tests/noBackendDataInSrc.test.ts` enforces it.
- The frontend never rewrites a condition's meaning ("Wire format of the query").
- Offline-first: no CDN, web font or remote image; SVGs plain with only the `http://www.w3.org/2000/svg` namespace.
- Only `src/ui/fomantic.ts` uses jQuery; `src/` never imports `mock-server/`; outside `src/api/` nothing imports `src/api/types.ts`.
- Every user-visible string from the server is escaped (`escapeHtml`). Every control has an accessible name.
- Narrowest supported window: 512 px. Check UI changes there.
- Before committing each task run: `npm run typecheck && npm test && npm run lint && npm run build` — all must pass. Then read your own diff.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`. Do not push and do not open a pull request.
- Browser checks: start private servers from the worktree root — `DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts` and `DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort` (background) — drive them with Playwright (`npx playwright`, Chromium; Firefox is installed too), put scripts/screenshots in the session scratchpad, and stop only the PIDs you started (find by port: `ss -ltnp`). Never `pkill` by name.

---

## Task 1: Pickle rain survives a jittery click (spec §6)

**Files:**
- Modify: `src/ui/layout.ts:76` (the logo `<img>`)
- Test: `tests/ui/layout.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Pickle theme and mascot"

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test** — in `tests/ui/layout.test.ts`, following how that file already gets at the shell's HTML (read it first; if it only tests pure functions, export the brand markup as a constant `BRAND_HTML` from `layout.ts` and test that):

```ts
it("the logo cannot be dragged, so a click that moves a few pixels still counts", () => {
  expect(BRAND_HTML).toMatch(/<img class="qb-logo"[^>]*draggable="false"/);
});
```

- [ ] **Step 2: Run it:** `npx vitest run tests/ui/layout.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** — add `draggable="false"` to the logo `<img>`, with a comment: a browser turns a click whose pointer moves a few pixels on a draggable image into a drag, and the click is lost (Chromium ≥4 px, Firefox ≥6 px), so five quick clicks rarely all counted.
- [ ] **Step 4: Run the test** — PASS.
- [ ] **Step 5: Docs** — in "Pickle theme and mascot", after the five-clicks paragraph, one sentence: the logo is `draggable="false"` so a slightly moving click is not swallowed as an image drag (why the rain seemed to work only in some browsers).
- [ ] **Step 6: Browser check** — Playwright, Chromium and Firefox: five clicks, each with `mouse.down()`, `mouse.move(+6, +6)`, `mouse.up()`; assert `.qb-rain-drop` elements appear.
- [ ] **Step 7: Full checks, read diff, commit** — `git commit -m "Keep logo clicks from turning into image drags so the pickle rain starts"`.

---

## Task 2: "Group contents" and "Ungroup" (spec §1)

**Files:**
- Modify: `src/query/tree.ts` (three new exports)
- Modify: `src/query/drop.ts` (announcement texts, next to `ADDED_GROUP_MESSAGE`)
- Modify: `src/ui/queryBuilder.ts` (`groupHtml` header buttons; click `switch`)
- Modify: `src/app.ts` (only if needed to expose `setNotice` for the blocked Ungroup — see Step 7)
- Modify: `src/main.ts` (pass the new hook)
- Modify: `src/styles.css` (header wrapping at narrow widths, if needed)
- Test: `tests/query/tree.test.ts`, `tests/ui/queryBuilder.test.ts`, `tests/app.test.ts`
- Docs: `docs/ARCHITECTURE.md` "The query model" (`tree.ts` bullets) and "Centre — `queryBuilder.ts`"

**Interfaces:**
- Produces (in `src/query/tree.ts`):
  - `groupContents(tree: Group, groupId: string): Group`
  - `ungroupBlocker(tree: Group, groupId: string): string | null`
  - `ungroup(tree: Group, groupId: string): Group | null`
  - `UNGROUP_BLOCKED_MESSAGE: string` = `"Ungroup works only when this group and the one around it are both ALL or both ANY, or when it holds one item."`
- Produces (in `src/query/drop.ts`): `groupedMessage(count: number): string` → `"Grouped 1 item."` / `"Grouped 3 items."`; `UNGROUPED_MESSAGE = "Ungrouped."`
- Produces (in `src/app.ts`, returned from `createApp`): `showNotice(message: string): void` — sets the drop notice and announces it (wraps the existing private `setNotice([message])`).

- [ ] **Step 1: Write failing tree tests** (append to `tests/query/tree.test.ts`; import the three functions and `UNGROUP_BLOCKED_MESSAGE`):

```ts
const cond = (id: string): Condition => ({
  kind: "condition", id, facetId: "f", fieldId: "x", operatorId: "eq", value: 1,
});
const group = (id: string, operator: "AND" | "OR", children: Group["children"], collapsed?: boolean): Group =>
  ({ kind: "group", id, operator, children, ...(collapsed === undefined ? {} : { collapsed }) });

describe("groupContents", () => {
  it("moves every child into one new group with the same operator", () => {
    const root = group("r", "OR", [cond("a"), cond("b")]);
    const next = groupContents(root, "r");
    expect(next.operator).toBe("OR");
    expect(next.children).toHaveLength(1);
    const inner = next.children[0] as Group;
    expect(inner).toMatchObject({ kind: "group", operator: "OR", children: [cond("a"), cond("b")] });
    expect(inner.id).not.toBe("r");
    expect(inner.collapsed).toBeUndefined();
  });

  it("works on a nested group and leaves the rest alone", () => {
    const root = group("r", "AND", [cond("a"), group("g", "OR", [cond("b"), cond("c")])]);
    const next = groupContents(root, "g");
    expect(next.children[0]).toEqual(cond("a"));
    const g = next.children[1] as Group;
    expect(g.id).toBe("g");
    expect((g.children[0] as Group).children).toEqual([cond("b"), cond("c")]);
  });

  it("returns the tree unchanged for an unknown id or a condition id", () => {
    const root = group("r", "AND", [cond("a"), cond("b")]);
    expect(groupContents(root, "nope")).toBe(root);
    expect(groupContents(root, "a")).toBe(root);
  });

  it("does not change what the query means (only one more level)", () => {
    const root = group("r", "AND", [cond("a"), cond("b")]);
    const inner = groupContents(root, "r").children[0] as Group;
    expect(sameSemantics({ ...inner, id: "r" }, root)).toBe(true);
  });
});

describe("ungroupBlocker / ungroup", () => {
  it("allows ungrouping when the group matches its parent's operator", () => {
    const root = group("r", "AND", [cond("a"), group("g", "AND", [cond("b"), cond("c")]), cond("d")]);
    expect(ungroupBlocker(root, "g")).toBeNull();
    expect(ungroup(root, "g")!.children.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("allows ungrouping a one-child group whatever its operator", () => {
    const root = group("r", "AND", [group("g", "OR", [cond("b")])]);
    expect(ungroupBlocker(root, "g")).toBeNull();
    expect(ungroup(root, "g")!.children).toEqual([cond("b")]);
  });

  it("refuses when operators differ and the group holds more than one item", () => {
    const root = group("r", "AND", [group("g", "OR", [cond("b"), cond("c")])]);
    expect(ungroupBlocker(root, "g")).toBe(UNGROUP_BLOCKED_MESSAGE);
    expect(ungroup(root, "g")).toBeNull();
  });

  it("refuses the root and unknown ids", () => {
    const root = group("r", "AND", [cond("a")]);
    expect(ungroupBlocker(root, "r")).not.toBeNull();
    expect(ungroup(root, "r")).toBeNull();
    expect(ungroup(root, "nope")).toBeNull();
  });

  it("ungrouping a collapsed group keeps its children's own state", () => {
    const inner = group("h", "OR", [cond("x")], true);
    const root = group("r", "AND", [group("g", "AND", [inner, cond("b")], true)]);
    expect(ungroup(root, "g")!.children).toEqual([inner, cond("b")]);
  });
});
```

(`ungroupBlocker` returns `"The whole query can't be ungrouped."` for the root and `"That group is no longer in the query."` for an unknown id or a condition — test only `not.toBeNull()` for those.)

- [ ] **Step 2: Run** `npx vitest run tests/query/tree.test.ts` — FAIL (not exported).
- [ ] **Step 3: Implement in `tree.ts`** (use the private `id("g")` helper for the new group's id, `mapTree` for edits):

```ts
/**
 * "Group contents": the group's children move into one new group, with the
 * same ALL/ANY, which becomes the group's only child. The query means the same
 * afterwards; the user can then add a sibling group and switch ALL/ANY.
 * An unknown id (or a condition's) changes nothing.
 */
export function groupContents(tree: Group, groupId: string): Group {
  const target = findNode(tree, groupId);
  if (!target || target.kind !== "group") return tree;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.id === groupId
      ? { ...n, children: [{ kind: "group", id: id("g"), operator: n.operator, children: n.children }] }
      : n,
  ) as Group;
}

export const UNGROUP_BLOCKED_MESSAGE =
  "Ungroup works only when this group and the one around it are both ALL or both ANY, or when it holds one item.";

/** The group that holds `nodeId` directly, or null (the root, or unknown). */
function parentOf(tree: Group, nodeId: string): Group | null {
  for (const child of tree.children) {
    if (child.id === nodeId) return tree;
    if (child.kind === "group") {
      const hit = parentOf(child, nodeId);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Why `groupId` can't be ungrouped, or null if it can. Ungrouping must never
 * change what the query means: that holds when the group combines its items
 * the same way as its parent, or when it holds only one item (a one-item
 * group means the same under ALL and ANY).
 */
export function ungroupBlocker(tree: Group, groupId: string): string | null {
  if (groupId === tree.id) return "The whole query can't be ungrouped.";
  const node = findNode(tree, groupId);
  const parent = parentOf(tree, groupId);
  if (!node || node.kind !== "group" || !parent) return "That group is no longer in the query.";
  if (node.operator === parent.operator || node.children.length === 1) return null;
  return UNGROUP_BLOCKED_MESSAGE;
}

/** Put `groupId`'s children in its place in its parent; null when `ungroupBlocker` says no. */
export function ungroup(tree: Group, groupId: string): Group | null {
  if (ungroupBlocker(tree, groupId) !== null) return null;
  return mapTree(tree, (n) =>
    n.kind === "group" && n.children.some((c) => c.id === groupId)
      ? { ...n, children: n.children.flatMap((c) => (c.id === groupId && c.kind === "group" ? c.children : [c])) }
      : n,
  ) as Group;
}
```

- [ ] **Step 4: Run tree tests** — PASS.
- [ ] **Step 5: Announcement texts** — in `src/query/drop.ts` next to `ADDED_GROUP_MESSAGE`, add `groupedMessage(count)` (`count === 1 ? "Grouped 1 item." : \`Grouped ${count} items.\``) and `UNGROUPED_MESSAGE`, with a test in `tests/query/drop.test.ts` for 1 and 3.
- [ ] **Step 6: Failing builder HTML tests** — in `tests/ui/queryBuilder.test.ts` (read how it renders a group today and reuse its helpers):
  - root with 2 children has a button `data-action="group-contents"` with text "Group contents" and `title="Put this group's conditions and groups into a new group inside it"`; root with 1 child has none; root never has `data-action="ungroup"`.
  - a non-root AND group inside an AND root has `data-action="ungroup"` without `aria-disabled`.
  - a non-root OR group with 2 children inside an AND root has `data-action="ungroup"` with `aria-disabled="true"` and `title="Ungroup works only when …"` (the full `UNGROUP_BLOCKED_MESSAGE`).
  - a collapsed group's header (the folded one) shows neither button (it is one big click target to unfold).
- [ ] **Step 7: Implement the UI** —
  - In `groupHtml` (expanded header only), after **+ Group** and before ✕: `Group contents` when `g.children.length >= 2`: `<button type="button" class="ui mini basic button" data-action="group-contents" title="…"><i class="object group outline icon" aria-hidden="true"></i>Group contents</button>`; and, when not root, `Ungroup`: `<button type="button" class="ui mini basic button" data-action="ungroup"${blocked ? ` aria-disabled="true" title="${escapeHtml(blocked)}"` : ` title="Put this group's items into the group around it"`}><i class="object ungroup outline icon" aria-hidden="true"></i>Ungroup</button>`. `groupHtml` needs the root tree to call `ungroupBlocker`: add `query: Group` to `BuilderCtx` and set it in `paintQueryBuilder`.
  - CSS: `[aria-disabled="true"]` on these buttons looks disabled (Fomantic's `.disabled` look: reduced opacity) but keeps pointer events and focus. Do not use the `disabled` attribute or Fomantic's `disabled` class (it sets `pointer-events: none`).
  - In the click `switch` of `wireQueryBuilder`:

```ts
      case "group-contents": {
        const node = findNode(q, nodeId);
        onChange(groupContents(q, nodeId));
        return hooks.announce(groupedMessage(node?.kind === "group" ? node.children.length : 0));
      }
      case "ungroup": {
        const next = ungroup(q, nodeId);
        // Refused: say why (the button is aria-disabled, not disabled, so
        // keyboard and screen-reader users can reach it and hear the reason).
        if (!next) return hooks.onNotice(ungroupBlocker(q, nodeId) ?? UNGROUP_BLOCKED_MESSAGE);
        onChange(next);
        return hooks.announce(UNGROUPED_MESSAGE);
      }
```

  - Add `onNotice(message: string): void` to `wireQueryBuilder`'s `hooks`; in `main.ts` pass `onNotice: app.showNotice`; in `app.ts` add and return `showNotice(message) { setNotice([message]); }`, with a test in `tests/app.test.ts` that it sets `dropNotice` and announces it.
  - Focus: the pressed button is repainted. After "Group contents" the root keeps the button only if it still has ≥2 children (it now has 1), so check in the browser where focus lands; if it falls to the page, the existing `data-focus-landing` on the query card must catch it (read "Keyboard focus across repaints").
- [ ] **Step 8: Run all tests** — PASS.
- [ ] **Step 9: Docs** — "The query model": a `tree.ts` bullet for `groupContents`, `ungroupBlocker`, `ungroup` and the rule (meaning never changes; one-child exception). "Centre — `queryBuilder.ts`": the two buttons, when each is drawn, the `aria-disabled` + notice behaviour, the announcements, and **Decided 2026-10-08** notes: label "Group contents" (not "Indent"/"Group children"), Ungroup only when meaning is unchanged, disabled-with-reason rather than hidden.
- [ ] **Step 10: Browser check** — Chromium at 1280 px and 512 px wide: header buttons wrap without overflow; Group contents then + Group then ANY gives `(a AND b) OR (…)`; blocked Ungroup shows the warning and is reachable by Tab; Enter on each button works; screenshot both widths.
- [ ] **Step 11: Full checks, read diff, commit** — `"Add Group contents and Ungroup to query groups"`.

---

## Task 3: "Previously seen values" in the dictionary (spec §5)

**Files:**
- Modify: `src/ui/docsSidebar.ts` (`valuesHtml`, `fieldHtml` passes the field name)
- Modify: `src/styles.css` (`.qb-doc-values`, `.qb-doc-value`)
- Test: `tests/ui/docsSidebar.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Left — `docsSidebar.ts` (data dictionary)" (item 4 of the list, "Value chips", becomes "Previously seen values")

**Interfaces:** none new outside the file.

- [ ] **Step 1: Failing tests** (reuse the file's facet/catalog fixtures; the field name below is whatever the fixture uses — never real backend data):
  - an opened field with 3 known values contains `<h4 class="qb-doc-values-title">Previously seen values (3)</h4>` (heading level: use the next level below what the field row uses; check the file and adjust the test to match).
  - the hint reads exactly `Drag one or press + to add <field name> equals <value>. Other values may work too.` with the field name escaped and the words "field name"/"value" as `<em>` (`<em>${name}</em> equals <em>value</em>`).
  - one `.qb-doc-value` per shown value, each still carrying its `data-item` value payload, grip and `aria-label="Add <value> to the query"` button.
  - with 40 known values: heading says `(40)`, 30 rows shown, "and 10 more".
  - a field without known values has no heading.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `valuesHtml(facet, field, catalog)` returns:

```ts
  return `<section class="qb-doc-values" aria-label="Previously seen values">
      <h4 class="qb-doc-values-title">Previously seen values (${options.length})</h4>
      <p class="qb-doc-values-hint">Drag one or press + to add <em>${escapeHtml(field.name)}</em> equals <em>value</em>. Other values may work too.</p>
      <ul class="qb-doc-value-list">${shown.map((v) => `<li class="qb-doc-value" data-item="…">${grip}<span class="qb-doc-value-text">…</span>${addButton(value)}</li>`).join("")}</ul>
      ${more > 0 ? `<p class="qb-muted qb-doc-more">and ${more} more</p>` : ""}
    </section>`;
```

  Keep `MAX_VALUE_CHIPS` (rename to `MAX_VALUES_SHOWN` and update every use). The drag/+ wiring reads the nearest `data-item`, so moving it to the `<li>` keeps both working — verify `wireDocsSidebar`'s selectors still match (`.qb-doc-value` etc.).
  - CSS: the list is one value per line (`display: block` rows, a light divider or zebra, compact padding), the value in the same monospace as field names, the grip at the left, the + at the right edge of the row. No pill/chip look (no rounded tinted background), so it can't be mistaken for the facet's `.qb-tag` chips. Heading small and muted-bold, hint in the muted colour (existing tokens only).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Docs** — update item 4 of the dictionary list and any sentence that says "value chips" (search the doc for "chip"), and record **Decided 2026-10-08**: shown as a labelled list, not chips, because users took them for tags; wording chosen by the maintainers.
- [ ] **Step 6: Browser check** — open a field with values at 26rem and at the 20rem minimum; drag a value and press its + (keyboard): each adds `field equals value`; screenshot.
- [ ] **Step 7: Full checks, read diff, commit** — `"Show a field's known values as a labelled list of previously seen values"`.

---

## Task 4: Easter-egg mascot toggle (spec §3)

**Files:**
- Create: `public/pickle/egg-logo.svg`, `public/pickle/egg-disappointed.svg`, `public/pickle/egg-loading.svg`
- Modify: `src/config.ts` (add `EASTER_EGG_MASCOT`)
- Modify: `src/state.ts` (`easterEgg: boolean`, `initialState.easterEgg = false`)
- Modify: `src/ui/layout.ts` (`setMascot(face, easterEgg)`, pure `mascotFile`)
- Modify: `src/main.ts` (logo click toggles; renderer keys)
- Test: `tests/ui/layout.test.ts`, `tests/state.test.ts` if it snapshots `initialState`
- Docs: `docs/ARCHITECTURE.md` "Pickle theme and mascot"

**Interfaces:**
- Produces: `EASTER_EGG_MASCOT: { neutral: string; disappointed: string; loading: string }` (`"/pickle/egg-logo.svg"`, `"/pickle/egg-disappointed.svg"`, `"/pickle/egg-loading.svg"`).
- Produces (in `layout.ts`): `export function mascotFile(face: MascotState, easterEgg: boolean, failed: ReadonlySet<string>): string` and `Shell.setMascot(face: MascotState, easterEgg: boolean): void`.
- Produces: `AppState.easterEgg: boolean` (display only, not stored).

- [ ] **Step 1: Failing tests for `mascotFile`:**

```ts
describe("mascotFile", () => {
  const none = new Set<string>();
  it("uses the normal set unless the easter egg is on", () => {
    expect(mascotFile("loading", false, none)).toBe(MASCOT.loading);
    expect(mascotFile("loading", true, none)).toBe(EASTER_EGG_MASCOT.loading);
  });
  it("falls back to the same set's neutral face, then to the normal neutral face", () => {
    expect(mascotFile("loading", true, new Set([EASTER_EGG_MASCOT.loading]))).toBe(EASTER_EGG_MASCOT.neutral);
    expect(mascotFile("loading", true, new Set([EASTER_EGG_MASCOT.loading, EASTER_EGG_MASCOT.neutral]))).toBe(MASCOT.neutral);
    expect(mascotFile("disappointed", false, new Set([MASCOT.disappointed]))).toBe(MASCOT.neutral);
  });
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — `mascotFile`:

```ts
/** The file for `face`: from the easter-egg set while it is on. A file that
 *  failed to load falls back to its set's neutral face, then to the normal
 *  neutral face (which is never given up on: it is the last resort). */
export function mascotFile(face: MascotState, easterEgg: boolean, failed: ReadonlySet<string>): string {
  const set = easterEgg ? EASTER_EGG_MASCOT : MASCOT;
  for (const file of [set[face], set.neutral]) if (!failed.has(file)) return file;
  return MASCOT.neutral;
}
```

  `setMascot(face, easterEgg)` remembers the last `face`/`easterEgg` in the closure and sets `logo.src = mascotFile(…)` only when it differs from the current `src`. The `error` listener adds the failing `src` to `failed` (unless it is `MASCOT.neutral`) and re-applies `mascotFile` with the remembered face and set — no loop, because `MASCOT.neutral` is never added.
  - `config.ts`: `EASTER_EGG_MASCOT` below `MASCOT`, doc comment: the hidden set five logo clicks switch to; replace the files to change it; same keys and fallbacks as `MASCOT`.
  - `state.ts`: `easterEgg: boolean` with a comment (display only; five logo clicks toggle it; not stored, so a reload brings back the normal pickle — decided by the maintainers).
  - `main.ts`: the click handler:

```ts
shell.logo.addEventListener("click", () => {
  if (!logoClicked()) return;
  const easterEgg = !store.getState().easterEgg;
  store.setState({ easterEgg });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion) startRain(Object.values(easterEgg ? EASTER_EGG_MASCOT : MASCOT));
  // Turning it off needs no toast: the face visibly changes back.
  else if (easterEgg) showToast(EASTER_EGG_TOAST);
});
```

  and the renderer entry `{ keys: ["issues", "stats", "preview", "easterEgg"], run: (s) => shell.setMascot(mascotFor(s), s.easterEgg) }`.
- [ ] **Step 4: Artwork** — three original 64×64 SVGs (`viewBox="0 0 64 64" width="64" height="64"`, only the SVG namespace, no scripts, no external refs) in the style of `public/pickle/logo.svg` (read it and the other two faces): a knockoff "Pickle Rick" — the same pickle body tilted, plus a spiky unibrow, wide eyes with small pupils and a wide grin showing teeth. `egg-disappointed.svg`: eyebrow angled down, flat/grimacing mouth. `egg-loading.svg`: eyes looking up/sideways, open "o" mouth. Drawn from scratch, nothing traced or copied. Keep them small (< 2 KB each).
- [ ] **Step 5: Run tests and `npm run build`** (includes `check:offline`) — PASS.
- [ ] **Step 6: Docs** — "Pickle theme and mascot": the egg set (table rows or a sentence naming the three `egg-*.svg` files and `EASTER_EGG_MASCOT`), the toggle (five clicks on, five more off, rains with the new set, reduced motion: toast only when turning on), not stored (decided 2026-10-08), the fallback order, and **Decided 2026-10-08**: the name `EASTER_EGG_MASCOT` (not tied to one character; the normal mascot is a pickle too).
- [ ] **Step 7: Browser check** — five clicks: rain uses the egg faces and the logo switches; trigger a loading face (edit the query) and see the egg loading face; five more clicks switch back; reload: neutral. Screenshot the logo in both sets.
- [ ] **Step 8: Full checks, read diff, commit** — `"Add an easter-egg mascot that five logo clicks toggle"`.

---

## Task 5: Group errors in the mock; statistics show errors where they can be fixed (spec §4, first half)

**Files:**
- Modify: `mock-server/evaluate.ts` (`queryErrors`)
- Modify: `src/ui/statsPanel.ts` (summary line, "Not counted" rows, request-failure box, `wireStatsPanel`)
- Modify: `src/ui/queryBuilder.ts` (export `revealNode(container, nodeId)`)
- Modify: `src/app.ts` (`retryStats`)
- Modify: `src/main.ts` (wire the stats panel)
- Modify: `src/styles.css` (summary line)
- Test: `tests/mock-server/evaluate.test.ts`, `tests/ui/statsPanel.test.ts`, `tests/app.test.ts`, `tests/api/mockContract.test.ts` (if it exercises errors)
- Docs: `docs/ARCHITECTURE.md` "Statistics lines", "Right — `statsPanel.ts`", "Error and loading model", "Mock server"

**Interfaces:**
- Produces: `app.retryStats(): void` — fetches statistics again for the current query and scope (calls the existing debounced `refreshStats`; it already checks `runBlocker`).
- Produces: `wireStatsPanel(container: HTMLElement, hooks: { onRetry(): void; onShowIssue(nodeId: string): void }): void` in `statsPanel.ts`.
- Produces: `revealNode(container: HTMLElement, nodeId: string): void` in `queryBuilder.ts` — scrolls `[data-node-id="…"]` into view (`block: "center"`) and focuses it (sets `tabindex="-1"` first if it has none).
- Produces (pure, `statsPanel.ts`): `queryProblemsLine(state: AppState): string` — `""` or the summary HTML.

- [ ] **Step 1: Failing mock tests** (`tests/mock-server/evaluate.test.ts`, building `RequestNode`s like the file's existing `queryErrors` tests; a "too long" value is `"x".repeat(MAX_TEXT_LENGTH + 1)`):
  - a group whose every child is too long → the condition errors **and** `{ nodeId: <group id>, kind: "incomplete", message: "Group contains no valid conditions." }`.
  - a group with one bad and one good child → only the condition error.
  - nested: an inner group all bad inside a root whose other child is fine → inner group error, no root error; root whose only child is that all-bad group → both group errors.
  - an empty group → no group error (the frontend's own validation reports it).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — in `queryErrors`, for a group: collect the children's errors; if the group has ≥1 child and **every** child has at least one error whose `nodeId` is that child's id (a condition's own error or a child group's own group error), append the group error. Doc comment: this mirrors the real backend, which reports a group with no usable condition; `kind: "incomplete"` as the maintainers decided (it shows as a grey hint; the condition errors stay red).
- [ ] **Step 4: Run mock tests** — PASS.
- [ ] **Step 5: Failing stats-panel tests** (`tests/ui/statsPanel.test.ts`, reuse `tests/statsFixtures.ts`):
  - two databases failed with the same node error, `serverIssues` holding it once → the HTML contains the message **zero** times; contains `Not counted: 1 problem is marked in the query.` and a `<button … data-action="show-issue" data-node-id="<placed id>">Show</button>`; each of those database rows says `Not counted`.
  - 2 server issues → `Not counted: 2 problems are marked in the query.`
  - a failed database whose errors have no `nodeId` → its row still shows the message in red; no summary line.
  - a failed database with both kinds → row shows only the no-`nodeId` messages; summary line present.
  - `stats.status === "error"` → `Couldn't get statistics` header, the escaped message and `<button … data-action="retry-stats">Try again</button>`; the old "Statistics failed" text is gone.
  - the summary's node id is the **placed** one (`placeIssues(state.query, state.serverIssues)[0].nodeId`), so an issue inside a collapsed group points at that group.
- [ ] **Step 6: Implement** —
  - `failureRowHtml`: messages = errors with `nodeId === null`; if none and some errors had a `nodeId`, show `Not counted` (muted, not red); if the result has no errors at all, keep `Failed.`; notes unchanged.
  - `queryProblemsLine(state)`: when `state.serverIssues.length > 0`, `<div class="qb-stat-problems" role="note"><span>Not counted: ${n === 1 ? "1 problem is" : \`${n} problems are\`} marked in the query.</span> <button type="button" class="ui mini basic button" data-action="show-issue" data-node-id="${escapeHtml(placedId)}">Show</button></div>`, placed right under the headline.
  - The error state: `<div class="ui small negative message"><div class="header">Couldn't get statistics</div><p>${escapeHtml(stats.error)}</p><button type="button" class="ui mini basic button" data-action="retry-stats">Try again</button></div>`.
  - `wireStatsPanel` — one delegated `click` listener calling `hooks.onRetry()` / `hooks.onShowIssue(id)`.
  - `app.ts`: `retryStats` (returned), test in `tests/app.test.ts`: after a failing `getStats`, `retryStats()` + timers advanced calls `getStats` again and the state goes to `ok`.
  - `main.ts`: `wireStatsPanel(panels.stats, { onRetry: app.retryStats, onShowIssue: (id) => revealNode(panels.center, id) })`. Add `"serverIssues"` and `"query"` to the stats renderer's keys if not there (they are).
- [ ] **Step 7: Run all tests** — PASS.
- [ ] **Step 8: Docs** — "Statistics lines": node errors are shown once, in the builder; the stats panel counts them. "Right — `statsPanel.ts`": the three kinds and the table from the spec (§4), the **Show** button, **Try again**, and the answer to the maintainers' question (no duplication). "Error and loading model": the stats request failure now has **Try again** (update "No retries" accordingly: user-triggered retry only). "Mock server": the group error.
- [ ] **Step 9: Browser check** — type a 101-character text value in two conditions of one group: the builder shows red condition errors and the grey group hint; the stats panel shows one "Not counted: 3 problems…" line and per-database "Not counted"; **Show** scrolls and focuses; stop the mock server briefly to see "Couldn't get statistics" and **Try again** recovering after restart. Screenshots.
- [ ] **Step 10: Full checks, read diff, commit** — `"Show query errors once in the builder and give statistics failures a retry"`.

---

## Task 6: Failed databases marked in the picker, with "Deselect failing" (spec §4, second half)

**Files:**
- Modify: `src/ui/databasePicker.ts` (markers, button, pure helpers)
- Modify: `src/main.ts` (renderer keys: add `"stats"`)
- Modify: `src/styles.css` (`.qb-db-pill.is-failed`)
- Test: `tests/ui/databasePicker.test.ts` (create)
- Docs: `docs/ARCHITECTURE.md` "Above the builder — `databasePicker.ts`"

**Interfaces:**
- Produces (pure, `databasePicker.ts`):
  - `failedDatabases(results: DatabaseResult[]): Map<string, string[]>` — database id → reasons (its errors' messages; if none, its notes; if none, `["Failed."]`).
  - `deselectFailingIds(selected: string[], failed: ReadonlyMap<string, string[]>): string[] | null` — the selection without the failed ones, or `null` when the button must not show (no selected database failed, or every selected one did).
- Consumes: `onDatabasesChange(nextIds)` from `app.ts` (exists).

- [ ] **Step 1: Failing tests** (create `tests/ui/databasePicker.test.ts`; build `AppState` from `initialState` with made-up ids like `"db-a"`):

```ts
describe("failedDatabases", () => {
  it("maps each failed database to its reasons, errors first, then notes", () => {
    const results: DatabaseResult[] = [
      { status: "ok", databaseId: "a", matchCount: 1, notes: [] },
      { status: "failed", databaseId: "b", errors: [{ message: "Too long", kind: "invalid", nodeId: "c1" }], notes: ["n"] },
      { status: "failed", databaseId: "c", errors: [], notes: ["Could not be reached."] },
      { status: "failed", databaseId: "d", errors: [], notes: [] },
    ];
    expect(failedDatabases(results)).toEqual(new Map([["b", ["Too long"]], ["c", ["Could not be reached."]], ["d", ["Failed."]]]));
  });
});

describe("deselectFailingIds", () => {
  const failed = new Map([["b", ["x"]]]);
  it("drops the failed ones when some selected databases still work", () => {
    expect(deselectFailingIds(["a", "b"], failed)).toEqual(["a"]);
  });
  it("is null when nothing selected failed, or everything selected did", () => {
    expect(deselectFailingIds(["a"], failed)).toBeNull();
    expect(deselectFailingIds(["b"], failed)).toBeNull();
  });
});
```

  (Check the real `DatabaseResult` / `DatabaseError` shapes in `src/model.ts` and adjust field names in the fixture to match.)
  Plus HTML tests of `renderDatabasePicker` via a pure `databasePickerHtml(state)` (extract it from `renderDatabasePicker` like `statsPanelHtml`): a failed, selected pill has class `is-failed`, `title` = its reasons joined with " · " (escaped), an `<i class="exclamation circle icon" aria-hidden="true">` and `<span class="qb-sr-only">failed for this query</span>`; an unselected database that failed earlier is **not** marked; the button `<button … data-db-deselect-failing>Deselect failing (1)</button>` appears only when `deselectFailingIds` is not null.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — helpers as above; markers read `state.stats` when it is not `"error"` (`results`), so they clear when a new query starts loading (`changeScope` resets `results` to `[]`); the pill's existing `title` (database description) is kept and the reasons are appended on a new line. Wire the button in `wireDatabasePicker`'s click handler: it needs the current state's ids — read them from the checked boxes and the pills' `is-failed` class (`.qb-db-pill.is-failed input[data-db-id]`), then call `onChange`. Add `"stats"` to the picker's renderer keys in `main.ts`.
  - CSS: `.qb-db-pill.is-failed` — danger-coloured outline and icon (existing `--qb-danger` token), keeps the checked look; check contrast stays within `themeContrast` pairs (no new text colour).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Docs** — "Above the builder": the markers (current results only, selected only, reason in the tooltip, hidden text) and the button's rule, with the reason (deselecting every selected database would leave nothing; then the query is the problem).
- [ ] **Step 6: Browser check** — set the mock's fail rate high enough to make some databases fail (read `MockConfig.failRate` / `mock-server/index.ts` for the env var), see markers and press **Deselect failing**; keyboard: Tab to it, Enter. At 512 px the pills and button wrap. Screenshot.
- [ ] **Step 7: Full checks, read diff, commit** — `"Mark databases that failed for the query and offer to deselect them"`.

---

## Task 7: Saved queries — API contract, conversion, client, mock endpoints (spec §2 "API", "Mock")

**Files:**
- Modify: `src/api/types.ts` (wire types)
- Modify: `src/api/request.ts` (`toSavedQueryRequest`)
- Modify: `src/api/response.ts` (`toSavedQuery`)
- Modify: `src/api/contract.ts` (only if a needed read is missing — see Step 3)
- Modify: `src/api/client.ts` (four functions, `PUT`/`DELETE` helpers)
- Modify: `src/model.ts` (`SavedQuery`, `SavedQueryDraft`)
- Create: `mock-server/savedQueries.ts` (in-memory store + body check)
- Modify: `mock-server/server.ts` (routes, `{id}` match)
- Test: `tests/api/request.test.ts`, `tests/api/response.test.ts`, `tests/api/client.test.ts`, `tests/api/mockContract.test.ts`, `tests/mock-server/savedQueries.test.ts` (create), `tests/mock-server/server.test.ts`
- Docs: `docs/ARCHITECTURE.md` "API contract" (endpoint table), "Naming" (the `id` exception), "Data model", "Reading responses" (any new read), "Mock server"; a new `###` section "Saved queries" under "API contract" (new headings are fine; never rename existing ones)

**Interfaces:**
- Produces (wire, `types.ts`):

```ts
/** A saved query as stored by the backend: the query as the user left it,
 *  finished or not. The backend checks the shape only, never the meaning. */
export interface SavedQueryRequest {
  name: string;
  note: string;
  databases: string[];
  query: SavedGroup;
}
export interface SavedQueryResponse extends SavedQueryRequest {
  /** Made by the server. Not a `label`: it names a user's own record, not backend data. */
  id: string;
  /** ISO 8601 UTC. */
  updatedAt: string;
}
export type SavedNode = SavedGroup | SavedCondition;
export interface SavedGroup { kind: "group"; id: string; operator: "AND" | "OR"; children: SavedNode[] }
export interface SavedCondition {
  kind: "condition"; id: string;
  facetId: string | null; fieldId: string | null; operatorId: string | null;
  value: SavedValue;
}
/** Like RequestValue, but a list may hold nulls (an unfinished from–to pair). */
export type SavedValue = null | RequestScalar | (RequestScalar | null)[];
```

- Produces (model, `model.ts`):

```ts
/** A query the user saved (GET/POST/PUT …/saved-queries). */
export interface SavedQuery {
  id: string;
  name: string;
  /** A few words to recognise it by; "" when none. Never the query itself. */
  note: string;
  databaseIds: string[];
  query: Group;
  /** ISO 8601 UTC. */
  updatedAt: string;
}
/** What is sent to save a query. */
export type SavedQueryDraft = Omit<SavedQuery, "id" | "updatedAt">;
```

- Produces (`request.ts`): `toSavedQueryRequest(draft: SavedQueryDraft): SavedQueryRequest` — trims `name` and `note`; never throws on unfinished conditions; drops `collapsed`; throws only on a value that is not JSON scalars / nulls (a bug, like `toQueryRequest`).
- Produces (`response.ts`): `toSavedQuery(obj: ResponseObject<SavedQueryResponse>): SavedQuery` (match the signature style of the existing `to…` functions).
- Produces (`client.ts`): `listSavedQueries(): Promise<SavedQuery[]>`, `createSavedQuery(draft: SavedQueryDraft): Promise<SavedQuery>`, `updateSavedQuery(id: string, draft: SavedQueryDraft): Promise<SavedQuery>`, `deleteSavedQuery(id: string): Promise<void>`. Errors as every endpoint: `ApiError` with `status` (401, 404, 409, 400), `ContractError`, `TimeoutError`. The id goes into the path with `encodeURIComponent`.
- Produces (mock): `createSavedQueryStore(now?: () => Date, newId?: () => string)` with `list(userId)`, `create(userId, body)`, `update(userId, id, body)`, `remove(userId, id)`, each returning `{ status: number; body?: unknown }`; `readSavedQueryBody(value: unknown): { ok: true; body: SavedQueryRequest } | { ok: false; error: string }`.

- [ ] **Step 1: Failing conversion tests** —
  - `toSavedQueryRequest`: a tree with a blank condition, a facet-level condition (`fieldId: null`), a `between` pair `[3, null]`, an empty group, and a `collapsed: true` group → exact expected `SavedQueryRequest` (no `collapsed` key anywhere; names trimmed; `databaseIds` → `databases`).
  - `toSavedQuery` on that request plus `id`/`updatedAt` → the original tree (without `collapsed`), `databaseIds` restored. Round trip test: `toSavedQuery(wrap(toSavedQueryRequest(d)))` deep-equals `d` minus `collapsed`.
  - contract errors: a node with `kind: "other"`, a missing `children`, a `facetId` of `3`, a missing `id` → `ContractError` naming the path (e.g. `"query.children[0].kind"`); a missing `note` → `""` with a warning (it is display text: `text` read).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement the conversions.** Read `src/api/contract.ts` first. Reading the tree needs: `kind` (text that must be `"group"`/`"condition"` → `ContractError` otherwise), `operator` (`"AND"`/`"OR"`), nullable ids (`string | null`), and `value` (`null`, a scalar, or a list of scalars/nulls). If `contract.ts` has no read for "nullable id" or "JSON value", add the smallest ones (`nullableId`, `savedValue`) to `ResponseObject`, with a doc comment, tests in `tests/api/contract.test.ts`, and a row in the "Reading responses" table. The tree is required data (`ContractError` when malformed), `name` is required (`id`-style non-blank read), `note` is display text (`text`).
- [ ] **Step 4: Client** — add `putJson(path, body)` and `del(path)` beside `postJson`/`post` (same `send` path, timeout and error handling), then the four functions. `tests/api/client.test.ts`: methods, paths (with an id needing encoding, e.g. `"a/b"` → `a%2Fb`), bodies, a `409` becoming `ApiError` with `status === 409` and the server's message, and `204` resolving `undefined`.
- [ ] **Step 5: Run api tests** — PASS.
- [ ] **Step 6: Failing mock store tests** (`tests/mock-server/savedQueries.test.ts`): create → 201 with id and `updatedAt`; list newest first; per-user isolation (user B can't list/update/delete user A's: 404); duplicate name ignoring case and outer spaces → 409 `{ error: 'A saved query called "…" already exists.' }`; update to its own name → 200; update to another's name → 409; delete → 204, then 404; `readSavedQueryBody` rejects: missing/blank name, name over 80, note over 80, non-string database, malformed tree (each with a message naming the first problem, like `requestBody.ts`) and accepts drafts with nulls and empty groups.
- [ ] **Step 7: Implement the mock** — `mock-server/savedQueries.ts` (pure store; ids like `sq-1`, `sq-2`), and in `server.ts`: one store per server instance; routes `GET`/`POST ${api}/saved-queries`; for `PUT`/`DELETE` on `${api}/saved-queries/<id>`, add an explicit second lookup before the 404 (a small `savedQueryIdFrom(pathname, api)` that returns the decoded id or null, tested). All four answer `401 { error: "Log in to use saved queries." }` without a session (`sessionFor`); use the session's user id as the key (read `mock-server/auth.ts` for the field). Bodies through `readJsonBody`-style helper used by `requestBody.ts` (read it; reuse, don't copy).
- [ ] **Step 8: `server.test.ts` / `mockContract.test.ts`** — route-level tests (401 without session; full create/list/update/delete with a session cookie, as the existing tests log in) and the real client against the mock with no `ContractError` or warning.
- [ ] **Step 9: Run all tests** — PASS.
- [ ] **Step 10: Docs** — endpoint table rows; a "Saved queries" subsection under "API contract" (the draft tree, why not the `/stats` format, the 401/404/409/400 answers, name/note limits, shape-only check, **Decided 2026-10-08**: half-built queries can be saved because a validation bug on our side must never stop a user saving); "Naming" table/paragraph: saved query `id` exception; "Data model": `SavedQuery`; "Mock server": in-memory per user, lost on restart. Remove "Saving / sharing queries" from "Non-goals" and put "Sharing saved queries" there instead (the redirect exception sentence stays, reworded).
- [ ] **Step 11: Full checks, read diff, commit** — `"Add the saved-queries API: wire types, conversions, client and mock endpoints"`.

---

## Task 8: Saved queries — state and app actions (spec §2 "UX", logic only)

**Files:**
- Create: `src/query/saved.ts` (pure helpers)
- Modify: `src/state.ts` (new state)
- Modify: `src/app.ts` (actions, `AppApi` gains the four client functions)
- Test: `tests/query/saved.test.ts` (create), `tests/app.test.ts`, `tests/state.test.ts` if it covers `initialState`
- Docs: `docs/ARCHITECTURE.md` "State and the render loop" (new keys) and a new `###` "Saved queries" under "Panels" can wait for Task 9 — here document only state and actions in "State and the render loop"

**Interfaces:**
- Consumes (Task 7): `SavedQuery`, `SavedQueryDraft`, `listSavedQueries`, `createSavedQuery`, `updateSavedQuery`, `deleteSavedQuery`; `ApiError` with `status`.
- Produces (`src/query/saved.ts`):

```ts
/** What the saved query on screen held when it was last opened or saved. */
export interface OpenSaved { id: string; name: string; note: string; query: Group; databaseIds: string[] }
/** Names match ignoring case and surrounding spaces (the backend's rule). */
export function sameName(a: string, b: string): boolean;
/** Whether the query or the database selection differs from `open`. Folding a group is not an edit. */
export function isEdited(open: OpenSaved, query: Group, databaseIds: string[]): boolean;
/** Whether opening another query would lose work: edited (or never saved) and holding a condition with anything chosen. */
export function hasUnsavedWork(open: OpenSaved | null, query: Group, databaseIds: string[]): boolean;
/** Saving `name`: update the open query when the name is its own, else create. */
export function saveTarget(name: string, open: OpenSaved | null): { kind: "update"; id: string } | { kind: "create" };
```

- Produces (`state.ts`):

```ts
export type SavedDialog = null | "save" | "list";
export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  /** The name belongs to another saved query: ask "Replace it?" */
  | { status: "conflict"; name: string; note: string }
  | { status: "error"; error: string };
export type SavedListState =
  | { status: "idle" | "loading" }
  | { status: "ok"; queries: SavedQuery[] }
  | { status: "error"; error: string };
/** An action in the list waiting for the user's yes. */
export type SavedConfirm = null | { action: "open" | "delete"; id: string };
// AppState gains: openSaved: OpenSaved | null; savedDialog: SavedDialog;
//   save: SaveState; savedList: SavedListState; savedConfirm: SavedConfirm;
// initialState: null, null, { status: "idle" }, { status: "idle" }, null
```

- Produces (`app.ts`, returned): `openSaveDialog()`, `openSavedList()`, `closeSavedDialog()`, `saveQuery(name: string, note: string)`, `confirmReplace()`, `cancelReplace()`, `retrySavedList()`, `askOpenSaved(id: string)`, `askDeleteSaved(id: string)`, `confirmSavedAction()`, `cancelSavedAction()`.

- [ ] **Step 1: Failing tests for `saved.ts`** — `sameName(" Weekly ", "weekly")` true; `isEdited` false for a tree differing only in `collapsed`, true after a value change, true when database ids differ as sets (order ignored), false when same set in another order; `hasUnsavedWork(null, seedWithBlankRow, ids)` false, `(null, treeWithAFacetChosen, ids)` true, `(open, sameAsOpen, ids)` false; `saveTarget("weekly", {name:"Weekly",…})` → update with its id, other name → create, `null` open → create.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `saved.ts` (use `sameSemantics`; "anything chosen" = a condition with any of facetId/fieldId/operatorId/value not null — reuse/extract the private `isBlankCondition` logic from `tree.ts` by exporting it rather than duplicating). **Step 4: Run** — PASS.
- [ ] **Step 5: Failing app tests** (`tests/app.test.ts`, fake api style already used there):
  - `openSaveDialog` while anonymous → `savePendingQuery` + `navigate(LOGIN_URL)` (same as Run's redirect); while authenticated → `savedDialog: "save"`, `save: idle`.
  - `openSavedList` authenticated → `savedDialog: "list"`, `savedList` loading then ok; failure → error with message; `retrySavedList` reloads.
  - `saveQuery("Weekly", "note")` with no open query → `createSavedQuery` called with the current query and selection → `openSaved` set from the answer, dialog closed, `announce("Saved “Weekly”.")`.
  - with `openSaved` named "Weekly" → `updateSavedQuery(openId, …)`.
  - create answering 409 → `save: { status: "conflict", name, note }`, dialog stays open; `confirmReplace()` → lists, finds the clashing one by `sameName`, `updateSavedQuery(itsId, …)` → saved as above; `cancelReplace()` → `save: idle`.
  - any saved-query call answering 401 → redirect to login like Run (query saved first).
  - other errors → `save: { status: "error", error }`, dialog open.
  - `askOpenSaved(id)` with no unsaved work → opens at once: query, `selectedDatabaseIds` (unknown ids dropped), `issues` validated, stats reset and refetched (`changeScope`), `openSaved` set, dialog closed, `announce("Opened “…”.")`; with dropped ids → `dropNotice` "1 saved database no longer exists and was left out." / "N saved databases no longer exist and were left out.".
  - `askOpenSaved(id)` with unsaved work → `savedConfirm: { action: "open", id }`; `confirmSavedAction()` opens it; `cancelSavedAction()` clears it.
  - `askDeleteSaved(id)` → `savedConfirm` delete; confirm → `deleteSavedQuery` → list reloaded; deleting the open one → `openSaved: null`.
- [ ] **Step 6: Implement** in `app.ts` following its existing patterns (comments say why; no DOM). A saved query is opened through the same path as an edit (`changeScope` + `validateQuery`), so the "Correctness invariant" holds. Add the four functions to `AppApi`.
- [ ] **Step 7: Run all tests** — PASS.
- [ ] **Step 8: Docs** — "State and the render loop": the new keys, one line each.
- [ ] **Step 9: Full checks, read diff, commit** — `"Add saved-query state and actions"`.

---

## Task 9: Saved queries — dialogs, query card title, docs (spec §2 "UX")

**Files:**
- Create: `src/ui/savedQueries.ts` (dialog HTML + wiring)
- Modify: `src/ui/layout.ts` (one persistent `<dialog class="qb-dialog" data-panel="saved">` in the shell, `aria-labelledby` its title)
- Modify: `src/ui/queryBuilder.ts` (card title: name, *(edited)*, **Save…**, **Saved queries**; hooks)
- Modify: `src/main.ts` (wire, renderer keys)
- Modify: `src/styles.css` (dialog look with existing tokens; `::backdrop`)
- Test: `tests/ui/savedQueries.test.ts` (create), `tests/ui/queryBuilder.test.ts`
- Docs: `docs/ARCHITECTURE.md` new `###` "Saved queries — `savedQueries.ts`" under "Panels", "Screen layout", "Directory layout" (new files), "Saved query across the login/compliance redirect" (now also triggered by Save/Saved queries)

**Interfaces:**
- Consumes (Task 8): the state types and app actions above; `isEdited`.
- Produces: `Shell.savedDialog: HTMLDialogElement` (layout.ts, the persistent dialog); `savedDialogHtml(state: AppState): string` (pure), `renderSavedDialog(dialog: HTMLDialogElement, state: AppState): void`, `wireSavedDialog(dialog: HTMLDialogElement, app: Pick<ReturnType<typeof createApp>, "closeSavedDialog" | "saveQuery" | "confirmReplace" | "cancelReplace" | "retrySavedList" | "askOpenSaved" | "askDeleteSaved" | "confirmSavedAction" | "cancelSavedAction">): void`; `queryTitleHtml(state: AppState): string` (pure, in `queryBuilder.ts`).

- [ ] **Step 1: Failing HTML tests** —
  - `queryTitleHtml`: no open query → `Query` + both buttons (`data-action="open-save-dialog"` text `Save…`, `data-action="open-saved-list"` text `Saved queries`); open "Weekly" unedited → `Query · Weekly`; edited → also `<span class="qb-muted">(edited)</span>`; name escaped.
  - `savedDialogHtml` with `savedDialog: "save"`: a `<form method="dialog">` with labelled Name (`required`, `maxlength="80"`, prefilled from `openSaved.name`) and Note (`maxlength="80"`, hint "A few words to recognise it later"), **Save** and **Cancel**; `saving` → Save shows a loader and is disabled; `error` → `ui negative message` with the escaped error; `conflict` → `A saved query called “…” exists. Replace it?` with **Replace** and **Cancel**.
  - `savedDialog: "list"`: loading; empty → `No saved queries yet. Build a query and press Save…`; ok → one item per query with escaped name, note, `N databases`, a `<time datetime="…">` date, **Open** (`data-action="open-saved" data-id`) and **Delete** (`data-action="delete-saved" data-id`, `aria-label="Delete <name>"`); **the HTML never contains the saved query's facet/field ids or summary** (assert a fixture's facet id is absent); `savedConfirm` open → `Replace the current query? Its changes are not saved.` with **Replace** / **Cancel** on that item; delete → `Delete “…”?` with **Delete** / **Cancel**; error → message + **Try again**.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** —
  - The `<dialog>` lives in the shell and is never replaced; `renderSavedDialog` paints its contents (`paint`) and opens/closes it to match `state.savedDialog` (`showModal()` when it becomes non-null and is not open; `close()` when null and open). Its `cancel` event (Escape) and the Cancel buttons call `app.closeSavedDialog()`; a `close` event that state did not ask for also calls it, so state and the dialog never disagree.
  - Submitting the save form (`submit` listener, `preventDefault()`) reads the two fields and calls `app.saveQuery(name, note)`; the browser's `required`/`maxlength` stop blank or long names.
  - Focus: when the dialog opens, focus goes to the Name field (save) or the first **Open** button / the empty-state text (list). When it closes, focus goes back to the button that opened it (remember it on open; it lives in the query card, which may have been repainted, so look it up again by its `data-action`).
  - Query card: replace `<h2 class="qb-card-title">Query</h2>` with `queryTitleHtml(state)`; the two buttons are handled in `wireQueryBuilder`'s click listener **before** the `nodeId` check (they are not inside a node), calling new hooks `onOpenSaveDialog` / `onOpenSavedList`, passed from `main.ts` as `app.openSaveDialog` / `app.openSavedList`. Add `"openSaved"`, `"selectedDatabaseIds"` to the builder renderer's keys (for *(edited)*) and a renderer `{ keys: ["savedDialog", "save", "savedList", "savedConfirm", "openSaved", "databases"], run: (s) => renderSavedDialog(shell.savedDialog, s) }`.
  - Dates: `new Date(updatedAt).toLocaleDateString()` inside `<time datetime>` (format in a small pure function in `format.ts` with a test that an invalid date shows the raw text).
  - Every string from the server escaped; every control labelled; the dialog has `aria-labelledby` its heading ("Save query" / "Saved queries").
- [ ] **Step 4: Run all tests** — PASS.
- [ ] **Step 5: Docs** — as listed under Files: behaviour, why native `<dialog>` (no jQuery, focus kept inside, Escape), why the list never shows the query (sensitive; decided by the maintainers 2026-10-08), the note, the open/replace confirmations, logged-out behaviour.
- [ ] **Step 6: Browser check (Chromium and Firefox)** — logged out: Save… → login → back with query restored; save "Weekly" with a note; edit → *(edited)*; Save… again updates; save a second query under "weekly" → Replace prompt; Saved queries: list shows name/note/date, no query; Open with unsaved work → confirm; Delete → confirm; reload mock → empty state; keyboard only: Tab/Enter/Escape through both dialogs, focus returns to the opener; 512 px wide. Screenshots.
- [ ] **Step 7: Full checks, read diff, commit** — `"Add Save and Saved queries dialogs to the query card"`.

---

## Task 10: Final verification (controller)

- [ ] `git fetch origin`; if `origin/main` moved, merge it, re-run checks, note what changed upstream.
- [ ] `npm run typecheck && npm test && npm run lint && npm run build` — all pass.
- [ ] Read the whole branch diff against `origin/main`: junior-maintainable, nothing broken in touched code (Fomantic behaviour, focus, drag), `docs/ARCHITECTURE.md` matches the code, no backend data names in `src/`.
- [ ] One end-to-end Playwright pass in Chromium and Firefox across all six features at 1280 px and 512 px.
- [ ] Push the branch (no pull request) and report what was checked.
