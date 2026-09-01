import { describe, it, expect } from "vitest";
import type { SchemaResponse } from "../../src/api/types";
import { renderValueControl } from "../../src/ui/valueControl";

type Field = SchemaResponse["fields"][number];
type Operator = SchemaResponse["operators"][number];

function field(overrides: Partial<Field> = {}): Field {
  return {
    id: "f",
    label: "F",
    valueType: "string",
    description: "",
    operatorIds: [],
    ...overrides,
  };
}

function op(arity: Operator["arity"]): Operator {
  return { id: "o", label: "O", description: "", arity };
}

const enumField = field({
  valueType: "enum",
  options: [
    { value: "a", label: "Apple" },
    { value: "b", label: "Banana" },
  ],
});

describe("renderValueControl", () => {
  it('arity "none" renders nothing', () => {
    expect(renderValueControl(field(), op("none"), null)).toBe("");
  });

  it('arity "one" + boolean renders a toggle checkbox', () => {
    const html = renderValueControl(field({ valueType: "boolean" }), op("one"), true);
    expect(html).toContain("ui toggle checkbox");
  });

  it('arity "one" + enum renders an <option> per label', () => {
    const html = renderValueControl(enumField, op("one"), "a");
    expect(html).toContain("<option");
    expect(html).toContain("Apple");
    expect(html).toContain("Banana");
  });

  it('arity "two" renders from/to ranges', () => {
    const html = renderValueControl(field({ valueType: "number" }), op("two"), [1, 2]);
    expect(html).toContain('data-range="from"');
    expect(html).toContain('data-range="to"');
  });

  it('arity "many" + enum renders a multiple select', () => {
    const html = renderValueControl(enumField, op("many"), ["a"]);
    expect(html).toContain("multiple");
  });
});
