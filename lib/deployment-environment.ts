import { PUBLIC_SITE_ORIGIN } from "./site-constants";

export const STAGING_SITE_ORIGIN = "https://staging.anish-shah-is.online";
export const PREVIEW_HOST_SUFFIX = ".anish-shah-is.online";

export type HostedDeploymentTier = "preview" | "staging" | "production";

export type DeploymentEnvironmentValues = {
  DEPLOYMENT_TIER?: string;
  PREVIEW_PR_NUMBER?: string;
  SITE_URL?: string;
  PRODUCTION_SITE_URL?: string;
  PUBLIC_CONTENT_MODE?: string;
  RELEASE_VERSION?: string;
};

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function validReleaseVersion(value: string | undefined): boolean {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

function exactHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function hostedDeploymentTier(
  value: string | undefined,
): HostedDeploymentTier | null {
  return value === "preview" || value === "staging" || value === "production"
    ? value
    : null;
}

export function previewOrigin(prNumber: string | number): string | null {
  const normalized = String(prNumber).trim();
  if (!/^[1-9][0-9]{0,6}$/.test(normalized)) return null;
  return `https://pr-${normalized}${PREVIEW_HOST_SUFFIX}`;
}

export function expectedHostedOrigin(
  values: DeploymentEnvironmentValues,
): string | null {
  const tier = hostedDeploymentTier(values.DEPLOYMENT_TIER);
  if (tier === "production") return PUBLIC_SITE_ORIGIN;
  if (tier === "staging") return STAGING_SITE_ORIGIN;
  if (tier === "preview") return previewOrigin(values.PREVIEW_PR_NUMBER ?? "");
  return null;
}

export function hostedEnvironmentConfigured(
  values: DeploymentEnvironmentValues,
): boolean {
  const tier = hostedDeploymentTier(values.DEPLOYMENT_TIER);
  const expected = expectedHostedOrigin(values);
  if (!tier || !expected) return false;
  if (!validReleaseVersion(values.RELEASE_VERSION)) return false;
  if (exactHttpsOrigin(values.SITE_URL) !== expected) return false;
  if (exactHttpsOrigin(values.PRODUCTION_SITE_URL) !== PUBLIC_SITE_ORIGIN) {
    return false;
  }
  if (tier === "preview") {
    return values.PUBLIC_CONTENT_MODE === "static_preview";
  }
  return values.PUBLIC_CONTENT_MODE === "d1_kv_required";
}

export function previewFixtureRuntime(
  values: DeploymentEnvironmentValues,
): boolean {
  return (
    values.DEPLOYMENT_TIER === "preview" &&
    values.PUBLIC_CONTENT_MODE === "static_preview" &&
    hostedEnvironmentConfigured(values)
  );
}

export function metadataTitlePrefix(
  value: string | undefined,
  previewPrNumber?: string,
): string {
  if (value === "staging") return "[Staging] ";
  if (value === "preview") {
    const number = previewPrNumber?.trim();
    return number && /^[1-9][0-9]{0,6}$/.test(number)
      ? `[PR #${number}] `
      : "[Preview] ";
  }
  return "";
}

export function canonicalMetadataOrigin(): string {
  return PUBLIC_SITE_ORIGIN;
}
