import type { SchemaResponse } from "../api/types";
import { escapeHtml } from "./panel";

type Field = SchemaResponse["fields"][number];
type Operator = SchemaResponse["operators"][number];

function enumDropdown(field: Field, current: unknown, multiple: boolean): string {
  const values = multiple
    ? Array.isArray(current)
      ? current.map(String)
      : []
    : [String(current ?? "")];
  const opts = (field.options ?? [])
    .map(
      (o) =>
        `<option value="${escapeHtml(o.value)}"${
          values.includes(o.value) ? " selected" : ""
        }>${escapeHtml(o.label)}</option>`,
    )
    .join("");
  return `<select class="ui ${multiple ? "multiple " : ""}selection dropdown" data-part="value"${
    multiple ? " multiple" : ""
  }>
    ${multiple ? "" : `<option value="">Choose…</option>`}${opts}
  </select>`;
}

function scalarInput(field: Field, current: unknown, part: string): string {
  const v = escapeHtml(current ?? "");
  if (field.valueType === "number")
    return `<input type="number" data-part="${part}" value="${v}" />`;
  if (field.valueType === "date") return `<input type="date" data-part="${part}" value="${v}" />`;
  return `<input type="text" data-part="${part}" value="${v}" />`;
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
      return `${enumDropdown(field, from, false).replace(
        'data-part="value"',
        'data-part="value" data-range="from"',
      )}
              <span style="margin:0 .4rem">to</span>
              ${enumDropdown(field, to, false).replace(
                'data-part="value"',
                'data-part="value" data-range="to"',
              )}`;
    }
    const from = Array.isArray(value) ? value[0] : "";
    const to = Array.isArray(value) ? value[1] : "";
    return `<div class="ui input" style="margin-right:.3rem">${scalarInput(
      field,
      from,
      "value",
    ).replace('data-part="value"', 'data-part="value" data-range="from"')}</div>
      <span style="margin:0 .4rem">to</span>
      <div class="ui input">${scalarInput(field, to, "value").replace(
        'data-part="value"',
        'data-part="value" data-range="to"',
      )}</div>`;
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
