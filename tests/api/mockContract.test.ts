import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as client from "../../src/api/client";
import type { DatabaseResult } from "../../src/model";
import type { Group } from "../../src/query/types";
import { createMockServer } from "../../mock-server/server";
import {
  exchangeCodeForSession,
  exchangeComplianceToken,
  issueFakeCode,
  issueFakeComplianceToken,
  startCompliance,
  startLogin,
} from "../../mock-server/auth";

// The real client (src/api/client.ts) against the mock server, over real HTTP:
// every mock response must pass the client's contract checks
// (src/api/contract.ts) with no error and no warning. If this fails, the mock
// and src/api/response.ts disagree about the contract in src/api/types.ts.

let server: Server;
let origin: string;
let cookie = "";

beforeAll(async () => {
  server = createMockServer({
    apiBase: import.meta.env.VITE_API_BASE,
    failRate: 0,
    lineDelayMs: () => 0,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  // The client fetches paths like "/api/v1/databases", as a page would. Send
  // them to the mock, with the session cookie a browser would add.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) =>
    realFetch(origin + path, { ...init, headers: { ...init.headers, cookie } }),
  );
  vi.spyOn(console, "warn");
});

afterEach(() => {
  expect(console.warn).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cookie = "";
});

/** Log in and give a compliance reason, the way the two flows do. */
function logInWithCompliance(): void {
  const login = exchangeCodeForSession(issueFakeCode(), startLogin());
  if (!login.ok) throw new Error(login.error);
  cookie = `qb_session=${login.sessionId}`;
  const ack = exchangeComplianceToken(
    issueFakeComplianceToken("testing"),
    startCompliance(),
    cookie,
  );
  if (!ack.ok) throw new Error(ack.error);
}

/** A query every event matches: the first field of the first facet is not empty. */
async function everyEventQuery(): Promise<Group> {
  const [facet] = await client.getFacets();
  return {
    kind: "group",
    id: "g1",
    operator: "AND",
    children: [
      {
        kind: "condition",
        id: "c1",
        facetId: facet!.id,
        fieldId: facet!.fields[0]!.id,
        operatorId: "isNotEmpty",
        value: null,
      },
    ],
  };
}

describe("the client reads every mock response", () => {
  it("databases and facets", async () => {
    expect((await client.getDatabases()).length).toBeGreaterThan(0);
    const facets = await client.getFacets();
    expect(facets.length).toBeGreaterThan(0);
    expect(facets.every((f) => f.fields.length > 0)).toBe(true);
  });

  it("login state and compliance, anonymous and logged in", async () => {
    expect(await client.getMe()).toBeNull();
    expect(await client.getComplianceStatus()).toEqual({ status: "required" });
    logInWithCompliance();
    expect(await client.getMe()).toEqual({ name: expect.any(String) });
    expect(await client.getComplianceStatus()).toMatchObject({ status: "acknowledged" });
  });

  it("statistics, one result per database", async () => {
    const ids = (await client.getDatabases()).map((d) => d.id);
    const results: DatabaseResult[] = [];
    await client.getStats(await everyEventQuery(), ids, (r) => results.push(r));
    expect(results.map((r) => r.databaseId)).toEqual(ids);
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  it("matching events", async () => {
    logInWithCompliance();
    const ids = (await client.getDatabases()).map((d) => d.id);
    const events = await client.runQuery(await everyEventQuery(), ids);
    expect(events.length).toBeGreaterThan(0);
  });

  it("logout and invalidating compliance", async () => {
    logInWithCompliance();
    await client.invalidateCompliance();
    expect(await client.getComplianceStatus()).toEqual({ status: "required" });
    await client.logout();
    expect(await client.getMe()).toBeNull();
  });
});
