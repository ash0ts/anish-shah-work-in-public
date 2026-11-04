import { runtimeValue } from "../runtime-env";
import { normalizeStravaEmbed } from "./parser";
import { evaluateStravaFraming } from "./framing";
import type { StravaDiagnostic, StravaHealthResult } from "./types";

const TIMEOUT_MS = 6_000;

export async function verifyStravaEmbed(
  embedUrl: string,
  fetcher: typeof fetch = fetch,
  siteOrigin = runtimeValue("SITE_URL") ?? "https://anish-shah-is.online",
): Promise<StravaHealthResult> {
  const checkedAt = new Date().toISOString();
  const diagnostic = (result: StravaDiagnostic["result"], httpStatus: number | null = null,
    policy: StravaDiagnostic["policy"] = "none"): StravaDiagnostic =>
    ({ schemaVersion: 1, result, policy, httpStatus, visuallyVerified: false });
  // Revalidate even when callers already parsed the setting: no arbitrary URL fetch.
  const parsed = normalizeStravaEmbed(embedUrl);
  if (!parsed.ok) {
    const legacy = /^https:\/\/www\.strava\.com\/activities\/\d+\/embed\//i.test(embedUrl);
    const reason = legacy ? "legacy_format" : "invalid_embed";
    return { status: "unavailable", checkedAt, reason, diagnostic: diagnostic(reason) };
  }
  let response: Response;
  try {
    response = await fetcher(parsed.embedUrl, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "Anish-Shah-personal-site/1.0" },
    });
  } catch {
    return { status: "unavailable", checkedAt, reason: "provider_error", diagnostic: diagnostic("provider_error") };
  }
  // The body is deliberately unread. A cancellation failure cannot change the
  // observed HTTP/header result or trigger another provider request.
  await response.body?.cancel().catch(() => undefined);
  if (response.status >= 300 && response.status < 400) {
    return { status: "unavailable", checkedAt, reason: "redirected", diagnostic: diagnostic("redirected", response.status) };
  }
  if (!response.ok) {
    return { status: "unavailable", checkedAt, reason: "provider_error", diagnostic: diagnostic("provider_error", response.status) };
  }
  const framing = evaluateStravaFraming(response.headers, parsed.embedUrl, siteOrigin);
  if (!framing.permitted) return { status: "unavailable", checkedAt, reason: "not_frameable",
    diagnostic: diagnostic("framing_blocked", response.status, framing.policy) };
  return { status: "available", checkedAt, diagnostic: diagnostic("headers_permit", response.status, framing.policy) };
}
