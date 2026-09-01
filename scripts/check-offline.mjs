// Fails if the built dist/ references any off-origin http(s) URL.
// See docs/ARCHITECTURE.md §2 (Offline-first).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const URL_RE = /https?:\/\/[^\s"'`)]+/gi;
// Allowed: nothing off-origin. (Our API is same-origin, referenced as "/api/...".)
// Sole exception: the exact literal "http://www.w3.org/2000/svg" — the SVG XML
// namespace declared inside inline `data:image/svg+xml` URIs in Fomantic's CSS
// (e.g. `xmlns='http://www.w3.org/2000/svg'`). It is a namespace identifier, not
// a URL the browser ever dereferences, so it is not a network fetch. Compared by
// exact string equality below, so nothing else on w3.org is permitted.
const ALLOW = ["http://www.w3.org/2000/svg"];

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
    if (ALLOW.includes(url)) continue;
    console.error(`OFF-ORIGIN URL in ${file}\n  ${url}`);
    bad++;
  }
}
if (bad) {
  console.error(
    `\ncheck:offline FAILED — ${bad} off-origin URL(s). The app must run on the LAN with no internet.`,
  );
  process.exit(1);
}
console.log("check:offline OK — no off-origin URLs in dist/.");
