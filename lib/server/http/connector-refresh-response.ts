import type { RefreshResult } from "../connectors/repository-contracts";

function retryAfterSeconds(
  retryNotBefore: string,
  nowMilliseconds: number,
): number | null {
  const timestamp = Date.parse(retryNotBefore);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(1, Math.ceil((timestamp - nowMilliseconds) / 1_000));
}

export function connectorRefreshResponse(
  result: RefreshResult,
  nowMilliseconds = Date.now(),
): Response {
  const status =
    result.status === "complete" || result.status === "withheld"
      ? 200
      : result.status === "already_running" || result.status === "not_due"
        ? 202
        : result.status === "setup_required"
          ? 503
          : result.code === "rate_limited"
            ? 429
            : 424;
  const error =
    result.status === "setup_required"
      ? result.reason === "credential"
        ? "Connect this provider before refreshing it."
        : result.reason === "encryption_key"
          ? "Connector encryption is not configured."
          : result.reason === "storage_disclosure"
            ? "Configure the truthful Steam data storage-country disclosure before syncing."
            : "The site database is not ready."
      : result.status === "failed"
        ? result.code === "credential_expired" ||
          result.code === "reauthorization_required"
          ? "The provider credential needs to be renewed. No new snapshot was published; any previously accepted snapshot remains unchanged."
          : result.code === "rate_limited"
            ? `The provider is rate-limiting requests.${result.retryNotBefore ? ` Retry after ${result.retryNotBefore}.` : ""} No new snapshot was published; any previously accepted snapshot remains unchanged.`
            : result.code === "public_payload_rejected"
              ? "The provider responded, but no new snapshot passed public validation. Do not replace the credential; any previously accepted snapshot remains unchanged."
              : "No new snapshot was published. Any previously accepted snapshot remains unchanged."
        : undefined;
  const message =
    result.status === "withheld"
      ? "Steam game details are not public, so every stored Steam snapshot was unpublished."
      : undefined;
  const retryAfter =
    result.status === "failed" &&
    result.code === "rate_limited" &&
    result.retryNotBefore
      ? retryAfterSeconds(result.retryNotBefore, nowMilliseconds)
      : null;

  return Response.json(
    error ? { ...result, error } : message ? { ...result, message } : result,
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        ...(retryAfter === null
          ? {}
          : { "retry-after": String(retryAfter) }),
      },
    },
  );
}
