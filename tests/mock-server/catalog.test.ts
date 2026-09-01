import { describe, it, expect } from "vitest";
import { DATABASES, FIELDS, OPERATORS } from "../../mock-server/catalog";

describe("catalog", () => {
  it("every field references only real operator ids", () => {
    const ids = new Set(OPERATORS.map((o) => o.id));
    for (const f of FIELDS) {
      for (const opId of f.operatorIds) expect(ids.has(opId)).toBe(true);
    }
  });

  it("enum fields have options", () => {
    for (const f of FIELDS) {
      if (f.valueType === "enum") expect(f.options && f.options.length).toBeTruthy();
    }
  });

  it("operator arities are from the allowed set", () => {
    for (const o of OPERATORS) expect(["none", "one", "two", "many"]).toContain(o.arity);
  });

  it("every database has a positive size, spanning several orders of magnitude", () => {
    for (const d of DATABASES) expect(d.size).toBeGreaterThan(0);
    const sizes = DATABASES.map((d) => d.size);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1000);
  });
});
