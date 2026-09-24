import type { Scalar } from "../model";

/**
 * Checks the backend's responses against the API contract (src/api/types.ts)
 * while they are read (docs/ARCHITECTURE.md, "Reading responses").
 *
 * client.ts wraps every JSON body in a `ResponseValue`, and the functions in
 * response.ts read it one key at a time through a `ResponseObject`. Each read
 * checks the value it reads. So a response that breaks the contract fails where
 * it is read, with a message that names the request and the field:
 *
 *     Unexpected response from GET /api/v1/individuals: "[3].fields" should be
 *     a list, but it is missing.
 *
 * and not three files later as "Cannot read properties of undefined".
 *
 * There are two kinds of read:
 * - **Required**: `id`, `number`, `boolean`, `list`, `object`. The app cannot
 *   work without these. A missing or wrong value throws a `ContractError`.
 * - **Display-only**: `text`, `strings` and the `optional…` reads. The app
 *   only shows these. A missing or wrong value becomes blank ("" or []) and is
 *   logged once as a console warning, so a small backend change can't take the
 *   whole app down. Use an `optional…` read for a key marked `?` in
 *   src/api/types.ts: the backend may leave those out, so their absence is not
 *   warned about.
 *
 * Keys the app doesn't read are never checked, and unknown keys are ignored.
 */

/** A response that doesn't match the API contract. The message says which
 *  request and which field, and what was expected. */
export class ContractError extends Error {
  constructor(source: string, problem: string) {
    super(`Unexpected response from ${source}: ${problem}`);
    this.name = "ContractError";
  }
}

type JsonObject = Record<string, unknown>;

/** A key of `T`, the response's type in src/api/types.ts. A key the type
 *  doesn't have (a typo, or a field the backend renamed) won't compile. */
type Key<T> = keyof T & string;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A key the backend left out. It sends `null` for some of those. */
function isAbsent(v: unknown): boolean {
  return v === undefined || v === null;
}

function shorten(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

/** What `v` is, for a message: "it is missing", "it is the number 42", … */
function whatIs(v: unknown): string {
  if (v === undefined) return "it is missing";
  if (v === null) return "it is null";
  if (Array.isArray(v)) return "it is a list";
  if (typeof v === "object") return "it is an object";
  if (typeof v === "string") return `it is the text ${JSON.stringify(shorten(v))}`;
  if (typeof v === "number") return `it is the number ${v}`;
  return `it is ${String(v)}`;
}

/** A message's core: `"[3].fields" should be a list, but it is missing.` */
function mismatch(path: string, expected: string, v: unknown): string {
  const where = path ? `"${path}"` : "the response";
  return `${where} should be ${expected}, but ${whatIs(v)}.`;
}

/** The path of `key` inside the object at `path`: "[3]" + "fields" → "[3].fields". */
function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Why `text` isn't a JSON body, for a ContractError. */
function notJson(text: string): string {
  if (text.trim() === "") return "the body is empty, but should be JSON.";
  // The usual cause: the request never reached the API, and a web server
  // answered with the app's own index.html instead.
  const hint = text.trimStart().startsWith("<")
    ? " That looks like a web page, not the API: check VITE_API_BASE in .env, and that the backend (or `npm run mock`) is running."
    : "";
  return `the body should be JSON, but it starts with ${JSON.stringify(shorten(text))}.${hint}`;
}

/**
 * The problems already warned about. A problem is warned about once per page
 * load, not once per list item: every number in the message counts as the same
 * (`#`), so "[0].description" and "[1].description" are one problem.
 */
const warned = new Set<string>();

function warnOnce(message: string): void {
  const key = message.replace(/\d+/g, "#");
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** Any JSON value from a response, not checked yet: the whole body, or a part of it. */
export class ResponseValue {
  constructor(
    private readonly value: unknown,
    /** The request it came from, e.g. "GET /api/v1/databases". */
    private readonly source: string,
    /** Where it sits in the body, e.g. "[3].fields". "" for the whole body. */
    private readonly path = "",
  ) {}

  /** Parse a response body. Throws a ContractError if it isn't JSON. */
  static parse(text: string, source: string): ResponseValue {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new ContractError(source, notJson(text));
    }
    return new ResponseValue(value, source);
  }

  /** This value as an object of type `T`. Throws if it isn't an object. */
  object<T>(): ResponseObject<T> {
    if (!isObject(this.value)) throw this.error("an object");
    return new ResponseObject<T>(this.value, this.source, this.path);
  }

  /** This value as a list of `T` objects. Throws if it isn't a list, or an
   *  item isn't an object. */
  list<T>(): ResponseObject<T>[] {
    if (!Array.isArray(this.value)) throw this.error("a list");
    return this.value.map((item, i) =>
      new ResponseValue(item, this.source, `${this.path}[${i}]`).object<T>(),
    );
  }

  private error(expected: string): ContractError {
    return new ContractError(this.source, mismatch(this.path, expected, this.value));
  }
}

/** One object from a response, read one key at a time. `T` is its type in
 *  src/api/types.ts. */
export class ResponseObject<T> {
  constructor(
    private readonly fields: JsonObject,
    private readonly source: string,
    private readonly path: string,
  ) {}

  // ---- required: a missing or wrong value throws a ContractError ----------

  /** A machine id (the backend's `label`s): text that isn't blank. */
  id(key: Key<T>): string {
    const v = this.fields[key];
    if (typeof v === "string" && v.trim() !== "") return v;
    throw this.error(key, "non-blank text");
  }

  /** A number (not NaN or Infinity). */
  number(key: Key<T>): number {
    const v = this.fields[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    throw this.error(key, "a number");
  }

  boolean(key: Key<T>): boolean {
    const v = this.fields[key];
    if (typeof v === "boolean") return v;
    throw this.error(key, "true or false");
  }

  /** A list of objects, each of type `U`. */
  list<U>(key: Key<T>): ResponseObject<U>[] {
    return new ResponseValue(this.fields[key], this.source, join(this.path, key)).list<U>();
  }

  /** An object of type `U`. */
  object<U>(key: Key<T>): ResponseObject<U> {
    return new ResponseValue(this.fields[key], this.source, join(this.path, key)).object<U>();
  }

  // ---- display-only: a missing or wrong value becomes blank, with a warning

  /** Text to show, trimmed. "" if it is missing or isn't text. */
  text(key: Key<T>): string {
    return this.readText(key, false);
  }

  /** Like `text`, for a key marked `?` in src/api/types.ts. */
  optionalText(key: Key<T>): string {
    return this.readText(key, true);
  }

  /** A list of texts, exactly as sent (not trimmed). Items that aren't text
   *  are left out; the whole list is [] if it is missing or isn't a list. */
  strings(key: Key<T>): string[] {
    return this.readStrings(key, false);
  }

  /** Like `strings`, for a key marked `?` in src/api/types.ts. */
  optionalStrings(key: Key<T>): string[] {
    return this.readStrings(key, true);
  }

  /** A number the backend may leave out (marked `?` in src/api/types.ts):
   *  `undefined` when it does, or when it isn't a number. */
  optionalNumber(key: Key<T>): number | undefined {
    const v = this.fields[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (!isAbsent(v)) this.warn(join(this.path, key), "a number", v, "Treating it as missing.");
    return undefined;
  }

  // ---- for objects keyed by the backend's own ids (an event's values) -----

  /** Every key of this object. */
  keys(): string[] {
    return Object.keys(this.fields);
  }

  /** This object's text, number and true/false values, by key. Other values
   *  are left out: `null` without a word, anything else with a warning. */
  scalars(): Record<string, Scalar> {
    const out: Record<string, Scalar> = {};
    for (const [key, v] of Object.entries(this.fields)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
      else if (v !== null) this.warn(join(this.path, key), "text, a number, true or false", v);
    }
    return out;
  }

  // ---- helpers -------------------------------------------------------------

  private readText(key: Key<T>, optional: boolean): string {
    const v = this.fields[key];
    if (typeof v === "string") return v.trim();
    const leftOutAsAllowed = optional && isAbsent(v);
    if (!leftOutAsAllowed) this.warn(join(this.path, key), "text", v, "Showing it as blank.");
    return "";
  }

  private readStrings(key: Key<T>, optional: boolean): string[] {
    const v = this.fields[key];
    const path = join(this.path, key);
    if (!Array.isArray(v)) {
      const leftOutAsAllowed = optional && isAbsent(v);
      if (!leftOutAsAllowed) this.warn(path, "a list of text", v, "Treating it as empty.");
      return [];
    }
    const texts: string[] = [];
    v.forEach((item, i) => {
      if (typeof item === "string") texts.push(item);
      else this.warn(`${path}[${i}]`, "text", item);
    });
    return texts;
  }

  private error(key: string, expected: string): ContractError {
    return new ContractError(
      this.source,
      mismatch(join(this.path, key), expected, this.fields[key]),
    );
  }

  /** Log a display-only problem; `outcome` says what the app does instead. */
  private warn(path: string, expected: string, v: unknown, outcome = "Leaving it out."): void {
    warnOnce(`Unexpected response from ${this.source}: ${mismatch(path, expected, v)} ${outcome}`);
  }
}
