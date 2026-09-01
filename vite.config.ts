import { defineConfig, type Plugin } from "vite";

/**
 * Offline-first (docs/ARCHITECTURE.md §2): nothing may load from the internet, so
 * this plugin strips every off-origin `@import` / `url()` from bundled CSS. In
 * fomantic-ui-css@2.9.x the off-origin references are the emoji icon URLs pointing
 * at `cdn.jsdelivr.net` (jdecked/twemoji); older builds also carried an
 * `@import url(https://fonts.googleapis.com/...)` for Lato. Both forms are removed
 * regardless. Lato is provided locally by @fontsource/lato (imported in src/main.ts).
 */
function stripRemoteCss(): Plugin {
  return {
    name: "strip-remote-css",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith(".css")) return null;
      const cleaned = code
        .replace(/@import\s+url\(\s*['"]?https?:\/\/[^)]+\)\s*;?/gi, "")
        .replace(/url\(\s*['"]?https?:\/\/[^)'"]+['"]?\s*\)/gi, "local(x)");
      return cleaned === code ? null : { code: cleaned, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripRemoteCss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
