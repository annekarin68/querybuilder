import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { SchemaResponse } from "../api/types";
import { panelEls } from "./layout";
import { escapeHtml, paint } from "./panel";
import { renderValueControl } from "./valueControl";

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
        `<option value="${f.id}"${f.id === c.fieldId ? " selected" : ""}>${escapeHtml(f.label)}</option>`,
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
        `<option value="${o.id}"${o.id === c.operatorId ? " selected" : ""}>${escapeHtml(o.label)}</option>`,
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
  _isRoot: boolean,
): string {
  return node.kind === "group"
    ? groupHtml(schema, node, issues, _isRoot)
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
}
