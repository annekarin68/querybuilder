import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { IndividualsResponse, SchemaResponse } from "../api/types";
import {
  addChild,
  emptyQuery,
  findNode,
  newCondition,
  newGroup,
  removeNode,
  updateNode,
} from "../query/tree";
import { panelEls } from "./layout";
import { escapeHtml, optionsHtml, paint } from "./panel";
import { onDropdownChange } from "./fomantic";
import { defaultValueFor, readValueControl, renderValueControl } from "./valueControl";

function issuesFor(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  if (!mine.length) return "";
  return `<div class="ui pointing red basic label">${mine
    .map((i) => escapeHtml(i.message))
    .join(" · ")}</div>`;
}

function individualDropdown(individuals: IndividualsResponse | null, c: Condition): string {
  const opts = optionsHtml(
    individuals?.individuals ?? [],
    (ind) => ind.label,
    (ind) => ind.name,
    (ind) => ind.label === c.individualId,
  );
  return `<select class="ui selection dropdown" data-part="individual"><option value="">Item…</option>${opts}</select>`;
}

function fieldDropdown(schema: SchemaResponse, c: Condition): string {
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

function operatorDropdown(schema: SchemaResponse, c: Condition): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const ops = field
    ? field.operatorIds
        .map((label) => schema.operators.find((o) => o.label === label))
        .filter((o): o is SchemaResponse["operators"][number] => o !== undefined)
    : [];
  const opts = optionsHtml(
    ops,
    (o) => o.label,
    (o) => o.name,
    (o) => o.label === c.operatorId,
  );
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}>
    <option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  c: Condition,
  issues: Issue[],
): string {
  const field = schema.fields.find((f) => f.label === c.fieldId);
  const operator = schema.operators.find((o) => o.label === c.operatorId);
  return `<div class="qb-condition" data-node-id="${c.id}" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.35rem 0">
    ${individualDropdown(individuals, c)}
    ${fieldDropdown(schema, c)}
    ${operatorDropdown(schema, c)}
    <span class="qb-value">${renderValueControl(field, operator, c.value)}</span>
    <button class="ui mini icon button" data-action="remove-node" title="Remove"><i class="trash icon"></i></button>
    ${issuesFor(c.id, issues)}
  </div>`;
}

function groupHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  g: Group,
  issues: Issue[],
  isRoot: boolean,
): string {
  const body = g.collapsed
    ? ""
    : `<div class="qb-children" style="padding-left:${isRoot ? 0 : 1}rem">
        ${g.children.map((child) => nodeHtml(schema, individuals, child, issues, false)).join("")}
      </div>`;
  return `<div class="ui segment qb-group" data-node-id="${g.id}">
    <div class="qb-group-head" style="display:flex;gap:.5rem;align-items:center">
      <button class="ui mini icon button" data-action="toggle-collapse" title="Collapse">
        <i class="${g.collapsed ? "caret right" : "caret down"} icon"></i>
      </button>
      <div class="ui mini buttons" data-part="logical">
        <button class="ui button ${g.operator === "AND" ? "primary" : ""}" data-action="set-and">AND</button>
        <button class="ui button ${g.operator === "OR" ? "primary" : ""}" data-action="set-or">OR</button>
      </div>
      <button class="ui mini button" data-action="add-condition"><i class="plus icon"></i> Condition</button>
      <button class="ui mini button" data-action="add-group"><i class="plus icon"></i> Group</button>
      ${
        isRoot
          ? ""
          : `<button class="ui mini icon button" data-action="remove-node" title="Remove group"><i class="trash icon"></i></button>`
      }
    </div>
    ${issuesFor(g.id, issues)}
    ${body}
  </div>`;
}

function nodeHtml(
  schema: SchemaResponse,
  individuals: IndividualsResponse | null,
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, individuals, node, issues, isRoot)
    : conditionHtml(schema, individuals, node, issues);
}

export function renderQueryBuilder(state: AppState): void {
  const el = panelEls().center;
  if (!state.schema) {
    paint(el, `<div class="ui segment"><div class="ui active inline loader"></div></div>`);
    return;
  }
  paint(
    el,
    `<h4 class="ui header">Build your query</h4>${nodeHtml(state.schema, state.individuals, state.query, state.issues, true)}`,
  );
  // Keep the once-wired delegated handlers acting on the current tree/schema.
  _setBuilderRefs(state.query as Group, state.schema);
}

// module-scope refs set by renderQueryBuilder; the delegated handlers below read
// these so a single wiring keeps working across every paint().
let currentQuery: Group = emptyQuery();
let schemaRef: SchemaResponse | null = null;

export function _setBuilderRefs(query: Group, schema: SchemaResponse | null): void {
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
