import type { StoredStravaConfig, StravaConfigResult } from "./types";

/** Exact public allowlist: diagnostics and saved unavailable URLs never escape. */
export function projectStravaConfig(stored: StoredStravaConfig): StravaConfigResult {
  const embed =
    stored.embedStatus === "available" &&
    stored.embedUrl &&
    stored.embedKind &&
    stored.checkedAt
      ? {
          kind: stored.embedKind,
          embedUrl: stored.embedUrl,
          checkedAt: stored.checkedAt,
        }
      : null;
  return {
    status: "ready",
    config: {
      provider: "strava",
      profileUrl: stored.profileUrl,
      embed,
      embedStatus: embed ? "available" : "unavailable",
      updatedAt: stored.updatedAt,
    },
  };
}
