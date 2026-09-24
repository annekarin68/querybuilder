import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Offline-first (docs/ARCHITECTURE.md, "Offline-first"): nothing may load from the internet, so
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

/**
 * Licence compliance: the minifier drops vendor licence banners, so
 * THIRD-PARTY-NOTICES.txt is the licence notice for the bundled jQuery /
 * Fomantic-UI / Lato code. Emit it into dist/ on every build so deploying
 * dist/ always ships it — no manual copy step to forget. (The repo-root file
 * stays the single source; scripts/check-offline.mjs exempts this one file,
 * whose licence URLs are document text the app never fetches.)
 */
function emitLicenseNotices(): Plugin {
  return {
    name: "emit-license-notices",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.txt",
        source: readFileSync("THIRD-PARTY-NOTICES.txt", "utf8"),
      });
    },
  };
}

/**
 * The API prefix from .env (docs/ARCHITECTURE.md, "API contract"). The app
 * has no default of its own, so a missing value — or one ending in "/", which
 * would double the slash in every URL — stops dev and build here, never in the
 * running app.
 */
function apiBase(mode: string): string {
  const base = loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE ?? "";
  if (!base || base.endsWith("/")) {
    throw new Error(
      `VITE_API_BASE must be set, without a trailing slash (see .env); got "${base}".`,
    );
  }
  return base;
}

/**
 * The backend the dev server forwards the API prefix to: DEV_BACKEND_URL from
 * .env — the mock server by default, or a real backend. Only the dev server
 * uses it; a built dist/ is served next to the real API instead.
 */
function devBackendUrl(mode: string): string {
  const url = loadEnv(mode, process.cwd(), "DEV_").DEV_BACKEND_URL ?? "";
  if (!URL.canParse(url)) {
    throw new Error(`DEV_BACKEND_URL must be a URL (see .env); got "${url}".`);
  }
  return url;
}

export default defineConfig(({ mode }) => {
  const api = apiBase(mode);
  return {
    plugins: [stripRemoteCss(), stripRemoteJs(), emitLicenseNotices()],
    server: {
      port: 5173,
      // Everything the app asks of the backend is under the API prefix, so
      // this one rule is the whole proxy. Pages the backend redirects the
      // browser to (an IdP, a compliance service) are the backend's business:
      // off-origin in production, under the prefix in the mock.
      proxy: { [api]: devBackendUrl(mode) },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Fomantic ships one prebuilt CSS file and one prebuilt JS file. Neither can
      // be tree-shaken, so the bundle is big on purpose. Raise the warning
      // threshold so a known, accepted size stops crying wolf on every build.
      chunkSizeWarningLimit: 1500,
    },
  };
});
