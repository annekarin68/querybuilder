import type { Facet } from "../api/types";

/** Section key for facets with no (non-blank) tags. Never a real tag, since
 *  blank tags are dropped by `tagsOf`. */
export const UNTAGGED = "";

/** A facet's tags as data-dictionary section keys: trimmed, blanks and
 *  duplicates dropped, or `[UNTAGGED]` when nothing is left. */
export function tagsOf(facet: Facet): string[] {
  const tags = [...new Set(facet.tags.map((t) => t.trim()).filter(Boolean))];
  return tags.length ? tags : [UNTAGGED];
}

/**
 * The data dictionary's sections: one per tag, holding every facet carrying it
 * (so a facet with several tags appears in several sections). Tags sort
 * alphabetically; untagged facets come last in their own section. Sections are
 * keyed by our own `tags`, not the third-party `group`, which may be blank.
 */
export function groupByTag(facets: Facet[]): Map<string, Facet[]> {
  const sections = new Map<string, Facet[]>();
  for (const facet of facets) {
    for (const tag of tagsOf(facet)) {
      const list = sections.get(tag) ?? [];
      list.push(facet);
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
  /** `Facet.label` of every matching facet. */
  facets: Set<string>;
  /** Section key (a tag, or `UNTAGGED`) → how many of its facets match
   *  (sections with none are absent). */
  groups: Map<string, number>;
}

/**
 * Which data-dictionary entries match the filter text: a case-insensitive
 * substring of the facet's name, or of any of its fields' label or name.
 * Returns null for a blank filter (nothing is being filtered).
 */
export function matchDocs(all: Facet[], text: string): DocsMatch | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  const has = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);
  const facets = new Set<string>();
  const groups = new Map<string, number>();
  for (const facet of all) {
    const hit = has(facet.name) || facet.fields.some((f) => has(f.label) || has(f.name));
    if (!hit) continue;
    facets.add(facet.label);
    for (const tag of tagsOf(facet)) groups.set(tag, (groups.get(tag) ?? 0) + 1);
  }
  return { facets, groups };
}
