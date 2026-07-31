export type BoundedJsonResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

const PRIVATE_NO_STORE = { "cache-control": "private, no-store" } as const;

function jsonError(
  error: string,
  code: string,
  status: number,
): BoundedJsonResult<never> {
  return {
    ok: false,
    response: Response.json(
      { error, code },
      { status, headers: PRIVATE_NO_STORE },
    ),
  };
}

/**
 * Reads a JSON body without trusting Content-Length. The stream is stopped as
 * soon as the configured byte ceiling is crossed, so chunked requests cannot
 * bypass the limit. Call this only after authentication and same-origin checks.
 */
export async function readBoundedJsonBody<T = unknown>(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<BoundedJsonResult<T>> {
  const maxBytes = options.maxBytes ?? 16_384;
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError(
      "Content-Type must be application/json.",
      "invalid_media_type",
      415,
    );
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return jsonError(
        "Content-Length is invalid.",
        "invalid_content_length",
        400,
      );
    }
    if (Number(declaredLength) > maxBytes) {
      return jsonError(
        "Request body is too large.",
        "request_too_large",
        413,
      );
    }
  }

  if (!request.body) {
    return jsonError("A JSON request body is required.", "invalid_json", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return jsonError(
          "Request body is too large.",
          "request_too_large",
          413,
        );
      }
      chunks.push(value);
    }
  } catch {
    return jsonError("Request body could not be read.", "invalid_body", 400);
  }

  if (bytesRead === 0) {
    return jsonError("A JSON request body is required.", "invalid_json", 400);
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T,
    };
  } catch {
    return jsonError("A valid JSON body is required.", "invalid_json", 400);
  }
}
