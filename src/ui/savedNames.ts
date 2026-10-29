import type { UnreadableSaved } from "../model";

/** What a saved query that can't be read is called in the list and in the
 *  messages about deleting it (issue #80). Its own file, without a DOM, so
 *  app.ts can use it too. */
export function unreadableName(u: UnreadableSaved): string {
  return u.name || "Unnamed saved query";
}
