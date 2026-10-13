import { describe, it, expect } from "vitest";
import { userMessage } from "../../src/api/errorText";
import { ApiError, NetworkError, TimeoutError } from "../../src/api/client";
import { ContractError } from "../../src/api/contract";

const api = (status: number) => new ApiError(status, `GET /x failed: ${status} STATUS: secret`);

describe("userMessage", () => {
  it("never shows the server's text, a status code or a URL", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      const text = userMessage(api(status));
      expect(text).not.toContain("secret");
      expect(text).not.toContain(String(status));
      expect(text).not.toContain("/x");
    }
  });

  it("says the server can't be reached when there was no answer", () => {
    expect(userMessage(new NetworkError("GET /x", new TypeError("Failed to fetch")))).toBe(
      "The server can't be reached. Check your network connection, then try again.",
    );
  });

  it("says the server was too slow on a timeout", () => {
    expect(userMessage(new TimeoutError())).toBe(
      "The server took too long to answer. Try again in a moment.",
    );
  });

  it("says the answer could not be understood on a contract error", () => {
    expect(userMessage(new ContractError("GET /x", '"label" is missing.'))).toBe(
      "The server sent an answer this app doesn't understand. Reload the page; if that doesn't help, contact support.",
    );
  });

  it.each([
    [401, "Your login has expired. Log in again, then try again."],
    [403, "You don't have permission to do this. If you think you should, contact support."],
    [404, "The server couldn't find what was asked for. Reload the page and try again."],
    [429, "The server is busy or unavailable right now. Try again in a moment."],
    [502, "The server is busy or unavailable right now. Try again in a moment."],
    [503, "The server is busy or unavailable right now. Try again in a moment."],
    [
      500,
      "The server ran into a problem. Try again in a moment; if it keeps happening, contact support.",
    ],
    [
      400,
      "The server didn't accept this request. Reload the page and try again; if it keeps happening, contact support.",
    ],
  ])("explains HTTP %i in plain words", (status, text) => {
    expect(userMessage(api(status))).toBe(text);
  });

  it("has a fallback for anything else", () => {
    expect(userMessage(new Error("boom"))).toBe(
      "Something went wrong. Try again; if it keeps happening, reload the page.",
    );
    expect(userMessage("not even an error")).toContain("Something went wrong");
  });
});
