import { describe, it, expect } from "vitest";
import { httpErrorFor, parseHttpErrors } from "../../mock-server/httpErrors";

describe("parseHttpErrors", () => {
  it("is empty when the variable is unset or blank", () => {
    expect(parseHttpErrors(undefined)).toEqual([]);
    expect(parseHttpErrors("  ")).toEqual([]);
  });

  it("reads rules separated by commas", () => {
    expect(parseHttpErrors("POST /saved-queries=500, GET /databases=502:html")).toEqual([
      { method: "POST", path: "/saved-queries", status: 500, html: false },
      { method: "GET", path: "/databases", status: 502, html: true },
    ]);
  });

  it("accepts * for any method or any path", () => {
    expect(parseHttpErrors("* *=503")).toEqual([
      { method: "*", path: "*", status: 503, html: false },
    ]);
  });

  it.each(["POST /x", "POST /x=200", "post /x=500", "POST x=500", "POST /x=600"])(
    "refuses %s, naming the variable",
    (rule) => {
      expect(() => parseHttpErrors(rule)).toThrow("MOCK_HTTP_ERRORS");
    },
  );
});

describe("httpErrorFor", () => {
  const rules = parseHttpErrors(
    "POST /saved-queries=500, DELETE /saved-queries/*=404, * /stats=503",
  );

  it("matches the method and the path exactly", () => {
    expect(httpErrorFor(rules, "POST", "/saved-queries")?.status).toBe(500);
    expect(httpErrorFor(rules, "GET", "/saved-queries")).toBeUndefined();
  });

  it("a path ending in /* matches everything below it, not itself", () => {
    expect(httpErrorFor(rules, "DELETE", "/saved-queries/abc")?.status).toBe(404);
    expect(httpErrorFor(rules, "DELETE", "/saved-queries")).toBeUndefined();
  });

  it("* matches any method", () => {
    expect(httpErrorFor(rules, "POST", "/stats")?.status).toBe(503);
  });

  it("the first matching rule wins", () => {
    const two = parseHttpErrors("GET /databases=500, * *=503");
    expect(httpErrorFor(two, "GET", "/databases")?.status).toBe(500);
  });
});
