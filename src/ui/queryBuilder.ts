import type { AppState } from "../state";
import type { Condition, Group, Issue, QueryNode } from "../query/types";
import type { Facet } from "../api/types";
import { findField, findOperator, OPERATORS, type FieldCatalog } from "../query/fieldCatalog";
import {
  addChild,
  countConditions,
  findNode,
  newCondition,
  newGroup,
  removeNode,
  updateNode,
} from "../query/tree";
import { nextCondition } from "../query/conditionEdit";
import { queryToText } from "../query/summary";
import { escapeHtml, optionsHtml, paint } from "./panel";
import { onDropdownChange } from "./fomantic";
import { countLabel } from "./format";
import { readValueControl, renderValueControl } from "./valueControl";

/** What every part of the tree's HTML needs, passed down the recursion. */
interface BuilderCtx {
  catalog: FieldCatalog;
  facets: Facet[] | null;
  issues: Issue[];
}

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

function facetDropdown(facets: Facet[] | null, c: Condition): string {
  const opts = optionsHtml(
    facets ?? [],
    (facet) => facet.label,
    (facet) => facet.name,
    (facet) => facet.label === c.facetId,
  );
  return `<select class="ui selection dropdown" data-part="facet" aria-label="Facet"><option value="">Facet…</option>${opts}</select>`;
}

function fieldDropdown(catalog: FieldCatalog, c: Condition): string {
  const prefix = c.facetId ? `${c.facetId}.` : null;
  const opts = prefix
    ? optionsHtml(
        catalog.fields.filter((f) => f.label.startsWith(prefix)),
        (f) => f.label,
        (f) => f.fieldName,
        (f) => f.label === c.fieldId,
      )
    : "";
  return `<select class="ui selection dropdown" data-part="field" aria-label="Field"${prefix ? "" : " disabled"}><option value="">Field…</option>${opts}</select>`;
}

function operatorDropdown(catalog: FieldCatalog, c: Condition): string {
  const field = findField(catalog, c.fieldId);
  const ops = field ? OPERATORS.filter((o) => field.operatorIds.includes(o.label)) : [];
  const opts = optionsHtml(
    ops,
    (o) => o.label,
    (o) => o.name,
    (o) => o.label === c.operatorId,
  );
  return `<select class="ui selection dropdown" data-part="operator" aria-label="Operator"${field ? "" : " disabled"}><option value="">Operator…</option>${opts}</select>`;
}

function conditionHtml(ctx: BuilderCtx, c: Condition): string {
  const field = findField(ctx.catalog, c.fieldId);
  const operator = findOperator(c.operatorId);
  return `<div class="qb-condition" data-node-id="${escapeHtml(c.id)}">
    <div class="qb-cond-grid">
      ${facetDropdown(ctx.facets, c)}
      ${fieldDropdown(ctx.catalog, c)}
      ${operatorDropdown(ctx.catalog, c)}
      <div class="qb-value">${renderValueControl(field, operator, c.value)}</div>
      ${iconButton("remove-node", "Remove condition", "times")}
    </div>
    ${issuesHtml(c.id, ctx.issues)}
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
function groupHtml(ctx: BuilderCtx, g: Group, isRoot: boolean): string {
  const tone = g.operator === "OR" ? "or" : "and";
  const matchWord = g.operator === "OR" ? "ANY" : "ALL";
  const remove = isRoot ? "" : iconButton("remove-node", "Remove group", "times");
  if (g.collapsed) {
    const text = queryToText(g, ctx.catalog);
    return `<div class="qb-group qb-group-${tone} is-collapsed" data-node-id="${escapeHtml(g.id)}">
      <div class="qb-group-head">
        ${collapseButton(true)}
        <span class="qb-op-badge">${matchWord}</span>
        <span class="qb-group-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>
        <span class="qb-count">${countLabel(countConditions(g), "condition")}</span>
        ${remove}
      </div>
      ${issuesHtml(g.id, ctx.issues)}
    </div>`;
  }
  const joiner = `<span class="qb-joiner">${g.operator}</span>`;
  const children = g.children.map((child) => nodeHtml(ctx, child, false)).join(joiner);
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
    ${issuesHtml(g.id, ctx.issues)}
    <div class="qb-children">${children}</div>
  </div>`;
}

function nodeHtml(ctx: BuilderCtx, node: QueryNode, isRoot: boolean): string {
  return node.kind === "group" ? groupHtml(ctx, node, isRoot) : conditionHtml(ctx, node);
}

/** The query card's footer: the whole query in plain English once it is
 *  complete, otherwise how many parts still need attention. */
function footerHtml(state: AppState, catalog: FieldCatalog): string {
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
  const text = queryToText(state.query, catalog);
  return `<span class="qb-summary" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}

function paintQueryBuilder(el: HTMLElement, state: AppState): void {
  if (!state.catalog) {
    paint(el, `<div class="qb-card"><div class="ui active centered inline loader"></div></div>`);
    return;
  }
  const ctx: BuilderCtx = { catalog: state.catalog, facets: state.facets, issues: state.issues };
  paint(
    el,
    `<div class="qb-card qb-query">
       <h2 class="qb-card-title">Query</h2>
       ${nodeHtml(ctx, state.query, true)}
       <div class="qb-query-foot">${footerHtml(state, state.catalog)}</div>
     </div>`,
  );
}

/**
 * Install the query builder's behaviour on `container` (the persistent centre
 * panel). Call ONCE at startup. The handlers read the current tree through
 * `getState()` when an event fires, so they never go stale across repaints.
 *
 * Returns the query builder's render function — the only way to paint it.
 * Rendering and binding must happen together: Fomantic dropdowns don't emit a
 * usable native "change", so their onChange is bound per element, and every
 * paint replaces those elements.
 */
export function wireQueryBuilder(
  container: HTMLElement,
  getState: () => AppState,
  onChange: (next: Group) => void,
): (state: AppState) => void {
  function handleRowChange(row: HTMLElement): void {
    const { query, catalog } = getState();
    const cond = findNode(query, row.dataset.nodeId!);
    if (!catalog || !cond || cond.kind !== "condition") return;
    const picked = (part: string) =>
      row.querySelector<HTMLSelectElement>(`select[data-part="${part}"]`)?.value || null;
    const patch = nextCondition(
      cond,
      {
        facetId: picked("facet"),
        fieldId: picked("field"),
        operatorId: picked("operator"),
      },
      catalog,
      (arity, valueType) => readValueControl(row, arity, valueType),
    );
    onChange(updateNode(query, cond.id, patch));
  }

  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    const nodeId = btn?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!btn || !nodeId) return;
    const q = getState().query;
    switch (btn.dataset.action) {
      case "add-condition":
        return onChange(addChild(q, nodeId, newCondition()));
      case "add-group":
        return onChange(addChild(q, nodeId, newGroup()));
      case "remove-node":
        return onChange(removeNode(q, nodeId));
      case "set-and":
        return onChange(updateNode(q, nodeId, { operator: "AND" }));
      case "set-or":
        return onChange(updateNode(q, nodeId, { operator: "OR" }));
      case "toggle-collapse": {
        const node = findNode(q, nodeId);
        return onChange(
          updateNode(q, nodeId, { collapsed: !(node?.kind === "group" && node.collapsed) }),
        );
      }
    }
  });

  container.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    // Fomantic dispatches a native bubbling "change" on the <select> behind each
    // dropdown *before* calling its onChange. Handling both would run
    // handleRowChange twice, the second time on a detached row, and write back
    // stale values. So every <select> is handled ONLY via onDropdownChange below;
    // this listener handles the plain <input>s (text/number, the range
    // pair and the boolean toggle's checkbox).
    if (target instanceof HTMLSelectElement) return;
    const row = target.closest<HTMLElement>(".qb-condition[data-node-id]");
    if (row) handleRowChange(row);
  });

  return (state) => {
    paintQueryBuilder(container, state);
    onDropdownChange(container, (el) => {
      const row = el.closest<HTMLElement>(".qb-condition[data-node-id]");
      if (row) handleRowChange(row);
    });
  };
}
