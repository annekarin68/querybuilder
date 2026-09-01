import "../components/index.js";
import { onQueryBuilderChange, type QueryBuilderChangeDetail } from "../components/query-builder-element.js";
import { HttpSchemaProvider } from "../core/schema-provider.js";

const mount = document.querySelector<HTMLElement>("#builder-mount");
const dslOutput = document.querySelector<HTMLElement>("#dsl-output");
const issuesOutput = document.querySelector<HTMLElement>("#issues-output");
const runButton = document.querySelector<HTMLButtonElement>("#run-query");
const resultsOutput = document.querySelector<HTMLElement>("#results-output");

if (!mount || !dslOutput || !issuesOutput || !runButton || !resultsOutput) {
  throw new Error("Expected demo page scaffolding (#builder-mount etc.) to be present in index.html.");
}

const builder = document.createElement("query-builder");
builder.schemaProvider = new HttpSchemaProvider("/api/fields");
mount.append(builder);

let latest: QueryBuilderChangeDetail | null = null;

onQueryBuilderChange(builder, (detail) => {
  latest = detail;
  dslOutput.textContent = detail.dsl || "(empty query)";

  if (detail.issues.length === 0) {
    issuesOutput.textContent = "";
    issuesOutput.hidden = true;
  } else {
    issuesOutput.hidden = false;
    issuesOutput.replaceChildren(
      ...detail.issues.map((issue) => {
        const li = document.createElement("li");
        li.textContent = issue.message;
        li.className = `issue issue--${issue.severity}`;
        return li;
      }),
    );
  }

  runButton.disabled = !detail.isValid;
});

runButton.addEventListener("click", async () => {
  if (!latest || !latest.isValid) return;
  runButton.disabled = true;
  runButton.textContent = "Running…";
  resultsOutput.textContent = "";

  try {
    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dsl: latest.dsl, expression: latest.json }),
    });
    const body = await response.json();
    resultsOutput.textContent = JSON.stringify(body, null, 2);
  } catch (error) {
    resultsOutput.textContent = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    runButton.disabled = !latest.isValid;
    runButton.textContent = "Run query";
  }
});
