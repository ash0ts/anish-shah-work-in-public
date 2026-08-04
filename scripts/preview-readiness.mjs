import { pathToFileURL } from "node:url";

const previewHostname = /^pr-[1-9]\d*\.anish-shah-is\.online$/;

function validatedOrigin(value) {
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !previewHostname.test(origin.hostname)
  ) {
    throw new Error("PREVIEW_ORIGIN must be an exact HTTPS PR-preview origin.");
  }
  return origin;
}

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export async function waitForPreviewReadiness({
  origin,
  accessClientId,
  accessClientSecret,
  timeoutMs = 90_000,
  attemptTimeoutMs = 8_000,
  fetcher = fetch,
  now = Date.now,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}) {
  const base = validatedOrigin(origin);
  if (!accessClientId || !accessClientSecret) {
    throw new Error("Preview Access service credentials are required.");
  }
  const boundedTimeout = positiveInteger(timeoutMs, 90_000, "timeoutMs");
  const boundedAttemptTimeout = positiveInteger(
    attemptTimeoutMs,
    8_000,
    "attemptTimeoutMs",
  );
  const startedAt = now();
  const deadline = startedAt + boundedTimeout;
  let attempts = 0;

  while (now() < deadline) {
    attempts += 1;
    const remaining = deadline - now();
    const requestTimeout = Math.max(
      1,
      Math.min(boundedAttemptTimeout, remaining),
    );
    try {
      const response = await fetcher(new URL("/play", base), {
        headers: {
          "CF-Access-Client-Id": accessClientId,
          "CF-Access-Client-Secret": accessClientSecret,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeout),
      });
      await response.body?.cancel();
      const robots = response.headers.get("x-robots-tag") ?? "";
      if (
        response.status === 200 &&
        /(?:^|[,;\s])noindex(?:$|[,;\s])/i.test(robots) &&
        response.headers.get("cache-control") === "private, no-store"
      ) {
        return { attempts, elapsedMs: now() - startedAt };
      }
    } catch {
      // DNS, TLS, Access, and the Worker become ready independently.
    }

    const delay = Math.min(3_000, Math.max(0, deadline - now()));
    if (delay > 0) await wait(delay);
  }

  throw new Error(
    `Preview did not become DNS-, TLS-, Access-, and application-ready within ${boundedTimeout}ms.`,
  );
}

async function main() {
  const result = await waitForPreviewReadiness({
    origin: process.env.PREVIEW_ORIGIN ?? "",
    accessClientId: process.env.ACCESS_CLIENT_ID ?? "",
    accessClientSecret: process.env.ACCESS_CLIENT_SECRET ?? "",
    timeoutMs: positiveInteger(
      process.env.PREVIEW_READINESS_TIMEOUT_MS,
      90_000,
      "PREVIEW_READINESS_TIMEOUT_MS",
    ),
  });
  console.log(
    JSON.stringify({
      status: "ready",
      attempts: result.attempts,
      elapsedMs: result.elapsedMs,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Preview readiness failed.");
    process.exitCode = 1;
  });
}
