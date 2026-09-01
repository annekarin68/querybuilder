// Ambient augmentation for the Fomantic-UI jQuery plugins we use through the
// airlock (src/ui/fomantic.ts). fomantic-ui-css ships no type declarations, and
// @types/jquery only covers core jQuery, so extend the global JQuery interface
// with the exact behaviors src/ui/fomantic.ts invokes. See docs/ARCHITECTURE.md §3.
interface JQuery {
  dropdown(settings?: Record<string, unknown>): JQuery;
  dropdown(behavior: string, ...args: unknown[]): JQuery;
  checkbox(behavior?: string): JQuery;
  accordion(behavior?: string): JQuery;
}
