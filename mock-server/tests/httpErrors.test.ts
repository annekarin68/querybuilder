import { describe, it, expect } from "vitest";
import { httpErrorFor, parseHttpErrors } from "../httpErrors";

describe("parseHttpErrors", () => {
  it("is empty when the variable is unset or blank", () => {
    expect(parseHttpErrors(undefined)).toEqual([]);
    expect(parseHttpErrors("  ")).toEqual([]);
  });

  it("reads rules separated by commas", () => {
    expect(parseHttpErrors("POST /filter/saved=500, GET /databases=502:html")).toEqual([
      { method: "POST", path: "/filter/saved", status: 500, html: false },
      { method: "GET", path: "/databases", status: 502, html: true },
    ]);
  });

  it("accepts * for any method or any path", () => {
    expect(parseHttpErrors("* *=503")).toEqual([
      { method: "*", path: "*", status: 503, html: false },
    ]);
  });

  it("accepts the bounds 400 and 599", () => {
    expect(parseHttpErrors("GET /a=400, GET /b=599").map((r) => r.status)).toEqual([400, 599]);
  });

  // A stray comma is a harmless slip, not a rule that could silently do nothing.
  it("ignores a trailing comma and empty parts", () => {
    expect(parseHttpErrors("GET /a=500,")).toEqual([
      { method: "GET", path: "/a", status: 500, html: false },
    ]);
    expect(parseHttpErrors("GET /a=500, ,GET /b=502")).toHaveLength(2);
  });

  it.each(["POST /x", "POST /x=200", "POST /x=399", "post /x=500", "POST x=500", "POST /x=600"])(
    "refuses %s, naming the variable",
    (rule) => {
      expect(() => parseHttpErrors(rule)).toThrow("MOCK_HTTP_ERRORS");
    },
  );
});

describe("httpErrorFor", () => {
  const rules = parseHttpErrors(
    "POST /filter/saved=500, DELETE /filter/saved/*=404, * /filter/validate=503",
  );

  it("matches the method and the path exactly", () => {
    expect(httpErrorFor(rules, "POST", "/filter/saved")?.status).toBe(500);
    expect(httpErrorFor(rules, "GET", "/filter/saved")).toBeUndefined();
  });

  it("a path ending in /* matches everything below it, not itself", () => {
    expect(httpErrorFor(rules, "DELETE", "/filter/saved/abc")?.status).toBe(404);
    expect(httpErrorFor(rules, "DELETE", "/filter/saved")).toBeUndefined();
  });

  it("* matches any method", () => {
    expect(httpErrorFor(rules, "POST", "/filter/validate")?.status).toBe(503);
  });

  it("the first matching rule wins", () => {
    const two = parseHttpErrors("GET /databases=500, * *=503");
    expect(httpErrorFor(two, "GET", "/databases")?.status).toBe(500);
  });
});
