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

// The wire-types airlock (docs/ARCHITECTURE.md, "Data model"). The `.*`
// entries catch the same file written with an extension ("../api/types.js").
const WIRE_TYPES_AIRLOCK = {
  group: [
    "./api/types",
    "../api/types",
    "../../api/types",
    "**/api/types",
    "./api/types.*",
    "../api/types.*",
    "../../api/types.*",
    "**/api/types.*",
  ],
  message:
    "Only src/api/ may import the backend's types (src/api/types.ts) — use the frontend's own model in src/model.ts. See docs/ARCHITECTURE.md, \"Data model\".",
};

// `no-restricted-imports` only sees `import … from "…"` lines. jQuery's types
// also declare `$` and `jQuery` as globals, setup-jquery.ts puts them on
// `window`, and an `import("…")` expression or an `import("…").Type` type is
// not an import line. These rules close those other routes into the airlocks,
// so "never write $(...) outside fomantic.ts" really is enforced.
const JQUERY_MESSAGE =
  'jQuery may only be used in src/ui/fomantic.ts (the airlock). See docs/ARCHITECTURE.md, "The Fomantic discipline".';
const JQUERY_GLOBALS = ["$", "jQuery"].map((name) => ({ name, message: JQUERY_MESSAGE }));
const JQUERY_ON_WINDOW = ["window", "globalThis"].flatMap((object) =>
  ["$", "jQuery"].map((property) => ({ object, property, message: JQUERY_MESSAGE })),
);

/** `no-restricted-syntax` entries that forbid `import("…")` and
 *  `import("…").Type` when the path matches `pathRegex`. */
function dynamicImportsOf(pathRegex, message) {
  return [
    { selector: `ImportExpression[source.value=${pathRegex}]`, message },
    { selector: `TSImportType[argument.literal.value=${pathRegex}]`, message },
  ];
}
const NO_DYNAMIC_JQUERY = dynamicImportsOf("/^jquery$/", JQUERY_MESSAGE);
const NO_DYNAMIC_MOCK_SERVER = dynamicImportsOf("/mock-server/", MOCK_SERVER_AIRLOCK.message);
const NO_DYNAMIC_WIRE_TYPES = dynamicImportsOf("/api.types/", WIRE_TYPES_AIRLOCK.message);

export default tseslint.config(
  { ignores: ["dist/", "coverage/", ".claude/"] },

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
  // The same replace-not-merge rule holds for `no-restricted-syntax`: the
  // blocks below that set it again repeat the entries they still need.
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
      "no-restricted-globals": ["error", ...JQUERY_GLOBALS],
      "no-restricted-properties": ["error", ...JQUERY_ON_WINDOW],
      "no-restricted-syntax": [
        "error",
        ...NO_DYNAMIC_JQUERY,
        ...NO_DYNAMIC_MOCK_SERVER,
        ...NO_DYNAMIC_WIRE_TYPES,
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
      "no-restricted-syntax": ["error", ...NO_DYNAMIC_JQUERY, ...NO_DYNAMIC_MOCK_SERVER],
    },
  },

  // The two files that legitimately import jQuery. (fomantic.ts's `$` is its
  // own import, not the global, so no-restricted-globals doesn't fire there.)
  {
    files: ["src/ui/fomantic.ts", "src/setup-jquery.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // The bootstrap publishes window.jQuery and window.$ but must never CALL $().
  {
    files: ["src/setup-jquery.ts"],
    rules: {
      "no-restricted-properties": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='$']",
          message:
            "This file may only bootstrap window.jQuery — put jQuery work in src/ui/fomantic.ts.",
        },
        ...NO_DYNAMIC_MOCK_SERVER,
        ...NO_DYNAMIC_WIRE_TYPES,
      ],
    },
  },

  // Plain-JS build script.
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
