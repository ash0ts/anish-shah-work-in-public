import type { ConnectorHealth } from "@/lib/server/connectors/repository";
import styles from "../studio.module.css";
import type {
  ApiResult,
  Environment,
  OAuthProvider,
} from "./model";

export const callbackResultMessages: Record<
  string,
  (provider: string) => string
> = {
  connected: (provider) =>
    `${provider} authorization is complete. Select Refresh now to verify the connection and create the sanitized snapshot.`,
  denied: (provider) =>
    `${provider} authorization was denied. Nothing was connected; start authorization again when ready.`,
  expired: () =>
    "The authorization attempt expired after ten minutes. Start a new authorization.",
  invalid_state: () =>
    "The authorization response could not be verified. Start again from this Studio tab.",
  provider_unavailable: (provider) =>
    `${provider} is temporarily unavailable. Wait a few minutes, then start authorization again.`,
  rate_limited: (provider) =>
    `${provider} rate-limited the authorization request. Wait before starting it again.`,
  reauthorization_required: (provider) =>
    `${provider} rejected the prior authorization. Start authorization again with the owner account.`,
  token_exchange_failed: (provider) =>
    `${provider} did not issue usable tokens. If the app registration changed, check its secret and exact callback; otherwise start again.`,
  setup_required: () =>
    "Studio could not finish authorization because encryption or the database is not ready. Resolve the setup notice and try again.",
  forbidden: () =>
    "The authorization response was not associated with the allowlisted owner. Sign in with the owner account and start again.",
};

export function connectorStatusLabel(
  connector: ConnectorHealth,
  blocked: boolean,
): string {
  if (blocked) return "Setup required";
  if (
    connector.status === "reauthorization_required" ||
    connector.lastErrorCode === "credential_expired" ||
    connector.lastErrorCode === "credential_invalid"
  ) {
    return "Reauthorization required";
  }
  if (connector.status === "authorization_required") {
    return "Authorization required";
  }
  if (connector.status === "setup_required") {
    return connector.configured ? "Setup required" : "Not configured";
  }
  if (connector.status === "never_synced") return "Connected · Refresh required";
  if (connector.status === "healthy") return "Current";
  if (connector.status === "stale") return "Stale";
  if (connector.status === "syncing") return "Syncing";
  if (connector.status === "visibility_required") return "Visibility required";
  return "Needs attention";
}

export function connectorStatusClass(
  connector: ConnectorHealth,
  blocked: boolean,
): string {
  if (blocked) return styles.status_setup_required;
  if (
    connector.status === "reauthorization_required" ||
    connector.lastErrorCode === "credential_expired" ||
    connector.lastErrorCode === "credential_invalid"
  ) {
    return styles.status_error;
  }
  return styles[`status_${connector.status}`] ?? styles.status_setup_required;
}

function isOwnerOAuthProvider(connector: ConnectorHealth): boolean {
  return (
    connector.provider === "myanimelist" ||
    connector.provider === "spotify" ||
    connector.provider === "discogs"
  );
}

function providerTitle(connector: ConnectorHealth): string {
  if (connector.provider === "spotify") return "Spotify";
  if (connector.provider === "discogs") return "Discogs";
  return "MyAnimeList";
}

export function statusGuidance(
  connector: ConnectorHealth,
  environment: Environment,
  encryptionConfigured: boolean,
  steamStorageCountries: string | null,
): string {
  if (!encryptionConfigured) {
    return environment === "local"
      ? "Add a local-only CONNECTOR_ENCRYPTION_KEY to .env.local, then restart npm run dev:studio."
      : "Configure CONNECTOR_ENCRYPTION_KEY before connecting or refreshing.";
  }
  if (connector.provider === "steam" && !steamStorageCountries) {
    return environment === "local"
      ? "Set STEAM_DATA_STORAGE_COUNTRIES=United States in .env.local, then restart Studio."
      : "Publish the truthful Steam storage-country disclosure before connecting.";
  }

  const preservedSnapshot =
    connector.itemCount === null
      ? ""
      : environment === "local"
        ? " Any previously accepted local snapshot remains unchanged."
        : " Any previously accepted public snapshot remains unchanged.";

  if (connector.lastErrorCode === "account_changed") {
    return "The authorized provider account changed. Data from the prior account was withheld. Save publication approval for this account, then refresh again.";
  }

  if (
    connector.status === "reauthorization_required" ||
    connector.lastErrorCode === "credential_expired" ||
    connector.lastErrorCode === "credential_invalid"
  ) {
    return isOwnerOAuthProvider(connector)
      ? connector.canReuseOAuthClient
        ? `Authorize the owner account again, then refresh.${preservedSnapshot}`
        : connector.provider === "discogs"
          ? `Enter the consumer key and secret, authorize, then refresh.${preservedSnapshot}`
          : `This legacy token cannot be renewed automatically. Enter the app client ID and secret, authorize, then refresh.${preservedSnapshot}`
      : `Replace the credential, then refresh.${preservedSnapshot}`;
  }
  if (connector.status === "authorization_required") {
    const provider = providerTitle(connector);
    return `Complete the open ${provider} authorization. If that tab was closed, start authorization again.`;
  }
  if (connector.status === "setup_required") {
    return connector.configured
      ? "A release gate is incomplete. Resolve the setup notice before refreshing."
      : isOwnerOAuthProvider(connector)
        ? "Enter the app credentials, then authorize the owner account."
        : "Enter the owner credential, then run the first refresh.";
  }
  if (connector.status === "never_synced") {
    return environment === "local"
      ? "Connected in local D1. Run Refresh now to create the first local sanitized snapshot."
      : connector.provider === "spotify" || connector.provider === "discogs"
        ? "Connected. Run Refresh now to create the first sanitized snapshot; public display remains controlled below."
        : "Connected. Run Refresh now to publish the first sanitized snapshot.";
  }
  if (connector.status === "healthy") {
    return environment === "local"
      ? "The local snapshot is current. It has not been copied to production; future collection refreshes run only when you select Refresh now."
      : connector.provider === "spotify"
        ? "The sanitized snapshot is current. Public display remains controlled below; collection refreshes run only when you select Refresh now."
        : connector.provider === "discogs"
          ? "The sanitized catalog is current. Public display remains controlled below; manual refresh becomes available after four hours."
        : "The public snapshot is current. Collection refreshes run only when you select Refresh now.";
  }
  if (connector.status === "stale") {
    return `The snapshot is due for refresh.${preservedSnapshot}`;
  }
  if (connector.status === "syncing") {
    return "A refresh is already running. Check this panel again in a moment.";
  }
  if (connector.status === "visibility_required") {
    return "Set both the Steam profile and Game details to Public, then refresh. The previous Steam snapshot is unpublished.";
  }
  if (connector.lastErrorCode === "public_payload_rejected") {
    return "The provider responded, but no new snapshot passed public validation. Do not replace the credential; any previously accepted snapshot remains unchanged.";
  }
  if (connector.lastErrorCode === "rate_limited") {
    return connector.retryNotBefore
      ? `The provider rate-limited the last request. Refresh becomes available after ${formatTimestamp(connector.retryNotBefore)}.${preservedSnapshot}`
      : `The provider rate-limited the last request. Wait before refreshing again.${preservedSnapshot}`;
  }
  return "The last refresh failed. No new snapshot was published; any previously accepted snapshot remains unchanged.";
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Not yet synced";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

export function spotifyReauthorizationDate(value: string | null): string | null {
  if (!value) return null;
  const authorized = new Date(value);
  if (Number.isNaN(authorized.valueOf())) return null;
  authorized.setUTCMonth(authorized.getUTCMonth() + 6);
  return authorized.toISOString();
}

export async function responseJson(response: Response): Promise<ApiResult> {
  try {
    return (await response.json()) as ApiResult;
  } catch {
    return {};
  }
}

export function safeAuthorizationUrl(
  provider: OAuthProvider,
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const valid = (() => {
      if (url.username || url.password || url.hash) return false;
      if (provider === "myanimelist") {
        return (
          url.origin === "https://myanimelist.net" &&
          url.pathname === "/v1/oauth2/authorize"
        );
      }
      if (provider === "spotify") {
        return (
          url.origin === "https://accounts.spotify.com" &&
          url.pathname === "/authorize"
        );
      }
      return (
        url.origin === "https://www.discogs.com" &&
        url.pathname === "/oauth/authorize" &&
        url.searchParams.size === 1 &&
        url.searchParams.getAll("oauth_token").length === 1 &&
        /^[^\s\u0000-\u001f\u007f]{1,8192}$/.test(
          url.searchParams.get("oauth_token") ?? "",
        )
      );
    })();
    return valid ? url.toString() : null;
  } catch {
    return null;
  }
}
