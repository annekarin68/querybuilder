import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findOffOrigin, findOffOriginInDir } from "../scripts/check-offline.mjs";

/**
 * The offline guard is what the "no internet" promise rests on
 * (docs/ARCHITECTURE.md, "Offline-first"), so it needs a test that proves it
 * really fails on a bad URL and stays quiet on the allowed ones.
 */
describe("findOffOrigin", () => {
  it("finds http and https URLs", () => {
    expect(findOffOrigin('<a href="http://a.example/x">')).toEqual(["http://a.example/x"]);
    expect(findOffOrigin("fetch('https://b.example/y')")).toEqual(["https://b.example/y"]);
  });

  it("finds WebSocket URLs", () => {
    expect(findOffOrigin('new WebSocket("ws://c.example/s")')).toEqual(["ws://c.example/s"]);
    expect(findOffOrigin('new WebSocket("wss://c.example/s")')).toEqual(["wss://c.example/s"]);
  });

  it("finds protocol-relative URLs where a URL is expected", () => {
    expect(findOffOrigin('<link href="//cdn.example/a.css">')).toEqual(["//cdn.example/a.css"]);
    expect(findOffOrigin("<script src=//cdn.example/a.js>")).toEqual(["//cdn.example/a.js"]);
    expect(findOffOrigin('@import "//cdn.example/a.css";')).toEqual(["//cdn.example/a.css"]);
    expect(findOffOrigin("a{background:url(//cdn.example/a.png)}")).toEqual([
      "//cdn.example/a.png",
    ]);
    expect(findOffOrigin("a{background:url( '//cdn.example/a.png' )}")).toEqual([
      "//cdn.example/a.png",
    ]);
  });

  it("reports every URL, in the order it appears", () => {
    expect(findOffOrigin('url(//b.example/1) "https://a.example/2"')).toEqual([
      "//b.example/1",
      "https://a.example/2",
    ]);
  });

  it("accepts same-origin references and plain comments", () => {
    const clean = [
      'fetch("/api/v1/query")',
      '<link href="/assets/a.css">',
      "a{background:url(/assets/a.png)}",
      "a{background:url(data:image/png;base64,AAAA)}",
      "// a JavaScript comment",
      "const half = 1 //2",
      'a.href === "//"',
    ].join("\n");
    expect(findOffOrigin(clean)).toEqual([]);
  });

  it("allows only the exact SVG namespace literal", () => {
    expect(findOffOrigin("<svg xmlns='http://www.w3.org/2000/svg'>")).toEqual([]);
    expect(findOffOrigin('<a href="http://www.w3.org/1999/xlink">')).toEqual([
      "http://www.w3.org/1999/xlink",
    ]);
  });
});

describe("findOffOriginInDir", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function makeDist(files: Record<string, string>): string {
    const dist = mkdtempSync(path.join(tmpdir(), "offline-check-"));
    dirs.push(dist);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dist, name)), { recursive: true });
      writeFileSync(path.join(dist, name), content);
    }
    return dist;
  }

  it("scans text files in sub-folders", () => {
    const dist = makeDist({ "assets/app.css": "@import '//cdn.example/a.css';" });
    expect(findOffOriginInDir(dist)).toEqual([
      { file: path.join(dist, "assets/app.css"), url: "//cdn.example/a.css" },
    ]);
  });

  it("skips binary assets", () => {
    const dist = makeDist({ "assets/font.woff2": "https://cdn.example/font" });
    expect(findOffOriginInDir(dist)).toEqual([]);
  });

  it("exempts the licence notice at the top of dist/ and nothing else", () => {
    const dist = makeDist({
      "THIRD-PARTY-NOTICES.txt": "see https://opensource.org/license/mit",
      "assets/THIRD-PARTY-NOTICES.txt": "see https://opensource.org/license/mit",
    });
    expect(findOffOriginInDir(dist).map((p) => p.file)).toEqual([
      path.join(dist, "assets/THIRD-PARTY-NOTICES.txt"),
    ]);
  });
});
