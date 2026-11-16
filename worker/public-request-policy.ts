import { workQueryIsValid } from "../lib/work-query-policy";

function rejected(status: number): Response {
  return new Response(status === 405 ? "Method Not Allowed" : "Bad Request", {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...(status === 405 ? { allow: "GET, HEAD" } : {}),
    },
  });
}

/** No Server Actions exist here. Reject before Vinext decodes any body or ID. */
export function publicRequestPolicyResponse(
  request: Request,
  pathname: string,
): Response | null {
  if (request.headers.has("next-action") || request.headers.has("x-rsc-action")) {
    return rejected(400);
  }
  // Owner and callback mutations have their own origin/body/method contracts.
  // Public pages and RSC navigation are read-only, including form submissions.
  if (!pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method)) {
    return rejected(405);
  }
  if (["/work", "/work/"].includes(pathname) &&
      !workQueryIsValid(new URL(request.url).searchParams)) {
    return rejected(400);
  }
  return null;
}
