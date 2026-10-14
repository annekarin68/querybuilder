import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

/**
 * The import airlocks in eslint.config.js: jQuery only in its two files,
 * src/ never importing mock-server/, and only src/api/ importing the backend's
 * types. They are easy to switch off by
 * accident (see the comment on the src/** block there), so lint a few
 * snippets as if they lived at `filePath` and check the rule still fires.
 * Besides import lines, the airlocks also cover jQuery's globals and
 * `import("…")`, which an import rule alone doesn't see.
 */
const eslint = new ESLint();

async function restrictedImportErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

/** Messages from every rule that guards an airlock, not only the import rule. */
const AIRLOCK_RULES = [
  "no-restricted-imports",
  "no-restricted-globals",
  "no-restricted-properties",
  "no-restricted-syntax",
];
async function airlockErrors(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages
    .filter((m) => AIRLOCK_RULES.includes(m.ruleId ?? ""))
    .map((m) => m.message);
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

  const importWireTypes = (from: string) =>
    `import type { DatabasesResponse } from "${from}";\nexport type X = DatabasesResponse;\n`;

  it.each([
    ["src/ui/statsPanel.ts", "../api/types"],
    ["src/app.ts", "./api/types"],
    ["src/query/fieldCatalog.ts", "../api/types"],
  ])("%s may not import the backend's types", async (filePath, from) => {
    const errors = await restrictedImportErrors(importWireTypes(from), filePath);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Only src/api/ may import the backend's types");
  });

  it("src/api/ may import the backend's types, but still not jquery or mock-server", async () => {
    expect(await restrictedImportErrors(importWireTypes("./types"), "src/api/response.ts")).toEqual(
      [],
    );
    expect(await restrictedImportErrors(importJquery, "src/api/client.ts")).toHaveLength(1);
    const mock =
      'import { DATABASES } from "../../mock-server/databases";\nexport const x = DATABASES;\n';
    expect(await restrictedImportErrors(mock, "src/api/client.ts")).toHaveLength(1);
  });

  it("src/query/ may still import its own ./types", async () => {
    const code = 'import type { Group } from "./types";\nexport type X = Group;\n';
    expect(await restrictedImportErrors(code, "src/query/tree.ts")).toEqual([]);
  });

  // jQuery's types declare `$` and `jQuery` as globals, and setup-jquery.ts puts
  // them on `window`, so code can reach jQuery without importing it.
  it.each([
    '$("#x").hide();\nexport {};\n',
    'jQuery.ajax("/x");\nexport {};\n',
    'window.$("#x");\nexport {};\n',
    'globalThis.jQuery("#x");\nexport {};\n',
    'export const m = import("jquery");\n',
  ])("src/ may not reach jQuery without importing it: %j", async (code) => {
    const errors = await airlockErrors(code, "src/ui/queryBuilder.ts");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("jQuery may only be used in src/ui/fomantic.ts");
  });

  it("fomantic.ts may use its own $, and setup-jquery.ts may publish it", async () => {
    const fomantic = 'import $ from "jquery";\nexport const f = () => $("#x");\n';
    expect(await airlockErrors(fomantic, "src/ui/fomantic.ts")).toEqual([]);
    const bootstrap = 'import $ from "jquery";\nwindow.jQuery = $;\nwindow.$ = $;\n';
    expect(await airlockErrors(bootstrap, "src/setup-jquery.ts")).toEqual([]);
  });

  it("src/ may not reach mock-server/ with import()", async () => {
    const code = 'export const m = import("../../mock-server/databases");\n';
    const errors = await airlockErrors(code, "src/ui/queryBuilder.ts");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("src/ must not import mock-server");
  });

  it.each([
    'import type { StatsResponse } from "../api/types.js";\nexport type X = StatsResponse;\n',
    'export type X = import("../api/types").StatsResponse;\n',
  ])("src/ outside src/api/ may not reach the backend's types: %j", async (code) => {
    const errors = await airlockErrors(code, "src/ui/statsPanel.ts");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Only src/api/ may import the backend's types");
  });

  it("src/api/ may use import() types for the backend's types", async () => {
    const code = 'export type X = import("./types").StatsResponse;\n';
    expect(await airlockErrors(code, "src/api/response.ts")).toEqual([]);
  });
});
