// Fails if the built dist/ references any off-origin URL.
// See docs/ARCHITECTURE.md, "Offline-first".
//
// Run it with `npm run check:offline`. The scanning logic is exported as plain
// functions so tests/offlineCheck.test.ts can call them without a build.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// A full URL with a scheme that leaves the machine: http(s) and WebSocket.
const ABSOLUTE_URL_RE = /(?:https?|wss?):\/\/[^\s"'`)]+/gi;
// A protocol-relative URL ("//host/path") inherits the page's scheme, so a
// browser fetches it from another host all the same. "//" alone is also how a
// comment starts, so only count it where a URL is expected: after `src=` or
// `href=` (HTML attributes and assignments), inside `url(` and after `@import`.
const PROTOCOL_RELATIVE_URL_RE =
  /(?:\b(?:src|href)\s*=\s*|url\(\s*|@import\s+)["']?(\/\/[^\s"'`)>]+)/gi;

// Allowed: nothing off-origin. (Our API is same-origin, referenced as "/api/...".)
// Sole exception: the exact literal "http://www.w3.org/2000/svg" — the SVG XML
// namespace declared inside inline `data:image/svg+xml` URIs in Fomantic's CSS
// (e.g. `xmlns='http://www.w3.org/2000/svg'`). It is a namespace identifier, not
// a URL the browser ever dereferences, so it is not a network fetch. Compared by
// exact string equality below, so nothing else on w3.org is permitted.
const ALLOW = ["http://www.w3.org/2000/svg"];

// The licence notice (emitted by vite.config.ts) quotes licence URLs as plain
// document text. The app never loads or fetches it — it is there for humans and
// licence compliance — so this exact file, at the top of dist/, is exempt.
// Nothing else is.
const EXEMPT_PATHS_IN_DIST = ["THIRD-PARTY-NOTICES.txt"];

// Scan EVERY text file, rather than allow-listing a few text extensions: that
// way .json, .svg, .txt and .webmanifest are covered too, and any new text
// asset type is audited by default instead of silently skipped. Binary assets
// (fonts, images, video) are skipped because they are not text: a URL inside a
// .png or .woff2 is not something this regex can read.
const BINARY_RE = /\.(woff2?|ttf|eot|otf|png|jpe?g|gif|webp|avif|ico|mp4|webm)$/i;

/**
 * Every off-origin URL found in `text`, in order of appearance. Pure.
 * @param {string} text
 * @returns {string[]}
 */
export function findOffOrigin(text) {
  // (Spread into arrays first: iterator `.map` needs Node 22, we support 20.19.)
  const found = [
    ...[...text.matchAll(ABSOLUTE_URL_RE)].map((m) => ({ at: m.index, url: m[0] })),
    ...[...text.matchAll(PROTOCOL_RELATIVE_URL_RE)].map((m) => ({ at: m.index, url: m[1] })),
  ];
  return found
    .sort((a, b) => a.at - b.at)
    .map((f) => f.url)
    .filter((url) => !ALLOW.includes(url));
}

/** Paths of the text files under `dir` that the check must read. */
function listTextFiles(distDir, dir = distDir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTextFiles(distDir, p));
    else if (!BINARY_RE.test(name) && !EXEMPT_PATHS_IN_DIST.includes(relative(distDir, p)))
      out.push(p);
  }
  return out;
}

/**
 * Every off-origin URL in the text files under `distDir`.
 * @param {string} distDir
 * @returns {{ file: string, url: string }[]}
 */
export function findOffOriginInDir(distDir) {
  return listTextFiles(distDir).flatMap((file) =>
    findOffOrigin(readFileSync(file, "utf8")).map((url) => ({ file, url })),
  );
}

function main() {
  const DIST = "dist";
  if (!existsSync(DIST)) {
    console.error(`check:offline — "${DIST}/" not found. Run "npm run build" first.`);
    process.exit(2);
  }
  const problems = findOffOriginInDir(DIST);
  for (const { file, url } of problems) console.error(`OFF-ORIGIN URL in ${file}\n  ${url}`);
  if (problems.length > 0) {
    console.error(
      `\ncheck:offline FAILED — ${problems.length} off-origin URL(s). The app must run on the LAN with no internet.`,
    );
    process.exit(1);
  }
  console.log("check:offline OK — no off-origin URLs in dist/.");
}

// Scan only when run as a script, not when a test imports this file. Compare
// real paths: started through a symlink, argv[1] is the link while import.meta.url
// is the file it points to, and a plain comparison would silently skip the scan
// (exit 0 with no output) so a leaking build would pass.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
