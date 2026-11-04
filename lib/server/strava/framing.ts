/** Evaluate the actual ancestor origin, not a generic third-party wildcard.
 * Enforced frame-ancestors overrides XFO; report-only CSP has no effect.
 * Multiple enforced policies intersect; the first duplicate directive wins.
 * This proves header eligibility only, never successful frame rendering.
 */
export function evaluateStravaFraming(headers: Headers, embedUrl: string, siteOrigin: string) {
  const parent = new URL(siteOrigin);
  const resource = new URL(embedUrl);
  const policies = (headers.get("content-security-policy") ?? "").split(",");
  const ancestors = policies.map(policy => policy.split(";")
    .map(part => part.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === "frame-ancestors"))
    .filter((directive): directive is string[] => Boolean(directive));
  if (ancestors.length) {
    return {
      permitted: ancestors.every(([, ...sources]) => sources.some(source => matches(source, parent, resource))),
      policy: "csp" as const,
    };
  }
  const xfo = headers.get("x-frame-options")?.toLowerCase().split(",").map(value => value.trim()) ?? [];
  return {
    permitted: !xfo.includes("deny") && (!xfo.includes("sameorigin") || parent.origin === resource.origin),
    policy: xfo.length ? "x-frame-options" as const : "none" as const,
  };
}

function schemeMatches(source: string, target: string) {
  return source === target || (source === "http:" && target === "https:");
}

function matches(expression: string, parent: URL, resource: URL): boolean {
  if (expression === "*") return ["https:", "http:"].includes(parent.protocol);
  if (expression.toLowerCase() === "'self'") return parent.origin === resource.origin;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(expression)) return schemeMatches(expression.toLowerCase(), parent.protocol);
  // A host source may omit its scheme, but never silently adopt the site's.
  const match = /^(?:(https?):\/\/)?(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)(?::(\*|\d+))?(\/[^?#]*)?$/i.exec(expression);
  if (!match) return false;
  const [, scheme, host, port, path] = match;
  if (path && path !== "/") return false;
  if (!schemeMatches(scheme ? scheme.toLowerCase() + ":" : resource.protocol, parent.protocol)) return false;
  const hostname = host.toLowerCase();
  if (hostname !== "*" && (hostname.startsWith("*.")
    ? !parent.hostname.endsWith(hostname.slice(1))
    : parent.hostname !== hostname)) return false;
  if (port === "*") return true;
  const actualPort = parent.port || (parent.protocol === "https:" ? "443" : "80");
  if (port) return port === actualPort || (port === "80" && scheme === "http" && actualPort === "443");
  return parent.port === "";
}
