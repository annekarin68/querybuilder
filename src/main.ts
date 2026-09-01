import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "fomantic-ui-css/semantic.min.css";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  app.innerHTML = `<div class="ui container" style="padding-top:2rem">
    <h1 class="ui header">Query Builder</h1>
    <p>Toolchain scaffolding is working.</p>
  </div>`;
}
