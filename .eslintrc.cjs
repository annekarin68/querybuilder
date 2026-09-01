module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2022: true, node: true },
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "jquery",
            message:
              "jQuery may only be imported in src/ui/fomantic.ts (the airlock). See docs/ARCHITECTURE.md §3.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["src/ui/fomantic.ts"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      // main.ts must import jquery to set window.jQuery before Fomantic's JS loads
      // (§3, "the bootstrap wrinkle") — but that is ALL it may do with it.
      files: ["src/main.ts"],
      rules: {
        "no-restricted-imports": "off",
        "no-restricted-syntax": [
          "error",
          {
            selector: "CallExpression[callee.name='$']",
            message:
              "src/main.ts may bootstrap window.jQuery but must not use $() — put jQuery work in src/ui/fomantic.ts.",
          },
        ],
      },
    },
    {
      files: ["tests/**/*.ts", "mock-server/**/*.ts", "*.config.ts", "scripts/**"],
      env: { node: true },
    },
  ],
  ignorePatterns: ["dist/", "node_modules/"],
};
