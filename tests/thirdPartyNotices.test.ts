import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The SIL Open Font License requires its full text to travel with every copy
// of the fonts, and THIRD-PARTY-NOTICES.txt is the only licence file that
// ships in dist/ (vite.config.ts emits it). So the notices file carries the
// font licences verbatim, and this test fails if a Fomantic upgrade changes
// them without the copies being updated.
const root = path.join(__dirname, "..");
const fonts = "node_modules/fomantic-ui-css/themes/default/assets/fonts";
/** A text file's content with Windows line endings and outer blank lines removed. */
const read = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\n+|\n+$/g, "");

describe("THIRD-PARTY-NOTICES.txt", () => {
  const notices = read("THIRD-PARTY-NOTICES.txt");

  it.each(["LICENSE_Lato.txt", "LICENSE_icons.txt"])(
    "contains Fomantic's %s word for word",
    (file) => {
      expect(notices).toContain(read(`${fonts}/${file}`));
    },
  );
});
