const PATH_DELIMITER_REGEX = /([/#?\\]|%(2f|23|3f|5c))/gi;

function encodePathDelimiters(segment: string): string {
  return segment.replace(PATH_DELIMITER_REGEX, (character) =>
    encodeURIComponent(character),
  );
}

function decodePathSegmentStrict(segment: string): string {
  return encodePathDelimiters(decodeURIComponent(segment));
}

function normalizePath(pathname: string): string {
  if (
    pathname === "/" ||
    (pathname.length > 1 &&
      pathname.startsWith("/") &&
      !pathname.includes("//") &&
      !pathname.includes("/./") &&
      !pathname.includes("/../") &&
      !pathname.endsWith("/.") &&
      !pathname.endsWith("/.."))
  ) {
    return pathname;
  }

  const resolved: string[] = [];
  for (const segment of pathname.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
}

/**
 * Produces the exact segment-decoded pathname used by Vinext route matching.
 * Security controls must classify this value, not URL.pathname's still-encoded
 * representation, or an encoded static segment can bypass a path boundary.
 */
export function canonicalSecurityPathname(pathname: string): string | null {
  try {
    const decoded = pathname
      .split("/")
      .map((segment) => decodePathSegmentStrict(segment))
      .join("/");
    return normalizePath(decoded);
  } catch {
    return null;
  }
}
