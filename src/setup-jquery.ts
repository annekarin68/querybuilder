// Publishes jQuery as a global BEFORE Fomantic's JS is evaluated.
//
// Fomantic's `semantic.min.js` is an IIFE that ends with `}(jQuery, window, document)`
// — it reads the global `jQuery` the moment it is evaluated. ES module imports are
// hoisted: every imported module runs to completion before the importing module's
// body. So the global must be set from *another module* that appears earlier in the
// import list than `fomantic-ui-css/semantic.min.js`. Setting it in `main.ts`'s body
// is too late. This file is that earlier module, and the ONLY place (besides
// `src/ui/fomantic.ts`) allowed to import jQuery. See docs/ARCHITECTURE.md §3.
import $ from "jquery";

declare global {
  interface Window {
    jQuery: typeof $;
    $: typeof $;
  }
}

window.jQuery = $;
window.$ = $;
