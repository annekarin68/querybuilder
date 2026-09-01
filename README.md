# Query Builder

A framework-agnostic, generic query builder: users click through fields, operators,
and values to construct a boolean expression tree, which is then serialized into a
compact query DSL for your backend:

```
(branches gte 20 AND foliage eq true) OR (flowering range april,july)
```

Built with plain TypeScript and native [Web Components][web-components] — no React,
Vue, or bundler required. `<query-builder>` is a custom element you can drop into any
app, framework or none. A small example app and mock backend are included so you can
see (and run) the whole round trip.

[web-components]: https://developer.mozilla.org/en-US/docs/Web/API/Web_components

## Why this shape

- **Generic naming.** Nothing in `src/core` or `src/components` knows about "plants"
  or any other business domain. The vocabulary is `Field`, `Operator`, `Condition`,
  `Group`, `Expression` — the same library works for any backend describable as a set
  of typed, comparable fields.
- **AST first, string second.** The builder's source of truth is a typed tree
  (`GroupNode` / `ConditionNode`), not a string. A `serializer.ts` turns that tree into
  the DSL string; a second `JsonSerializer` is included to prove the tree isn't
  coupled to one output format. Add a SQL or GraphQL serializer later without
  touching a single component.
- **One-directional data flow, no framework required.** State lives in one place
  (`query-builder-element`'s internal `Store`). Data flows *down* into child elements
  via plain properties (`.node`, `.fields`); edits flow *up* as `CustomEvent`s
  (`builder-command`). This is the same discipline React/Redux apps follow — it just
  doesn't need a framework to enforce it.
- **Schema from the backend.** The set of queryable fields (and each field's type,
  and therefore its valid operators) is fetched at runtime from `GET /api/fields`, via
  the `SchemaProvider` interface. Swap `HttpSchemaProvider` for a static array
  (`StaticSchemaProvider`) in tests or storybook-style demos.
- **Zero runtime dependencies.** The whole library is TypeScript compiled straight to
  native ES modules — no bundler needed to ship it, no framework runtime shipped to
  the browser.

## Project layout

```
src/
  core/                 Framework-free domain logic — the reusable "library" part.
    types.ts              FieldDefinition, OperatorDefinition, ConditionNode, GroupNode, ...
    operators.ts           The operator catalog (eq, gte, range, in, isEmpty, ...).
    ast.ts                 Pure, immutable tree operations (insert/update/remove/find).
    commands.ts             TreeCommand union + the reducer that applies one to a tree.
    serializer.ts          ExpressionSerializer interface + DslSerializer + JsonSerializer.
    validator.ts           Walks a tree and reports what's incomplete/invalid.
    schema-provider.ts     SchemaProvider interface + HTTP and static implementations.
  state/
    store.ts               A ~20-line observable store (no Redux/MobX needed here).
  components/            The Web Components (view layer only — no tree mutation here).
    element-base.ts        Tiny base class: shadow DOM, batched re-render, emit().
    dom.ts                  h(), a minimal hyperscript helper (no vdom, no deps).
    query-builder-element.ts   <query-builder> — owns the tree, talks to the schema.
    query-group-element.ts     <query-group> — AND/OR toggle, children, add/remove.
    query-condition-element.ts <query-condition> — field/operator/value row.
    value-input.ts          Picks the right form control(s) for a field+operator pair.
  app/
    main.ts                The example app: mounts <query-builder>, wires the "Run
                            query" button to POST the serialized query.
server/                  A tiny mock backend (Node's built-in http, no Express) that
                          serves GET /api/fields and evaluates POST /api/query
                          against a small in-memory dataset — stands in for "your
                          real backend" so the demo does something real.
public/                  index.html + styles.css for the example app.
tests/                   Unit tests for core/ (ast, commands, serializer, validator).
```

## Getting started

```bash
npm install
npm run build   # compiles src/ -> dist/ and server/ -> server/dist/
npm run start   # serves the example app + mock API at http://localhost:5173
npm test        # runs the unit test suite (Node's built-in test runner via tsx)
npm run typecheck
```

Open http://localhost:5173, build a query, and click "Run query" — it POSTs the
serialized expression to the mock backend, which filters an in-memory dataset with it
and returns the matches.

There's no dev-server/HMR step by design — everything compiles to plain ES modules
and runs as-is. If you want a faster edit loop, `npx tsc -p tsconfig.json --watch` in
one terminal and `npm run start` (rerun after each rebuild) in another works fine; a
bundler like Vite would also slot in without any changes to `src/` itself.

## Using `<query-builder>` in your own app

```ts
import "query-builder/dist/components/index.js";
import { HttpSchemaProvider } from "query-builder/dist/core/schema-provider.js";
import { onQueryBuilderChange } from "query-builder/dist/components/query-builder-element.js";

const builder = document.createElement("query-builder");
builder.schemaProvider = new HttpSchemaProvider("/api/fields");
document.body.append(builder);

onQueryBuilderChange(builder, ({ dsl, json, tree, issues, isValid }) => {
  // `dsl`   — the string DSL, e.g. "(branches gte 20 AND foliage eq true) OR ..."
  // `json`  — the same tree as plain JSON (JsonSerializer), if your backend prefers that
  // `tree`  — the raw GroupNode, if you want to persist/restore it directly
  // `issues`/`isValid` — from validateExpression(); gate your "Run query" button on isValid
});
```

`GET /api/fields` is expected to return `{ "fields": FieldDefinition[] }` — see
`server/fields.ts` for a worked example, or implement `SchemaProvider` yourself
against any source.

## The DSL grammar

- A **condition** never gets its own parentheses: `field operator value`.
- A **group** (a boolean combination the user built with "Add group", or the implicit
  root) is wrapped in parentheses *whenever it isn't the root* — regardless of how
  many children it has. That's what makes a lone condition inside an explicit group
  print as `(flowering range april,july)` while a bare top-level condition doesn't.
- Children of a group are joined by that group's own `AND`/`OR`.
- Value formatting: booleans print as `true`/`false`; a `range` operator's pair prints
  as `start,end`; a `multi` operator's list prints as `[a,b,c]`; a string containing
  whitespace is quoted.

All of this lives in `DslSerializer` (`src/core/serializer.ts`) and is covered by
`tests/serializer.test.ts`, including the exact example above.

## Extending it

- **New operator** (e.g. `startsWith`): add one entry to `OPERATOR_DEFINITIONS` in
  `operators.ts`, and a `case` in `DslSerializer`'s value formatter only if it needs
  non-default formatting.
- **New field value type** (e.g. `duration`): add it to the `ValueType` union in
  `types.ts`, teach `getOperatorsForType`'s callers which operators apply, and add a
  case to `renderScalarControl` in `value-input.ts` for its form control.
- **New output format** (e.g. SQL, OData, GraphQL): implement `ExpressionSerializer<T>`
  — you never need to touch a component to do this, since components only ever emit
  the tree, not any particular string.
- **New backend for field definitions**: implement `SchemaProvider`.

## A note on how this was built

This project has zero runtime dependencies and only three devDependencies
(`typescript`, `@types/node`, `tsx`) — deliberately, so it's easy to audit and easy to
drop into any setup. If you'd rather have Vite's dev-server/HMR loop, that's a
drop-in addition (`npm i -D vite`, point it at `public/index.html`) — nothing in
`src/` assumes its absence.
