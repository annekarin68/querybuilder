// Words about a block's facet that more than one panel says (the block's
// head, its About panel and its Seen together chart), kept in one place so
// the panels never word the same thing differently.

/** Said where a block's facet is missing from the data dictionary. */
export const UNKNOWN_FACET = "This facet is not in the data dictionary.";

/** The facet's name from `facets` (the dictionary, or the field catalog's
 *  facets), or its id when they do not know it or are still loading (null). */
export function facetNameOrId(
  facets: readonly { id: string; name: string }[] | null,
  facetId: string,
): string {
  return facets?.find((f) => f.id === facetId)?.name ?? facetId;
}
