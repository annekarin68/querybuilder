import { describe, it, expect } from "vitest";
import { complianceHtml } from "../../src/ui/accountMenu";

describe("the account menu's Compliance section", () => {
  it("shows the log whole in a focusable, labelled region, then Withdraw", () => {
    const html = complianceHtml({ status: "acknowledged", log: '{\n  "reason": "audit"\n}' });
    expect(html).toContain(
      '<pre class="qb-account-log" tabindex="0" aria-label="Compliance log">{\n  &quot;reason&quot;: &quot;audit&quot;\n}</pre>',
    );
    expect(html.indexOf("qb-account-log")).toBeLessThan(html.indexOf("withdraw-compliance"));
    // Issue #97: a bare "Invalidate" didn't say what it invalidates.
    expect(html).toContain(">Withdraw compliance reason</button>");
  });

  it("escapes markup in the log", () => {
    const html = complianceHtml({ status: "acknowledged", log: '{"x": "<img src=x>"}' });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("offers the compliance check when none is logged", () => {
    expect(complianceHtml({ status: "required" })).toContain("Start compliance check");
  });
});
