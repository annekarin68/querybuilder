import type { Individual } from "../api/types";

/** What the data-dictionary filter matched. */
export interface DocsMatch {
  /** `Individual.label` of every matching item. */
  items: Set<string>;
  /** `Individual.group` → how many of its items match (groups with none are absent). */
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
    groups.set(ind.group, (groups.get(ind.group) ?? 0) + 1);
  }
  return { items, groups };
}
