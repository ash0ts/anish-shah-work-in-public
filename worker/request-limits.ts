import { privateJson } from "./security-headers";

const WRITE_BODY_LIMIT_BYTES = 16_384;
const PROMOTION_BODY_LIMIT_BYTES = 65_536;

export async function boundedApiWrite(
  request: Request,
  pathname: string,
): Promise<Request | Response> {
  if (
    !["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ||
    !pathname.startsWith("/api/") ||
    !request.body
  ) {
    return request;
  }
  const maxBytes =
    pathname === "/api/play-promotion/import"
      ? PROMOTION_BODY_LIMIT_BYTES
      : WRITE_BODY_LIMIT_BYTES;
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    return privateJson("Request body is too large.", "request_too_large", 413);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return privateJson(
          "Request body is too large.",
          "request_too_large",
          413,
        );
      }
      chunks.push(value);
    }
  } catch {
    return privateJson("Request body could not be read.", "invalid_body", 400);
  }
  if (size > 0) {
    const contentType = request.headers.get("content-type") ?? "";
    if (
      contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      return privateJson(
        "Content-Type must be application/json.",
        "invalid_media_type",
        415,
      );
    }
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.set("content-length", String(size));
  // The original stream has been consumed by the size check, so rebuilding
  // from it throws in Workers even when the request body was empty. Recreate
  // the request from its URL and explicit safe fields instead.
  return new Request(request.url, {
    method: request.method,
    headers,
    body: size ? body : undefined,
    redirect: request.redirect,
    signal: request.signal,
  });
}
