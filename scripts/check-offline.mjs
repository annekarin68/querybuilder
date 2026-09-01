// Fails if the built dist/ references any off-origin http(s) URL.
// See docs/ARCHITECTURE.md §2 (Offline-first).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const URL_RE = /https?:\/\/[^\s"'`)]+/gi;
// Allowed: nothing off-origin. (Our API is same-origin, referenced as "/api/...".)
// Exception: the SVG/XML namespace literal `http://www.w3.org/2000/svg` appears
// inside inline `data:image/svg+xml` URIs in Fomantic's CSS. It is an XML
// namespace identifier, never dereferenced by the browser — no network call.
const ALLOW = ["http://www.w3.org/"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|css|html|map)$/.test(name)) out.push(p);
  }
  return out;
}

let bad = 0;
let files;
try {
  files = walk(DIST);
} catch {
  console.error(`check:offline — "${DIST}/" not found. Run "npm run build" first.`);
  process.exit(2);
}
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (ALLOW.some((a) => url.startsWith(a))) continue;
    console.error(`OFF-ORIGIN URL in ${file}\n  ${url}`);
    bad++;
  }
}
if (bad) {
  console.error(`\ncheck:offline FAILED — ${bad} off-origin URL(s). The app must run on the LAN with no internet.`);
  process.exit(1);
}
console.log("check:offline OK — no off-origin URLs in dist/.");
