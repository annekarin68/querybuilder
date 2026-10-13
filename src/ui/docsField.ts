import type { Field } from "../model";
import type { TextSource } from "../config";
import { countLabel } from "./format";

/** What a field's row in the data dictionary shows closed, and what opening adds. */
export interface FieldPreview {
  /** The text shown in the closed row, and who wrote it; null when it has none. */
  text: { body: string; source: TextSource } | null;
  /** What opening the row adds, in words. Empty: the row has nothing more and
   *  does not open (it is a plain row showing its text in full). */
  more: string[];
}

/**
 * Users opened fields only to read the same text again (2026-10-13), so a row
 * opens only when opening shows something new: a second text or known values.
 * A field with one text and no values shows that text in full instead, and a
 * row that opens says what opening adds. No character count is involved: how
 * much fits depends on the dictionary's width, which the user can change.
 *
 * Our comment is shown when there is one (it is always correct); the third
 * party's description is then what opening adds.
 */
export function fieldPreview(
  field: Pick<Field, "comment" | "description">,
  valueCount: number,
): FieldPreview {
  const { comment, description } = field;
  const text = comment
    ? { body: comment, source: "ours" as const }
    : description
      ? { body: description, source: "thirdParty" as const }
      : null;
  const more: string[] = [];
  if (comment && description) more.push("third-party description");
  if (valueCount > 0) {
    more.push(countLabel(valueCount, "previously seen value", "previously seen values"));
  }
  return { text, more };
}
