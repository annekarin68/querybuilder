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
import { hoverTitle } from "./format";

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

/**
 * The <option> values of the yes/no dropdown. They are NOT "true" / "false":
 * Fomantic reads an item's value with jQuery's `.data()`, which turns the text
 * "false" into the boolean false, and Fomantic then takes that for "no value"
 * and shows an empty box. The labels the user sees stay true / false.
 */
const YES = "yes";
const NO = "no";

/** The yes/no dropdown's option value for a stored boolean ("" when unset). */
export function booleanOptionValue(value: unknown): string {
  if (value === true) return YES;
  if (value === false) return NO;
  return "";
}

/** The boolean a yes/no option value stands for; anything else is unset (null). */
export function booleanFromOptionValue(optionValue: string): boolean | null {
  if (optionValue === YES) return true;
  if (optionValue === NO) return false;
  return null;
}

/**
 * A yes/no value: "true" or "false", and nothing chosen until the user picks
 * one (maintainers' decision on #83, 2026-10-29). A toggle could not show
 * "unset", and its fixed "true" label read as the value while it was off.
 *
 * It is a `search selection` dropdown like every other field-row dropdown
 * (the search box stays hidden unless typed into): a plain `selection` one is
 * a focusable <div>, which the focus memory (focusMemory.ts) does not find
 * again after the repaint, so picking a value dropped the focus to the page.
 */
function booleanDropdown(current: unknown): string {
  const chosen = booleanOptionValue(current);
  const opts = optionsHtml(
    [
      { value: YES, label: "true" },
      { value: NO, label: "false" },
    ],
    (o) => o.value,
    (o) => o.label,
    (o) => o.value === chosen,
  );
  return `<select class="ui search selection dropdown" data-part="value" aria-label="Value">
    <option value="">Choose…</option>${opts}
  </select>`;
}

/** A date is typed, not picked: a full or partial ISO UTC timestamp
 *  ("2024", "2024-11-06", "2024-11-06T14:30Z"; see src/query/dates.ts). */
const DATE_ATTRS = `placeholder="${UTC_TIMESTAMP_HINT}" spellcheck="false" autocomplete="off"`;

function scalarInput(field: CatalogField, current: unknown, attrs: string): string {
  const type = field.valueType === "number" ? "number" : "text";
  const extra = field.valueType === "date" ? ` ${DATE_ATTRS}` : "";
  const text = current === null || current === undefined ? "" : String(current);
  // A long value is cut off by the box: hovering shows all of it. The builder
  // keeps the title in step while the user types (wireQueryBuilder).
  const full = hoverTitle(text);
  const title = full ? ` title="${escapeHtml(full)}"` : "";
  return `<div class="ui input"><input type="${type}" data-part="value" ${attrs}${extra}${title} value="${escapeHtml(text)}" /></div>`;
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
  if (field.valueType === "boolean") return booleanDropdown(value);
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

/**
 * A free-entry dropdown's value once `typed` (text left in its typing box
 * when the focus left, without Enter) is added as an entry: the one value for
 * Equals, one more item for Is any of (unless it is already there). Without
 * this the box kept showing the text while the condition had no value
 * (issue #82). Blank text changes nothing.
 */
export function withTypedEntry(
  current: unknown,
  typed: string,
  multiple: boolean,
  valueType: ValueType,
): unknown {
  if (typed.trim() === "") return current;
  const entry = parseEntry(typed, valueType);
  if (!multiple) return entry;
  const items = Array.isArray(current) ? current : [];
  return items.includes(entry) ? items : [...items, entry];
}

/**
 * Whether text left in a free-entry dropdown's typing box is added as an entry
 * once the pointer's click has been handled. Not when the text is blank, not
 * when the condition changed since the focus left (a menu pick won: the typed
 * text is not the choice), and not when the focus is back in the same dropdown.
 */
export function shouldAddTypedEntry(state: {
  typed: string;
  conditionChanged: boolean;
  focusInDropdown: boolean;
}): boolean {
  return state.typed.trim() !== "" && !state.conditionChanged && !state.focusInDropdown;
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
    const entry = chosen ? optionEntry(chosen) : "";
    // The yes/no dropdown (booleanDropdown): nothing chosen is null.
    if (valueType === "boolean") return booleanFromOptionValue(entry);
    return parseEntry(entry, valueType);
  }
  if (control instanceof HTMLInputElement) return readInput(control, valueType);
  return null;
}

function readInput(el: HTMLInputElement | null, valueType: ValueType): unknown {
  return el ? parseEntry(el.value, valueType) : null;
}
