export type StravaEmbedKind =
  | "profile_feed"
  | "profile_summary"
  | "activity"
  | "route";

export type StravaPublicConfig = {
  provider: "strava";
  profileUrl: string;
  embed: {
    kind: StravaEmbedKind;
    embedUrl: string;
    checkedAt: string;
  } | null;
  embedStatus: "available" | "unavailable";
  updatedAt: string;
};

export type StravaPortableConfig = {
  profileUrl: string;
  embedUrl: string | null;
  embedKind: StravaEmbedKind | null;
};

export type StoredStravaConfig = StravaPortableConfig & {
  embedStatus: "available" | "unavailable";
  checkedAt: string | null;
  updatedAt: string;
  diagnostic?: StravaDiagnostic;
};

export type StravaConfigResult =
  | { status: "ready"; config: StravaPublicConfig }
  | {
      status: "unavailable";
      reason:
        | "database_unavailable"
        | "not_configured"
        | "invalid_config"
        | "visibility_withheld";
    };

export type StravaEmbedValidation =
  | {
      ok: true;
      embedUrl: string;
      kind: StravaEmbedKind;
      inferredProfileUrl: string | null;
    }
  | { ok: false; code: "invalid_embed"; message: string };

export type StravaHealthResult =
  | { status: "available"; checkedAt: string; diagnostic?: StravaDiagnostic }
  | {
      status: "unavailable";
      checkedAt: string;
      reason: "redirected" | "not_frameable" | "provider_error" | "legacy_format" | "invalid_embed";
      diagnostic?: StravaDiagnostic;
    };


export type StravaDiagnostic = {
  schemaVersion: 1;
  result: "headers_permit" | "redirected" | "framing_blocked" | "provider_error" | "legacy_format" | "invalid_embed";
  policy: "csp" | "x-frame-options" | "none";
  httpStatus: number | null;
  visuallyVerified: false;
};
