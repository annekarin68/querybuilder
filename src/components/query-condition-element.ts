import { ReactiveElement } from "./element-base.js";
import { h } from "./dom.js";
import { dispatchCommand } from "./events.js";
import { renderValueInput } from "./value-input.js";
import { getOperatorById, getOperatorsForType } from "../core/operators.js";
import type { ConditionNode, FieldDefinition } from "../core/types.js";

const TAG_NAME = "query-condition";

/**
 * Renders one condition: field select → operator select → value input(s).
 * Purely a view over the ConditionNode it's given; every interaction is
 * reported upward as a BuilderCommand rather than mutating local state.
 */
export class QueryConditionElement extends ReactiveElement {
  #node!: ConditionNode;
  #fields: readonly FieldDefinition[] = [];

  set node(value: ConditionNode) {
    this.#node = value;
    this.requestUpdate();
  }

  set fields(value: readonly FieldDefinition[]) {
    this.#fields = value;
    this.requestUpdate();
  }

  protected override styles(): HTMLStyleElement {
    const style = document.createElement("style");
    style.textContent = `
      :host { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      select, input, .value-input { font: inherit; padding: 0.3rem 0.5rem; border: 1px solid var(--qb-border, #cbd5e1); border-radius: 6px; background: var(--qb-surface, #fff); color: inherit; }
      .range-input { display: inline-flex; align-items: center; gap: 0.4rem; }
      .remove-button { border: none; background: transparent; color: var(--qb-danger, #b91c1c); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0.25rem; border-radius: 4px; }
      .remove-button:hover { background: var(--qb-danger-bg, #fee2e2); }
    `;
    return style;
  }

  protected override render(): Node {
    const node = this.#node;
    const field = this.#fields.find((candidate) => candidate.id === node.fieldId);
    const operators = field ? getOperatorsForType(field.valueType, field.allowedOperatorIds) : [];
    const operator = getOperatorById(node.operatorId);

    return h("div", { class: "condition" }, [
      h(
        "select",
        {
          class: "field-select",
          ariaLabel: "Field",
          onchange: (e) => {
            const fieldId = (e.target as HTMLSelectElement).value || null;
            dispatchCommand(this, {
              type: "update-condition",
              nodeId: node.id,
              patch: { fieldId, operatorId: null, value: null },
            });
          },
        },
        [
          h("option", { value: "", selected: !node.fieldId }, ["Select field…"]),
          ...this.#fields.map((candidate) =>
            h("option", { value: candidate.id, selected: candidate.id === node.fieldId }, [candidate.label]),
          ),
        ],
      ),
      field
        ? h(
            "select",
            {
              class: "operator-select",
              ariaLabel: "Operator",
              onchange: (e) => {
                const operatorId = (e.target as HTMLSelectElement).value || null;
                dispatchCommand(this, {
                  type: "update-condition",
                  nodeId: node.id,
                  patch: { operatorId, value: null },
                });
              },
            },
            [
              h("option", { value: "", selected: !node.operatorId }, ["Select operator…"]),
              ...operators.map((candidate) =>
                h("option", { value: candidate.id, selected: candidate.id === node.operatorId }, [candidate.label]),
              ),
            ],
          )
        : null,
      field && operator
        ? renderValueInput({
            field,
            operator,
            value: node.value,
            onChange: (value) => dispatchCommand(this, { type: "update-condition", nodeId: node.id, patch: { value } }),
          })
        : null,
      h(
        "button",
        {
          type: "button",
          class: "remove-button",
          ariaLabel: "Remove condition",
          title: "Remove condition",
          onclick: () => dispatchCommand(this, { type: "remove-node", nodeId: node.id }),
        },
        ["✕"],
      ),
    ]);
  }
}

customElements.define(TAG_NAME, QueryConditionElement);

declare global {
  interface HTMLElementTagNameMap {
    [TAG_NAME]: QueryConditionElement;
  }
}
