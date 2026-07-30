import { validatePublicProjection } from "../editorial-policy";
import type { ConnectorProvider } from "./types";

const PROFILE_POLICIES: Record<
  ConnectorProvider,
  { hosts: ReadonlySet<string>; path: RegExp }
> = {
  myanimelist: {
    hosts: new Set(["myanimelist.net", "www.myanimelist.net"]),
    path: /^\/profile\/[a-z0-9_-]{1,64}\/?$/i,
  },
  hardcover: {
    hosts: new Set(["hardcover.app", "www.hardcover.app"]),
    path: /^\/@[a-z0-9_-]{1,64}\/?$/i,
  },
  steam: {
    hosts: new Set(["steamcommunity.com", "www.steamcommunity.com"]),
    path: /^\/profiles\/\d{17}\/?$/,
  },
};

const FORBIDDEN_CREDENTIAL_FIELDS = new Set([
  "apikey",
  "authorization",
  "ciphertext",
  "credential",
  "iv",
  "key",
  "password",
  "refreshtoken",
  "secret",
  "steamid",
  "steamid64",
  "token",
  "accesstoken",
]);

export function normalizeConnectorProfileUrl(
  provider: ConnectorProvider,
  value: string | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const policy = PROFILE_POLICIES[provider];
  if (
    url.protocol !== "https:" ||
    !policy.hosts.has(url.hostname.toLocaleLowerCase()) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !policy.path.test(url.pathname)
  ) {
    return null;
  }

  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function hasForbiddenCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasForbiddenCredentialField);
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      FORBIDDEN_CREDENTIAL_FIELDS.has(
        key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase(),
      ) || hasForbiddenCredentialField(child),
  );
}

function hasUnexpectedUrlField(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlField(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => {
      const childPath = `${path}.${key}`;
      if (/url$|uri$|image$/i.test(key)) {
        return !(
          path === "payload" &&
          key === "profileUrl" &&
          (child === null ||
            (typeof child === "string" &&
              normalizeConnectorProfileUrl(provider, child) === child))
        );
      }
      return hasUnexpectedUrlField(child, provider, childPath);
    },
  );
}

function hasUnexpectedUrlText(
  value: unknown,
  provider: ConnectorProvider,
  path = "payload",
): boolean {
  if (typeof value === "string") {
    if (!/(?:https?|file):\/\//i.test(value)) return false;
    return !(
      path === "payload.profileUrl" &&
      normalizeConnectorProfileUrl(provider, value) === value
    );
  }
  if (Array.isArray(value)) {
    return value.some((child, index) =>
      hasUnexpectedUrlText(child, provider, `${path}[${index}]`),
    );
  }
  if (typeof value !== "object" || value === null) return false;

  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    hasUnexpectedUrlText(child, provider, `${path}.${key}`),
  );
}

export function validateConnectorPublicPayload(
  provider: ConnectorProvider,
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    payload.provider === provider &&
    Object.hasOwn(payload, "profileUrl") &&
    (payload.profileUrl === null ||
      (typeof payload.profileUrl === "string" &&
        normalizeConnectorProfileUrl(provider, payload.profileUrl) ===
          payload.profileUrl)) &&
    !hasForbiddenCredentialField(payload) &&
    !hasUnexpectedUrlField(payload, provider) &&
    !hasUnexpectedUrlText(payload, provider) &&
    validatePublicProjection(payload, `connector:${provider}`).ok
  );
}

export function parseStoredConnectorPublicPayload(
  provider: ConnectorProvider,
  value: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return validateConnectorPublicPayload(provider, parsed) ? parsed : null;
  } catch {
    return null;
  }
}
