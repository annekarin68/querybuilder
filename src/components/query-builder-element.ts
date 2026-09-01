import { ReactiveElement } from "./element-base.js";
import { h } from "./dom.js";
import { BUILDER_COMMAND_EVENT, type BuilderCommandEvent } from "./events.js";
import "./query-group-element.js";
import { applyCommand } from "../core/commands.js";
import { createEmptyExpression } from "../core/ast.js";
import { DslSerializer, JsonSerializer, type JsonGroup } from "../core/serializer.js";
import { validateExpression } from "../core/validator.js";
import type { SchemaProvider } from "../core/schema-provider.js";
import type { FieldDefinition, GroupNode, ValidationIssue } from "../core/types.js";
import { Store, type Unsubscribe } from "../state/store.js";

const TAG_NAME = "query-builder";

interface BuilderState {
  status: "idle" | "loading" | "ready" | "error";
  fields: readonly FieldDefinition[];
  tree: GroupNode;
  error?: string;
}

export interface QueryBuilderChangeDetail {
  readonly tree: GroupNode;
  readonly dsl: string;
  readonly json: JsonGroup;
  readonly issues: readonly ValidationIssue[];
  readonly isValid: boolean;
}

/**
 * The root element. Owns the one piece of mutable state in the whole
 * subtree (the expression tree) and is the only thing that talks to a
 * SchemaProvider. Everything below it is a pure view: state flows down
 * through `.node` / `.fields` properties, edits flow up as
 * `builder-command` events, and this element re-emits a public
 * `change` event any time the tree settles into a new shape.
 *
 * Usage:
 *   const builder = document.createElement("query-builder");
 *   builder.schemaProvider = new HttpSchemaProvider("/api/fields");
 *   builder.addEventListener("change", (e) => console.log(e.detail.dsl));
 *   document.body.append(builder);
 */
export class QueryBuilderElement extends ReactiveElement {
  #store = new Store<BuilderState>({ status: "idle", fields: [], tree: createEmptyExpression() });
  #schemaProvider: SchemaProvider | null = null;
  #dslSerializer = new DslSerializer();
  #jsonSerializer = new JsonSerializer();
  #unsubscribeStore: Unsubscribe | null = null;

  set schemaProvider(provider: SchemaProvider) {
    this.#schemaProvider = provider;
    void this.#loadSchema();
  }

  /** Replaces the current tree wholesale, e.g. to restore a saved query. */
  set tree(value: GroupNode) {
    this.#store.setState((state) => ({ ...state, tree: value }));
    this.#emitChange();
  }

  get tree(): GroupNode {
    return this.#store.getState().tree;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeStore = this.#store.subscribe(() => this.requestUpdate());
    this.addEventListener(BUILDER_COMMAND_EVENT, this.#handleCommand);
    if (this.#schemaProvider && this.#store.getState().status === "idle") {
      void this.#loadSchema();
    }
  }

  disconnectedCallback(): void {
    this.#unsubscribeStore?.();
    this.removeEventListener(BUILDER_COMMAND_EVENT, this.#handleCommand);
  }

  protected override styles(): HTMLStyleElement {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--qb-text, #0f172a); }
      .status { color: var(--qb-muted, #64748b); font-style: italic; margin: 0; }
      .status--error { color: var(--qb-danger, #b91c1c); font-style: normal; }
    `;
    return style;
  }

  protected override render(): Node {
    const state = this.#store.getState();

    if (state.status === "idle" || state.status === "loading") {
      return h("p", { class: "status" }, ["Loading fields…"]);
    }
    if (state.status === "error") {
      return h("p", { class: "status status--error" }, [`Couldn't load the field schema: ${state.error}`]);
    }

    const root = h("query-group", {});
    root.node = state.tree;
    root.fields = state.fields;
    root.isRoot = true;
    return root;
  }

  async #loadSchema(): Promise<void> {
    if (!this.#schemaProvider) return;
    this.#store.setState((state) => ({ ...state, status: "loading" }));
    try {
      const fields = await this.#schemaProvider.getFields();
      this.#store.setState((state) => ({ ...state, status: "ready", fields }));
      this.#emitChange();
    } catch (error) {
      this.#store.setState((state) => ({
        ...state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  #handleCommand = (event: Event): void => {
    const { detail } = event as BuilderCommandEvent;
    this.#store.setState((state) => ({ ...state, tree: applyCommand(state.tree, detail) }));
    this.#emitChange();
  };

  #emitChange(): void {
    const { tree, fields } = this.#store.getState();
    const issues = validateExpression(tree, fields);
    this.emit<QueryBuilderChangeDetail>("change", {
      tree,
      dsl: this.#dslSerializer.serialize(tree),
      json: this.#jsonSerializer.serialize(tree),
      issues,
      isValid: issues.every((issue) => issue.severity !== "error"),
    });
  }
}

customElements.define(TAG_NAME, QueryBuilderElement);

declare global {
  interface HTMLElementTagNameMap {
    [TAG_NAME]: QueryBuilderElement;
  }
}

/**
 * Type-safe helper for listening to the builder's `change` event, since
 * the native `HTMLElementEventMap["change"]` type (used by every plain
 * <input>/<select>) can't be narrowed to `CustomEvent` via declaration
 * merging without conflicting with the DOM lib's own definition.
 */
export function onQueryBuilderChange(
  builder: QueryBuilderElement,
  listener: (detail: QueryBuilderChangeDetail) => void,
): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<QueryBuilderChangeDetail>).detail);
  builder.addEventListener("change", handler);
  return () => builder.removeEventListener("change", handler);
}
