import { h } from "./dom.js";
import type { ConditionValue, FieldDefinition, OperatorDefinition } from "../core/types.js";

export interface ValueInputParams {
  readonly field: FieldDefinition;
  readonly operator: OperatorDefinition;
  readonly value: ConditionValue;
  readonly onChange: (value: ConditionValue) => void;
}

/**
 * Picks and builds the right value input(s) for a field/operator pair.
 * This is the one place that knows how ValueType and OperatorArity combine
 * into concrete form controls, so every other component can stay ignorant
 * of that mapping.
 */
export function renderValueInput({ field, operator, value, onChange }: ValueInputParams): Node {
  switch (operator.arity) {
    case "none":
      return document.createDocumentFragment();
    case "single":
      return renderScalarControl(field, (value as string | number | boolean | null) ?? "", onChange);
    case "range":
      return renderRangeControl(field, value, onChange);
    case "multi":
      return renderMultiControl(field, value, onChange);
    default:
      return document.createDocumentFragment();
  }
}

function renderScalarControl(
  field: FieldDefinition,
  value: string | number | boolean,
  onChange: (value: ConditionValue) => void,
): HTMLElement {
  switch (field.valueType) {
    case "number":
      return h("input", {
        type: "number",
        class: "value-input",
        value: value === "" ? "" : Number(value),
        oninput: (e) => onChange(toNumberOrNull((e.target as HTMLInputElement).value)),
      });
    case "date":
      return h("input", {
        type: "date",
        class: "value-input",
        value: String(value ?? ""),
        oninput: (e) => onChange((e.target as HTMLInputElement).value || null),
      });
    case "boolean":
      return h(
        "select",
        {
          class: "value-input",
          onchange: (e) => onChange((e.target as HTMLSelectElement).value === "true"),
        },
        [
          h("option", { value: "true", selected: value === true }, ["true"]),
          h("option", { value: "false", selected: value === false }, ["false"]),
        ],
      );
    case "enum":
      return h(
        "select",
        {
          class: "value-input",
          onchange: (e) => onChange((e.target as HTMLSelectElement).value || null),
        },
        [
          h("option", { value: "", selected: value === "" || value === null }, ["Select…"]),
          ...(field.options ?? []).map((option) =>
            h("option", { value: option.value, selected: option.value === value }, [option.label]),
          ),
        ],
      );
    case "string":
    default:
      return h("input", {
        type: "text",
        class: "value-input",
        value: String(value ?? ""),
        oninput: (e) => onChange((e.target as HTMLInputElement).value),
      });
  }
}

function renderRangeControl(
  field: FieldDefinition,
  value: ConditionValue,
  onChange: (value: ConditionValue) => void,
): HTMLElement {
  const [initialStart, initialEnd] = Array.isArray(value) ? value : ["", ""];

  // The two sides are read live from the DOM whenever either changes, rather
  // than from closed-over `initialStart`/`initialEnd` — those go stale the
  // instant one side changes, which would silently drop the other side's
  // value if both are edited before this component's next render.
  let startControl!: HTMLElement;
  let endControl!: HTMLElement;
  const emitCurrentRange = () => {
    onChange([readScalarValue(field, startControl), readScalarValue(field, endControl)] as ConditionValue);
  };

  startControl = renderScalarControl(field, initialStart ?? "", emitCurrentRange);
  endControl = renderScalarControl(field, initialEnd ?? "", emitCurrentRange);

  return h("span", { class: "range-input" }, [
    startControl,
    h("span", { class: "range-separator", ariaLabel: "and" }, ["–"]),
    endControl,
  ]);
}

function readScalarValue(field: FieldDefinition, control: HTMLElement): string | number {
  const input = control as HTMLInputElement | HTMLSelectElement;
  if (field.valueType === "number") {
    return input.value === "" ? "" : Number(input.value);
  }
  return input.value;
}

function renderMultiControl(
  field: FieldDefinition,
  value: ConditionValue,
  onChange: (value: ConditionValue) => void,
): HTMLElement {
  const selectedValues = new Set(Array.isArray(value) ? value.map(String) : []);
  const options = field.options ?? [];

  return h(
    "select",
    {
      class: "value-input value-input--multi",
      multiple: true,
      size: Math.min(Math.max(options.length, 2), 5),
      onchange: (e) => {
        const select = e.target as HTMLSelectElement;
        const next = Array.from(select.selectedOptions).map((option) => option.value);
        onChange(next);
      },
    },
    options.map((option) => h("option", { value: option.value, selected: selectedValues.has(option.value) }, [option.label])),
  );
}

function toNumberOrNull(raw: string): number | null {
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}
