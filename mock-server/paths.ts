/**
 * The part of `pathname` below the API prefix `apiBase`
 * ("/api/v1/filter/saved" → "/filter/saved"; the prefix itself → ""), or
 * null when the path is not under it. The match ends at a "/": "/api/v10/x"
 * starts with the same letters as "/api/v1" but is not below it.
 */
export function pathBelow(pathname: string, apiBase: string): string | null {
  if (pathname === apiBase) return "";
  return pathname.startsWith(`${apiBase}/`) ? pathname.slice(apiBase.length) : null;
}
