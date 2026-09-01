/**
 * A tiny base class for building reusable custom elements without a
 * framework. It gives subclasses:
 *   - a shadow root scoped to the element,
 *   - a `requestUpdate()` that batches renders to one per microtask,
 *   - and an `emit()` helper for the up-the-tree CustomEvent pattern
 *     these components use to report changes to whatever owns them.
 *
 * Subclasses implement `render(): Node`, built with the `h()` helper in
 * `dom.ts`. This is deliberately close to what a framework like Lit gives
 * you, minus the templating DSL and the dependency.
 */
export abstract class ReactiveElement extends HTMLElement {
  #updateScheduled = false;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.requestUpdate();
  }

  /** Schedules a re-render on the next microtask, coalescing bursts of state changes into one render. */
  protected requestUpdate(): void {
    if (this.#updateScheduled) return;
    this.#updateScheduled = true;
    queueMicrotask(() => {
      this.#updateScheduled = false;
      this.#performRender();
    });
  }

  #performRender(): void {
    if (!this.isConnected || !this.shadowRoot) return;
    const content = this.render();
    this.shadowRoot.replaceChildren(...(this.styles() ? [this.styles() as Node, content] : [content]));
  }

  /** Optional shared <style> element rendered once per update alongside the content. */
  protected styles(): HTMLStyleElement | null {
    return null;
  }

  /** Dispatches a bubbling, shadow-crossing CustomEvent — the standard way these components report changes upward. */
  protected emit<TDetail>(name: string, detail: TDetail): void {
    this.dispatchEvent(new CustomEvent<TDetail>(name, { detail, bubbles: true, composed: true }));
  }

  protected abstract render(): Node;
}
