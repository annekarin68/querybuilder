import { describe, it, expect } from "vitest";
import { paginate } from "../../mock-server/index";

describe("paginate", () => {
  const items = Array.from({ length: 57 }, (_, i) => i);
  it("returns the requested page", () => {
    const r = paginate(items, 2, 25);
    expect(r.slice).toEqual(items.slice(25, 50));
    expect(r).toMatchObject({ page: 2, pageSize: 25, totalRows: 57 });
  });
  it("clamps page below 1 and huge pageSize", () => {
    expect(paginate(items, 0, 1000).page).toBe(1);
    expect(paginate(items, 0, 1000).pageSize).toBe(100);
  });
});
