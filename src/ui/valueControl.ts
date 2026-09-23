import type { CatalogField, CatalogOperator } from "../query/fieldCatalog";
import { escapeHtml, optionsHtml } from "./panel";

type Field = CatalogField;
type Operator = CatalogOperator;

function enumDropdown(field: Field, current: unknown, multiple: boolean, extraAttrs = ""): string {
  const values = multiple
    ? Array.isArray(current)
      ? current.map(String)
      : []
    : [String(current ?? "")];
  const opts = optionsHtml(
    field.options ?? [],
    (o) => o.value,
    (o) => o.label,
    (o) => values.includes(o.value),
  );
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  return `<select class="ui ${multiple ? "multiple " : ""}selection dropdown" data-part="value"${attrs}${
    multiple ? " multiple" : ""
  }>
    ${multiple ? "" : `<option value="">Choose…</option>`}${opts}
  </select>`;
}

function scalarInput(field: Field, current: unknown, part: string, extraAttrs = ""): string {
  const v = escapeHtml(current ?? "");
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  if (field.valueType === "number")
    return `<input type="number" data-part="${part}"${attrs} value="${v}" />`;
  if (field.valueType === "date")
    return `<input type="date" data-part="${part}"${attrs} value="${v}" />`;
  return `<input type="text" data-part="${part}"${attrs} value="${v}" />`;
}

export function renderValueControl(
  field: Field | undefined,
  operator: Operator | undefined,
  value: unknown,
): string {
  if (!field || !operator || operator.arity === "none") return "";
  if (operator.arity === "many") {
    if (field.valueType === "enum") return enumDropdown(field, value, true);
    // Non-enum "many" has no fixed option list, so there is nothing for a Fomantic
    // dropdown to offer. Fomantic's free-entry mode (`allowAdditions`) is a
    // settings-only option — it is never read from `data-*`, and the airlock's
    // activate() passes only { fullTextSearch: true } — so the old dropdown markup
    // was inert. A plain comma-separated text input is the simpler, working control.
    return `<div class="ui input"><input type="text" data-part="value" data-multi="1" value="${escapeHtml(
      Array.isArray(value) ? value.join(", ") : "",
    )}" placeholder="Comma-separated values" /></div>`;
  }
  if (operator.arity === "two") {
    if (field.valueType === "enum") {
      const from = Array.isArray(value) ? value[0] : undefined;
      const to = Array.isArray(value) ? value[1] : undefined;
      return `<div class="qb-range">${enumDropdown(field, from, false, 'data-range="from"')}<span class="qb-range-to">to</span>${enumDropdown(field, to, false, 'data-range="to"')}</div>`;
    }
    const from = Array.isArray(value) ? value[0] : "";
    const to = Array.isArray(value) ? value[1] : "";
    return `<div class="qb-range"><div class="ui input">${scalarInput(field, from, "value", 'data-range="from"')}</div><span class="qb-range-to">to</span><div class="ui input">${scalarInput(field, to, "value", 'data-range="to"')}</div></div>`;
  }
  // arity "one"
  if (field.valueType === "boolean") {
    return `<div class="ui toggle checkbox" data-part="value">
      <input type="checkbox"${value === true ? " checked" : ""} /><label>true</label>
    </div>`;
  }
  if (field.valueType === "enum") return enumDropdown(field, value, false);
  return `<div class="ui input">${scalarInput(field, value, "value")}</div>`;
}

/**
 * The value a condition should hold when it has no meaningful selection yet — not
 * every control can represent "unset" on screen (a boolean toggle is always either
 * true or false), so this is where a field/operator's real default lives. Kept
 * next to `renderValueControl`/`readValueControl` since it's the same arity ×
 * valueType dispatch table, just answering "what's the default" instead of
 * "how do I render/read this".
 */
export function defaultValueFor(field: Field | undefined, operator: Operator | undefined): unknown {
  if (field?.valueType === "boolean" && operator?.arity === "one") return false;
  return null;
}

export function readValueControl(
  row: HTMLElement,
  arity: Operator["arity"],
  valueType: Field["valueType"],
): unknown {
  if (arity === "none") return null;
  if (arity === "two") {
    const from = row.querySelector<HTMLElement>('[data-range="from"]');
    const to = row.querySelector<HTMLElement>('[data-range="to"]');
    return [readOne(from, valueType), readOne(to, valueType)];
  }
  if (arity === "many") {
    const sel = row.querySelector<HTMLSelectElement>('select[multiple][data-part="value"]');
    if (sel) return Array.from(sel.selectedOptions).map((o) => o.value);
    const text = row.querySelector<HTMLInputElement>('[data-part="value"][data-multi="1"]');
    return (text?.value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return readOne(row.querySelector<HTMLElement>('[data-part="value"]'), valueType);
}

function readOne(el: HTMLElement | null, valueType: Field["valueType"]): unknown {
  if (!el) return null;
  if (el.matches(".ui.checkbox"))
    return el.querySelector<HTMLInputElement>("input")?.checked ?? false;
  if (el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLInputElement)
    return valueType === "number" && el.value !== "" ? Number(el.value) : el.value;
  const inner = el.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  return inner ? readOne(inner, valueType) : null;
}
