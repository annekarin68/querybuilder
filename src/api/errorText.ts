import { ApiError, NetworkError, TimeoutError } from "./client";
import { ContractError } from "./contract";

/**
 * What a panel tells the user when a request failed (docs/ARCHITECTURE.md,
 * "Error and loading model"). Plain words for the kind of failure, and what
 * the user can do about it. Never the server's own text, a status code or a
 * URL: they mean nothing to a user and can show internals (a stack trace, a
 * table name). Those are in the error's message, which app.ts logs to the
 * console with `console.error`.
 *
 * The panel around this text already says WHAT failed ("Couldn't get
 * statistics"), so this only says why.
 */
export function userMessage(err: unknown): string {
  if (err instanceof NetworkError) {
    return "The server can't be reached. Check your network connection, then try again.";
  }
  if (err instanceof TimeoutError) {
    return "The server took too long to answer. Try again in a moment.";
  }
  if (err instanceof ContractError) {
    return "The server sent an answer this app doesn't understand. Reload the page; if that doesn't help, contact support.";
  }
  if (err instanceof ApiError) return statusMessage(err.status);
  return "Something went wrong. Try again; if it keeps happening, reload the page.";
}

/** Busy or unreachable for a moment: trying again later can work. */
const TRY_LATER = new Set([408, 429, 502, 503, 504]);

function statusMessage(status: number): string {
  if (status === 401) return "Your login has expired. Log in again, then try again.";
  if (status === 403) {
    return "You don't have permission to do this. If you think you should, contact support.";
  }
  if (status === 404) {
    return "The server couldn't find what was asked for. Reload the page and try again.";
  }
  if (TRY_LATER.has(status)) {
    return "The server is busy or unavailable right now. Try again in a moment.";
  }
  if (status >= 500) {
    return "The server ran into a problem. Try again in a moment; if it keeps happening, contact support.";
  }
  return "The server didn't accept this request. Reload the page and try again; if it keeps happening, contact support.";
}
