import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { Individual } from "../api/types";
import type { CatalogField, CatalogOperator } from "../query/fieldCatalog";
import {
  addChild,
  countConditions,
  emptyQuery,
  findNode,
  newCondition,
  newGroup,
  removeNode,
  updateNode,
} from "../query/tree";
import { queryToText } from "../query/summary";
import { panelEls } from "./layout";
import { escapeHtml, optionsHtml, paint } from "./panel";
import { onDropdownChange } from "./fomantic";
import { countLabel } from "./format";
import { defaultValueFor, readValueControl, renderValueControl } from "./valueControl";

type FieldCatalog = { fields: CatalogField[]; operators: CatalogOperator[] };

/**
 * Unfinished parts are quiet grey hints — the user simply isn't done yet. Only
 * an invalid query is shown in red. Both kinds still block running (validate.ts).
 */
function issuesHtml(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  const text = (kind: Issue["kind"]) =>
    mine
      .filter((i) => i.kind === kind)
      .map((i) => escapeHtml(i.message))
      .join(" ");
  const incomplete = text("incomplete");
  const invalid = text("invalid");
  return (
    (incomplete ? `<div class="qb-hint">${incomplete}</div>` : "") +
    (invalid
      ? `<div class="qb-invalid"><i class="exclamation circle icon"></i>${invalid}</div>`
      : "")
  );
}

function iconButton(action: string, label: string, icon: string, extra = ""): string {
  return `<button type="button" class="qb-icon-btn" data-action="${action}" aria-label="${label}" title="${label}"${extra}><i class="${icon} icon"></i></button>`;
}

function individualDropdown(individuals: Individual[] | null, c: Condition): string {
  const opts = optionsHtml(
    individuals ?? [],
    (ind) => ind.label,
    (ind) => ind.name,
    (ind) => ind.label === c.individualId,
  );
  return `<select class="ui selection dropdown" data-part="individual"><option value="">Item…</option>${opts}</select>`;
}

function fieldDropdown(schema: FieldCatalog, c: Condition): string {
  const prefix = c.individualId ? `${c.individualId}.` : null;
  const opts = prefix
    ? optionsHtml(
        schema.fields.filter((f) => f.label.startsWith(prefix)),
        (f) => f.label,
        (f) => f.label.slice(prefix.length),
        (f) => f.label === c.fieldId,
      )
    : "";
  return `<select class="ui selection dropdown" data-part="field"${prefix ? "" : " disabled"}><option value="">Field…</option>${opts}</select>`;
}

function operatorDropdown(schema: FieldCatalog, c: Condition): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const ops = field
    ? field.operatorIds
        .map((label) => schema.operators.find((o) => o.label === label))
        .filter((o): o is CatalogOperator => o !== undefined)
    : [];
  const opts = optionsHtml(
    ops,
    (o) => o.label,
    (o) => o.name,
    (o) => o.label === c.operatorId,
  );
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}><option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  c: Condition,
  issues: Issue[],
): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const operator = schema.operators.find((o) => o.label === c.operatorId);
  return `<div class="qb-condition" data-node-id="${escapeHtml(c.id)}">
    <div class="qb-cond-grid">
      ${individualDropdown(individuals, c)}
      ${fieldDropdown(schema, c)}
      ${operatorDropdown(schema, c)}
      <div class="qb-value">${renderValueControl(field, operator, c.value)}</div>
      ${iconButton("remove-node", "Remove condition", "times")}
    </div>
    ${issuesHtml(c.id, issues)}
  </div>`;
}

function collapseButton(collapsed: boolean): string {
  return iconButton(
    "toggle-collapse",
    collapsed ? "Expand group" : "Collapse group",
    collapsed ? "caret right" : "caret down",
    ` aria-expanded="${!collapsed}"`,
  );
}

/**
 * A group is drawn as a coloured bracket with a faint tint (blue = ALL/AND,
 * amber = ANY/OR — see styles.css). Between its children sits a small AND/OR
 * "joiner" on the bracket line. A collapsed group folds to one line: its
 * plain-English summary and how many conditions it holds.
 */
function groupHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  g: Group,
  issues: Issue[],
  isRoot: boolean,
): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  if (g.collapsed) {
    const text = queryToText(g, schema);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head">
        ${collapseButton(true)}
        <span class="qb-op-badge">${matchWord}</span>
        <span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        <span class="qb-count">${countLabel(countConditions(g), "condition")}</span>
        ${remove}
      </div>
      ${issuesHtml(g.id, issues)}
    </div>`;
  }
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children
    .map((child) => nodeHtml(schema, individuals, child, issues, false))
    .join(joiner);
  return `<div class="qb-group qb-group-${tone}" data-node-id="${escapeHtml(g.id)}">
    <div class="qb-group-head">
      ${collapseButton(false)}
      <span class="qb-group-label">Match</span>
      <span class="qb-logic" role="group" aria-label="Combine conditions with">
        <button type="button" class="qb-logic-btn${g.operator === "AND" ? " is-on" : ""}" data-action="set-and" aria-pressed="${g.operator === "AND"}">ALL</button>
        <button type="button" class="qb-logic-btn${g.operator === "OR" ? " is-on" : ""}" data-action="set-or" aria-pressed="${g.operator === "OR"}">ANY</button>
      </span>
      <span class="qb-group-label">of the following</span>
      <span class="qb-spacer"></span>
      <button type="button" class="ui mini basic button" data-action="add-condition"><i class="plus icon"></i>Condition</button>
      <button type="button" class="ui mini basic button" data-action="add-group"><i class="plus icon"></i>Group</button>
      ${remove}
    </div>
    ${issuesHtml(g.id, issues)}
    <div class="qb-children">${children}</div>
  </div>`;
}

function nodeHtml(
  schema: FieldCatalog,
  individuals: Individual[] | null,
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, individuals, node, issues, isRoot)
    : conditionHtml(schema, individuals, node, issues);
}

/** The query card's footer: the whole query in plain English once it is
 *  complete, otherwise how many parts still need attention. */
function footerHtml(state: AppState, schema: FieldCatalog): string {
  if (countConditions(state.query) === 0) {
    return `<span class="qb-muted">Add a condition to start building the query.</span>`;
  }
  const pending = new Set(state.issues.map((i) => i.nodeId)).size;
  if (pending > 0) {
    const what =
      pending === 1
        ? "1 part of the query still needs"
        : `${pending} parts of the query still need`;
    return `<span class="qb-muted">${what} attention.</span>`;
  }
  const text = queryToText(state.query, schema);
  return `<span class="qb-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

export function renderQueryBuilder(state: AppState): void {
  const el = panelEls().center;
  if (!state.schema) {
    paint(el, `<div class="qb-card"><div class="ui active centered inline loader"></div></div>`);
    return;
  }
  paint(
    el,
    `<div class="qb-card qb-query">
       <h2 class="qb-card-title">Query</h2>
       ${nodeHtml(state.schema, state.individuals, state.query, state.issues, true)}
       <div class="qb-query-foot">${footerHtml(state, state.schema)}</div>
     </div>`,
  );
  // Keep the once-wired delegated handlers acting on the current tree/schema.
  _setBuilderRefs(state.query as Group, state.schema);
}

// module-scope refs set by renderQueryBuilder; the delegated handlers below read
// these so a single wiring keeps working across every paint().
let currentQuery: Group = emptyQuery();
let schemaRef: FieldCatalog | null = null;

export function _setBuilderRefs(query: Group, schema: FieldCatalog | null): void {
  currentQuery = query;
  schemaRef = schema;
}

/**
 * Install the query-builder's interactive behaviour on `container` (the persistent
 * centre panel). main.ts calls this after every renderQueryBuilder(), because
 * paint() swaps container.innerHTML. The two delegated listeners are attached
 * ONCE per container (guarded by data-qbWired) so re-calls don't stack handlers;
 * onDropdownChange is re-run every time because Fomantic rebinds onChange per
 * .ui.dropdown element, and paint() replaces those elements.
 */
export function wireQueryBuilder(container: HTMLElement, onChange: (next: Group) => void): void {
  const getQuery = (): Group => currentQuery;
  const rootId = (): string => currentQuery.id;

  function nodeIdFrom(el: HTMLElement): string | null {
    return el.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
  }

  function handleRowChange(row: HTMLElement): void {
    const nodeId = row.dataset.nodeId!;
    const q = getQuery();
    const cond = findNode(q, nodeId);
    if (!cond || cond.kind !== "condition") return;

    const individualSel = row.querySelector<HTMLSelectElement>('[data-part="individual"]');
    const fieldSel = row.querySelector<HTMLSelectElement>('[data-part="field"]');
    const opSel = row.querySelector<HTMLSelectElement>('[data-part="operator"]');

    const newIndividualId = individualSel ? individualSel.value || null : cond.individualId;
    const individualChanged = newIndividualId !== cond.individualId;

    const newFieldId = individualChanged ? null : fieldSel ? fieldSel.value || null : cond.fieldId;
    const fieldChanged = individualChanged || newFieldId !== cond.fieldId;
    const newOperatorId = fieldChanged ? null : opSel ? opSel.value || null : cond.operatorId;

    const field = schemaRef?.fields.find((f) => f.label === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.label === newOperatorId);
    // The value control's DOM shape (one input, two, a multi-select, or none)
    // depends on the operator's arity. If only the operator changed but its arity
    // differs from before, `row` still holds the OLD shape until the next paint()
    // — reading it would silently pull garbage from the wrong control. Only trust
    // the DOM when the shape it currently has actually matches `operator`.
    const oldOperator = schemaRef?.operators.find((o) => o.label === cond.operatorId);
    const arityChanged =
      newOperatorId !== cond.operatorId && oldOperator?.arity !== operator?.arity;

    let value: unknown = defaultValueFor(field, operator);
    if (!fieldChanged && !arityChanged && operator) {
      value = readValueControl(row, operator.arity, field?.valueType ?? "string") ?? value;
    }
    onChange(
      updateNode(q, nodeId, {
        individualId: newIndividualId,
        fieldId: newFieldId,
        operatorId: newOperatorId,
        value,
      }),
    );
  }

  if (container.dataset.qbWired !== "1") {
    container.dataset.qbWired = "1";

    container.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action!;
      const nodeId = nodeIdFrom(btn);
      if (!nodeId) return;
      const q = getQuery();
      switch (action) {
        case "add-condition":
          return onChange(addChild(q, nodeId, newCondition()));
        case "add-group":
          return onChange(addChild(q, nodeId, newGroup()));
        case "remove-node":
          return onChange(nodeId === rootId() ? q : removeNode(q, nodeId));
        case "set-and":
          return onChange(updateNode(q, nodeId, { operator: "AND" }));
        case "set-or":
          return onChange(updateNode(q, nodeId, { operator: "OR" }));
        case "toggle-collapse": {
          const node = findNode(q, nodeId);
          return onChange(
            updateNode(q, nodeId, {
              collapsed: !(node && "collapsed" in node && node.collapsed),
            }),
          );
        }
      }
    });

    container.addEventListener("change", (e) => {
      const target = e.target as HTMLElement;
      // Fomantic's `set.value` dispatches a NATIVE bubbling "change" on the backing
      // <select> *before* calling settings.onChange. Without this guard both this
      // listener and onDropdownChange below would run handleRowChange for the same
      // interaction; pass 2 would then read the already-detached (stale) row and write
      // back the operator pass 1 cleared — state and screen would disagree (§6).
      // So every Fomantic-managed <select> (field, operator, enum value) is handled
      // EXCLUSIVELY by onDropdownChange, and everything else keeps this path.
      //
      // The `select` qualifier is load-bearing, do not drop it: `data-part="value"`
      // also sits directly on the native <input> controls (text/number/date, the
      // two-arity from/to pair, and the comma-separated `many` input). A bare
      // `[data-part="value"]` would exclude those too — and since they are not
      // `.ui.dropdown`, onDropdownChange never binds them, so their edits would be
      // silently dropped and the query would stop updating as the user types.
      if (
        target.matches(
          'select[data-part="individual"], select[data-part="field"], select[data-part="operator"], select[data-part="value"]',
        )
      ) {
        return;
      }
      const row = target.closest<HTMLElement>(".qb-condition[data-node-id]");
      if (!row) return;
      handleRowChange(row);
    });
  }

  // ALWAYS re-run — Fomantic rebinds onChange per .ui.dropdown, which paint() replaces.
  onDropdownChange(container, (el) => {
    const row = el.closest<HTMLElement>(".qb-condition[data-node-id]");
    if (row) handleRowChange(row);
  });
}
