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

// The mock-server airlock (docs/ARCHITECTURE.md, "Mock server").
const MOCK_SERVER_AIRLOCK = {
  group: [
    "../mock-server",
    "../mock-server/*",
    "../../mock-server",
    "../../mock-server/*",
    "**/mock-server/**",
  ],
  message:
    'src/ must not import mock-server directly — go through src/api/client.ts. See docs/ARCHITECTURE.md, "Mock server".',
};

// The wire-types airlock (docs/ARCHITECTURE.md, "Data model").
const WIRE_TYPES_AIRLOCK = {
  group: ["./api/types", "../api/types", "../../api/types", "**/api/types"],
  message:
    "Only src/api/ may import the backend's types (src/api/types.ts) — use the frontend's own model in src/model.ts. See docs/ARCHITECTURE.md, \"Data model\".",
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

  // Two more airlocks for src/:
  //  - mock-server (docs/ARCHITECTURE.md, "Mock server"): src/ reaches the
  //    backend only through src/api/client.ts, never by importing
  //    mock-server's modules directly, so it knows nothing of the mock's
  //    internals.
  //  - the backend's types (docs/ARCHITECTURE.md, "Data model"): only
  //    src/api/ may import src/api/types.ts. Everything else uses the
  //    frontend's own model (src/model.ts), so a backend rename touches
  //    src/api/ alone. Switched off for src/api/ below.
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
          patterns: [MOCK_SERVER_AIRLOCK, WIRE_TYPES_AIRLOCK],
        },
      ],
    },
  },

  // src/api/ is where the backend's types are translated, so it may import
  // them. The other two airlocks still apply.
  {
    files: ["src/api/**/*.{ts,cts,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [JQUERY_ONLY_IN_AIRLOCK], patterns: [MOCK_SERVER_AIRLOCK] },
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
