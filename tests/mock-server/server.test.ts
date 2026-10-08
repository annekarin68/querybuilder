import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMockServer, QUERY_RESULT_CAP } from "../../mock-server/server";
import {
  exchangeCodeForSession,
  exchangeComplianceToken,
  issueFakeCode,
  issueFakeComplianceToken,
  startCompliance,
  startLogin,
} from "../../mock-server/auth";
import { auditLogSnapshot } from "../../mock-server/audit";
import { MAX_TEXT_LENGTH } from "../../mock-server/evaluate";
import { unfinishedRequest } from "../savedQueryFixtures";

// The mock server over real HTTP, on a free port. Deterministic: no simulated
// failures and no streaming delay.

let server: Server;
let base: string;

/** A prefix no deployment uses, so a hard-coded "/api" in the mock can't pass. */
const API = "/test-api/v9";

beforeAll(async () => {
  server = createMockServer({ apiBase: API, failRate: 0, lineDelayMs: () => 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const get = (path: string, cookie?: string) =>
  fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });

const post = (path: string, body: string, cookie?: string) =>
  fetch(base + path, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });

/** A logged-in session's cookie, made through auth.ts like the login flow does. */
function loggedIn(): string {
  const outcome = exchangeCodeForSession(issueFakeCode(), startLogin());
  if (!outcome.ok) throw new Error(outcome.error);
  return `qb_session=${outcome.sessionId}`;
}

/** A logged-in session that has also given a compliance reason. */
function compliant(): string {
  const cookie = loggedIn();
  const outcome = exchangeComplianceToken(
    issueFakeComplianceToken("testing"),
    startCompliance(),
    cookie,
  );
  if (!outcome.ok) throw new Error(outcome.error);
  return cookie;
}

/** Every event has an observation window, so this query matches them all. */
const everyEvent = {
  kind: "group",
  id: "g1",
  operator: "AND",
  children: [
    {
      kind: "condition",
      id: "c1",
      facetId: "observation_window",
      fieldId: "from_timestamp",
      operatorId: "present",
      value: null,
    },
  ],
};
const body = (databases: string[], query: unknown = everyEvent) =>
  JSON.stringify({ query, databases });

describe("GET /api/databases and /api/individuals", () => {
  it.each([`${API}/databases`, `${API}/individuals`])(
    "%s returns a bare JSON array",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      const data: unknown = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect((data as unknown[]).length).toBeGreaterThan(0);
    },
  );
});

describe("POST /api/stats", () => {
  it("streams one successful line per selected database, in order", async () => {
    const res = await post(`${API}/stats`, body(["beta", "alpha"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.label)).toEqual(["beta", "alpha"]);
    for (const l of lines) {
      expect(l.success).toBe(true);
      expect(typeof l.matchCount).toBe("number");
    }
  });

  it("fails every database, pointing at the condition and its group, when a text is too long", async () => {
    const tooLong = {
      ...everyEvent,
      children: [
        { ...everyEvent.children[0], operatorId: "eq", value: "x".repeat(MAX_TEXT_LENGTH + 1) },
      ],
    };
    const res = await post(`${API}/stats`, body(["alpha", "beta"], tooLong));
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual(
      ["alpha", "beta"].map((label) => ({
        label,
        success: false,
        errorMessages: [
          { nodeId: "c1", kind: "invalid", message: "Text is too long (at most 100 characters)." },
          { nodeId: "g1", kind: "incomplete", message: "Group contains no valid conditions." },
        ],
        infoMessages: [],
      })),
    );
  });

  it.each([
    ["body that isn't JSON", "{", "Request body must be valid JSON."],
    ["JSON body that isn't an object", "null", "Body must include a `query` tree."],
    [
      "missing query",
      JSON.stringify({ databases: ["alpha"] }),
      "Body must include a `query` tree.",
    ],
    ["query that is an array", body(["alpha"], []), "Body must include a `query` tree."],
    [
      "query whose root is a condition",
      body(["alpha"], everyEvent.children[0]),
      "Malformed query: query must be a group.",
    ],
    [
      "query that is an empty group",
      body(["alpha"], { ...everyEvent, children: [] }),
      "Malformed query: query.children must be a non-empty list.",
    ],
    [
      "condition without a field",
      body(["alpha"], { ...everyEvent, children: [{ ...everyEvent.children[0], fieldId: "" }] }),
      "Malformed query: query.children[0].fieldId must be a non-empty string or null.",
    ],
    ["no databases", body([]), "Select at least one database."],
  ])("answers 400 for a %s", async (_label, payload, error) => {
    const res = await post(`${API}/stats`, payload);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});

describe("POST /api/query", () => {
  it("needs a session (401)", async () => {
    const res = await post(`${API}/query`, body(["alpha"]));
    expect(res.status).toBe(401);
  });

  it("needs a compliance reason (403)", async () => {
    const res = await post(`${API}/query`, body(["alpha"]), loggedIn());
    expect(res.status).toBe(403);
  });

  it("returns the matching events, capped, and writes an audit entry", async () => {
    const before = auditLogSnapshot().length;
    const all = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
    const res = await post(`${API}/query`, body(all), compliant());
    expect(res.status).toBe(200);
    const { entrysets } = (await res.json()) as { entrysets: { id: number }[] };
    expect(entrysets.length).toBeGreaterThan(0);
    expect(entrysets.length).toBeLessThanOrEqual(QUERY_RESULT_CAP);
    expect(auditLogSnapshot()).toHaveLength(before + 1);
    expect(auditLogSnapshot().at(-1)).toMatchObject({ name: "demo.user", reason: "testing" });
  });

  it("checks the body after the session", async () => {
    const res = await post(`${API}/query`, "{", compliant());
    expect(res.status).toBe(400);
  });
});

describe("login and compliance navigations", () => {
  it("GET /api/auth/login redirects to the mock IdP and binds the state to this browser", async () => {
    const res = await get(`${API}/auth/login`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(`${API}/mock-idp/authorize?state=`);
    expect(res.headers.get("set-cookie")).toContain("qb_login_state=");
  });

  it("a callback whose state doesn't match the browser's cookie is an HTML error page", async () => {
    const res = await get(`${API}/auth/callback?code=x&state=y`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("set-cookie")).toMatch(/qb_login_state=;.*Max-Age=0/);
    expect(await res.text()).toContain("Back to the Query Builder");
  });

  it("starting compliance without a session goes to log in instead", async () => {
    const res = await get(`${API}/compliance/start`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${API}/auth/login`);
  });

  it("the mock compliance form rejects a blank reason", async () => {
    const res = await fetch(base + `${API}/mock-compliance/submit`, {
      method: "POST",
      body: new URLSearchParams({ state: "s", reason: "   " }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Please enter a reason.");
  });
});

describe("GET /api/auth/me and /api/compliance/status", () => {
  it("me is 401 without a session and the user with one", async () => {
    expect((await get(`${API}/auth/me`)).status).toBe(401);
    const res = await get(`${API}/auth/me`, loggedIn());
    expect(await res.json()).toEqual({ name: "demo.user" });
  });

  it("compliance status follows the session", async () => {
    expect(await (await get(`${API}/compliance/status`)).json()).toEqual({ status: "required" });
    expect(await (await get(`${API}/compliance/status`, compliant())).json()).toMatchObject({
      status: "acknowledged",
      reason: "testing",
    });
  });
});

describe("saved queries (…/saved-queries)", () => {
  const url = `${API}/saved-queries`;
  const send = (method: string, path: string, cookie?: string, body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    });
  const named = (name: string) => ({ ...unfinishedRequest, name });

  it.each([
    ["GET", url],
    ["POST", url],
    ["PUT", `${url}/sq-1`],
    ["DELETE", `${url}/sq-1`],
  ])("%s %s without a session is a 401", async (method, path) => {
    const res = await send(method, path, undefined, unfinishedRequest);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Log in to use saved queries." });
  });

  it("creates, lists, updates and deletes, answering as the contract says", async () => {
    const cookie = loggedIn();
    expect(await (await send("GET", url, cookie)).json()).toEqual([]);

    const created = await send("POST", url, cookie, named("First"));
    expect(created.status).toBe(201);
    const first = await created.json();
    expect(first).toMatchObject({ ...named("First"), id: expect.any(String) });
    expect(new Date(first.updatedAt).toISOString()).toBe(first.updatedAt);

    const listed = await (await send("GET", url, cookie)).json();
    expect(listed).toEqual([first]);

    const renamed = await send("PUT", `${url}/${first.id}`, cookie, named("Second"));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: first.id, name: "Second" });

    const deleted = await send("DELETE", `${url}/${first.id}`, cookie);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(await (await send("GET", url, cookie)).json()).toEqual([]);
  });

  it("answers 404 for an unknown id and 409 for a taken name", async () => {
    const cookie = loggedIn();
    expect((await send("PUT", `${url}/nope`, cookie, named("X"))).status).toBe(404);
    expect((await send("DELETE", `${url}/nope`, cookie)).status).toBe(404);
    await send("POST", url, cookie, named("Taken"));
    const clash = await send("POST", url, cookie, named(" taken "));
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: 'A saved query called "taken" already exists.' });
  });

  it("finds an id that needs decoding", async () => {
    const cookie = loggedIn();
    const res = await send("DELETE", `${url}/a%2Fb`, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No saved query with that id." });
  });

  it("answers 400 for a malformed body, naming the problem", async () => {
    const cookie = loggedIn();
    const res = await send("POST", url, cookie, { ...unfinishedRequest, name: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name must be 1 to 80 characters." });
    const notJson = await fetch(base + url, { method: "POST", body: "{", headers: { cookie } });
    expect(notJson.status).toBe(400);
  });

  it("does not answer other methods on an id path", async () => {
    const res = await send("GET", `${url}/sq-1`, loggedIn());
    expect(res.status).toBe(404);
  });
});

it("an unknown route is a 404 with a JSON error", async () => {
  const res = await get("/api/nope");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "No route for GET /api/nope" });
});

describe("the API prefix (MockConfig.apiBase)", () => {
  it("serves the API only under the prefix", async () => {
    expect((await get(`${API}/databases`)).status).toBe(200);
    expect((await get("/api/databases")).status).toBe(404);
  });

  it("the mock IdP sends the browser back to the login callback under the prefix", async () => {
    const res = await get(`${API}/mock-idp/authorize/confirm?state=s`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(`${API}/auth/callback?code=`);
  });

  it("the mock compliance form sends the browser back to the callback under the prefix", async () => {
    const res = await fetch(base + `${API}/mock-compliance/submit`, {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({ state: "s", reason: "testing" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(`${API}/compliance/callback?token=`);
  });
  // So that the dev server's single proxy rule (the prefix) reaches every
  // page the browser is sent to during login and compliance.
  it("the stand-in pages link and post only under the prefix", async () => {
    const idp = await (await get(`${API}/mock-idp/authorize?state=s`)).text();
    expect(idp).toContain(`href="${API}/mock-idp/authorize/confirm?state=s"`);
    const form = await (await get(`${API}/mock-compliance/submit?state=s`)).text();
    expect(form).toContain(`action="${API}/mock-compliance/submit"`);
  });
});
