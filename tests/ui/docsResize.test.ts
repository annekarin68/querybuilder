import { describe, it, expect } from "vitest";
import {
  clampDocsWidth,
  DOCS_DEFAULT_REM,
  DOCS_MAX_REM,
  DOCS_MIN_REM,
} from "../../src/ui/docsResize";

describe("clampDocsWidth", () => {
  it("keeps the sidebar between 20 and 40rem", () => {
    expect(DOCS_MIN_REM).toBe(20);
    expect(DOCS_MAX_REM).toBe(40);
    expect(clampDocsWidth(5)).toBe(20);
    expect(clampDocsWidth(30)).toBe(30);
    expect(clampDocsWidth(99)).toBe(40);
  });
  it("falls back to the default for nonsense", () => {
    expect(clampDocsWidth(NaN)).toBe(DOCS_DEFAULT_REM);
  });
});
