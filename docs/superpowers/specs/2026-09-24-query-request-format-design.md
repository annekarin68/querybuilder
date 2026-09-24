# Query request format — design

Status: approved in chat on 2026-09-24, ready for implementation planning.

## 1. Problem

`POST /api/stats` and `POST /api/query` take `{ query, databases }`, where
`query` is the query builder's own editing state, `JSON.stringify`'d as-is.
The editing model and the API contract are the same object, which causes:

1. **No request type in the contract.** `src/api/types.ts` is meant to hold
   every request and response type, but the body is typed as `QueryNode`
   from `src/query/types.ts`. A UI rename or a new UI flag silently changes
   the API; `collapsed`, `facetId` and node `id`s already go over the wire as
   noise. The type allows `null` field/operator ids and `value: unknown`, so
   it cannot say "finished conditions only". The mock server keeps its own
   `JsonNode` type to cope.
2. **A dotted field id.** `fieldId` is `"facetLabel.fieldLabel"`, which the
   backend has to split. Nothing forbids a `.` in a label, and then:
   - `findField` can return the wrong field (facet `a.b` + field `c` and
     facet `a` + field `b.c` have the same id);
   - the Field dropdown, filtered by the prefix `"facet."`
     (`src/ui/queryBuilder.ts`), lists facet `a.b`'s fields under facet `a`.
3. **Numbers and booleans sent as strings.** A field with a `values` list
   becomes an `enum`, which replaces its declared type. `values` are strings,
   so a BOOLEAN or integer field with a values list sends `"true"` / `"3"`
   instead of `true` / `3`. It also loses its comparison operators.
4. **Values are not type-checked.** `validate.ts` only checks that a value is
   present, plus the date format. A query restored after the login or
   compliance redirect is untrusted input, and its values are never checked
   before being sent.
5. **No versioning.** After a deploy, a cached old bundle sends the old shape
   and the backend cannot tell.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | The API path prefix is set in one committed config file, `.env` (`VITE_API_BASE=/api/v1`). Versioning is done by changing the prefix. The request body has no version field. |
| D2 | New request types in `src/api/types.ts`; a pure converter `toQueryRequest` in `src/query/request.ts` builds them from the UI tree. |
| D3 | A field is identified by the pair (facet label, field label), both on the wire and inside the frontend. No dotted ids anywhere in `src/`. |
| D4 | The value type always comes from the declared `type`/`format`. `FacetField.values` is a list of suggestions (a pick-list), never a type, and the user may enter values that are not on it. |
| D5 | "Is any of" (`in`) is offered on every string and number field. |
| D6 | Values are type-checked in `validate.ts`; a reversed number range is invalid. |
| D7 | The mock server serves under the same prefix and answers 400 to a malformed body. |

## 3. API prefix (D1)

- **`.env`** at the repo root, committed, holds `VITE_API_BASE=/api/v1` (no
  trailing slash). Vite reads it for dev, build and tests. A deployment
  overrides it the usual Vite way: `.env.local` (already git-ignored by
  `*.local`), `.env.production`, or an environment variable at build time.
- **`src/api/client.ts`** drops its `?? "/api"` fallback. `.env` is the only
  place the default lives. `src/vendor.d.ts` types `VITE_API_BASE` as a
  required `string`.
- **An unset prefix fails the build**, never the running app:
  `vite.config.ts` reads the setting with `loadEnv` and throws a clear error
  when it is empty. A test checks that `.env` sets it.
- **The whole API moves together**: data endpoints, `auth/*` and
  `compliance/*`. `LOGIN_URL` and `COMPLIANCE_START_URL` already follow the
  prefix. The backend registers its login and compliance callback URLs under
  whatever prefix is deployed.
- **The dev proxy** in `vite.config.ts` proxies the configured prefix (read
  with `loadEnv`) instead of a hard-coded `/api`. `/mock-idp` and
  `/mock-compliance` stay as they are: they stand in for external services.
- **The mock server** reads the same setting with Vite's `loadEnv` in
  `mock-server/index.ts` and passes it to `createMockServer` as
  `MockConfig.apiBase`. Every route key and every redirect it issues
  (`…/auth/login`, `…/auth/callback`, `…/compliance/callback`) is built from
  it. Tests pass `apiBase` directly.

## 4. Request types and converter (D2)

In `src/api/types.ts`:

```ts
/** The body of POST {prefix}/stats and POST {prefix}/query. */
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
  /** An operator label, e.g. "gt" (§6). */
  operatorId: string;
  /** Shaped by the operator (§6). */
  value: RequestValue;
}

export type RequestScalar = string | number | boolean;
export type RequestValue = null | RequestScalar | RequestScalar[];
```

- **`toQueryRequest(query: Group, databases: string[]): QueryRequest`** in
  the new `src/query/request.ts`. It is pure:
  - it keeps `kind`, `id`, `operator`, `children`, `facetId`, `fieldId`,
    `operatorId` and `value`, and drops `collapsed`;
  - operators and values pass through unchanged. It never rewrites a
    condition (docs/ARCHITECTURE.md, "Dates": the backend interprets the
    query);
  - it throws on an unfinished condition (a `null` id) or a value that is not
    `null`, a scalar or a list of scalars. `app.ts` only calls it after
    `runBlocker` returns null, so a throw means a bug.
- **`client.ts`**: `getStats(body: QueryRequest, onLine, signal?)` and
  `runQuery(body: QueryRequest, signal?)` send `body` as given. `AppApi` in
  `app.ts` changes to match.
- **`app.ts`**: `runPreview` and `refreshStats` build the body with
  `toQueryRequest(state.query, state.selectedDatabaseIds)` after their
  existing `runBlocker` check.
- The sent tree never has an empty group: validation reports an empty
  non-root group, and `runBlocker` blocks a query with no conditions.

## 5. Field identity (D3)

- **`Condition`** (`src/query/types.ts`): `facetId` holds `Facet.label` and
  is now part of what the condition targets, not "UI staging only".
  `fieldId` holds the field's own `FacetField.label`.
- **`CatalogField`** (`src/query/fieldCatalog.ts`): the dotted `label` is
  replaced by `facetLabel` and `fieldLabel`. `name` ("Facet name: field
  name") and `fieldName` stay.
- **`findField(catalog, facetId, fieldId)`** matches both labels.
- **`fieldsOfFacet(catalog, facetId)`** (new, in `fieldCatalog.ts`) returns
  the fields whose `facetLabel === facetId`. The Field dropdown
  (`queryBuilder.ts`) uses it instead of its prefix filter, with `fieldLabel`
  as each option's value.
- **`conditionEdit.ts`, `validate.ts`, `summary.ts`** look fields up by the
  pair. The cascade is unchanged: a new facet clears field, operator and
  value.
- **`pendingQuery.ts`** keeps its structural check. A query saved by an older
  build carries a dotted `fieldId`. Validation reports it as "Unknown field."
  for the user to fix. There is no migration.

## 6. Value types, operators and pick-lists (D4, D5)

**Value type.** `ValueType` is `"string" | "number" | "boolean" | "date"`;
`"enum"` is removed. `buildFieldCatalog` always takes it from
`valueTypeFor(type/format)`, whether or not the field has `values`.

**Pick-list.** `CatalogField.options` holds the known values that are valid
for the field's type:

| Type | `options` |
|---|---|
| string | every entry of `values` |
| number | the entries of `values` that are finite numbers (`Number(v)`, non-blank) |
| boolean, date | none: a boolean has its toggle; a date is typed as a partial timestamp |

When nothing is left, the field has no pick-list. `FacetField.values`' doc
comment in `src/api/types.ts` says it is a static list built ahead of time,
which can be out of date, so the frontend uses it only for suggestions.

**Operators** stay keyed by value type only:

| Type | Operators |
|---|---|
| string | `eq`, `neq`, `contains`, `in`, `isEmpty`, `isNotEmpty` |
| number | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `isEmpty`, `isNotEmpty` |
| boolean | `eq`, `neq` |
| date | `eq`, `neq`, `before`, `after`, `between`, `isEmpty`, `isNotEmpty` |

Changes from today: string and number fields gain `in`; a field that used to
be an `enum` keeps its type's operators, so a string field with values gains
`contains`.

**Value controls** (`src/ui/valueControl.ts`), by operator and type:

| Operator | string | number | boolean | date |
|---|---|---|---|---|
| `eq`, `neq` | free-entry dropdown if it has a pick-list, else a text input | free-entry dropdown if it has a pick-list, else a number input | toggle | text input (partial timestamp) |
| `in` | free-entry multi dropdown | free-entry multi dropdown | — | — |
| `gt`, `gte`, `lt`, `lte`, `contains` | text input | number input | — | — |
| `before`, `after` | — | — | — | text input |
| `between` | — | two number inputs | — | two text inputs |
| `isEmpty`, `isNotEmpty` | nothing | nothing | — | nothing |

- **A free-entry dropdown** is a Fomantic `search` dropdown with
  `allowAdditions`. It lists the pick-list, and typing a value that is not on
  the list adds it. `in` uses the multiple variant, with or without a
  pick-list. `fomantic.ts` activates dropdowns marked for free entry (a data
  attribute set by `valueControl.ts`) with `allowAdditions: true`; all other
  dropdowns keep today's settings.
- **A value not on the pick-list** (typed earlier, or restored) is rendered as
  its own selected option, so it survives a repaint.
- **Reading a value back** (`readValueControl`) converts each picked or typed
  entry to the field's type. For a number field, a non-blank entry that is a
  finite number becomes a `number`. Any other entry is kept as the text
  typed, so validation can report it and the value is never dropped
  silently. String entries stay strings.

**Values on the wire** (documented in ARCHITECTURE.md, "Wire format of the
query"):

| Field type | Each scalar is |
|---|---|
| string | a JSON string |
| number | a JSON number |
| boolean | `true` or `false` |
| date | a partial ISO 8601 UTC string (docs/ARCHITECTURE.md, "Dates") |

| Operator arity | `value` |
|---|---|
| `none` (`isEmpty`, `isNotEmpty`) | `null` |
| `one` (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `before`, `after`, `contains`) | a scalar |
| `two` (`between`) | `[from, to]` |
| `many` (`in`) | a non-empty list of scalars |

## 7. Validation (D6)

`validate.ts` keeps its existing checks and messages. After the shape checks
(value present, both range ends present, list not empty), it checks each
scalar of the value: the value itself, each end of a range, each item of a
list. Each failure is `invalid`:

| Check | Message |
|---|---|
| A number field's scalar is a finite `number` | "Enter a number." |
| A boolean field's scalar is `true` or `false` | "Choose true or false." |
| A string field's scalar is a `string` | "Enter text." |
| A date field's scalar is a partial ISO UTC timestamp | unchanged |
| A number `between` has `from <= to` | "From must not be greater than To." |

- There is no pick-list membership check (D4).
- A date range's order is not checked: with partial timestamps, what "in
  order" means is the backend's call.
- These checks also cover a restored query, which `app.ts` already validates
  on restore.

## 8. Mock server (D7)

- **Prefix.** Routes and redirects under `MockConfig.apiBase` (§3).
- **Body check.** `readQueryBody` checks the body against `QueryRequest`:
  - `databases` is a non-empty `string[]` (as today);
  - every group has `kind`, a string `id`, an `AND`/`OR` `operator` and a
    non-empty `children` list;
  - every condition has `kind`, a string `id`, non-empty string `facetId`,
    `fieldId` and `operatorId`, and a `value` that is `null`, a scalar or a
    list of scalars.
  
  Any failure is a 400 with `{ error }` naming the first problem found. This
  makes the mock a working reference for the backend team and catches
  frontend regressions in dev.
- **Types.** `evaluate.ts` drops `JsonNode` / `JsonCondition` and uses
  `RequestNode` / `RequestCondition` through a type-only import from
  `src/api/types.ts`, as it already does for `StatsResponse`.
- **Lookup.** A condition reads the row key built from `facetId` and
  `fieldId`. The mock's flattened rows (`mock-server/rows.ts`) are a
  mock-only detail, and the fictional data has no dotted labels.
- **Data.** In `mock-server/data/individual.json`, one number field and one
  boolean field gain a `values` list, so the typing fix and the number
  pick-list show up in dev.

## 9. Documentation

- **`docs/ARCHITECTURE.md`** (keep existing section titles, which the code
  cites):
  - "Naming": rule 2 (`fieldId` is facet-local; `CatalogField` has
    `facetLabel` / `fieldLabel`).
  - §4 "Directory layout": `.env`, `src/query/request.ts`.
  - §7 "API contract": the prefix and `.env`, endpoint paths relative to the
    prefix.
  - "The field catalog": pick-lists instead of `enum`, the operator table.
  - "Wire format of the query": rewritten around `QueryRequest`,
    `toQueryRequest`, and the value table in §6.
  - §8 "The query model", §9 "Centre" (the free-entry dropdowns), §10 "Mock
    server" (prefix, body check).
- **`README.md`**: the "API location" paragraph (`.env`, default `/api/v1`,
  how to override).
- **`docs/CHANGELOG.md`** is archived and says it is no longer updated, so
  it is left alone.

## 10. Testing

Written before the code they cover (TDD):

- **`tests/query/request.test.ts`** (new): drops `collapsed`; keeps ids;
  operators and values pass through unchanged; nested groups; throws on an
  unfinished condition and on a non-JSON-scalar value.
- **`tests/query/fieldCatalog.test.ts`**:
  - number and boolean fields with `values` keep their type;
  - a number field's non-numeric values are left out of its pick-list, and it
    has none when none are numbers;
  - boolean and date fields never get a pick-list;
  - the operator table above;
  - labels containing `.` cause no collision in `findField`;
  - `fieldsOfFacet` returns only the chosen facet's fields, including when
    another facet's label starts with the same text.
- **`tests/query/validate.test.ts`**: each new check; values off the
  pick-list are accepted; a reversed number range is invalid and a reversed
  date range is not flagged.
- **`tests/query/conditionEdit.test.ts`**, **`summary.test.ts`**: lookups by
  the pair.
- **`tests/ui/valueControl.test.ts`**:
  - the free-entry dropdown appears exactly where the controls table says;
  - a value off the pick-list is rendered as a selected option;
  - a number pick reads back as a `number`, and non-numeric typed text reads
    back as the text.
- **`tests/api/client.test.ts`**: requests go to `{VITE_API_BASE}/…`;
  `getStats` / `runQuery` send the `QueryRequest` they are given.
- **`tests/app.test.ts`**: the app sends `toQueryRequest(query, databases)`.
- **`tests/mock-server/server.test.ts`**: routes and redirects follow
  `apiBase`; each malformed-body case answers 400.
- **`tests/mock-server/evaluate.test.ts`**: conditions match by the pair;
  typed number and boolean values match.
- **A config test**: `.env` sets `VITE_API_BASE`.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` all
  pass.

## 11. What the real backend must do

- Serve the whole API under the deployed prefix (default `/api/v1`),
  including `auth/*` and `compliance/*`, and register the login and
  compliance callback URLs under it.
- Accept `QueryRequest` on `POST {prefix}/stats` and `POST {prefix}/query`.
  Identify a field by `facetId` + `fieldId`, and read `value` by operator
  arity and field type (§6).
- Accept values that are not in `FacetField.values`.
- Answer a malformed body with `400 { "error": "…" }`.
- Node `id`s are opaque. They may be quoted in a later per-condition error
  response (out of scope here).

## 12. Out of scope

- NOT groups / negation.
- Per-condition error responses from the backend.
- Migrating queries saved by an older build (they show "Unknown field.").
