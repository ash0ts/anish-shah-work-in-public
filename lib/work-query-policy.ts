// Shared, dependency-free boundary: importing this in the Worker must not load
// the archive or presentation bundle just to reject an abusive query.
export const WORK_QUERY_MAX_LENGTH = 2_048;
export const WORK_SEARCH_MAX_LENGTH = 200;
export const WORK_QUERY_KEYS = [
  "q", "bucket", "topic", "year", "format", "organization", "role",
  "practice", "organizations", "page",
] as const;

export function validWorkPage(value: string): boolean {
  return /^[1-9][0-9]{0,5}$/.test(value);
}

export function workQueryIsValid(parameters: URLSearchParams): boolean {
  if (parameters.toString().length > WORK_QUERY_MAX_LENGTH) return false;
  for (const key of [...WORK_QUERY_KEYS, "view"]) {
    const values = parameters.getAll(key);
    if (values.length > 1) return false;
    const value = values[0];
    if (value === undefined) continue;
    if (value.length > (key === "q" ? WORK_SEARCH_MAX_LENGTH : 240)) return false;
    if (/[\u0000-\u001f\u007f]/.test(value)) return false;
    if (key === "page" && !validWorkPage(value)) return false;
  }
  return true;
}

export function isFilteredWorkRequest(request: Request, pathname: string): boolean {
  return ["/work", "/work/"].includes(pathname) &&
    ["GET", "HEAD"].includes(request.method) &&
    [...new URL(request.url).searchParams.keys()].some((key) => key !== "_rsc");
}
