import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContractError, ResponseValue } from "../../src/api/contract";

// Every number in a warning counts as the same problem (see warnOnce), and
// warnings are remembered for the whole file, so each test below warns about
// its own key.

interface Thing {
  label: string;
  size: number;
  active: boolean;
  note: string;
  maybe?: string;
  tags: string[];
  extras?: string[];
  count?: number;
  parts: Thing[];
  extraParts?: Thing[];
  kind: "a" | "b";
  value: null;
}

const thing = (body: unknown) => new ResponseValue(body, "GET /api/v1/things").object<Thing>();

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResponseValue.parse", () => {
  it("parses a JSON body", () => {
    expect(ResponseValue.parse('{"label":"a"}', "GET /x").object<Thing>().id("label")).toBe("a");
  });

  it("says when the body isn't JSON, and quotes its start", () => {
    expect(() => ResponseValue.parse("oops, not json", "GET /x")).toThrow(
      new ContractError("GET /x", 'the body should be JSON, but it starts with "oops, not json".'),
    );
  });

  it("points at VITE_API_BASE when a web page came back instead of the API", () => {
    expect(() => ResponseValue.parse("<!doctype html><html>", "GET /x")).toThrow(
      /looks like a web page, not the API: check VITE_API_BASE/,
    );
  });

  it("says when the body is empty", () => {
    expect(() => ResponseValue.parse("", "GET /x")).toThrow(
      "Unexpected response from GET /x: the body is empty, but should be JSON.",
    );
  });
});

describe("the body's shape", () => {
  it("a list where an object belongs throws, naming the request", () => {
    expect(() => thing([])).toThrow(
      "Unexpected response from GET /api/v1/things: the response should be an object, but it is a list.",
    );
  });

  it("an object where a list belongs throws", () => {
    expect(() => new ResponseValue({}, "GET /x").list()).toThrow(
      "the response should be a list, but it is an object.",
    );
  });

  it("a list item that isn't an object throws, naming the item", () => {
    expect(() => new ResponseValue([{}, "b"], "GET /x").list()).toThrow(
      '"[1]" should be an object, but it is the text "b".',
    );
  });

  it("a nested list names the whole path", () => {
    const body = { parts: [{ parts: [{}, { label: 7 }] }] };
    const inner = thing(body).list<Thing>("parts")[0]!.list<Thing>("parts")[1]!;
    expect(() => inner.id("label")).toThrow(
      '"parts[0].parts[1].label" should be non-blank text, but it is the number 7.',
    );
  });
});

describe("required reads", () => {
  it("return the value when it is right", () => {
    const t = thing({ label: "a", size: 0, active: false });
    expect([t.id("label"), t.number("size"), t.boolean("active")]).toEqual(["a", 0, false]);
  });

  it.each([
    ["missing", {}, "it is missing"],
    ["null", { label: null }, "it is null"],
    ["blank", { label: "  " }, 'it is the text "  "'],
    ["a number", { label: 5 }, "it is the number 5"],
  ])("id: %s throws", (_what, body, found) => {
    expect(() => thing(body).id("label")).toThrow(
      `"label" should be non-blank text, but ${found}.`,
    );
  });

  it("number: text or NaN throws", () => {
    expect(() => thing({ size: "5" }).number("size")).toThrow('it is the text "5"');
    expect(() => thing({ size: NaN }).number("size")).toThrow("should be a number");
  });

  it("boolean: anything but true or false throws", () => {
    expect(() => thing({ active: "true" }).boolean("active")).toThrow(
      '"active" should be true or false',
    );
  });

  it("a long text is shortened in the message", () => {
    expect(() => thing({ size: "x".repeat(100) }).number("size")).toThrow(
      `it is the text "${"x".repeat(40)}…".`,
    );
  });
});

describe("ids", () => {
  it("returns the ids as sent, untrimmed, and an empty list", () => {
    expect(thing({ tags: ["a", " b "] }).ids("tags")).toEqual(["a", " b "]);
    expect(thing({ tags: [] }).ids("tags")).toEqual([]);
  });

  it.each([
    ["missing", {}, '"tags" should be a list of ids, but it is missing.'],
    ["null", { tags: null }, '"tags" should be a list of ids, but it is null.'],
    ["not a list", { tags: "a" }, '"tags" should be a list of ids, but it is the text "a".'],
    [
      "a blank item",
      { tags: ["a", " "] },
      '"tags[1]" should be non-blank text, but it is the text " ".',
    ],
    [
      "a number item",
      { tags: ["a", 2] },
      '"tags[1]" should be non-blank text, but it is the number 2.',
    ],
    ["a null item", { tags: [null] }, '"tags[0]" should be non-blank text, but it is null.'],
  ])("%s throws, naming the place", (_what, body, message) => {
    expect(() => thing(body).ids("tags")).toThrow(ContractError);
    expect(() => thing(body).ids("tags")).toThrow(message);
  });
});

describe("nullableId", () => {
  it("returns an id, and null when the key is null or left out", () => {
    expect(thing({ label: "a" }).nullableId("label")).toBe("a");
    expect(thing({ label: null }).nullableId("label")).toBeNull();
    expect(thing({}).nullableId("label")).toBeNull();
  });

  it.each([
    ["blank", { label: " " }, 'it is the text " "'],
    ["a number", { label: 3 }, "it is the number 3"],
  ])("%s throws", (_what, body, found) => {
    expect(() => thing(body).nullableId("label")).toThrow(
      `"label" should be non-blank text, but ${found}.`,
    );
  });
});

describe("oneOf", () => {
  it("returns the value when it is allowed", () => {
    expect(thing({ kind: "b" }).oneOf("kind", ["a", "b"])).toBe("b");
  });

  it.each([
    ["missing", {}, "it is missing"],
    ["another text", { kind: "c" }, 'it is the text "c"'],
    ["a number", { kind: 1 }, "it is the number 1"],
  ])("%s throws, listing what was expected", (_what, body, found) => {
    expect(() => thing(body).oneOf("kind", ["a", "b"])).toThrow(
      `"kind" should be "a" or "b", but ${found}.`,
    );
  });
});

describe("savedValue", () => {
  it.each([
    ["null", null],
    ["text", "x"],
    ["a number", 0],
    ["false", false],
    ["a list", [1, "b", true]],
    ["a list with a null", [3, null]],
    ["an empty list", []],
  ])("accepts %s as it is", (_what, value) => {
    expect(thing({ value }).savedValue("value")).toEqual(value);
  });

  it("reads a left-out value as null", () => {
    expect(thing({}).savedValue("value")).toBeNull();
  });

  it("returns a copy of a list", () => {
    const list = [1, 2];
    expect(thing({ value: list }).savedValue("value")).not.toBe(list);
  });

  it.each([
    ["an object", { from: 1 }],
    ["a list holding an object", [1, {}]],
    ["a list holding a list", [[1]]],
  ])("%s throws", (_what, value) => {
    expect(() => thing({ value }).savedValue("value")).toThrow(
      '"value" should be null, text, a number, true or false, or a list of those',
    );
  });
});

describe("optionalList", () => {
  it("is [] when the key is missing or null, without a warning", () => {
    expect(thing({}).optionalList<Thing>("extraParts")).toEqual([]);
    expect(thing({ extraParts: null }).optionalList<Thing>("extraParts")).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reads a list of objects like `list`", () => {
    const parts = thing({ extraParts: [{ label: "a" }] }).optionalList<Thing>("extraParts");
    expect(parts.map((p) => p.id("label"))).toEqual(["a"]);
  });

  it("throws when the value is there but isn't a list of objects", () => {
    expect(() => thing({ extraParts: "a" }).optionalList<Thing>("extraParts")).toThrow(
      '"extraParts" should be a list, but it is the text "a".',
    );
    expect(() => thing({ extraParts: ["a"] }).optionalList<Thing>("extraParts")).toThrow(
      '"extraParts[0]" should be an object, but it is the text "a".',
    );
  });
});

describe("display-only reads", () => {
  it("text is trimmed", () => {
    expect(thing({ note: "  hi " }).text("note")).toBe("hi");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("missing text is blank, with a warning", () => {
    expect(thing({}).text("note")).toBe("");
    expect(console.warn).toHaveBeenCalledWith(
      'Unexpected response from GET /api/v1/things: "note" should be text, but it is missing. Showing it as blank.',
    );
  });

  it("optional text may be missing or null without a warning, but not another kind", () => {
    expect(thing({}).optionalText("maybe")).toBe("");
    expect(thing({ maybe: null }).optionalText("maybe")).toBe("");
    expect(console.warn).not.toHaveBeenCalled();
    expect(thing({ maybe: 3 }).optionalText("maybe")).toBe("");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("strings keeps the texts, as sent, and leaves out the rest with a warning", () => {
    expect(thing({ tags: [" a ", 1, "b"] }).strings("tags")).toEqual([" a ", "b"]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"tags[1]" should be text, but it is the number 1. Leaving it out.'),
    );
  });

  it("a missing list is empty; an optional one without a warning", () => {
    expect(thing({ extras: null }).optionalStrings("extras")).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
    expect(thing({ tags: "a,b" }).strings("tags")).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("optionalNumber is undefined when missing or not a number", () => {
    expect(thing({ count: 4 }).optionalNumber("count")).toBe(4);
    expect(thing({}).optionalNumber("count")).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
    expect(thing({ count: "4" }).optionalNumber("count")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("the same problem on many list items is warned about once", () => {
    const list = new ResponseValue([{}, {}, {}], "GET /y").list<Thing>();
    for (const item of list) item.text("label");
    expect(console.warn).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"[0].label"'));
  });
});

describe("objects keyed by the backend's ids", () => {
  it("keys and scalars", () => {
    const o = new ResponseValue({ a: "x", b: 2, c: true, d: null }, "GET /z").object<
      Record<string, unknown>
    >();
    expect(o.keys()).toEqual(["a", "b", "c", "d"]);
    expect(o.scalars()).toEqual({ a: "x", b: 2, c: true });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("scalars leaves out an object or a list, with a warning", () => {
    const o = new ResponseValue({ a: "x", e: [1] }, "GET /z").object<Record<string, unknown>>();
    expect(o.scalars()).toEqual({ a: "x" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"e" should be text'));
  });
});
