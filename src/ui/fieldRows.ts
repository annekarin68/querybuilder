import {
  fieldsOfFacet,
  findFacet,
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
 *  that is not expanded — the first few, the set ones and the open one,
 *  in the facet's order. */
export function visibleFieldIds(
  fieldIds: string[],
  setIds: ReadonlySet<string>,
  expanded: boolean,
  openFieldId: string | null,
): { shown: string[]; hiddenCount: number } {
  if (expanded || fieldIds.length <= FOLD_AFTER) return { shown: fieldIds, hiddenCount: 0 };
  const shown = fieldIds.filter(
    (id, i) => i < SHOWN_WHEN_FOLDED || setIds.has(id) || id === openFieldId,
  );
  return { shown, hiddenCount: fieldIds.length - shown.length };
}

/**
 * The value of the operator dropdown's "Not filtered" choice, which clears the
 * field. Not "": Fomantic turns an option with an empty value into the
 * dropdown's placeholder text and leaves it out of the menu, so it could not
 * be picked.
 */
export const NOT_FILTERED = "not-filtered";

/** The operator the user picked in a row's operator dropdown (its `value`),
 *  or null for "Not filtered" (and for the empty placeholder). */
export function pickedOperatorId(value: string): string | null {
  return value === NOT_FILTERED || value === "" ? null : value;
}

/**
 * A row's operator dropdown: "Not filtered" first, then the operators the
 * field offers. A saved query can hold a condition with no operator, or with
 * one the field does not offer (any more); the row must not say "Not
 * filtered" then, which its issue would contradict. So a missing operator
 * shows "Choose an operator…" (the placeholder, an empty first option), and
 * one that is not offered is shown chosen but cannot be picked again.
 */
function operatorSelect(field: CatalogField, c: FieldCondition | undefined): string {
  const selectedId = c?.operatorId ?? null;
  const choices = OPERATORS.filter((o) => field.operatorIds.includes(o.id));
  const opts = optionsHtml(
    choices,
    (o) => o.id,
    (o) => o.name,
    (o) => o.id === selectedId,
  );
  let lead = "";
  if (c && selectedId === null) {
    lead = `<option value="">Choose an operator…</option>`;
  } else if (selectedId !== null && !choices.some((o) => o.id === selectedId)) {
    const name = findOperator(selectedId)?.name ?? selectedId;
    lead = `<option value="${escapeHtml(selectedId)}" selected disabled>${escapeHtml(name)}</option>`;
  }
  return `<select class="ui search selection dropdown" data-part="operator" aria-label="Operator for ${escapeHtml(field.fieldName)}">${lead}<option value="${NOT_FILTERED}">Not filtered</option>${opts}</select>`;
}

/** A field with a condition, or the open unset field (no condition yet:
 *  its operator dropdown is drawn so it can be opened at once). */
function activeRowHtml(ctx: RowCtx, field: CatalogField, c: FieldCondition | undefined): string {
  const operator = findOperator(c?.operatorId ?? null);
  const nodeId = c ? ` data-node-id="${escapeHtml(c.id)}"` : "";
  const value = c
    ? `<div class="qb-value">${renderValueControl(field, operator, c.value)}</div>`
    : "";
  return `<div class="qb-field-row" data-field-id="${escapeHtml(field.fieldId)}"${nodeId}>
      <span class="qb-field-label">${escapeHtml(field.fieldName)}</span>
      ${operatorSelect(field, c)}
      ${value}
    </div>${c ? issuesHtml(c.id, ctx.issues) : ""}`;
}

function unsetRowHtml(field: CatalogField): string {
  const name = escapeHtml(field.fieldName);
  return `<div class="qb-field-row is-unset" data-field-id="${escapeHtml(field.fieldId)}">
      <span class="qb-field-label">${name}<span class="qb-sr-only"> (not filtered)</span></span>
      <button type="button" class="qb-unset-slot" data-action="edit-field" data-field-id="${escapeHtml(field.fieldId)}" aria-label="Filter on ${name}"></button>
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
      ${iconButton("remove-condition", `Remove the condition on ${c.fieldId}`, "times")}
    </div>${issuesHtml(c.id, ctx.issues)}`;
}

/** Whether a block draws the fold button: only a large facet, and only when
 *  it would do something: it hides some fields, or it is open and can close
 *  again. (A large facet whose set fields already fill the first rows hides
 *  nothing, and "+ 0 more fields" would be a button that does nothing.) */
export function showsFoldButton(
  fieldCount: number,
  hiddenCount: number,
  expanded: boolean,
): boolean {
  return fieldCount > FOLD_AFTER && (hiddenCount > 0 || expanded);
}

/** "+ N more fields" / "Show fewer fields". Its accessible name adds the
 *  facet's name: a page can hold several of these buttons. */
function foldButton(hiddenCount: number, expanded: boolean, facetName: string): string {
  const label = expanded
    ? "Show fewer fields"
    : `+ ${hiddenCount} more ${hiddenCount === 1 ? "field" : "fields"}`;
  const name = `${label} of ${facetName}`;
  return `<button type="button" class="ui mini basic button qb-more-fields" data-action="toggle-fields" aria-expanded="${expanded}" aria-label="${escapeHtml(name)}">${label}</button>`;
}

/** The rows of `block`: one per visible field of its facet, then any stray
 *  conditions, then the fold button for a large facet. */
export function fieldRowsHtml(
  ctx: RowCtx,
  block: FacetBlock,
  expanded: boolean,
  openFieldId: string | null,
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
    openFieldId,
  );
  const rows = fields
    .filter((f) => shown.includes(f.fieldId))
    .map((f) => {
      const c = firstOf.get(f.fieldId);
      return c || f.fieldId === openFieldId ? activeRowHtml(ctx, f, c) : unsetRowHtml(f);
    });
  const facetName = findFacet(ctx.catalog, block.facetId)?.name ?? block.facetId;
  const fold = showsFoldButton(fields.length, hiddenCount, expanded)
    ? foldButton(hiddenCount, expanded, facetName)
    : "";
  return rows.join("") + strays.map((c) => strayRowHtml(ctx, c)).join("") + fold;
}
