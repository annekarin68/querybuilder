import {
  fieldsOfFacet,
  findFacet,
  findField,
  findOperator,
  type FieldCatalog,
} from "./fieldCatalog";
import { isBlankValue } from "./validate";
import type { FacetBlock, FieldCondition, QueryNode } from "./types";

// The query in plain words, e.g. "Thing has (size > 40 AND label in (a, b))".
// Display only. As short as it can be without becoming ambiguous, because it
// is often cut off (spec, section 5 "Summary"): operators are symbols or one
// word, and a block's fields are bracketed so an AND inside a block (one
// occurrence) can't be read as the AND between two blocks.

/** Stands in for a value the user hasn't entered yet. */
const MISSING = "(value?)";

/** Each operator's short form. `between` is written "between (20, 80)", never
 *  "20–80", which can read as "twenty minus eighty" (maintainers, 2026-10-27). */
const OPERATOR_TEXT: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  before: "before",
  after: "after",
  contains: "contains",
  between: "between",
  in: "in",
  not_in: "not in",
  present: "present",
  absent: "absent",
};

function valueText(v: unknown): string {
  return isBlankValue(v) ? MISSING : String(v);
}

/** A list or a from–to pair, in brackets: "(a, b)", "(20, 80)". */
function listText(v: unknown): string {
  return Array.isArray(v) && v.length > 0 ? `(${v.map(valueText).join(", ")})` : MISSING;
}

function conditionText(block: FacetBlock, c: FieldCondition, catalog: FieldCatalog): string {
  const name = findField(catalog, block.facetId, c.fieldId)?.fieldName ?? "(field?)";
  const op = findOperator(c.operatorId);
  if (!op) return `${name} (operator?)`;
  const opText = OPERATOR_TEXT[op.id] ?? op.name;
  switch (op.arity) {
    case "none":
      return `${name} ${opText}`;
    case "one":
      return `${name} ${opText} ${valueText(c.value)}`;
    case "two":
    case "many":
      return `${name} ${opText} ${listText(c.value)}`;
  }
}

/** The block's conditions in the facet's own field order, which is how its
 *  rows are drawn; a field the catalog no longer knows goes last. */
function inFieldOrder(block: FacetBlock, catalog: FieldCatalog): FieldCondition[] {
  const order = fieldsOfFacet(catalog, block.facetId).map((f) => f.fieldId);
  const rank = (c: FieldCondition) => {
    const at = order.indexOf(c.fieldId);
    return at === -1 ? order.length : at;
  };
  return [...block.conditions].sort((a, b) => rank(a) - rank(b));
}

/** One block in words: "Thing present", "Thing has size > 40",
 *  "Thing has no (size > 40)", "Thing has (size > 40 AND label = x)". */
export function blockText(block: FacetBlock, catalog: FieldCatalog): string {
  const facet = findFacet(catalog, block.facetId)?.name ?? "(facet?)";
  const parts = inFieldOrder(block, catalog).map((c) => conditionText(block, c, catalog));
  if (parts.length === 0) return `${facet} ${block.negated ? "absent" : "present"}`;
  const has = block.negated ? "has no" : "has";
  // "has no" always gets brackets, even around one field: "has no size > 40"
  // could be read as "has no size" (maintainers, 2026-10-27).
  const bare = parts.length === 1 && !block.negated;
  const inner = bare ? parts[0]! : `(${parts.join(` ${block.operator} `)})`;
  return `${facet} ${has} ${inner}`;
}

function nodeText(node: QueryNode, isRoot: boolean, catalog: FieldCatalog): string {
  if (node.kind === "facet") return blockText(node, catalog);
  if (node.children.length === 0) return isRoot ? "(empty query)" : "()";
  const inner = node.children.map((c) => nodeText(c, false, catalog)).join(` ${node.operator} `);
  return isRoot ? inner : `(${inner})`;
}

export function queryToText(tree: QueryNode, catalog: FieldCatalog): string {
  return nodeText(tree, true, catalog);
}
