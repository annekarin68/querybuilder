// Flat config (ESLint 9). Replaces .eslintrc.cjs.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// The jQuery airlock (docs/ARCHITECTURE.md, "The Fomantic discipline").
const JQUERY_ONLY_IN_AIRLOCK = {
  name: "jquery",
  message:
    'jQuery may only be imported in src/ui/fomantic.ts (the airlock) or src/setup-jquery.ts (the global bootstrap). See docs/ARCHITECTURE.md, "The Fomantic discipline".',
};

export default tseslint.config(
  { ignores: ["dist/", "coverage/"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Application + config + test sources (TypeScript).
  {
    files: ["**/*.{ts,cts,mts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // jquery may be imported only in src/ui/fomantic.ts and
      // src/setup-jquery.ts (switched off for those two files below).
      "no-restricted-imports": ["error", { paths: [JQUERY_ONLY_IN_AIRLOCK] }],
    },
  },

  // The mock-server airlock (docs/ARCHITECTURE.md, "Mock server"): src/ reaches
  // the backend only through src/api/client.ts + src/api/types.ts, never by
  // importing mock-server's modules directly. This keeps src/ swappable onto
  // a real backend without knowing anything about the mock's internals.
  //
  // `paths` MUST repeat the jquery entry. When two blocks set the same rule,
  // the later block's options REPLACE the earlier ones (they are not merged),
  // so without it any file in src/ could import jquery and lint would pass.
  // tests/lintRules.test.ts fails if the entry goes missing.
  {
    files: ["src/**/*.{ts,cts,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [JQUERY_ONLY_IN_AIRLOCK],
          patterns: [
            {
              group: [
                "../mock-server",
                "../mock-server/*",
                "../../mock-server",
                "../../mock-server/*",
                "**/mock-server/**",
              ],
              message:
                'src/ must not import mock-server directly — go through src/api/client.ts + src/api/types.ts. See docs/ARCHITECTURE.md, "Mock server".',
            },
          ],
        },
      ],
    },
  },

  // The two files that legitimately import jQuery.
  {
    files: ["src/ui/fomantic.ts", "src/setup-jquery.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // The bootstrap publishes window.jQuery but must never CALL $().
  {
    files: ["src/setup-jquery.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='$']",
          message:
            "This file may only bootstrap window.jQuery — put jQuery work in src/ui/fomantic.ts.",
        },
      ],
    },
  },

  // Plain-JS build script.
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
