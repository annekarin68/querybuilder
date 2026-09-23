// Types for the Fomantic-UI jQuery plugins we use through the airlock
// (src/ui/fomantic.ts). fomantic-ui-css ships no type declarations, and
// @types/jquery only covers core jQuery, so extend the global JQuery interface
// with exactly the behaviors src/ui/fomantic.ts invokes. See docs/ARCHITECTURE.md,
// "The Fomantic discipline".
interface JQuery {
  dropdown(settings?: Record<string, unknown>): JQuery;
  dropdown(behavior: string, ...args: unknown[]): JQuery;
  checkbox(behavior?: string): JQuery;
}

// Our build-time settings on Vite's `import.meta.env` (the rest comes from
// `vite/client`, listed in tsconfig.json "types").
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}
