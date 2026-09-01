import { ReactiveElement } from "./element-base.js";
import { h } from "./dom.js";
import { dispatchCommand } from "./events.js";
import "./query-condition-element.js";
import type { ExpressionNode, FieldDefinition, GroupNode, LogicalOperator } from "../core/types.js";

const TAG_NAME = "query-group";

/**
 * Renders one Group: a logical-operator toggle, its children (conditions
 * and/or nested groups), and the "add condition" / "add group" actions.
 * Like `query-condition`, it never mutates the tree itself — every action
 * becomes a BuilderCommand dispatched upward.
 */
export class QueryGroupElement extends ReactiveElement {
  #node!: GroupNode;
  #fields: readonly FieldDefinition[] = [];
  #isRoot = false;

  set node(value: GroupNode) {
    this.#node = value;
    this.requestUpdate();
  }

  set fields(value: readonly FieldDefinition[]) {
    this.#fields = value;
    this.requestUpdate();
  }

  set isRoot(value: boolean) {
    this.#isRoot = value;
    this.requestUpdate();
  }

  protected override styles(): HTMLStyleElement {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      .group { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.75rem; border: 1px dashed var(--qb-border, #cbd5e1); border-radius: 10px; background: var(--qb-group-bg, rgba(148, 163, 184, 0.06)); }
      .group--root { border: none; padding: 0; background: transparent; }
      .group-header { display: flex; align-items: center; gap: 0.5rem; }
      .operator-toggle { display: inline-flex; border: 1px solid var(--qb-border, #cbd5e1); border-radius: 999px; overflow: hidden; }
      .operator-toggle button { border: none; background: var(--qb-surface, #fff); color: inherit; padding: 0.25rem 0.75rem; cursor: pointer; font: inherit; font-weight: 600; font-size: 0.75rem; letter-spacing: 0.03em; }
      .operator-toggle button[aria-pressed="true"] { background: var(--qb-accent, #4338ca); color: white; }
      .remove-group-button { margin-left: auto; border: none; background: transparent; color: var(--qb-danger, #b91c1c); cursor: pointer; font-size: 0.85rem; padding: 0.25rem 0.5rem; border-radius: 4px; }
      .remove-group-button:hover { background: var(--qb-danger-bg, #fee2e2); }
      .group-children { display: flex; flex-direction: column; gap: 0.5rem; }
      .connector { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; color: var(--qb-muted, #64748b); padding-left: 0.15rem; }
      .group-actions { display: flex; gap: 0.5rem; }
      .action-button { border: 1px solid var(--qb-border, #cbd5e1); background: var(--qb-surface, #fff); color: inherit; border-radius: 6px; padding: 0.3rem 0.6rem; font: inherit; font-size: 0.8rem; cursor: pointer; }
      .action-button:hover { background: var(--qb-group-bg, rgba(148, 163, 184, 0.12)); }
      .empty-hint { font-size: 0.8rem; color: var(--qb-muted, #64748b); font-style: italic; }
    `;
    return style;
  }

  protected override render(): Node {
    const node = this.#node;
    const isRoot = this.#isRoot;

    return h("div", { class: `group${isRoot ? " group--root" : ""}` }, [
      h("div", { class: "group-header" }, [
        this.#renderOperatorToggle(node.operator, node.id),
        !isRoot
          ? h(
              "button",
              {
                type: "button",
                class: "remove-group-button",
                title: "Remove group",
                onclick: () => dispatchCommand(this, { type: "remove-node", nodeId: node.id }),
              },
              ["Remove group"],
            )
          : null,
      ]),
      node.children.length === 0
        ? h("p", { class: "empty-hint" }, ["No conditions yet — add one below."])
        : h(
            "div",
            { class: "group-children" },
            node.children.flatMap((child, index) => [
              index > 0 ? h("span", { class: "connector" }, [node.operator]) : null,
              this.#renderChild(child),
            ]),
          ),
      h("div", { class: "group-actions" }, [
        h(
          "button",
          {
            type: "button",
            class: "action-button",
            onclick: () => dispatchCommand(this, { type: "add-condition", parentId: node.id }),
          },
          ["+ Add condition"],
        ),
        h(
          "button",
          {
            type: "button",
            class: "action-button",
            onclick: () => dispatchCommand(this, { type: "add-group", parentId: node.id }),
          },
          ["+ Add group"],
        ),
      ]),
    ]);
  }

  #renderOperatorToggle(current: LogicalOperator, nodeId: string): HTMLElement {
    const option = (value: LogicalOperator) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(current === value),
          onclick: () => dispatchCommand(this, { type: "set-group-operator", nodeId, operator: value }),
        },
        [value],
      );
    return h("div", { class: "operator-toggle" }, [option("AND"), option("OR")]);
  }

  #renderChild(child: ExpressionNode): HTMLElement {
    if (child.kind === "condition") {
      const el = h("query-condition", {});
      el.node = child;
      el.fields = this.#fields;
      return el;
    }
    const el = h("query-group", {});
    el.node = child;
    el.fields = this.#fields;
    el.isRoot = false;
    return el;
  }
}

customElements.define(TAG_NAME, QueryGroupElement);

declare global {
  interface HTMLElementTagNameMap {
    [TAG_NAME]: QueryGroupElement;
  }
}
