import { describe, it, expect } from "vitest";
import {
  startLogin,
  issueFakeCode,
  exchangeCodeForSession,
  sessionFor,
  endSession,
  parseCookie,
  sessionCookieHeader,
  clearSessionCookieHeader,
} from "../../mock-server/auth";

describe("parseCookie", () => {
  it("finds a named cookie's value among several", () => {
    expect(parseCookie("a=1; qb_session=abc123; b=2", "qb_session")).toBe("abc123");
  });
  it("returns undefined when the cookie isn't present", () => {
    expect(parseCookie("a=1; b=2", "qb_session")).toBeUndefined();
  });
  it("returns undefined for an undefined header", () => {
    expect(parseCookie(undefined, "qb_session")).toBeUndefined();
  });
});

describe("login/callback round trip", () => {
  it("a valid state+code pair exchanges for a session with a demo user", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    expect(outcome).toEqual({ ok: true, sessionId: expect.any(String) });
  });

  it("the resulting session is findable via its cookie header", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    const cookieHeader = sessionCookieHeader(outcome.sessionId);
    const sessionId = parseCookie(cookieHeader, "qb_session");
    expect(sessionFor(`qb_session=${sessionId}`)).toEqual({ user: { name: "demo.user" } });
  });

  it("a state can only be consumed once", () => {
    const state = startLogin();
    const code1 = issueFakeCode();
    const code2 = issueFakeCode();
    expect(exchangeCodeForSession(code1, state).ok).toBe(true);
    expect(exchangeCodeForSession(code2, state)).toEqual({
      ok: false,
      error: "Invalid or expired login attempt.",
    });
  });

  it("a code can only be consumed once", () => {
    const state1 = startLogin();
    const state2 = startLogin();
    const code = issueFakeCode();
    expect(exchangeCodeForSession(code, state1).ok).toBe(true);
    expect(exchangeCodeForSession(code, state2)).toEqual({
      ok: false,
      error: "Invalid or expired authorization code.",
    });
  });

  it("an unknown state is rejected", () => {
    const code = issueFakeCode();
    expect(exchangeCodeForSession(code, "not-a-real-state")).toEqual({
      ok: false,
      error: "Invalid or expired login attempt.",
    });
  });

  it("an unknown code is rejected", () => {
    const state = startLogin();
    expect(exchangeCodeForSession("not-a-real-code", state)).toEqual({
      ok: false,
      error: "Invalid or expired authorization code.",
    });
  });
});

describe("sessionFor / endSession", () => {
  function newSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    return outcome.sessionId;
  }

  it("returns null for a missing cookie", () => {
    expect(sessionFor(undefined)).toBeNull();
  });

  it("returns null for a cookie that doesn't match any session", () => {
    expect(sessionFor("qb_session=not-a-real-session")).toBeNull();
  });

  it("finds the session for a valid cookie", () => {
    const sessionId = newSession();
    expect(sessionFor(`qb_session=${sessionId}`)).toEqual({ user: { name: "demo.user" } });
  });

  it("endSession removes the session so it's no longer found", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    expect(sessionFor(cookie)).not.toBeNull();
    endSession(cookie);
    expect(sessionFor(cookie)).toBeNull();
  });
});

describe("cookie headers", () => {
  it("sessionCookieHeader includes HttpOnly, SameSite=Lax, and the session id", () => {
    const header = sessionCookieHeader("abc123");
    expect(header).toContain("qb_session=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("clearSessionCookieHeader expires the cookie immediately", () => {
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });
});
