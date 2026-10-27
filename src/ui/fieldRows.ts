import {
  fieldsOfFacet,
  findOperator,
  OPERATORS,
  type CatalogField,
  type FieldCatalog,
} from "../query/fieldCatalog";
import type { FacetBlock, FieldCondition, Issue } from "../query/types";
import { issuesHtml, iconButton } from "./builderParts";
import { escapeHtml, optionsHtml } from "./panel";
import { renderValueControl } from "./valueControl";

// One row per field of a block's facet (spec, section 5). An unset field is
// "don't care": a muted label and empty controls, no visible text — the
// words "any value" would read as "must have a value" (maintainers,
// 2026-10-27). Unset rows draw plain buttons, not Fomantic dropdowns: the
// builder repaints on every edit, and twenty fields per block would mean
// hundreds of dropdowns to initialise.

/** Facets with more fields than this fold their unset rows. */
export const FOLD_AFTER = 5;
/** How many of a folded facet's first fields stay visible. */
export const SHOWN_WHEN_FOLDED = 3;

export interface RowCtx {
  catalog: FieldCatalog;
  issues: Issue[];
}

/** Which of a facet's fields get a row: all of them, or — for a large facet
 *  that is not expanded — the first few, the set ones and the selected one,
 *  in the facet's order. */
export function visibleFieldIds(
  fieldIds: string[],
  setIds: ReadonlySet<string>,
  expanded: boolean,
  selectedId: string | null,
): { shown: string[]; hiddenCount: number } {
  if (expanded || fieldIds.length <= FOLD_AFTER) return { shown: fieldIds, hiddenCount: 0 };
  const shown = fieldIds.filter(
    (id, i) => i < SHOWN_WHEN_FOLDED || setIds.has(id) || id === selectedId,
  );
  return { shown, hiddenCount: fieldIds.length - shown.length };
}

function operatorSelect(field: CatalogField, selectedId: string | null): string {
  const choices = OPERATORS.filter((o) => field.operatorIds.includes(o.id));
  const opts = optionsHtml(
    choices,
    (o) => o.id,
    (o) => o.name,
    (o) => o.id === selectedId,
  );
  return `<select class="ui search selection dropdown" data-part="operator" aria-label="Operator for ${escapeHtml(field.fieldName)}"><option value="">Not filtered</option>${opts}</select>`;
}

/** A field with a condition, or the selected unset field (no condition yet:
 *  its operator dropdown is drawn so it can be opened at once). */
function activeRowHtml(ctx: RowCtx, field: CatalogField, c: FieldCondition | undefined): string {
  const operator = findOperator(c?.operatorId ?? null);
  const nodeId = c ? ` data-node-id="${escapeHtml(c.id)}"` : "";
  const value = c
    ? `<div class="qb-value">${renderValueControl(field, operator, c.value)}</div>`
    : "";
  return `<div class="qb-field-row" data-field-id="${escapeHtml(field.fieldId)}"${nodeId}>
      <span class="qb-field-label">${escapeHtml(field.fieldName)}</span>
      ${operatorSelect(field, c?.operatorId ?? null)}
      ${value}
    </div>${c ? issuesHtml(c.id, ctx.issues) : ""}`;
}

function unsetRowHtml(field: CatalogField): string {
  const name = escapeHtml(field.fieldName);
  return `<div class="qb-field-row is-unset" data-field-id="${escapeHtml(field.fieldId)}">
      <span class="qb-field-label">${name}<span class="qb-sr-only"> (not filtered)</span></span>
      <button type="button" class="qb-unset-slot" data-action="edit-field" aria-label="Filter on ${name}"></button>
      <span class="qb-unset-slot" aria-hidden="true"></span>
    </div>`;
}

/** A condition the facet's rows can't show: its field is gone from the
 *  dictionary, or it is a second condition on one field. Kept, read-only,
 *  with its error and a ✕, so a saved query reloads as it was saved. */
function strayRowHtml(ctx: RowCtx, c: FieldCondition): string {
  const op = findOperator(c.operatorId);
  const value = c.value === null || c.value === undefined ? "" : ` ${String(c.value)}`;
  const text = `${op?.name ?? c.operatorId ?? "(operator?)"}${value}`;
  return `<div class="qb-field-row is-stray" data-field-id="${escapeHtml(c.fieldId)}" data-node-id="${escapeHtml(c.id)}">
      <span class="qb-field-label">${escapeHtml(c.fieldId)}</span>
      <span class="qb-stray-text">${escapeHtml(text)}</span>
      ${iconButton("remove-condition", "Remove this condition", "times")}
    </div>${issuesHtml(c.id, ctx.issues)}`;
}

function foldButton(hiddenCount: number, expanded: boolean): string {
  const label = expanded
    ? "Show fewer fields"
    : `+ ${hiddenCount} more ${hiddenCount === 1 ? "field" : "fields"}`;
  return `<button type="button" class="ui mini basic button qb-more-fields" data-action="toggle-fields" aria-expanded="${expanded}">${label}</button>`;
}

/** The rows of `block`: one per visible field of its facet, then any stray
 *  conditions, then the fold button for a large facet. */
export function fieldRowsHtml(
  ctx: RowCtx,
  block: FacetBlock,
  expanded: boolean,
  selectedFieldId: string | null,
): string {
  const fields = fieldsOfFacet(ctx.catalog, block.facetId);
  const known = new Set(fields.map((f) => f.fieldId));
  const firstOf = new Map<string, FieldCondition>();
  const strays: FieldCondition[] = [];
  for (const c of block.conditions) {
    if (known.has(c.fieldId) && !firstOf.has(c.fieldId)) firstOf.set(c.fieldId, c);
    else strays.push(c);
  }
  const { shown, hiddenCount } = visibleFieldIds(
    fields.map((f) => f.fieldId),
    new Set(firstOf.keys()),
    expanded,
    selectedFieldId,
  );
  const rows = fields
    .filter((f) => shown.includes(f.fieldId))
    .map((f) => {
      const c = firstOf.get(f.fieldId);
      return c || f.fieldId === selectedFieldId ? activeRowHtml(ctx, f, c) : unsetRowHtml(f);
    });
  const fold = fields.length > FOLD_AFTER ? foldButton(hiddenCount, expanded) : "";
  return rows.join("") + strays.map((c) => strayRowHtml(ctx, c)).join("") + fold;
}
