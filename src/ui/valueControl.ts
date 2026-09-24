import {
  isNumberText,
  type Arity,
  type CatalogField,
  type CatalogOperator,
  type ValueType,
} from "../query/fieldCatalog";
import { UTC_TIMESTAMP_HINT } from "../query/dates";
import { isBlankValue } from "../query/validate";
import { escapeHtml, optionsHtml } from "./panel";

/**
 * The value control(s) for a condition row, chosen by the operator × the
 * field's valueType. Only the combinations OPERATOR_PROFILE can produce are
 * handled (fieldCatalog.ts): `many` ("Is any of") exists only for strings and
 * numbers, and `two` ("Between") only for numbers and dates.
 */

/** Operators that compare with one exact value, where suggesting a field's
 *  known values helps. The rest (gt, contains, …) take a plain input. */
const PICK_OPERATORS = new Set(["eq", "neq"]);

/** The value(s) a control currently holds, as the strings its <option>s use. */
function chosenValues(current: unknown, multiple: boolean): string[] {
  if (multiple) return Array.isArray(current) ? current.map(String) : [];
  return isBlankValue(current) ? [] : [String(current)];
}

/**
 * A free-entry dropdown: it lists the field's pick-list, if any, and accepts
 * any typed value too (`data-free-entry`, activated with allowAdditions in
 * fomantic.ts), because the pick-list is a static list that can be out of
 * date. A current value that isn't on the list gets its own selected option,
 * so it survives a repaint.
 */
function freeEntryDropdown(field: CatalogField, current: unknown, multiple: boolean): string {
  const chosen = chosenValues(current, multiple);
  const known = field.options ?? [];
  const opts = optionsHtml(
    [...known, ...chosen.filter((v) => !known.includes(v))],
    (o) => o,
    (o) => o,
    (o) => chosen.includes(o),
  );
  return `<select class="ui ${multiple ? "multiple " : ""}search selection dropdown" data-part="value" data-free-entry aria-label="Value"${
    multiple ? " multiple" : ""
  }>
    ${multiple ? "" : `<option value="">Choose or type…</option>`}${opts}
  </select>`;
}

/** A date is typed, not picked: a full or partial ISO UTC timestamp
 *  ("2024", "2024-11-06", "2024-11-06T14:30Z"; see src/query/dates.ts). */
const DATE_ATTRS = `placeholder="${UTC_TIMESTAMP_HINT}" spellcheck="false" autocomplete="off"`;

function scalarInput(field: CatalogField, current: unknown, attrs: string): string {
  const type = field.valueType === "number" ? "number" : "text";
  const extra = field.valueType === "date" ? ` ${DATE_ATTRS}` : "";
  return `<div class="ui input"><input type="${type}" data-part="value" ${attrs}${extra} value="${escapeHtml(current ?? "")}" /></div>`;
}

export function renderValueControl(
  field: CatalogField | undefined,
  operator: CatalogOperator | undefined,
  value: unknown,
): string {
  if (!field || !operator || operator.arity === "none") return "";
  if (operator.arity === "many") return freeEntryDropdown(field, value, true);
  if (operator.arity === "two") {
    const [from, to] = Array.isArray(value) ? value : ["", ""];
    return `<div class="qb-range">${scalarInput(field, from, 'data-range="from" aria-label="From"')}<span class="qb-range-to">to</span>${scalarInput(field, to, 'data-range="to" aria-label="To"')}</div>`;
  }
  // arity "one"
  if (field.valueType === "boolean") {
    return `<div class="ui toggle checkbox" data-part="value">
      <input type="checkbox" aria-label="Value"${value === true ? " checked" : ""} /><label>true</label>
    </div>`;
  }
  if (field.options && PICK_OPERATORS.has(operator.id)) {
    return freeEntryDropdown(field, value, false);
  }
  return scalarInput(field, value, 'aria-label="Value"');
}

/**
 * A picked or typed entry as the field's type: a number field's entry that is
 * a number becomes a `number` ("3" → 3). Anything else stays the text entered,
 * so validation can point at it instead of the value vanishing.
 */
export function parseEntry(text: string, valueType: ValueType): string | number {
  return valueType === "number" && isNumberText(text) ? Number(text) : text;
}

/** What Fomantic's HTML escaping turns each character into (see optionEntry). */
const FOMANTIC_ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&#x27;": "'",
  "&#x60;": "`",
  "&amp;": "&",
};

/**
 * The entry an option of a free-entry dropdown stands for. Our own options
 * (rendered from state) hold it exactly. An option Fomantic created for a
 * typed entry (class `addition`) holds it HTML-escaped (`a"b` → `a&quot;b`),
 * so that escaping is undone here, in one pass, and the value goes out as
 * typed. Text that already looks like one of these entities (typing `&lt;`
 * itself) comes back decoded: Fomantic stores it the same way as `<`.
 */
export function optionEntry(option: HTMLOptionElement): string {
  if (!option.classList.contains("addition")) return option.value;
  return option.value.replace(/&(?:quot|lt|gt|#x27|#x60|amp);/g, (e) => FOMANTIC_ENTITIES[e]!);
}

/** Reads back what `renderValueControl` rendered inside `row`. */
export function readValueControl(row: HTMLElement, arity: Arity, valueType: ValueType): unknown {
  if (arity === "none") return null;
  if (arity === "two") {
    return [
      readInput(row.querySelector<HTMLInputElement>('input[data-range="from"]'), valueType),
      readInput(row.querySelector<HTMLInputElement>('input[data-range="to"]'), valueType),
    ];
  }
  if (arity === "many") {
    const sel = row.querySelector<HTMLSelectElement>('select[data-part="value"]');
    return sel
      ? Array.from(sel.selectedOptions).map((o) => parseEntry(optionEntry(o), valueType))
      : [];
  }
  const control = row.querySelector<HTMLElement>('[data-part="value"]');
  if (!control) return null;
  if (control instanceof HTMLSelectElement) {
    const chosen = control.selectedOptions[0];
    return parseEntry(chosen ? optionEntry(chosen) : "", valueType);
  }
  if (control instanceof HTMLInputElement) return readInput(control, valueType);
  // The boolean toggle: a .ui.checkbox wrapper around the real checkbox.
  return control.querySelector<HTMLInputElement>("input")?.checked ?? false;
}

function readInput(el: HTMLInputElement | null, valueType: ValueType): unknown {
  return el ? parseEntry(el.value, valueType) : null;
}
