import type { TreeCommand } from "../core/commands.js";

/**
 * The DOM plumbing around `TreeCommand` (defined in core, framework-free).
 * Every editable component dispatches commands upward via `dispatchCommand`
 * instead of mutating the tree itself; `query-builder-element` is the only
 * place that actually applies them.
 */
export const BUILDER_COMMAND_EVENT = "builder-command";

export type BuilderCommandEvent = CustomEvent<TreeCommand>;

export function dispatchCommand(target: EventTarget, command: TreeCommand): void {
  target.dispatchEvent(new CustomEvent<TreeCommand>(BUILDER_COMMAND_EVENT, { detail: command, bubbles: true, composed: true }));
}
