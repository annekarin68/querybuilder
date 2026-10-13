/**
 * MOCK_HTTP_ERRORS: make chosen routes answer with an HTTP error, to see how
 * the frontend copes when the backend fails (docs/ARCHITECTURE.md, "Mock
 * server"). The variable holds rules separated by commas:
 *
 *     MOCK_HTTP_ERRORS="POST /filter/saved=500, GET /documentation/databases=502:html"
 *
 * Each rule is `METHOD PATH=STATUS`. PATH is below the API prefix
 * ("/filter/saved", not "/api/v1/filter/saved"). `*` as METHOD or PATH
 * matches anything, and a PATH ending in "/*" matches everything below it
 * ("/filter/saved/*" is every saved query's own path). `:html` answers with a
 * small HTML page instead of the usual `{ "error": … }` JSON, as a proxy or
 * gateway in front of a real backend would. The first matching rule wins.
 */
export interface HttpErrorRule {
  /** "GET", "POST", … or "*". */
  method: string;
  /** Below the API prefix, e.g. "/filter/validate"; or "*"; or ending in "/*". */
  path: string;
  /** 400–599. */
  status: number;
  /** Answer with an HTML page instead of JSON. */
  html: boolean;
}

const RULE = /^(\*|[A-Z]+)\s+(\*|\/\S*)\s*=\s*(\d{3})(:html)?$/;

/** The rules in `text` (the variable's value). Throws on a rule it can't read,
 *  so a typo stops the mock at startup instead of silently doing nothing. */
export function parseHttpErrors(text: string | undefined): HttpErrorRule[] {
  // Empty parts (unset, blank, a trailing comma) are skipped: a harmless slip.
  const rules = (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((rule) => rule !== "");
  return rules.map((rule) => {
    const m = RULE.exec(rule);
    const status = m ? Number(m[3]) : 0;
    if (!m || status < 400 || status > 599) {
      throw new Error(
        `MOCK_HTTP_ERRORS: "${rule}" should look like "POST /filter/saved=500" ` +
          `(a status from 400 to 599, optionally followed by ":html").`,
      );
    }
    return { method: m[1]!, path: m[2]!, status, html: m[4] !== undefined };
  });
}

function pathMatches(rulePath: string, path: string): boolean {
  if (rulePath === "*" || rulePath === path) return true;
  // "/filter/saved/*": anything below "/filter/saved/".
  return rulePath.endsWith("/*") && path.startsWith(rulePath.slice(0, -1));
}

/** The rule that makes `method path` fail, if any. `path` is below the prefix. */
export function httpErrorFor(
  rules: HttpErrorRule[],
  method: string,
  path: string,
): HttpErrorRule | undefined {
  return rules.find((r) => (r.method === "*" || r.method === method) && pathMatches(r.path, path));
}
