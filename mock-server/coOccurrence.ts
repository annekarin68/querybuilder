import type { Entryset } from "./vehicleData";

/**
 * For every facet, how often each facet is seen together with it: the share of
 * its events that also hold the other facet, as text ("50"), like the real
 * backend's `co_occurrence`. A facet with itself is "100"; one that no event
 * holds gets "0" for every other facet.
 *
 * Counting the events of each facet once, then each pair once, keeps this fast
 * enough to run at startup.
 */
export function coOccurrenceOf(
  entrysets: Entryset[],
  facetLabels: string[],
): Record<string, Record<string, string>> {
  const known = new Set(facetLabels);
  const eventsWith = new Map<string, number>();
  const eventsWithBoth = new Map<string, number>();
  for (const event of entrysets) {
    const held = Object.keys(event.items).filter((label) => known.has(label));
    for (const a of held) {
      eventsWith.set(a, (eventsWith.get(a) ?? 0) + 1);
      for (const b of held) {
        const pair = `${a}\u0000${b}`;
        eventsWithBoth.set(pair, (eventsWithBoth.get(pair) ?? 0) + 1);
      }
    }
  }
  const out: Record<string, Record<string, string>> = {};
  for (const a of facetLabels) {
    const row: Record<string, string> = {};
    for (const b of facetLabels) {
      const total = eventsWith.get(a) ?? 0;
      const both = eventsWithBoth.get(`${a}\u0000${b}`) ?? 0;
      row[b] = a === b ? "100" : String(total === 0 ? 0 : (both / total) * 100);
    }
    out[a] = row;
  }
  return out;
}
