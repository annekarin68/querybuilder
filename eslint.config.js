// Flat config (ESLint 9). Replaces .eslintrc.cjs.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

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
      // The jQuery airlock (docs/ARCHITECTURE.md §3): jquery may be imported
      // only in src/ui/fomantic.ts and src/setup-jquery.ts (overridden below).
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "jquery",
              message:
                "jQuery may only be imported in src/ui/fomantic.ts (the airlock) or src/setup-jquery.ts (the global bootstrap). See docs/ARCHITECTURE.md §3.",
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

  // These files may publish window.jQuery but must never CALL $().
  {
    files: ["src/main.ts", "src/setup-jquery.ts"],
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
