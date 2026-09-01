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
      files: ["src/ui/fomantic.ts", "src/main.ts"],
      rules: { "no-restricted-imports": "off" },
    },
    {
      files: ["tests/**/*.ts", "mock-server/**/*.ts", "*.config.ts", "scripts/**"],
      env: { node: true },
    },
  ],
  ignorePatterns: ["dist/", "node_modules/"],
};
