// Prints one section of docs/ARCHITECTURE.md: the heading whose title
// contains the given text, down to the next heading of the same or a higher
// level. The whole document is over 200 KB; reading only the section you
// need keeps a session (and every subagent) cheap. Usage:
//
//   npm run doc -- "Centre"            (one section)
//   npm run doc -- --list              (every heading, with its line number)
import { readFileSync } from "node:fs";

const query = process.argv.slice(2).join(" ");
// Joined from parts so that tests/docReferences.test.ts, which checks every
// quoted title after this file name, does not read the next argument as one.
const DOC = ["docs", "ARCHITECTURE.md"].join("/");
const lines = readFileSync(DOC, "utf8").split("\n");

// The heading level of each line (1 for "# x"), 0 for other lines. A "# "
// inside a fenced code block is a shell comment, not a heading.
let inFence = false;
const levels = lines.map((line) => {
  if (line.startsWith("```")) inFence = !inFence;
  const match = inFence ? null : /^(#{1,6}) /.exec(line);
  return match ? match[1].length : 0;
});

if (!query) {
  console.error('Usage: npm run doc -- "<part of a heading>" | --list');
  process.exit(2);
} else if (query === "--list") {
  lines.forEach((line, index) => {
    if (levels[index]) console.log(`${index + 1}: ${line}`);
  });
} else {
  const start = lines.findIndex((line, index) => levels[index] && line.includes(query));
  if (start < 0) {
    console.error(`No heading contains "${query}". Try: npm run doc -- --list`);
    process.exit(1);
  }
  const level = levels[start];
  let end = start + 1;
  while (end < lines.length && !(levels[end] && levels[end] <= level)) end++;
  console.log(`(${DOC} lines ${start + 1}–${end})`);
  console.log(lines.slice(start, end).join("\n"));
}
