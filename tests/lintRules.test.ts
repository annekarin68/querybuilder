import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

/**
 * The two import airlocks in eslint.config.js: jQuery only in its two files,
 * and src/ never importing mock-server/. They are easy to switch off by
 * accident (see the comment on the src/** block there), so lint a few
 * snippets as if they lived at `filePath` and check the rule still fires.
 */
const eslint = new ESLint();

async function restrictedImportErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

const importJquery = 'import $ from "jquery";\nexport const x = $;\n';

describe("lint airlocks", { timeout: 30_000 }, () => {
  it.each(["src/ui/queryBuilder.ts", "src/main.ts", "mock-server/index.ts", "tests/x.test.ts"])(
    "jquery may not be imported in %s",
    async (filePath) => {
      const errors = await restrictedImportErrors(importJquery, filePath);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("jQuery may only be imported");
    },
  );

  it.each(["src/ui/fomantic.ts", "src/setup-jquery.ts"])(
    "jquery may be imported in %s",
    async (filePath) => {
      expect(await restrictedImportErrors(importJquery, filePath)).toEqual([]);
    },
  );

  it("src/ may not import mock-server/", async () => {
    const code =
      'import { DATABASES } from "../../mock-server/databases";\nexport const x = DATABASES;\n';
    const errors = await restrictedImportErrors(code, "src/ui/queryBuilder.ts");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/ must not import mock-server");
  });
});
