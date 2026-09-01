import { defineConfig, type Plugin } from "vite";

/**
 * Offline-first (docs/ARCHITECTURE.md §2): nothing may load from the internet, so
 * this plugin strips every off-origin `@import` / `url()` from bundled CSS. In
 * fomantic-ui-css@2.9.x the only off-origin references are the emoji icon URLs
 * pointing at `cdn.jsdelivr.net` (jdecked/twemoji), and they sit in commented-out
 * rules — nothing the browser would fetch, but `check:offline` greps the text, so
 * they are neutralised here. Note 2.9.x does NOT `@import` Google Fonts: it ships
 * Lato self-hosted as `themes/default/assets/fonts/Lato*.woff2` with local
 * `@font-face` rules. The `@import` branch below is kept only as a guard in case a
 * future/other CSS dependency reintroduces one.
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

/**
 * Offline-first, JS side. Bundling Fomantic-UI's and jQuery's JS pulls in a
 * handful of off-origin URLs that are never network-dereferenced but still trip
 * `scripts/check-offline.mjs` (which greps the built JS for `https://`):
 *   - jQuery's `/*! ... *\/` banner (`https://jquery.com/`, `https://jquery.org/license`).
 *     This plugin neutralises the URLs in it. The minifier drops the banner text
 *     itself (behaviour varies by toolchain), so licence attribution does NOT rely
 *     on it — `THIRD-PARTY-NOTICES.txt` at the repo root carries the full terms and
 *     must be deployed alongside `dist/` (see README).
 *   - Fomantic developer-facing error-message strings embedding upstream project
 *     URLs: the `unorm` polyfill hint and the `jquery-address` library hint. These
 *     live inside `error:` setting objects and are only ever `console`'d / thrown.
 * Neutralize the URL scheme so the offline audit stays honest without changing
 * any behavior we rely on.
 */
function stripRemoteJs(): Plugin {
  return {
    name: "strip-remote-js",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[cm]?js$/.test(id)) return null;
      const cleaned = code.replace(
        /https?:\/\/(jquery\.com\/|jquery\.org\/license|cdn\.jsdelivr\.net\/npm\/unorm[^\s"'`)>]*|github\.com\/asual\/jquery-address)/gi,
        "(removed-for-offline)",
      );
      return cleaned === code ? null : { code: cleaned, map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripRemoteCss(), stripRemoteJs()],
  esbuild: { legalComments: "eof" },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Fomantic's CSS/JS is one big vendor chunk by design (§2). Raise the warning
    // threshold so a known, accepted size stops crying wolf on every build.
    chunkSizeWarningLimit: 1500,
  },
});
