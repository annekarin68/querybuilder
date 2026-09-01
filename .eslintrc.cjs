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
              "jQuery may only be imported in src/ui/fomantic.ts (the airlock) or src/setup-jquery.ts (the global bootstrap). See docs/ARCHITECTURE.md §3.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // The airlock, and the one module that publishes window.jQuery before
      // Fomantic's JS evaluates (§3, "the bootstrap wrinkle").
      files: ["src/ui/fomantic.ts", "src/setup-jquery.ts"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      // setup-jquery.ts assigns the global; it must never CALL $(). main.ts
      // imports neither, but keep the guard so nobody reintroduces $() there.
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
    {
      files: ["tests/**/*.ts", "mock-server/**/*.ts", "*.config.ts", "scripts/**"],
      env: { node: true },
    },
  ],
  ignorePatterns: ["dist/", "node_modules/"],
};
