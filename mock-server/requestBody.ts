// Checks a request body's query against the contract (QueryRequest in
// src/api/types.ts) before anything reads it. The body is untrusted JSON; this
// is also a working reference for the real backend's own check.

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";
const isNonEmptyString = (v: unknown) => typeof v === "string" && v !== "";

/**
 * What is wrong with `node` as a RequestNode, or null if nothing is. `at` names
 * the node in the message, e.g. "query.children[1]". The first problem found wins.
 */
export function queryProblem(node: unknown, at = "query"): string | null {
  if (!isObject(node)) return `${at} must be an object.`;
  if (node.kind !== "group" && node.kind !== "condition") {
    return `${at}.kind must be "group" or "condition".`;
  }
  if (typeof node.id !== "string") return `${at}.id must be a string.`;
  if (node.kind === "group") {
    if (node.operator !== "AND" && node.operator !== "OR") {
      return `${at}.operator must be "AND" or "OR".`;
    }
    if (!Array.isArray(node.children) || node.children.length === 0) {
      return `${at}.children must be a non-empty list.`;
    }
    for (const [i, child] of node.children.entries()) {
      const problem = queryProblem(child, `${at}.children[${i}]`);
      if (problem) return problem;
    }
    return null;
  }
  for (const key of ["facetId", "fieldId", "operatorId"] as const) {
    if (!isNonEmptyString(node[key])) return `${at}.${key} must be a non-empty string.`;
  }
  const v = node.value;
  if (v === null || isScalar(v) || (Array.isArray(v) && v.every(isScalar))) return null;
  return `${at}.value must be null, a string, number or boolean, or a list of them.`;
}
