export const STAGING_REQUEST_TIMEOUT_MS = 10_000;
export const STAGING_READINESS_TIMEOUT_MS = 30_000;

const BASE_STAGING_SMOKE_PATHS = Object.freeze([
  "/",
  "/work",
  "/play",
  "/sources",
  "/privacy",
  "/robots.txt",
]);

const ROOM_STAGING_SMOKE_PATHS = Object.freeze([
  "/play/watch",
  "/play/read",
  "/play/listen",
  "/play/collect",
  "/play/play",
  "/play/move",
]);

export function stagingSmokePaths(playExperienceMode) {
  if (playExperienceMode === "classic") return [...BASE_STAGING_SMOKE_PATHS];
  if (playExperienceMode === "my-room-2001") {
    return [...BASE_STAGING_SMOKE_PATHS, ...ROOM_STAGING_SMOKE_PATHS];
  }
  throw new Error("The staging plan contains an unsupported Play experience mode.");
}

export async function fetchWithTimeout(
  fetchImplementation,
  input,
  init = {},
  timeoutMs = STAGING_REQUEST_TIMEOUT_MS,
  consumeResponse = (response) => response,
) {
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("The staging request timeout is invalid.");
  }
  if (init.signal) {
    throw new Error("Staging requests cannot override the guarded timeout signal.");
  }
  if (typeof consumeResponse !== "function") {
    throw new Error("The staging response consumer is invalid.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(input, {
      ...init,
      signal: controller.signal,
    });
    return await consumeResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`The staging request exceeded ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForReadOnlyStagingReadiness({
  check,
  timeoutMs = STAGING_READINESS_TIMEOUT_MS,
  intervalMs = 500,
}) {
  if (typeof check !== "function") {
    throw new Error("A read-only staging readiness check is required.");
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > timeoutMs
  ) {
    throw new Error("The staging readiness deadline is invalid.");
  }

  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  do {
    attempts += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      const result = await check(
        Math.min(STAGING_REQUEST_TIMEOUT_MS, remainingMs),
      );
      if (result === true) return { attempts };
    } catch {
      // A read-only readiness probe is safe to repeat until the fixed deadline.
    }
    const remainingAfterCheck = deadline - Date.now();
    if (remainingAfterCheck <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(intervalMs, remainingAfterCheck)),
    );
  } while (Date.now() < deadline);

  throw new Error(
    `Staging did not become ready within ${timeoutMs}ms after ${attempts} read-only checks.`,
  );
}
