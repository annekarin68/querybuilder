import type { Individual } from "../api/types";

/** Section key for items with no (non-blank) tags. Never a real tag, since
 *  blank tags are dropped by `tagsOf`. */
export const UNTAGGED = "";

/** An item's tags as data-dictionary section keys: trimmed, blanks and
 *  duplicates dropped, or `[UNTAGGED]` when nothing is left. */
export function tagsOf(ind: Individual): string[] {
  const tags = [...new Set(ind.tags.map((t) => t.trim()).filter(Boolean))];
  return tags.length ? tags : [UNTAGGED];
}

/**
 * The data dictionary's sections: one per tag, holding every item carrying it
 * (so an item with several tags appears in several sections). Tags sort
 * alphabetically; untagged items come last in their own section. Sections are
 * keyed by our own `tags`, not the third-party `group`, which may be blank.
 */
export function groupByTag(individuals: Individual[]): Map<string, Individual[]> {
  const sections = new Map<string, Individual[]>();
  for (const ind of individuals) {
    for (const tag of tagsOf(ind)) {
      const list = sections.get(tag) ?? [];
      list.push(ind);
      sections.set(tag, list);
    }
  }
  const keys = [...sections.keys()]
    .filter((k) => k !== UNTAGGED)
    .sort((a, b) => a.localeCompare(b));
  if (sections.has(UNTAGGED)) keys.push(UNTAGGED);
  return new Map(keys.map((k) => [k, sections.get(k)!]));
}

/** What the data-dictionary filter matched. */
export interface DocsMatch {
  /** `Individual.label` of every matching item. */
  items: Set<string>;
  /** Section key (a tag, or `UNTAGGED`) → how many of its items match
   *  (sections with none are absent). */
  groups: Map<string, number>;
}

/**
 * Which data-dictionary entries match the filter text: a case-insensitive
 * substring of the item's name, or of any of its fields' label or name.
 * Returns null for a blank filter (nothing is being filtered).
 */
export function matchDocs(individuals: Individual[], text: string): DocsMatch | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const has = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);
  const items = new Set<string>();
  const groups = new Map<string, number>();
  for (const ind of individuals) {
    const hit = has(ind.name) || ind.fields.some((f) => has(f.label) || has(f.name));
    if (!hit) continue;
    items.add(ind.label);
    for (const tag of tagsOf(ind)) groups.set(tag, (groups.get(tag) ?? 0) + 1);
  }
  return { items, groups };
}
