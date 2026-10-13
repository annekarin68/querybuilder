# Matching Events Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the up-to-2,000 sampled matching events as a paged table, one column per facet that occurs, each occurrence of a facet drawn as its own set of field values, with a sticky header row and a pinned event-id column.

**Architecture:** Pure helpers do the work and are tested in Node:
- `src/util/paging.ts` for paging;
- `src/ui/eventTable.ts` for the columns, the cells and the table HTML.

The page number lives in the successful preview state (`preview.page`), so every query edit resets it with the preview. The event JSON opens in a second native `<dialog>`, built in the pattern of the saved-queries dialog. Plain HTML table and CSS `position: sticky`; no new dependency.

**Tech Stack:** TypeScript (strict), Vite 8, Vitest 4 (Node, no DOM), Fomantic UI CSS (no new plugin), Playwright (Chromium) for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-13-matching-events-table-design.md` (approved by the maintainers 2026-10-13). Read it first; this plan argues from it.

## Global Constraints

- **Words.** "Results" is the one word for the returned sample:
  - paging line: "Results 101–200 of 1,987";
  - one page only: "42 results";
  - header count: "in 12 of 1,987 results";
  - announcement: "Showing results 101 to 200 of 1987." (plain numbers: `app.ts` formats nothing, number formatting lives in `src/ui/format.ts`, and a screen reader reads them the same).
- **Columns:**
  - **Order:** `FIRST_COLUMNS` (`src/config.ts`) first, in its order; then by `Facet.number` ascending; facets missing from the dictionary last, by id.
  - **Which:** only facets held by at least one result, counted over the whole sample, not the page.
- **Pages:** 100 rows per page (`PAGE_SIZE = 100`), 0-based `page` in state.
- **Sets:** each occurrence of a facet in an event is its own `<dl>` box; several are a `<ul>` in the cell.
  - **Field order:** the dictionary's, unknown keys after, sorted.
  - **Values:** shown as text exactly as sent.
  - **Empty occurrence:** shows "—".
- **Cells:** max width 16rem, wrapping (`overflow-wrap: anywhere`), never cut off.
- **Scroll box:** about 70vh high, scrolling both ways.
  - The header row is sticky at the top.
  - The id column is sticky on the left.
  - The corner cell sits above both.
  - Sticky cells have an opaque background.
- **Removed:** tag/group badges, `HIDDEN_ROW_BADGES`, `ROW_COLUMNS` / `RowColumn` (replaced by `FIRST_COLUMNS: string[]`), per-field cells and their datetime formatting.
- **Unchanged:** Run query and its notes, loader, error with Try again, `previewAnnouncement` after a run, and resetting `preview` on every query or database change ("Correctness invariant").
- **Project rules (CLAUDE.md):**
  - `src/` never names backend data, and `FIRST_COLUMNS` ships empty.
  - Offline-first.
  - jQuery only in `src/ui/fomantic.ts`.
  - Never rename a heading of `docs/ARCHITECTURE.md`.
  - The doc changes in the same commit as the code.
  - Junior-friendly: small pure functions; comments say why.
- **Before every commit:** `npm run typecheck && npm test && npm run lint && npm run build`, then read the diff. UI changes are checked in Chromium on private ports (`DEV_BACKEND_URL=http://localhost:3091 npx tsx mock-server/index.ts`, `DEV_BACKEND_URL=http://localhost:3091 npx vite --port 5191 --strictPort`).
  - Stop only the processes you started, found by port and `readlink /proc/PID/cwd`.
  - Throwaway scripts go outside the repo; ESLint lints any `.mjs` inside it.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No pull request** unless asked; push the branch and say so.

---

### Task 0: Branch base

**Files:** none.

- [ ] **Step 1: Check whether `claude/user-feedback-round` has been merged**

```bash
git fetch origin
git switch claude/matching-events-table
git log --oneline origin/main..origin/claude/user-feedback-round | wc -l
```

- [ ] **Step 2: If that count is 0 (merged), move this branch onto `main`**

The feedback branch's last commit is `42b967f`. Everything after it belongs to this branch:

```bash
git rebase --onto origin/main 42b967f claude/matching-events-table
npm ci
npm run typecheck && npm test && npm run lint && npm run build
```

If the merge was a squash and the rebase conflicts on files that the feedback branch changed, stop and report. Otherwise (not merged yet) stay stacked and continue.

---

### Task 1: `Facet.number` from the backend's `id_number`

**Files:**
- Modify: `src/model.ts` (`Facet`), `src/api/response.ts` (`toFacet`)
- Modify: every test fixture that builds a `Facet` (`npm run typecheck` lists them: `tests/app.test.ts`, `tests/query/drop.test.ts`, `tests/query/fieldCatalog.test.ts`, `tests/ui/dataPreview.test.ts`, `tests/ui/docsFilter.test.ts`, `tests/ui/docsSidebar.test.ts`, `tests/ui/queryBuilder.test.ts`, `tests/ui/statsPanel.test.ts`, `tests/ui/databasePicker.test.ts` and `tests/api/*` where they build facets)
- Test: `tests/api/response.test.ts`
- Docs: `docs/ARCHITECTURE.md` "Data model"

**Interfaces:**
- Produces: `Facet.number: number`, the backend's `id_number`, which orders the table's columns.

- [ ] **Step 1: Write the failing test**

In `tests/api/response.test.ts`, inside `describe("toFacet", …)` (add the `describe` if there is none), using the file's existing `read<IndividualResponse>(…)` helper:

```ts
  it("keeps the backend's facet number, which orders the events table's columns", () => {
    const facet = toFacet(
      read<IndividualResponse>({
        label: "thing",
        group: "",
        tags: [],
        id_number: 7,
        name: "Thing",
        description: "",
        comment: "",
        total_count: 3,
        fields: [],
      }),
    );
    expect(facet.number).toBe(7);
  });

  it("throws a ContractError when the facet number is missing", () => {
    expect(() =>
      toFacet(
        readBroken<IndividualResponse>({
          label: "thing", group: "", tags: [], name: "Thing", description: "",
          comment: "", total_count: 3, fields: [],
        }),
      ),
    ).toThrow('"id_number"');
  });
```

Run: `npx vitest run tests/api/response.test.ts -t "facet number"`
Expected: FAIL (`number` is undefined; no throw).

- [ ] **Step 2: Implement**

`src/model.ts`, in `Facet` after `name`:

```ts
  /** The backend's number for this facet. The Matching events table orders
   *  its columns by it (after the facets in `FIRST_COLUMNS`). */
  number: number;
```

`src/api/response.ts`, in `toFacet`'s returned object after `name`:

```ts
    number: i.number("id_number"),
```

Run `npm run typecheck`. Every `Facet` literal it reports gets `number: <n>`: use `1, 2, 3…` in the order the fixture lists facets, so tests that later rely on order are predictable. Where a helper builds facets (`facet(id, …)`), give the helper a `number = 1` parameter at the end instead of touching each call.

- [ ] **Step 3: Run the tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Docs**

In `docs/ARCHITECTURE.md`, "Data model":
- Remove `IndividualResponse.idNumber` (or `id_number`) from the "Only what the app uses is mapped" list of keys that are left out.
- Add to the quirks list: "**A facet's number** (`id_number`) becomes `Facet.number`; the Matching events table orders its columns by it."

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Keep the backend's facet number (id_number) as Facet.number

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Paging, columns and cells as pure functions

**Files:**
- Create: `src/util/paging.ts`, `src/ui/eventTable.ts`
- Test: `tests/util/paging.test.ts`, `tests/ui/eventTable.test.ts`

**Interfaces:**
- Consumes: `Facet.number` (Task 1).
- Produces:
  - `PAGE_SIZE = 100`, `interface Page { page; pageCount; from; to; total }` and `pageOf(total: number, page: number, size?: number): Page` (paging.ts);
  - `interface FacetColumn { facetId; name; resultCount; fields: { id; name }[] }` and `tableColumns(events, facets, firstColumns): FacetColumn[]`;
  - `interface CellEntry { name; value }` and `cellSets(event, column): CellEntry[][]`;
  - `shortId(id: string): string`, moved here from dataPreview.ts (eventTable.ts).

- [ ] **Step 1: Write the failing paging tests**

`tests/util/paging.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PAGE_SIZE, pageOf } from "../../src/util/paging";

describe("pageOf", () => {
  it("pages hold 100 results", () => {
    expect(PAGE_SIZE).toBe(100);
  });

  it("gives the rows of a page, 1-based, last row included", () => {
    expect(pageOf(1987, 1)).toEqual({ page: 1, pageCount: 20, from: 101, to: 200, total: 1987 });
    expect(pageOf(1987, 19)).toEqual({ page: 19, pageCount: 20, from: 1901, to: 1987, total: 1987 });
  });

  it("is one page for 100 results or fewer", () => {
    expect(pageOf(42, 0)).toEqual({ page: 0, pageCount: 1, from: 1, to: 42, total: 42 });
    expect(pageOf(100, 0).pageCount).toBe(1);
  });

  it("clamps a page out of range or not a number (a stale click)", () => {
    expect(pageOf(150, 5).page).toBe(1);
    expect(pageOf(150, -1).page).toBe(0);
    expect(pageOf(150, Number.NaN).page).toBe(0);
  });

  it("has no rows for no results", () => {
    expect(pageOf(0, 0)).toEqual({ page: 0, pageCount: 1, from: 0, to: 0, total: 0 });
  });
});
```

Run: `npx vitest run tests/util/paging.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Write `src/util/paging.ts`**

```ts
/** How many results one page of the Matching events table shows. */
export const PAGE_SIZE = 100;

/** One page of a list of `total` results. `page` is 0-based; `from` and `to`
 *  are the 1-based first and last result shown (0 and 0 when there is none). */
export interface Page {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/**
 * Page `page` of `total` results, with the page number clamped to the pages
 * that exist: a click on a page that is gone (the results changed) shows the
 * nearest page instead of nothing.
 */
export function pageOf(total: number, page: number, size = PAGE_SIZE): Page {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const wanted = Number.isFinite(page) ? Math.floor(page) : 0;
  const p = Math.min(Math.max(0, wanted), pageCount - 1);
  return {
    page: p,
    pageCount,
    from: total === 0 ? 0 : p * size + 1,
    to: Math.min(total, (p + 1) * size),
    total,
  };
}
```

Run: `npx vitest run tests/util/paging.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing column and cell tests**

`tests/ui/eventTable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { EventRecord, Facet } from "../../src/model";
import { cellSets, shortId, tableColumns } from "../../src/ui/eventTable";

const facet = (id: string, number: number, fields: string[] = []): Facet => ({
  id,
  name: id.toUpperCase(),
  number,
  tags: [],
  group: "",
  comment: "",
  description: "",
  eventCount: 0,
  fields: fields.map((f) => ({
    id: f, name: `${f} name`, typeName: "VARCHAR", comment: "", description: "", values: [],
  })),
});

const facets = [facet("b", 2, ["x"]), facet("a", 1, ["pos", "val"]), facet("c", 3)];

const event = (id: string, values: EventRecord["values"]): EventRecord => ({ id, values });

const events = [
  event("e1", { b: [{ x: 1 }], a: [{ val: 2.2, pos: "right" }, { pos: "left", val: 1.1 }] }),
  event("e2", { b: [{ x: 2 }], zz: [{ k: "v" }] }),
];

describe("tableColumns", () => {
  it("has a column for each facet some result holds, by facet number", () => {
    expect(tableColumns(events, facets, []).map((c) => c.facetId)).toEqual(["a", "b", "zz"]);
  });

  it("puts the FIRST_COLUMNS facets first, in their order", () => {
    expect(tableColumns(events, facets, ["b"]).map((c) => c.facetId)).toEqual(["b", "a", "zz"]);
  });

  it("gives no column to a FIRST_COLUMNS facet that no result holds", () => {
    expect(tableColumns(events, facets, ["c", "b"]).map((c) => c.facetId)).toEqual(["b", "a", "zz"]);
  });

  it("counts results over the whole sample and names the column", () => {
    const [a, b, zz] = tableColumns(events, facets, []);
    expect(a).toMatchObject({ name: "A", resultCount: 1 });
    expect(b).toMatchObject({ name: "B", resultCount: 2 });
    expect(zz).toMatchObject({ name: "zz", resultCount: 1, fields: [] });
  });

  it("puts facets the dictionary does not know last, by id", () => {
    const more = [...events, event("e3", { aa: [{ k: 1 }] })];
    expect(tableColumns(more, facets, []).map((c) => c.facetId)).toEqual(["a", "b", "aa", "zz"]);
  });

  it("ignores a facet listed with no occurrences", () => {
    expect(tableColumns([event("e", { a: [] })], facets, [])).toEqual([]);
  });
});

describe("cellSets", () => {
  const [a, , zz] = tableColumns(events, facets, []);

  it("keeps each occurrence as its own set, fields in dictionary order", () => {
    expect(cellSets(events[0]!, a!)).toEqual([
      [{ name: "pos name", value: "right" }, { name: "val name", value: "2.2" }],
      [{ name: "pos name", value: "left" }, { name: "val name", value: "1.1" }],
    ]);
  });

  it("is empty for a result without the facet", () => {
    expect(cellSets(events[1]!, a!)).toEqual([]);
  });

  it("names unknown fields by their key, after the known ones, sorted", () => {
    const col = tableColumns([event("e", { a: [{ z: 1, pos: "p", b: true }] })], facets, [])[0]!;
    expect(cellSets(event("e", { a: [{ z: 1, pos: "p", b: true }] }), col)).toEqual([
      [
        { name: "pos name", value: "p" },
        { name: "b", value: "true" },
        { name: "z", value: "1" },
      ],
    ]);
    expect(cellSets(events[1]!, zz!)).toEqual([[{ name: "k", value: "v" }]]);
  });

  it("keeps an occurrence with no values as an empty set", () => {
    expect(cellSets(event("e", { a: [{}] }), a!)).toEqual([[]]);
  });
});

describe("shortId", () => {
  it("cuts a GUID to its first 8 characters", () => {
    expect(shortId("6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10")).toBe("6f1c2a9e…");
  });
  it("keeps a short id as it is", () => {
    expect(shortId("e-12")).toBe("e-12");
  });
});
```

Run: `npx vitest run tests/ui/eventTable.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `src/ui/eventTable.ts` (columns, cells, shortId)**

```ts
import type { EventRecord, Facet } from "../model";

/**
 * The Matching events table (docs/ARCHITECTURE.md, "Under the query —
 * `dataPreview.ts` (Matching events)"): which facet columns it has, and what
 * each cell holds. Pure, so it is tested in Node; dataPreview.ts paints it.
 */

/** One facet column of the table. */
export interface FacetColumn {
  facetId: string;
  /** The dictionary's name; the id for a facet the dictionary does not know. */
  name: string;
  /** How many results (events of the sample) hold this facet. */
  resultCount: number;
  /** The facet's fields in dictionary order. Empty for an unknown facet. */
  fields: { id: string; name: string }[];
}

/** One field value inside a set. */
export interface CellEntry {
  name: string;
  value: string;
}

/** The start of a long event id (a GUID has 36 characters). The id button's
 *  tooltip and the event's JSON show the whole id. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * The table's facet columns: one per facet that at least one result holds,
 * counted over the whole sample so the columns stay the same from page to
 * page. Order: `firstColumns` (src/config.ts `FIRST_COLUMNS`) in their order,
 * then by facet number; a facet the dictionary does not know comes last, by
 * id (maintainers' decision, 2026-10-13).
 */
export function tableColumns(
  events: EventRecord[],
  facets: Facet[],
  firstColumns: string[],
): FacetColumn[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const [facetId, occurrences] of Object.entries(event.values)) {
      if (occurrences.length > 0) counts.set(facetId, (counts.get(facetId) ?? 0) + 1);
    }
  }
  const byId = new Map(facets.map((f) => [f.id, f]));
  // Not listed: after every listed facet.
  const listed = (id: string) => {
    const i = firstColumns.indexOf(id);
    return i === -1 ? firstColumns.length : i;
  };
  const ids = [...counts.keys()].sort((a, b) => {
    if (listed(a) !== listed(b)) return listed(a) - listed(b);
    const na = byId.get(a)?.number;
    const nb = byId.get(b)?.number;
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1; // a known facet before an unknown one
    if (nb !== undefined) return 1;
    return a.localeCompare(b);
  });
  return ids.map((id) => {
    const facet = byId.get(id);
    return {
      facetId: id,
      name: facet?.name ?? id,
      resultCount: counts.get(id) ?? 0,
      fields: facet ? facet.fields.map((f) => ({ id: f.id, name: f.name })) : [],
    };
  });
}

/**
 * What one cell shows: one set per occurrence of the column's facet in the
 * event, so values that belong together are never mixed with another
 * occurrence's ("right" stays with 2.2, "left" with 1.1). In a set, the fields
 * follow the dictionary's order, so a facet looks the same in every row; keys
 * the dictionary does not know come after, sorted. Values are text, exactly
 * as sent (`null` never reaches here: toEvent drops it).
 */
export function cellSets(event: EventRecord, column: FacetColumn): CellEntry[][] {
  const known = new Set(column.fields.map((f) => f.id));
  return (event.values[column.facetId] ?? []).map((occurrence) => [
    ...column.fields
      .filter((f) => f.id in occurrence)
      .map((f) => ({ name: f.name, value: String(occurrence[f.id]) })),
    ...Object.keys(occurrence)
      .filter((key) => !known.has(key))
      .sort()
      .map((key) => ({ name: key, value: String(occurrence[key]) })),
  ]);
}
```

Run: `npx vitest run tests/ui/eventTable.test.ts tests/util/paging.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

`shortId` now exists twice (dataPreview.ts too) until Task 3 removes the old one. That is fine for one commit.

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Pure helpers for the events table: paging, facet columns, cell sets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: State, actions and the table in the Matching events card

**Files:**
- Modify: `src/state.ts` (`PreviewState`, `openEventId`), `src/app.ts` (`runPreview`, `changeScope`, `resetPreview`, `showEventPage`, `openEvent`, `closeEvent`)
- Modify: `src/ui/eventTable.ts` (`eventTableHtml`, `pagingHtml`), `src/ui/dataPreview.ts` (the `"ok"` branch, removals, `wireDataPreview`)
- Modify: `src/config.ts` (`FIRST_COLUMNS` replaces `HIDDEN_ROW_BADGES`, `RowColumn`, `ROW_COLUMNS`)
- Modify: `src/ui/focusMemory.ts` (`data-event-id`), `src/main.ts` (wiring), `src/styles.css`
- Test: `tests/app.test.ts`, `tests/ui/eventTable.test.ts`, `tests/ui/dataPreview.test.ts`, `tests/ui/focusMemory.test.ts`
- Docs: `docs/ARCHITECTURE.md` (see Step 9)

**Interfaces:**
- Consumes:
  - `pageOf`, `PAGE_SIZE` (paging.ts);
  - `tableColumns`, `cellSets`, `shortId` (eventTable.ts);
  - `Facet.number`.
- Produces:
  - `PreviewState` `"ok"` = `{ status: "ok"; events: EventRecord[]; page: number }`;
  - `AppState.openEventId: string | null`;
  - app actions `showEventPage(page: number)`, `openEvent(id: string)`, `closeEvent()`;
  - `eventTableHtml(events, columns, page: Page, locale?)`, `pagingHtml(page: Page, locale?)`;
  - `wireDataPreview(container, hooks: { onRun(): void; onPage(page: number): void; onOpenEvent(id: string): void })`;
  - config `FIRST_COLUMNS: string[]`.

- [ ] **Step 1: Write the failing app tests**

In `tests/app.test.ts`, change every `{ status: "ok", events }` the app is expected to produce to `{ status: "ok", events, page: 0 }`. Test inputs that are fed into `previewAnnouncement` or into `setup(...)` also get `page: 0`, since the type requires it. Then add, near the Run query tests:

```ts
describe("Matching events pages and the event dialog", () => {
  const many: EventRecord[] = Array.from({ length: 250 }, (_, i) => ({ id: `e-${i}`, values: {} }));
  const shownMany = (): Partial<AppState> => ({
    ...ready(),
    preview: { status: "ok", events: many, page: 0 },
  });

  it("a run starts at the first page", async () => {
    const { app, store } = setup(ready(), fakeApi({ runQuery: vi.fn(async () => many) }));
    app.runPreview();
    await flushPromises();
    expect(store.getState().preview).toEqual({ status: "ok", events: many, page: 0 });
  });

  it("shows another page and says which results are shown", () => {
    const { app, store, announce } = setup(shownMany());
    app.showEventPage(2);
    expect(store.getState().preview).toMatchObject({ page: 2 });
    expect(announce).toHaveBeenCalledWith("Showing results 201 to 250 of 250.");
  });

  it("clamps a page that does not exist, and does nothing for the page on screen", () => {
    const { app, store, announce } = setup(shownMany());
    app.showEventPage(9);
    expect(store.getState().preview).toMatchObject({ page: 2 });
    announce.mockClear();
    app.showEventPage(2);
    expect(announce).not.toHaveBeenCalled();
  });

  it("a query edit resets the page and closes the dialog with the results", () => {
    const { app, store } = setup({ ...shownMany(), openEventId: "e-3" });
    app.onQueryChange(runnableQuery(9));
    expect(store.getState().preview).toEqual({ status: "idle" });
    expect(store.getState().openEventId).toBeNull();
  });

  it("opens the dialog for a shown event only, and closes it", () => {
    const { app, store } = setup(shownMany());
    app.openEvent("ghost");
    expect(store.getState().openEventId).toBeNull();
    app.openEvent("e-3");
    expect(store.getState().openEventId).toBe("e-3");
    app.closeEvent();
    expect(store.getState().openEventId).toBeNull();
  });
});
```

(Import `EventRecord` from `../src/model` and `AppState` from `../src/state` if the file does not already.)

Run: `npx vitest run tests/app.test.ts`
Expected: FAIL (TypeScript: no `page`, `openEventId`, `showEventPage`, …).

- [ ] **Step 2: Implement state and actions**

`src/state.ts`:

```ts
/** The Matching events request. Only "ok" carries events (and which page of
 *  them is on screen, 0-based: src/util/paging.ts), only "error" a message. */
export type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; events: EventRecord[]; page: number }
  | { status: "error"; error: string };
```

In `AppState`, after `preview`:

```ts
  /** The event whose JSON dialog is open (an `EventRecord.id` of the results
   *  on screen), or null. Closed with the results whenever they reset. */
  openEventId: string | null;
```

and `openEventId: null,` in `initialState`.

`src/app.ts`: add `import { pageOf } from "./util/paging";`.
- In `runPreview`: `show({ status: "ok", events, page: 0 })`.
- In `changeScope`'s `setState` and in `resetPreview`'s `setState`: add `openEventId: null` (the dialog shows one of the results being reset).
- Add the actions:

```ts
  /** Show page `page` of the results (clamped to the pages that exist) and
   *  say which results are on screen: the table repaints out of sight of a
   *  screen-reader user. */
  function showEventPage(page: number): void {
    const { preview } = store.getState();
    if (preview.status !== "ok") return;
    const shown = pageOf(preview.events.length, page);
    if (shown.page === preview.page) return;
    store.setState({ preview: { ...preview, page: shown.page } });
    announce(`Showing results ${shown.from} to ${shown.to} of ${shown.total}.`);
  }

  /** Open the JSON dialog of a result on screen (an id from an older run,
   *  clicked on a stale screen, opens nothing). */
  function openEvent(id: string): void {
    const { preview } = store.getState();
    if (preview.status === "ok" && preview.events.some((e) => e.id === id)) {
      store.setState({ openEventId: id });
    }
  }

  function closeEvent(): void {
    if (store.getState().openEventId !== null) store.setState({ openEventId: null });
  }
```

and return `showEventPage, openEvent, closeEvent` from `createApp`.

Run: `npx vitest run tests/app.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing table HTML tests**

Append to `tests/ui/eventTable.test.ts` (and import `eventTableHtml`, `pagingHtml` and `pageOf` from `../../src/util/paging`):

```ts
describe("eventTableHtml", () => {
  const columns = tableColumns(events, facets, []);
  const html = eventTableHtml(events, columns, pageOf(events.length, 0), "en-US");

  it("is a real table in a focusable, labelled scroll box with a hidden caption", () => {
    expect(html).toContain(
      '<div class="qb-et-scroll" tabindex="0" role="region" aria-label="Matching events table">',
    );
    expect(html).toContain('<caption class="qb-sr-only">Matching events</caption>');
  });

  it("heads each facet column with its name and how many results hold it", () => {
    expect(html).toContain(
      '<th scope="col"><span class="qb-et-facet">A</span><span class="qb-et-count">in 1 of 2 results</span></th>',
    );
  });

  it("makes each row's id cell its row header, holding the button that opens its JSON", () => {
    expect(html).toContain(
      '<th scope="row" class="qb-et-id"><button type="button" class="qb-et-id-btn" data-action="open-event" data-event-id="e1" aria-label="Show event e1 as JSON" title="Event e1">#e1</button></th>',
    );
  });

  it("draws each occurrence as its own set", () => {
    expect(html).toContain(
      '<ul class="qb-et-sets"><li><dl class="qb-et-set"><dt>pos name</dt><dd>right</dd><dt>val name</dt><dd>2.2</dd></dl></li><li><dl class="qb-et-set"><dt>pos name</dt><dd>left</dd><dt>val name</dt><dd>1.1</dd></dl></li></ul>',
    );
  });

  it("shows — for an occurrence with no values, and nothing for a missing facet", () => {
    const empty = eventTableHtml([event("e", { a: [{}] })], tableColumns([event("e", { a: [{}] })], facets, []), pageOf(1, 0));
    expect(empty).toContain('<li><span class="qb-et-empty">—</span></li>');
    expect(html).toContain("<td></td>");
  });

  it("escapes every text", () => {
    const bad = [event('"><img>', { a: [{ pos: "<b>" }] })];
    const out = eventTableHtml(bad, tableColumns(bad, facets, []), pageOf(1, 0));
    expect(out).not.toContain("<img>");
    expect(out).not.toContain("<b>");
  });

  it("shows only the rows of the page, and says which page in the caption", () => {
    const many = Array.from({ length: 150 }, (_, i) => event(`e${i}`, { b: [{ x: i }] }));
    const second = eventTableHtml(many, tableColumns(many, facets, []), pageOf(150, 1));
    expect(second).toContain("Matching events, page 2 of 2");
    expect(second).toContain('data-event-id="e100"');
    expect(second).not.toContain('data-event-id="e99"');
  });
});

describe("pagingHtml", () => {
  it("says how many results when they fit on one page, with no buttons", () => {
    expect(pagingHtml(pageOf(42, 0), "en-US")).toBe('<p class="qb-et-paging">42 results</p>');
  });

  it("says which results are shown, with Previous and Next", () => {
    const html = pagingHtml(pageOf(1987, 1), "en-US");
    expect(html).toContain("Results 101–200 of 1,987");
    expect(html).toContain('data-action="previous-event-page" data-page="0">Previous</button>');
    expect(html).toContain('data-action="next-event-page" data-page="2">Next</button>');
  });

  it("disables Previous on the first page and Next on the last", () => {
    expect(pagingHtml(pageOf(150, 0))).toContain('data-page="-1" disabled>Previous');
    expect(pagingHtml(pageOf(150, 1))).toContain('data-page="2" disabled>Next');
  });
});
```

Run: `npx vitest run tests/ui/eventTable.test.ts`
Expected: FAIL (`eventTableHtml` / `pagingHtml` not exported).

- [ ] **Step 4: Write `eventTableHtml` and `pagingHtml`**

Append to `src/ui/eventTable.ts` (add the imports `import { escapeHtml } from "./panel";`, `import { countLabel, exact } from "./format";` and `import type { Page } from "../util/paging";`):

```ts
/** One cell: nothing when the result lacks the facet; otherwise one set per
 *  occurrence, each a small definition list, all in a list, so a screen
 *  reader reads them as separate sets too. */
function cellHtml(sets: CellEntry[][]): string {
  if (sets.length === 0) return "";
  const setHtml = (set: CellEntry[]) =>
    set.length === 0
      ? `<span class="qb-et-empty">—</span>`
      : `<dl class="qb-et-set">${set.map((e) => `<dt>${escapeHtml(e.name)}</dt><dd>${escapeHtml(e.value)}</dd>`).join("")}</dl>`;
  return `<ul class="qb-et-sets">${sets.map((set) => `<li>${setHtml(set)}</li>`).join("")}</ul>`;
}

/**
 * The table for one page of the results, in its scroll box. The header row
 * and the id column are sticky (styles.css): the headers stay in view while
 * the user scrolls down and move with their columns sideways, so a value
 * never loses its header (maintainers, 2026-10-13). Every text is escaped.
 */
export function eventTableHtml(
  events: EventRecord[],
  columns: FacetColumn[],
  page: Page,
  locale?: string,
): string {
  const caption =
    page.pageCount > 1 ? `Matching events, page ${page.page + 1} of ${page.pageCount}` : "Matching events";
  const total = exact(page.total, locale);
  const head = columns
    .map(
      (c) =>
        `<th scope="col"><span class="qb-et-facet">${escapeHtml(c.name)}</span><span class="qb-et-count">in ${exact(c.resultCount, locale)} of ${total} results</span></th>`,
    )
    .join("");
  const rows = events
    .slice(Math.max(0, page.from - 1), page.to)
    .map((e) => {
      const id = escapeHtml(e.id);
      const short = escapeHtml(shortId(e.id));
      const cells = columns.map((c) => `<td>${cellHtml(cellSets(e, c))}</td>`).join("");
      return `<tr><th scope="row" class="qb-et-id"><button type="button" class="qb-et-id-btn" data-action="open-event" data-event-id="${id}" aria-label="Show event ${short} as JSON" title="Event ${id}">#${short}</button></th>${cells}</tr>`;
    })
    .join("");
  return `<div class="qb-et-scroll" tabindex="0" role="region" aria-label="Matching events table"><table class="qb-et"><caption class="qb-sr-only">${caption}</caption><thead><tr><th scope="col" class="qb-et-id">Event</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/**
 * The line above the table: "42 results" when they fit on one page,
 * otherwise "Results 101–200 of 1,987" with Previous and Next. "Results" is
 * the one word for the returned sample, so nobody reads a count as a total
 * across all databases (maintainers, 2026-10-13). The two buttons have their
 * own `data-action`, so a repaint keeps the keyboard focus on the one pressed.
 */
export function pagingHtml(page: Page, locale?: string): string {
  if (page.pageCount === 1) {
    return `<p class="qb-et-paging">${countLabel(page.total, "result", "results", locale)}</p>`;
  }
  const first = page.page === 0 ? " disabled" : "";
  const last = page.page === page.pageCount - 1 ? " disabled" : "";
  return `<div class="qb-et-paging">
    <span>Results ${exact(page.from, locale)}–${exact(page.to, locale)} of ${exact(page.total, locale)}</span>
    <button type="button" class="ui mini basic button" data-action="previous-event-page" data-page="${page.page - 1}"${first}>Previous</button>
    <button type="button" class="ui mini basic button" data-action="next-event-page" data-page="${page.page + 1}"${last}>Next</button>
  </div>`;
}
```

If the expected strings in the Step 3 tests differ only in whitespace from these templates (the paging buttons sit on separate lines), adjust the tests' `toContain` fragments to single-line pieces that exist. The tests check the content, not the indentation.

Run: `npx vitest run tests/ui/eventTable.test.ts`
Expected: PASS.

- [ ] **Step 5: Config, panel and wiring**

`src/config.ts`: delete `HIDDEN_ROW_BADGES`, `RowColumn` and `ROW_COLUMNS` with their comments, and add:

```ts
/**
 * Facets shown first in the Matching events table, right after the event id,
 * in this order (`Facet.id`, the backend's label). The other facets follow by
 * facet number. A listed facet that no result holds gets no column. Empty by
 * default: then every column is ordered by facet number.
 *
 * Example: ["some_facet", "other_facet"]
 */
export const FIRST_COLUMNS: string[] = [];
```

`src/ui/dataPreview.ts`:
- Delete `MAX_TAG_BADGES`, `MAX_GROUP_BADGES`, `facetsById`, `eventBadges`, `badgesHtml`, `tagsAndGroupsHtml`, `fieldValues`, `rowCell`, `shortId`, `rowGrid` and `eventRowHtml`, and the imports only they used.
- Import `FIRST_COLUMNS` from `../config`, `pageOf` from `../util/paging`, and `eventTableHtml`, `pagingHtml`, `tableColumns` from `./eventTable`.
- Replace the end of `renderDataPreview` (after the `events.length === 0` branch) with:

```ts
  // One page of the results as a table: columns from the whole sample, so
  // they stay put while paging (docs/ARCHITECTURE.md, "Under the query —
  // `dataPreview.ts` (Matching events)").
  const page = pageOf(events.length, p.page);
  const columns = tableColumns(events, state.facets ?? [], FIRST_COLUMNS);
  paint(el, card(pagingHtml(page) + eventTableHtml(events, columns, page), events.length));
```

- Replace `wireDataPreview`:

```ts
/** One delegated listener for the card's buttons: Run / Try again, Previous /
 *  Next, and each result's id. Call once at startup. */
export function wireDataPreview(
  container: HTMLElement,
  hooks: { onRun(): void; onPage(page: number): void; onOpenEvent(id: string): void },
): void {
  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    if (action === "run") hooks.onRun();
    else if (action === "previous-event-page" || action === "next-event-page") {
      hooks.onPage(Number(btn.dataset.page));
    } else if (action === "open-event" && btn.dataset.eventId) {
      hooks.onOpenEvent(btn.dataset.eventId);
    }
  });
}
```

`src/main.ts`:

```ts
wireDataPreview(panels.preview, {
  onRun: app.runPreview,
  onPage: app.showEventPage,
  onOpenEvent: app.openEvent,
});
```

`src/ui/focusMemory.ts`: put `"data-event-id",` FIRST in `IDENTIFYING_ATTRIBUTES`, with the comment "every result's id button shares its `data-action`; its event id tells them apart". In `tests/ui/focusMemory.test.ts` add:

```ts
  it("tells the results' id buttons apart by their event id", () => {
    const attrs: Record<string, string> = { "data-action": "open-event", "data-event-id": "e7" };
    const el = { tagName: "BUTTON", getAttribute: (n: string) => attrs[n] ?? null };
    expect(controlOf(el)).toEqual({ tag: "BUTTON", attribute: "data-event-id", value: "e7" });
  });
```

`tests/ui/dataPreview.test.ts`: delete the `eventBadges`, `rowCell`, `fieldValues`, `shortId` and `rowGrid` tests (shortId's moved to eventTable.test.ts). Keep the `EVENT_SAMPLE_SIZE` / `idleMessage` tests.

- [ ] **Step 6: Styles**

In `src/styles.css`:
- Delete the rules for `.qb-preview-note`, `.qb-event-list`, `.qb-event-row*`, `.qb-er-*` and `.qb-group-badge`, after checking with `grep -rn "qb-group-badge\|qb-er-\|qb-event-row\|qb-event-list\|qb-preview-note" src` that nothing else uses them.
- Add:

```css
/* ---- Matching events table (src/ui/eventTable.ts) ----
   A plain table in its own scroll box. The header row sticks to the top of
   the box and moves sideways with its columns; the id column sticks to the
   left; the corner cell sits above both. Sticky cells need an opaque
   background, or the scrolled cells show through them. border-collapse must
   be "separate": collapsed borders do not move with sticky cells. */
.qb-et-paging {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: var(--qb-muted);
}
.qb-et-paging .ui.button {
  margin: 0;
}
.qb-et-scroll {
  max-height: 70vh;
  overflow: auto;
  border: 1px solid var(--qb-border);
  border-radius: var(--qb-radius);
}
.qb-et-scroll:focus-visible {
  outline: 2px solid var(--qb-and);
  outline-offset: 2px;
}
.qb-et {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.8rem;
}
.qb-et th,
.qb-et td {
  padding: 0.4rem 0.5rem;
  border-right: 1px solid var(--qb-border);
  border-bottom: 1px solid var(--qb-border);
  background: var(--qb-surface);
  text-align: left;
  vertical-align: top;
}
.qb-et td {
  min-width: 8rem;
  max-width: 16rem;
  overflow-wrap: anywhere;
}
.qb-et thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--qb-surface-2);
}
.qb-et .qb-et-id {
  position: sticky;
  left: 0;
  z-index: 1;
  white-space: nowrap;
}
.qb-et thead .qb-et-id {
  z-index: 2; /* the corner: above the sticky header row and the id column */
}
.qb-et-facet {
  display: block;
  font-weight: 700;
}
.qb-et-count {
  display: block;
  font-weight: 400;
  font-size: 0.72rem;
  color: var(--qb-muted);
}
.qb-et-id-btn {
  padding: 0;
  border: 0;
  background: none;
  color: var(--qb-and);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}
.qb-et-id-btn:focus-visible {
  outline: 2px solid var(--qb-and);
  outline-offset: 2px;
}
.qb-et-sets {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* One occurrence: its fields as a small two-column box, so the values that
   belong together read as one set. */
.qb-et-set {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 0.4rem;
  margin: 0;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--qb-border-strong);
  border-radius: 4px;
}
.qb-et-set dt {
  color: var(--qb-muted);
}
.qb-et-set dd {
  margin: 0;
}
.qb-et-empty {
  color: var(--qb-muted);
}
```

- Check that `tests/themeContrast.test.ts` covers the pairs this uses:
  - `qb-and` (the id link) on `qb-surface`; add it to `PAIRS` if it is missing, since it is text;
  - `qb-muted` on `qb-surface` and on `qb-surface-2`.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS.

- [ ] **Step 8: Check in Chromium**

Serve a synthetic 2,000-result answer with `page.route("**/api/v1/filter/execute", …)`. The mock only has 21 events, so build them in the script:
- `{ events: [...] }`, each event `{ id: "<guid>", items: [...] }`;
- 20–40 facet labels taken from the real `GET /api/v1/documentation/individuals` response, so they have dictionary names;
- a few facets in every event, many in only ~10 events;
- one facet with two occurrences per event.

Log in and give a compliance reason through the mock, add a condition, Run query, then check:
1. The paging line reads "Results 1–100 of 2,000". **Next** moves to "Results 101–200 of 2,000" fast (well under a second), and the keyboard focus stays on **Next**.
2. Header row: set `scrollTop = 600` on `.qb-et-scroll`. A header `th`'s `getBoundingClientRect().top` equals the scroll box's top (±1 px).
3. Columns: set `scrollLeft = 600`. The 5th header cell's left has moved by 600 px together with its column's cells. The id `th`'s left equals the box's left (±1 px).
4. The two-occurrence facet shows two separate boxes in one cell.
5. The counts read "in N of 2,000 results".
6. At a 512 px wide window, the box scrolls both ways and nothing overflows the card.

Take screenshots of 1 and 6. Stop only the servers you started.

- [ ] **Step 9: Docs**

`docs/ARCHITECTURE.md`:
- **"Under the query — `dataPreview.ts` (Matching events)":** rewrite the result description for the table, per the spec's "What the user sees". Replace "**Decision: a list, not a grid.** …" with "**Decided 2026-10-13 by the users: a table, not a list.** …". Give their reason (comparing values across results; a horizontal scroll bar is accepted), say that per-field columns belong to a later Event viewer, and note "keep it simple" (plain table, CSS sticky, pages of 100, no library).
- **"State and the render loop":** `preview` `"ok"` carries `page`; `openEventId`; triggers-table rows for Previous / Next (`app.showEventPage`) and for an id (`app.openEvent`).
- **"Keyboard focus across repaints":** add `data-event-id` to the attribute list (first); the paging buttons keep focus by their own `data-action`.
- **"Directory layout":** `src/util/paging.ts`, `src/ui/eventTable.ts`; `config.ts` now lists `FIRST_COLUMNS` (not `HIDDEN_ROW_BADGES`, `ROW_COLUMNS`).
- **"How do I…":** "**…hide a badge, or add a column to the Matching events rows?**" becomes "**…show certain facets first in the Matching events table?**", which says to edit `FIRST_COLUMNS` in `src/config.ts`.
- Grep `grep -n "ROW_COLUMNS\|HIDDEN_ROW_BADGES\|badge\|a list, not a grid" docs/ARCHITECTURE.md README.md src`. Every hit that describes the Matching events rows as they used to be must go. The account menu's compliance badge is a different thing; keep it.

- [ ] **Step 10: Check and commit**

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Show the matching events as a paged table, one column per facet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The event JSON dialog

**Files:**
- Create: `src/ui/eventDialog.ts`
- Modify: `src/ui/layout.ts` (a second `<dialog>`, `Shell.eventDialog`), `src/main.ts` (renderer row and wiring), `src/styles.css`
- Test: `tests/ui/eventDialog.test.ts`, `tests/ui/layout.test.ts` (if it checks the shell template)
- Docs: `docs/ARCHITECTURE.md` "Under the query — `dataPreview.ts` (Matching events)"

**Interfaces:**
- Consumes: `AppState.openEventId`, `app.closeEvent()`, `shortId` (eventTable.ts).
- Produces:
  - `EVENT_TITLE_ID = "qb-event-title"`;
  - `openEventOf(state: Pick<AppState, "openEventId" | "preview">): EventRecord | null`;
  - `eventDialogHtml(event: EventRecord | null): string`;
  - `renderEventDialog(dialog: HTMLDialogElement, state: AppState): void`;
  - `wireEventDialog(dialog: HTMLDialogElement, onClose: () => void): void`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/eventDialog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialState } from "../../src/state";
import { EVENT_TITLE_ID, eventDialogHtml, openEventOf } from "../../src/ui/eventDialog";

const event = { id: "6f1c2a9e-0b7d-4c55-9a43-2f0e8d1b7c10", values: { a: [{ x: "<b>" }] } };
const shown = { ...initialState, preview: { status: "ok" as const, events: [event], page: 0 } };

describe("openEventOf", () => {
  it("is the open result, or null when none is open or it is gone", () => {
    expect(openEventOf({ ...shown, openEventId: event.id })).toBe(event);
    expect(openEventOf({ ...shown, openEventId: null })).toBeNull();
    expect(openEventOf({ ...initialState, openEventId: event.id })).toBeNull();
  });
});

describe("eventDialogHtml", () => {
  it("is empty while no event is open", () => {
    expect(eventDialogHtml(null)).toBe("");
  });

  it("titles the dialog with the short id, shows the whole id and the JSON, escaped", () => {
    const html = eventDialogHtml(event);
    expect(html).toContain(`<h2 class="qb-dialog-title" id="${EVENT_TITLE_ID}">Event 6f1c2a9e…</h2>`);
    expect(html).toContain(event.id);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("has a Close button that takes the focus first", () => {
    expect(eventDialogHtml(event)).toContain(
      '<button type="button" class="ui small basic button" data-action="close-event" data-initial-focus>Close</button>',
    );
  });
});
```

Run: `npx vitest run tests/ui/eventDialog.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Write `src/ui/eventDialog.ts`**

```ts
import type { AppState } from "../state";
import type { EventRecord } from "../model";
import { escapeHtml, paint } from "./panel";
import { shortId } from "./eventTable";

/**
 * One result's JSON, in a native <dialog> (docs/ARCHITECTURE.md, "Under the
 * query — `dataPreview.ts` (Matching events)"). An expanded row would sit far
 * off to the left inside the wide, sideways-scrolled table; a dialog does not,
 * and it is where a later Event viewer can plug in. Built like the saved-
 * queries dialog: created once by the shell, painted from the state, opened
 * and closed to match `openEventId`, closed by Escape, and the focus goes back
 * to the id button that opened it.
 */

/** The heading's id: the <dialog> in layout.ts is labelled by it. */
export const EVENT_TITLE_ID = "qb-event-title";

/** The open result, or null: none is open, or it is not among the results
 *  on screen any more. */
export function openEventOf(state: Pick<AppState, "openEventId" | "preview">): EventRecord | null {
  const { openEventId, preview } = state;
  if (openEventId === null || preview.status !== "ok") return null;
  return preview.events.find((e) => e.id === openEventId) ?? null;
}

export function eventDialogHtml(event: EventRecord | null): string {
  if (!event) return "";
  return `<h2 class="qb-dialog-title" id="${EVENT_TITLE_ID}">Event ${escapeHtml(shortId(event.id))}</h2>
    <p class="qb-dialog-hint">${escapeHtml(event.id)}</p>
    <pre class="qb-event-json" tabindex="0" aria-label="The event as JSON">${escapeHtml(JSON.stringify(event, null, 2))}</pre>
    <div class="qb-dialog-actions">
      <button type="button" class="ui small basic button" data-action="close-event" data-initial-focus>Close</button>
    </div>`;
}

// ---- The browser part (needs a DOM, so it is checked in a browser) --------

/** Which event each dialog showed at its last render: closing gives the
 *  focus back to that event's id button. */
const shownId = new WeakMap<HTMLDialogElement, string>();

export function renderEventDialog(dialog: HTMLDialogElement, state: AppState): void {
  const event = openEventOf(state);
  const before = shownId.get(dialog);
  if (!event) {
    shownId.delete(dialog);
    if (dialog.open) dialog.close();
    paint(dialog, "");
    // The table may have been repainted meanwhile, so the button is looked up again.
    if (before) {
      dialog.ownerDocument
        .querySelector<HTMLElement>(`[data-event-id="${CSS.escape(before)}"]`)
        ?.focus();
    }
    return;
  }
  shownId.set(dialog, event.id);
  paint(dialog, eventDialogHtml(event));
  if (!dialog.open) dialog.showModal();
  if (before !== event.id) dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
}

/** Close, Escape, and a close the state did not ask for all tell the state.
 *  Call once at startup. */
export function wireEventDialog(dialog: HTMLDialogElement, onClose: () => void): void {
  dialog.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-action='close-event']")) onClose();
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    onClose();
  });
  dialog.addEventListener("close", () => {
    if (shownId.has(dialog)) onClose();
  });
}
```

Run: `npx vitest run tests/ui/eventDialog.test.ts`
Expected: PASS.

- [ ] **Step 3: Shell, wiring, styles**

`src/ui/layout.ts`:
- `import { EVENT_TITLE_ID } from "./eventDialog";`
- After the saved-queries `<dialog>` in the template: `<dialog class="qb-dialog qb-event-dialog" data-panel="event" aria-labelledby="${EVENT_TITLE_ID}"></dialog>`.
- In `Shell`:

```ts
  /** The event JSON dialog (eventDialog.ts). Never replaced, like `savedDialog`. */
  eventDialog: HTMLDialogElement;
```

- In the returned object: `eventDialog: find<HTMLDialogElement>('[data-panel="event"]'),`.

`src/main.ts`:
- Import `renderEventDialog` and `wireEventDialog`.
- Wire it: `wireEventDialog(shell.eventDialog, app.closeEvent);`.
- Append a last row to `panelRenderers`, after the saved dialog's, so that closing focuses an id button that is already repainted:

```ts
  {
    keys: ["openEventId", "preview"],
    run: (s) => renderEventDialog(shell.eventDialog, s),
  },
```

`src/styles.css`, after the saved-queries dialog rules:

```css
/* The event JSON dialog (src/ui/eventDialog.ts): wider than the saved-queries
   one, the JSON scrolls inside it. */
.qb-event-dialog {
  width: min(48rem, calc(100vw - 2rem));
}
.qb-event-json {
  max-height: 60vh;
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  overflow: auto;
  border: 1px solid var(--qb-border);
  border-radius: 4px;
  background: var(--qb-surface-2);
  font-size: 0.8rem;
}
.qb-event-json:focus-visible {
  outline: 2px solid var(--qb-and);
  outline-offset: 2px;
}
```

If `tests/ui/layout.test.ts` asserts the shell template, add a check that it holds the event `<dialog>` labelled by `EVENT_TITLE_ID`.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Check in Chromium**

With the Task 3 setup:
- Press an id with the mouse. The dialog shows "Event <short id>", the whole id and the JSON; the focus is on **Close**.
- Escape closes it, and the focus returns to that id button.
- Tab to another id and press Enter. It opens, and **Close** returns the focus to it.
- At 512 px the dialog fits, and the JSON scrolls inside it.

Stop only your servers.

- [ ] **Step 6: Docs and commit**

In "Under the query — `dataPreview.ts` (Matching events)", describe the dialog:
- an id opens the event's JSON in a dialog;
- Escape and **Close** close it, and the focus goes back to that id;
- it is where the later Event viewer can plug in.

Add `eventDialog.ts` to "Directory layout".

```bash
npm run typecheck && npm test && npm run lint && npm run build
git add -A
git commit -m "Open a result's JSON in a dialog from its id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final check and push

**Files:** none new.

- [ ] **Step 1: Sync**

```bash
git fetch origin
git log --oneline HEAD..origin/main
```

If `main` moved and the feedback branch is merged, do Task 0 Step 2 now. Re-run everything and report what changed upstream.

- [ ] **Step 2: All checks and a sweep**

```bash
npm run typecheck && npm test && npm run lint && npm run build
grep -rn "ROW_COLUMNS\|HIDDEN_ROW_BADGES\|eventBadges\|rowCell\|rowGrid\|qb-event-row\|qb-er-" src tests docs/ARCHITECTURE.md README.md
```

Expected: the checks pass, and the grep finds nothing.

- [ ] **Step 3: Push and report**

Leave this plan file on the branch until it is merged, then delete it (plans live only while a feature is being built).

```bash
git push -u origin claude/matching-events-table
```

Report:
- what changed, per task;
- the four commands;
- the Chromium checks, with screenshots;
- whether the branch is still stacked on `claude/user-feedback-round`.

Do not open a pull request unless asked.
