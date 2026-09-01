import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { SchemaResponse } from "../api/types";
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
import { escapeHtml, paint } from "./panel";
import { onDropdownChange } from "./fomantic";
import { readValueControl, renderValueControl } from "./valueControl";

function issuesFor(nodeId: string, issues: Issue[]): string {
  const mine = issues.filter((i) => i.nodeId === nodeId);
  if (!mine.length) return "";
  return `<div class="ui pointing red basic label">${mine
    .map((i) => escapeHtml(i.message))
    .join(" · ")}</div>`;
}

function fieldDropdown(schema: SchemaResponse, c: Condition): string {
  const opts = schema.fields
    .map(
      (f) =>
        `<option value="${escapeHtml(f.id)}"${f.id === c.fieldId ? " selected" : ""}>${escapeHtml(f.label)}</option>`,
    )
    .join("");
  return `<select class="ui selection dropdown" data-part="field"><option value="">Field…</option>${opts}</select>`;
}

function operatorDropdown(schema: SchemaResponse, c: Condition): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const ops = field
    ? field.operatorIds
        .map((id) => schema.operators.find((o) => o.id === id))
        .filter((o): o is SchemaResponse["operators"][number] => o !== undefined)
    : [];
  const opts = ops
    .map(
      (o) =>
        `<option value="${escapeHtml(o.id)}"${o.id === c.operatorId ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
    )
    .join("");
  return `<select class="ui selection dropdown" data-part="operator"${field ? "" : " disabled"}>
    <option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(schema: SchemaResponse, c: Condition, issues: Issue[]): string {
  const field = schema.fields.find((f) => f.id === c.fieldId);
  const operator = schema.operators.find((o) => o.id === c.operatorId);
  return `<div class="qb-condition" data-node-id="${c.id}" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin:.35rem 0">
    ${fieldDropdown(schema, c)}
    ${operatorDropdown(schema, c)}
    <span class="qb-value">${renderValueControl(field, operator, c.value)}</span>
    <button class="ui mini icon button" data-action="remove-node" title="Remove"><i class="trash icon"></i></button>
    ${issuesFor(c.id, issues)}
  </div>`;
}

function groupHtml(schema: SchemaResponse, g: Group, issues: Issue[], isRoot: boolean): string {
  const body = g.collapsed
    ? ""
    : `<div class="qb-children" style="padding-left:${isRoot ? 0 : 1}rem">
        ${g.children.map((child) => nodeHtml(schema, child, issues, false)).join("")}
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
  node: QueryNode,
  issues: Issue[],
  isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, node, issues, isRoot)
    : conditionHtml(schema, node, issues);
}

export function renderQueryBuilder(state: AppState): void {
  const el = panelEls().center;
  if (!state.schema) {
    paint(el, `<div class="ui segment"><div class="ui active inline loader"></div></div>`);
    return;
  }
  paint(
    el,
    `<h4 class="ui header">Build your query</h4>${nodeHtml(state.schema, state.query, state.issues, true)}`,
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

    const fieldSel = row.querySelector<HTMLSelectElement>('[data-part="field"]');
    const opSel = row.querySelector<HTMLSelectElement>('[data-part="operator"]');
    const newFieldId = fieldSel ? fieldSel.value || null : cond.fieldId;
    const fieldChanged = newFieldId !== cond.fieldId;
    let newOperatorId = opSel ? opSel.value || null : cond.operatorId;
    if (fieldChanged) newOperatorId = null; // operators depend on field

    const field = schemaRef?.fields.find((f) => f.id === newFieldId);
    const operator = schemaRef?.operators.find((o) => o.id === newOperatorId);
    let value: unknown = cond.value;
    if (fieldChanged || !operator) {
      value = null;
    } else {
      value = readValueControl(row, operator.arity, field?.valueType ?? "string");
    }
    // A boolean toggle has no "unset" state on screen: an unchecked toggle IS `false`.
    // Default a null value to `false` so the rendered control and the validated value
    // agree, instead of showing an unchecked toggle under an "Enter a value." error.
    if (field?.valueType === "boolean" && operator?.arity === "one" && value == null) {
      value = false;
    }
    onChange(updateNode(q, nodeId, { fieldId: newFieldId, operatorId: newOperatorId, value }));
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
          'select[data-part="field"], select[data-part="operator"], select[data-part="value"]',
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
