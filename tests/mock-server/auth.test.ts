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
  loginStateCookieHeader,
  clearLoginStateCookieHeader,
  loginStateFromCookie,
  startCompliance,
  issueFakeComplianceToken,
  exchangeComplianceToken,
  complianceStatusFor,
  clearCompliance,
  complianceStateCookieHeader,
  clearComplianceStateCookieHeader,
  complianceStateFromCookie,
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

describe("login-state binding cookie", () => {
  it("loginStateCookieHeader includes the state, HttpOnly, and SameSite=Lax", () => {
    const header = loginStateCookieHeader("abc123");
    expect(header).toContain("qb_login_state=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("loginStateFromCookie reads it back via parseCookie", () => {
    const header = loginStateCookieHeader("xyz789");
    const cookiePair = header.split(";")[0]!; // "qb_login_state=xyz789"
    expect(loginStateFromCookie(cookiePair)).toBe("xyz789");
  });

  it("clearLoginStateCookieHeader expires it immediately", () => {
    expect(clearLoginStateCookieHeader()).toContain("Max-Age=0");
  });
});

describe("compliance state/token round trip", () => {
  function newSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    return outcome.sessionId;
  }

  it("a valid state+token pair attaches the reason to the session", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state = startCompliance();
    const token = issueFakeComplianceToken("investigating incident #123");
    const outcome = exchangeComplianceToken(token, state, cookie);
    expect(outcome).toEqual({ ok: true });
    expect(complianceStatusFor(cookie)).toMatchObject({
      status: "acknowledged",
      reason: "investigating incident #123",
    });
  });

  it("a state can only be consumed once", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state = startCompliance();
    const token1 = issueFakeComplianceToken("reason one");
    const token2 = issueFakeComplianceToken("reason two");
    expect(exchangeComplianceToken(token1, state, cookie).ok).toBe(true);
    expect(exchangeComplianceToken(token2, state, cookie)).toEqual({
      ok: false,
      error: "Invalid or expired compliance attempt.",
    });
  });

  it("a token can only be consumed once", () => {
    const sessionId = newSession();
    const cookie = `qb_session=${sessionId}`;
    const state1 = startCompliance();
    const state2 = startCompliance();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, state1, cookie).ok).toBe(true);
    expect(exchangeComplianceToken(token, state2, cookie)).toEqual({
      ok: false,
      error: "Invalid or expired compliance token.",
    });
  });

  it("an unknown state is rejected", () => {
    const sessionId = newSession();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, "not-a-real-state", `qb_session=${sessionId}`)).toEqual({
      ok: false,
      error: "Invalid or expired compliance attempt.",
    });
  });

  it("an unknown token is rejected", () => {
    const sessionId = newSession();
    const state = startCompliance();
    expect(exchangeComplianceToken("not-a-real-token", state, `qb_session=${sessionId}`)).toEqual({
      ok: false,
      error: "Invalid or expired compliance token.",
    });
  });

  it("fails when there is no session for the cookie", () => {
    const state = startCompliance();
    const token = issueFakeComplianceToken("reason");
    expect(exchangeComplianceToken(token, state, undefined)).toEqual({
      ok: false,
      error: "Not authenticated.",
    });
  });
});

describe("complianceStatusFor / clearCompliance", () => {
  function ackedSession(): string {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    const sessionId = outcome.sessionId;
    const cookie = `qb_session=${sessionId}`;
    const cState = startCompliance();
    const token = issueFakeComplianceToken("reason");
    exchangeComplianceToken(token, cState, cookie);
    return sessionId;
  }

  it("reports required for a session with no compliance record", () => {
    const state = startLogin();
    const code = issueFakeCode();
    const outcome = exchangeCodeForSession(code, state);
    if (!outcome.ok) throw new Error("expected success");
    expect(complianceStatusFor(`qb_session=${outcome.sessionId}`)).toEqual({ status: "required" });
  });

  it("reports required when there is no session at all", () => {
    expect(complianceStatusFor(undefined)).toEqual({ status: "required" });
  });

  it("reports acknowledged with the reason after a successful exchange", () => {
    const sessionId = ackedSession();
    expect(complianceStatusFor(`qb_session=${sessionId}`)).toMatchObject({
      status: "acknowledged",
      reason: "reason",
    });
  });

  it("clearCompliance removes just the compliance field, leaving the session logged in", () => {
    const sessionId = ackedSession();
    const cookie = `qb_session=${sessionId}`;
    clearCompliance(cookie);
    expect(complianceStatusFor(cookie)).toEqual({ status: "required" });
    expect(sessionFor(cookie)).not.toBeNull(); // still logged in
  });
});

describe("compliance-state binding cookie", () => {
  it("complianceStateCookieHeader includes the state, HttpOnly, and SameSite=Lax", () => {
    const header = complianceStateCookieHeader("abc123");
    expect(header).toContain("qb_compliance_state=abc123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("complianceStateFromCookie reads it back", () => {
    const header = complianceStateCookieHeader("xyz789");
    const cookiePair = header.split(";")[0]!;
    expect(complianceStateFromCookie(cookiePair)).toBe("xyz789");
  });

  it("clearComplianceStateCookieHeader expires it immediately", () => {
    expect(clearComplianceStateCookieHeader()).toContain("Max-Age=0");
  });
});

describe("login and compliance flows don't cross-validate", () => {
  it("a compliance token cannot be exchanged against a login state", () => {
    const loginState = startLogin();
    const complianceToken = issueFakeComplianceToken("some reason");
    expect(exchangeComplianceToken(complianceToken, loginState, undefined)).toEqual({
      ok: false,
      error: "Invalid or expired compliance attempt.",
    });
  });

  it("a login code cannot be exchanged against a compliance state", () => {
    const complianceState = startCompliance();
    const loginCode = issueFakeCode();
    expect(exchangeCodeForSession(loginCode, complianceState)).toEqual({
      ok: false,
      error: "Invalid or expired login attempt.",
    });
  });
});
