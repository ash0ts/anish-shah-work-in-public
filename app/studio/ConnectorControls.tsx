"use client";

import { useEffect, useState } from "react";
import type { ConnectorHealth } from "@/lib/server/connectors/repository";
import styles from "./studio.module.css";

type Environment = "local" | "hosted";

type Props = {
  connector: ConnectorHealth;
  environment: Environment;
  encryptionConfigured: boolean;
  myAnimeListCallbackUrl: string | null;
  spotifyCallbackUrl: string | null;
  steamStorageCountries: string | null;
};

type ApiResult = {
  authorizationUrl?: string;
  callbackUrl?: string;
  code?: string;
  embedUrl?: string;
  error?: string;
  expiresAt?: string;
  itemCount?: number;
  message?: string;
  profileUrl?: string;
  embedStatus?: "available" | "unavailable";
  status?: string;
  updatedAt?: string;
  config?: SpotifyPresentationConfig;
};

type SpotifyPresentationConfig = {
  publishTopTracks: boolean;
  reviewedAt: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
  fallbackEmbed: {
    kind: "track" | "album" | "playlist";
    spotifyId: string;
  } | null;
};

const providerMeta = {
  myanimelist: {
    stream: "Watch",
    title: "MyAnimeList",
    requirement: "Client ID + client secret",
    sources: [
      {
        href: "https://myanimelist.net/apiconfig",
        label: "Open developer portal",
      },
    ],
    summary:
      "Authorize the owner account through MyAnimeList. Studio stores the resulting tokens—not your password—and renews access automatically.",
    recovery:
      "If authorization is denied, start it again. If Studio reports reauthorization required, authorize the stored app again; replace the app credentials only when the registration itself changed.",
  },
  hardcover: {
    stream: "Read",
    title: "Hardcover",
    requirement: "API token",
    sources: [
      {
        href: "https://docs.hardcover.app/api/getting-started/",
        label: "Read API setup",
      },
      {
        href: "https://hardcover.app/account/api",
        label: "Copy account token",
      },
    ],
    summary:
      "Connect the owner library with a personal API token. Studio derives the public profile link from the authenticated account.",
    recovery:
      "Tokens expire after one year and reset on January 1; Hardcover may also reset them during beta. If refresh returns 401, copy a current token, choose Replace credential, and refresh again. For rate limits, wait before retrying.",
  },
  spotify: {
    stream: "Listen",
    title: "Spotify",
    requirement: "Client ID + client secret",
    sources: [
      {
        href: "https://developer.spotify.com/dashboard",
        label: "Open developer dashboard",
      },
      {
        href: "https://developer.spotify.com/documentation/web-api/concepts/redirect_uri",
        label: "Review redirect rules",
      },
      {
        href: "https://developer.spotify.com/documentation/web-api/concepts/quota-modes",
        label: "Review development mode",
      },
    ],
    summary:
      "Authorize the owner account, synchronize Spotify-calculated Top Tracks, then make a separate decision about public display. Rankings are affinity—not play counts.",
    recovery:
      "Development-mode apps require the app owner to keep Spotify Premium and the authorized account on the app allowlist. Spotify refresh tokens expire after six months; when Studio requests reauthorization, authorize again rather than retrying. Replace app credentials only when the registration changed, and respect Retry-After before retrying a rate limit.",
  },
  steam: {
    stream: "Play",
    title: "Steam",
    requirement: "Web API key + SteamID64",
    sources: [
      {
        href: "https://partner.steamgames.com/doc/webapi_overview",
        label: "Read Web API setup",
      },
      {
        href: "https://steamcommunity.com/dev/apikey",
        label: "Register owner key",
      },
      {
        href: "https://help.steampowered.com/en/faqs/view/2816-BE67-5B69-0FEC",
        label: "Find account details",
      },
    ],
    summary:
      "Publish a bounded view of public game details: rounded totals and a short list of recent and top-played games.",
    recovery:
      "If visibility is required, make both Profile and Game details Public, then refresh. A private library is unpublished immediately; a disconnected stream is deleted.",
  },
} as const;

const callbackResultMessages: Record<string, (provider: string) => string> = {
  connected: (provider) =>
    `${provider} authorization is complete. Select Refresh now to verify the connection and create the sanitized snapshot.`,
  denied: (provider) =>
    `${provider} authorization was denied. Nothing was connected; start authorization again when ready.`,
  expired:
    () => "The authorization attempt expired after ten minutes. Start a new authorization.",
  invalid_state:
    () => "The authorization response could not be verified. Start again from this Studio tab.",
  provider_unavailable: (provider) =>
    `${provider} is temporarily unavailable. Wait a few minutes, then start authorization again.`,
  rate_limited: (provider) =>
    `${provider} rate-limited the authorization request. Wait before starting it again.`,
  token_exchange_failed: (provider) =>
    `${provider} did not issue usable tokens. If the app registration changed, check its secret and exact callback; otherwise start again.`,
  setup_required:
    () => "Studio could not finish authorization because encryption or the database is not ready. Resolve the setup notice and try again.",
  forbidden:
    () => "The authorization response was not associated with the allowlisted owner. Sign in with the owner account and start again.",
};

const oauthStartPaths = {
  myanimelist: "/api/studio/connectors/myanimelist/oauth/start",
  spotify: "/api/studio/connectors/spotify/oauth/start",
} as const;

function connectorStatusLabel(
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
  if (connector.status === "never_synced") return "Connected · refresh";
  if (connector.status === "healthy") return "Current";
  if (connector.status === "stale") return "Stale";
  if (connector.status === "syncing") return "Syncing";
  if (connector.status === "visibility_required") return "Visibility required";
  return "Needs attention";
}

function connectorStatusClass(
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

function statusGuidance(
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
        ? " The last successful local snapshot remains available."
        : connector.provider === "steam"
          ? " The latest eligible snapshot remains available for up to 72 hours."
          : " The last successful public snapshot remains available.";

  if (
    connector.status === "reauthorization_required" ||
    connector.lastErrorCode === "credential_expired" ||
    connector.lastErrorCode === "credential_invalid"
  ) {
    return connector.provider === "myanimelist" || connector.provider === "spotify"
      ? connector.canReuseOAuthClient
        ? `Authorize the owner account again, then refresh.${preservedSnapshot}`
        : `This legacy token cannot be renewed automatically. Enter the app client ID and secret, authorize, then refresh.${preservedSnapshot}`
      : `Replace the credential, then refresh.${preservedSnapshot}`;
  }
  if (connector.status === "authorization_required") {
    const provider = connector.provider === "spotify" ? "Spotify" : "MyAnimeList";
    return `Complete the open ${provider} authorization. If that tab was closed, start authorization again.`;
  }
  if (connector.status === "setup_required") {
    return connector.configured
      ? "A release gate is incomplete. Resolve the setup notice before refreshing."
      : connector.provider === "myanimelist" || connector.provider === "spotify"
        ? "Enter the app credentials, then authorize the owner account."
        : "Enter the owner credential, then run the first refresh.";
  }
  if (connector.status === "never_synced") {
    return environment === "local"
      ? "Connected in local D1. Run Refresh now to create the first local sanitized snapshot."
      : connector.provider === "spotify"
        ? "Connected. Run Refresh now to create the first sanitized snapshot; public display remains controlled below."
        : "Connected. Run Refresh now to publish the first sanitized snapshot.";
  }
  if (connector.status === "healthy") {
    return environment === "local"
      ? "The local snapshot is current. It has not been copied to production."
      : connector.provider === "spotify"
        ? "The sanitized snapshot is current. Public display remains controlled below; automatic refreshes are limited to once every 12 hours."
        : "The public snapshot is current. Automatic refreshes are limited to once every 12 hours.";
  }
  if (connector.status === "stale") {
    return `The snapshot is due for refresh.${preservedSnapshot}`;
  }
  if (connector.status === "syncing") {
    return "A refresh is already running. Reload shortly to see its result.";
  }
  if (connector.status === "visibility_required") {
    return "Set both the Steam profile and Game details to Public, then refresh. The previous Steam snapshot is unpublished.";
  }
  if (connector.lastErrorCode === "rate_limited") {
    return `The provider rate-limited the last request. Wait before refreshing again.${preservedSnapshot}`;
  }
  return `The last refresh failed. Try once more; replace or reauthorize only if the error continues.${preservedSnapshot}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not yet synced";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

function spotifyPublicCutoff(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 72 * 60 * 60 * 1000).toISOString()
    : null;
}

function spotifyReauthorizationDate(value: string | null): string | null {
  if (!value) return null;
  const authorized = new Date(value);
  if (Number.isNaN(authorized.valueOf())) return null;
  authorized.setUTCMonth(authorized.getUTCMonth() + 6);
  return authorized.toISOString();
}

async function responseJson(response: Response): Promise<ApiResult> {
  try {
    return (await response.json()) as ApiResult;
  } catch {
    return {};
  }
}

function safeAuthorizationUrl(
  provider: "myanimelist" | "spotify",
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const valid =
      provider === "myanimelist"
        ? url.origin === "https://myanimelist.net" &&
          url.pathname === "/v1/oauth2/authorize"
        : url.origin === "https://accounts.spotify.com" &&
          url.pathname === "/authorize";
    return valid
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function ConnectorControls({
  connector,
  environment,
  encryptionConfigured,
  myAnimeListCallbackUrl,
  spotifyCallbackUrl,
  steamStorageCountries,
}: Props) {
  const meta = providerMeta[connector.provider];
  const isMyAnimeList = connector.provider === "myanimelist";
  const isSpotify = connector.provider === "spotify";
  const isOAuthProvider = isMyAnimeList || isSpotify;
  const oauthProvider = isSpotify ? "spotify" : "myanimelist";
  const oauthProviderTitle = isSpotify ? "Spotify" : "MyAnimeList";
  const [secret, setSecret] = useState("");
  const [clientId, setClientId] = useState("");
  const [steamId, setSteamId] = useState("");
  const [showCredentialForm, setShowCredentialForm] = useState(
    !connector.configured,
  );
  const [pending, setPending] = useState<
    "save" | "authorize" | "refresh" | "disconnect" | "copy" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authorizationDestination, setAuthorizationDestination] = useState<
    string | null
  >(null);
  const connectorBlocked =
    !encryptionConfigured ||
    (isMyAnimeList && !myAnimeListCallbackUrl) ||
    (isSpotify && !spotifyCallbackUrl) ||
    (connector.provider === "steam" && !steamStorageCountries);
  const registeredCallback = isMyAnimeList
    ? myAnimeListCallbackUrl
    : isSpotify
      ? spotifyCallbackUrl
      : null;

  useEffect(() => {
    if (!isOAuthProvider) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("connector") !== oauthProvider) return;
    const result = query.get("result");
    const resultMessageFactory = result ? callbackResultMessages[result] : null;
    const resultMessage = resultMessageFactory
      ? resultMessageFactory(oauthProviderTitle)
      : null;
    const updateTimer = resultMessage
      ? window.setTimeout(() => {
          setMessage(resultMessage);
          setShowCredentialForm(
            result !== "connected" && !connector.configured,
          );
        }, 0)
      : null;
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("connector");
    cleaned.searchParams.delete("result");
    window.history.replaceState({}, "", `${cleaned.pathname}${cleaned.search}`);
    return () => {
      if (updateTimer !== null) window.clearTimeout(updateTimer);
    };
  }, [connector.configured, isOAuthProvider, oauthProvider, oauthProviderTitle]);

  async function copyCallback(): Promise<void> {
    if (!registeredCallback) {
      setMessage("Set SITE_URL to the exact origin and restart Studio first.");
      return;
    }
    setPending("copy");
    try {
      await navigator.clipboard.writeText(registeredCallback);
      setMessage("Callback URL copied.");
    } catch {
      setMessage("Copy was unavailable. Select the callback URL and copy it manually.");
    } finally {
      setPending(null);
    }
  }

  async function authorizeOAuthProvider(reuseStored: boolean): Promise<void> {
    if (!registeredCallback) {
      setMessage("Set SITE_URL to the exact origin and restart Studio first.");
      return;
    }
    if (!reuseStored && (!clientId.trim() || !secret)) {
      setMessage(`Enter both the ${oauthProviderTitle} client ID and client secret.`);
      return;
    }
    setPending("authorize");
    setMessage(null);
    setAuthorizationDestination(null);
    try {
      const response = await fetch(
        oauthStartPaths[oauthProvider],
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            reuseStored
              ? {}
              : { clientId: clientId.trim(), clientSecret: secret },
          ),
        },
      );
      const result = await responseJson(response);
      if (!response.ok) {
        setMessage(
          result.error ??
            `${oauthProviderTitle} authorization could not start (${response.status}).`,
        );
        return;
      }
      if (result.callbackUrl !== registeredCallback) {
        setMessage(
          `Studio expected ${registeredCallback}, but the server reported a different callback. Check SITE_URL before authorizing.`,
        );
        return;
      }
      const destination = safeAuthorizationUrl(
        oauthProvider,
        result.authorizationUrl,
      );
      if (!destination) {
        setMessage(
          "Studio received an invalid authorization destination. Nothing was opened.",
        );
        return;
      }
      setSecret("");
      setAuthorizationDestination(destination);
      setMessage(
        `${oauthProviderTitle} authorization is ready. If it does not open automatically, use Continue to ${oauthProviderTitle} below.`,
      );
      window.location.assign(destination);
    } catch {
      setMessage(`${oauthProviderTitle} authorization could not start. Try again.`);
    } finally {
      setPending(null);
    }
  }

  async function request(
    action: "save" | "refresh" | "disconnect",
  ): Promise<void> {
    const cancellingPendingAuthorization =
      action === "disconnect" &&
      isOAuthProvider &&
      !connector.configured &&
      connector.status === "authorization_required";
    if (
      action === "disconnect" &&
      !window.confirm(
        cancellingPendingAuthorization
          ? `Cancel the pending ${oauthProviderTitle} authorization? Its encrypted, single-use transaction will be deleted${environment === "local" ? " from this local sandbox." : "."}`
          : `Disconnect ${meta.title}? Its encrypted credentials, snapshots, pending authorization, and sync history will be deleted${environment === "local" ? " from this local sandbox." : " and the stream will be unpublished."}`,
      )
    ) {
      return;
    }

    setPending(action);
    setMessage(null);
    const path =
      action === "refresh"
        ? `/api/studio/connectors/${connector.provider}/refresh`
        : `/api/studio/connectors/${connector.provider}/credentials`;

    try {
      const response = await fetch(path, {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers:
          action === "save" ? { "content-type": "application/json" } : undefined,
        body:
          action === "save"
            ? JSON.stringify(
                connector.provider === "steam"
                  ? { apiKey: secret, steamId64: steamId }
                  : { secret },
              )
            : undefined,
      });
      const result = await responseJson(response);
      if (!response.ok) {
        setMessage(result.error ?? `Request failed (${response.status}).`);
        if (action === "refresh") {
          window.setTimeout(() => window.location.reload(), 1_500);
        }
        return;
      }

      setSecret("");
      setSteamId("");
      if (action === "save") setShowCredentialForm(false);
      setMessage(
        action === "save"
          ? environment === "local"
            ? "Credential encrypted in local D1. Run Refresh now to verify it in this sandbox."
            : connector.provider === "spotify"
              ? "Credential encrypted and saved. Run Refresh now to verify it; public display remains controlled separately."
              : "Credential encrypted and saved. Run Refresh now to verify and publish it."
          : action === "disconnect"
            ? cancellingPendingAuthorization
              ? `Pending ${oauthProviderTitle} authorization cancelled.`
              : `${meta.title} disconnected. Its credentials, snapshots, and sync history were deleted${environment === "local" ? " from this sandbox." : "."}`
            : result.status === "already_running"
              ? "A refresh is already running."
              : result.status === "withheld"
                ? result.message ??
                  "Steam game details are not public, so the stream was unpublished."
                : `${environment === "local" ? "Local sync" : "Sync"} complete${typeof result.itemCount === "number" ? ` · ${result.itemCount} items` : ""}.`,
      );
      window.setTimeout(() => window.location.reload(), 1_100);
    } catch {
      setMessage("The request could not be completed. Try again.");
    } finally {
      setPending(null);
    }
  }

  const statusLabel = connectorStatusLabel(connector, connectorBlocked);

  return (
    <section
      className={styles.connectorPanel}
      aria-labelledby={`${connector.provider}-title`}
      data-provider={connector.provider}
    >
      <header className={styles.connectorRail}>
        <p>{meta.stream}</p>
        <h3 id={`${connector.provider}-title`}>{meta.title}</h3>
        <span
          className={`${styles.statusPill} ${connectorStatusClass(connector, connectorBlocked)}`}
        >
          {statusLabel}
        </span>
      </header>

      <div className={styles.connectorMain}>
        <div className={styles.providerLead}>
          <p>{meta.summary}</p>
          <nav aria-label={`${meta.title} setup resources`}>
            {meta.sources.map((source) => (
              <a
                href={source.href}
                rel="noreferrer"
                target="_blank"
                key={source.href}
              >
                {source.label}
              </a>
            ))}
          </nav>
        </div>

        <dl className={styles.connectorFacts}>
          <div>
            <dt>You need</dt>
            <dd>{meta.requirement}</dd>
          </div>
          <div>
            <dt>Last successful sync</dt>
            <dd>{formatTimestamp(connector.lastSyncedAt)}</dd>
          </div>
          <div>
            <dt>
              {environment === "local"
                ? "Local snapshot"
                : isSpotify
                  ? "Sanitized snapshot"
                  : "Published snapshot"}
            </dt>
            <dd>
              {connector.itemCount === null
                ? "None"
                : `${connector.itemCount.toLocaleString()} items`}
            </dd>
          </div>
          <div>
            <dt>Snapshot refresh due</dt>
            <dd>{formatTimestamp(connector.freshUntil)}</dd>
          </div>
          {isOAuthProvider ? (
            <div>
              <dt>Access token refresh</dt>
              <dd>{formatTimestamp(connector.credentialExpiresAt)}</dd>
            </div>
          ) : null}
          {isSpotify ? (
            <>
              <div>
                <dt>Public cutoff</dt>
                <dd>{formatTimestamp(spotifyPublicCutoff(connector.lastSyncedAt))}</dd>
              </div>
              <div>
                <dt>Reauthorize by</dt>
                <dd>{formatTimestamp(spotifyReauthorizationDate(connector.authorizedAt))}</dd>
              </div>
            </>
          ) : null}
        </dl>

        <p className={styles.statusGuidance}>{statusGuidance(
          connector,
          environment,
          encryptionConfigured,
          steamStorageCountries,
        )}</p>

        {isOAuthProvider ? (
          <div className={styles.callbackBlock}>
            <span>Callback URL for this {environment === "local" ? "local client" : "production client"}</span>
            <div>
              <code>{registeredCallback ?? "SITE_URL is not configured"}</code>
              <button
                className={styles.copyButton}
                type="button"
                disabled={pending !== null || !registeredCallback}
                onClick={() => void copyCallback()}
              >
                {pending === "copy" ? "Copying…" : "Copy"}
              </button>
            </div>
            <p>
              Register this exact URL in {oauthProviderTitle}. Use a separate
              application for local and production.
              {isSpotify && environment === "local"
                ? " Spotify rejects localhost redirects, so this callback uses the explicit 127.0.0.1 loopback address."
                : ""}
            </p>
          </div>
        ) : null}

        {showCredentialForm ? (
          <form
            className={styles.credentialForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (isOAuthProvider) void authorizeOAuthProvider(false);
              else void request("save");
            }}
          >
            {isOAuthProvider ? (
              <div className={styles.fieldPair}>
                <label className={styles.formField} htmlFor={`${oauthProvider}-client-id`}>
                  <span>Client ID</span>
                  <input
                    id={`${oauthProvider}-client-id`}
                    type="text"
                    value={clientId}
                    minLength={8}
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder={`From ${oauthProviderTitle} developer settings`}
                    required
                  />
                </label>
                <label className={styles.formField} htmlFor={`${oauthProvider}-client-secret`}>
                  <span>Client secret</span>
                  <input
                    id={`${oauthProvider}-client-secret`}
                    type="password"
                    value={secret}
                    minLength={8}
                    maxLength={2048}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="Stored encrypted; never shown again"
                    required
                  />
                </label>
              </div>
            ) : connector.provider === "steam" ? (
              <div className={styles.fieldPair}>
                <label className={styles.formField} htmlFor="steam-id">
                  <span>SteamID64</span>
                  <input
                    id="steam-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{17}"
                    value={steamId}
                    minLength={17}
                    maxLength={17}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setSteamId(event.target.value)}
                    placeholder="17 digits"
                    required
                  />
                </label>
                <label className={styles.formField} htmlFor="steam-secret">
                  <span>Web API key</span>
                  <input
                    id="steam-secret"
                    type="password"
                    value={secret}
                    minLength={32}
                    maxLength={32}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="32-character owner key"
                    required
                  />
                </label>
              </div>
            ) : (
              <label className={styles.formField} htmlFor="hardcover-secret">
                <span>API token · Bearer optional</span>
                <input
                  id="hardcover-secret"
                  type="password"
                  value={secret}
                  minLength={8}
                  maxLength={8192}
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="Stored encrypted; never shown again"
                  required
                />
              </label>
            )}

            <div className={styles.formActions}>
              <button
                type="submit"
                disabled={pending !== null || connectorBlocked}
              >
                {pending === "authorize"
                  ? "Opening authorization…"
                  : pending === "save"
                    ? "Saving…"
                    : isOAuthProvider
                      ? `Authorize with ${oauthProviderTitle}`
                      : connector.configured
                        ? "Replace credential"
                        : "Connect"}
              </button>
              {connector.configured ? (
                <button
                  className={styles.textButton}
                  disabled={pending !== null}
                  onClick={() => {
                    setSecret("");
                    setClientId("");
                    setSteamId("");
                    setShowCredentialForm(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              ) : null}
              {isOAuthProvider &&
              !connector.configured &&
              connector.status === "authorization_required" ? (
                <button
                  className={styles.textButton}
                  disabled={pending !== null}
                  onClick={() => void request("disconnect")}
                  type="button"
                >
                  {pending === "disconnect"
                    ? "Cancelling…"
                    : "Cancel pending authorization"}
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className={styles.actionRow}>
            <button
              type="button"
              disabled={pending !== null || connectorBlocked}
              onClick={() => void request("refresh")}
            >
              {pending === "refresh" ? "Refreshing…" : "Refresh now"}
            </button>
            {isOAuthProvider && connector.canReuseOAuthClient ? (
              <button
                className={styles.quietButton}
                type="button"
                disabled={pending !== null || connectorBlocked}
                onClick={() => void authorizeOAuthProvider(true)}
              >
                {pending === "authorize" ? "Opening…" : "Authorize again"}
              </button>
            ) : null}
            <button
              className={styles.quietButton}
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setMessage(null);
                setShowCredentialForm(true);
              }}
            >
              {isOAuthProvider ? "Replace app credentials" : "Replace credential"}
            </button>
            <button
              className={styles.quietButton}
              type="button"
              disabled={pending !== null}
              onClick={() => void request("disconnect")}
            >
              {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}

        <p className={styles.recoveryText}>
          <strong>If it needs attention</strong>
          {meta.recovery}
        </p>

        {isSpotify ? (
          <SpotifyPresentationControls
            configured={connector.configured}
            environment={environment}
          />
        ) : null}

        {message ? (
          <p className={styles.formMessage} role="status">
            {message}
          </p>
        ) : null}
        {authorizationDestination ? (
          <a
            className={styles.authorizationLink}
            href={authorizationDestination}
            rel="noreferrer"
          >
            Continue to {oauthProviderTitle}
          </a>
        ) : null}
      </div>
    </section>
  );
}

type SpotifyConfigState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; config: SpotifyPresentationConfig };

function spotifyFallbackUrl(
  fallback: SpotifyPresentationConfig["fallbackEmbed"],
): string {
  return fallback
    ? `https://open.spotify.com/${fallback.kind}/${fallback.spotifyId}`
    : "";
}

function SpotifyPresentationControls({
  configured,
  environment,
}: {
  configured: boolean;
  environment: Environment;
}) {
  const [state, setState] = useState<SpotifyConfigState>({ phase: "loading" });
  const [publishTopTracks, setPublishTopTracks] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [fallbackEmbed, setFallbackEmbed] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/studio/connectors/spotify/config", { cache: "no-store" })
      .then(async (response) => {
        const result = await responseJson(response);
        if (!active) return;
        if (response.ok && result.config) {
          setState({ phase: "ready", config: result.config });
          setPublishTopTracks(result.config.publishTopTracks);
          setFallbackEmbed(spotifyFallbackUrl(result.config.fallbackEmbed));
          return;
        }
        setState({
          phase: "error",
          message:
            result.error ??
            "Spotify display settings could not be checked. Reload Studio and try again.",
        });
      })
      .catch(() => {
        if (active) {
          setState({
            phase: "error",
            message:
              "Spotify display settings could not be checked. Reload Studio and try again.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (publishTopTracks && !configured) {
      setMessage("Authorize and refresh Spotify before publishing Top Tracks.");
      return;
    }
    if (publishTopTracks && !acknowledged) {
      setMessage("Acknowledge the public-display qualification before publishing.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/spotify/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publishTopTracks,
          fallbackEmbed: fallbackEmbed.trim() || null,
          acknowledgePublicDisplay: publishTopTracks ? acknowledged : false,
        }),
      });
      const result = await responseJson(response);
      if (!response.ok || !result.config) {
        setMessage(
          result.error ??
            "Use an official open.spotify.com track, album, or playlist URL, then try again.",
        );
        return;
      }
      setState({ phase: "ready", config: result.config });
      setPublishTopTracks(result.config.publishTopTracks);
      setFallbackEmbed(spotifyFallbackUrl(result.config.fallbackEmbed));
      setAcknowledged(false);
      setMessage(
        result.config.publishTopTracks
          ? environment === "local"
            ? "Top Tracks enabled in the local sandbox only. Production still requires separate authorization and review."
            : "Top Tracks published with the affinity qualification."
          : result.config.fallbackEmbed
            ? "Top Tracks are private. The official Spotify fallback is available after visitor consent."
            : "Spotify public display is off.",
      );
    } catch {
      setMessage("Spotify display settings could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  const config = state.phase === "ready" ? state.config : null;

  return (
    <section className={styles.spotifyPublication} aria-labelledby="spotify-display-title">
      <div className={styles.spotifyPublicationLead}>
        <div>
          <p className={styles.spotifyPublicationLabel}>Public display</p>
          <h4 id="spotify-display-title">Choose what leaves Studio.</h4>
        </div>
        {config ? (
          <dl>
            <div>
              <dt>Top Tracks</dt>
              <dd>{config.publishTopTracks ? "Published" : "Private"}</dd>
            </div>
            <div>
              <dt>Last review</dt>
              <dd>{formatTimestamp(config.reviewedAt)}</dd>
            </div>
            <div>
              <dt>Fallback</dt>
              <dd>{config.fallbackEmbed ? `Official ${config.fallbackEmbed.kind}` : "None"}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {state.phase === "loading" ? (
        <p className={styles.configStatus} role="status">Checking display settings…</p>
      ) : state.phase === "error" ? (
        <p className={styles.configStatus} role="alert">{state.message}</p>
      ) : (
        <form
          className={styles.spotifyPublicationForm}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className={styles.publicationSwitch}>
            <input
              type="checkbox"
              checked={publishTopTracks}
              disabled={pending}
              onChange={(event) => {
                setPublishTopTracks(event.target.checked);
                setAcknowledged(false);
              }}
            />
            <span>
              <strong>Publish Top Tracks publicly</strong>
              <small>
                Show up to twelve Spotify-calculated affinity ranks per time
                window. This is not play-count or listening-history data.
              </small>
            </span>
          </label>

          {publishTopTracks ? (
            <label className={styles.publicationAcknowledgement}>
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={pending}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I reviewed this public display and will describe it as Spotify
                affinity—not plays, minutes, popularity, or a listener profile.
              </span>
            </label>
          ) : null}

          <label className={styles.formField} htmlFor="spotify-fallback">
            <span>Official fallback (optional)</span>
            <input
              id="spotify-fallback"
              type="text"
              inputMode="url"
              value={fallbackEmbed}
              maxLength={2048}
              disabled={pending}
              spellCheck={false}
              onChange={(event) => setFallbackEmbed(event.target.value)}
              placeholder="https://open.spotify.com/playlist/…"
            />
          </label>
          <p className={styles.fieldHelp}>
            Accepts an official Spotify track, album, or playlist URL or Embed.
            Visitors load it only after consent. Spotify controls playback
            availability and length.
          </p>

          <div className={styles.formActions}>
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Spotify display"}
            </button>
          </div>
        </form>
      )}

      {message ? (
        <p className={styles.formMessage} role="status">{message}</p>
      ) : null}
      <p className={styles.spotifyIsolationNote}>
        {environment === "local"
          ? "Local authorization, snapshots, fallback, and publication choice stay on this machine. None are included in the production handoff."
          : "This production decision is independent of local Studio and can be revoked without disconnecting the app."}
      </p>
    </section>
  );
}

type StravaState =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      profileUrl: string;
      embedUrl: string | null;
      embedStatus: "available" | "unavailable";
      updatedAt: string | null;
    };

export function StravaConnectorControls({
  environment,
}: {
  environment: Environment;
}) {
  const [state, setState] = useState<StravaState>({ phase: "loading" });
  const [profileUrl, setProfileUrl] = useState("");
  const [embed, setEmbed] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<"save" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/studio/connectors/strava/config", { cache: "no-store" })
      .then(async (response) => {
        const result = (await responseJson(response)) as ApiResult & {
          payload?: {
            profileUrl?: string;
            embedUrl?: string | null;
            embedStatus?: "available" | "unavailable";
            updatedAt?: string;
          };
        };
        if (!active) return;
        if (response.ok && result.payload?.profileUrl) {
          setState({
            phase: "ready",
            profileUrl: result.payload.profileUrl,
            embedUrl: result.payload.embedUrl ?? null,
            embedStatus: result.payload.embedStatus ?? "unavailable",
            updatedAt: result.payload.updatedAt ?? null,
          });
          setProfileUrl(result.payload.profileUrl);
          setEmbed(result.payload.embedUrl ?? "");
          setShowForm(false);
        } else if (response.ok && result.status === "unavailable") {
          setState({ phase: "unavailable" });
          setShowForm(true);
        } else {
          setState({
            phase: "error",
            message:
              result.error ??
              "Strava configuration could not be checked. Reload and try again.",
          });
          setShowForm(true);
        }
      })
      .catch(() => {
        if (active) {
          setState({
            phase: "error",
            message:
              "Strava configuration could not be checked. Reload and try again.",
          });
          setShowForm(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (!profileUrl.trim()) {
      setMessage(
        "Enter the public Strava athlete profile URL. The cumulative feed is optional.",
      );
      return;
    }
    setPending("save");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/strava/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileUrl, embed }),
      });
      const result = await responseJson(response);
      if (!response.ok || result.status !== "saved" || !result.profileUrl) {
        setMessage(
          result.error ??
            "Enter the public athlete profile and, optionally, the complete iframe generated by Strava.",
        );
        return;
      }
      setState({
        phase: "ready",
        profileUrl: String(result.profileUrl),
        embedUrl:
          typeof result.embedUrl === "string" ? result.embedUrl : null,
        embedStatus:
          result.embedStatus === "available" ? "available" : "unavailable",
        updatedAt: result.updatedAt ?? null,
      });
      setEmbed(typeof result.embedUrl === "string" ? result.embedUrl : "");
      setShowForm(false);
      setMessage(
        environment === "local"
          ? "Strava settings saved in local D1. Play uses the cumulative feed when it passes the anonymous frame check, otherwise the profile link."
          : "Strava settings published. The cumulative feed appears only when it passes the anonymous frame check.",
      );
    } catch {
      setMessage("The Strava embed could not be saved. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    if (
      !window.confirm(
        `Disconnect Strava? The embed configuration and related history will be deleted${environment === "local" ? " from this local sandbox." : " and the Move stream will be unpublished."}`,
      )
    ) {
      return;
    }
    setPending("disconnect");
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/strava/config", {
        method: "DELETE",
      });
      const result = await responseJson(response);
      if (!response.ok) {
        setMessage(result.error ?? `Request failed (${response.status}).`);
        return;
      }
      setState({ phase: "unavailable" });
      setShowForm(true);
      setMessage("Strava disconnected and unpublished.");
    } catch {
      setMessage("Strava could not be disconnected. Try again.");
    } finally {
      setPending(null);
    }
  }

  const status =
    state.phase === "loading"
      ? "Checking…"
      : state.phase === "ready"
        ? state.embedStatus === "available"
          ? "Current"
          : "Profile fallback"
        : state.phase === "error"
          ? "Needs attention"
          : "Not configured";

  return (
    <section
      className={styles.connectorPanel}
      aria-labelledby="strava-title"
      data-provider="strava"
    >
      <header className={styles.connectorRail}>
        <p>Move</p>
        <h3 id="strava-title">Strava</h3>
        <span
          className={`${styles.statusPill} ${
            state.phase === "ready"
              ? styles.status_healthy
              : state.phase === "error"
                ? styles.status_error
                : styles.status_setup_required
          }`}
        >
          {status}
        </span>
      </header>
      <div className={styles.connectorMain}>
        <div className={styles.providerLead}>
          <p>
            Publish the athlete profile and, when Strava provides it, the
            generated recent-activity feed or weekly summary. The profile link
            remains available whenever anonymous framing fails.
          </p>
          <nav aria-label="Strava setup resources">
            <a
              href="https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed"
              rel="noreferrer"
              target="_blank"
            >
              Open embed guide
            </a>
            <a
              href="https://support.strava.com/en-us/articles/15401987-activity-privacy-controls"
              rel="noreferrer"
              target="_blank"
            >
              Activity privacy
            </a>
          </nav>
        </div>

        <dl className={styles.connectorFacts}>
          <div>
            <dt>You need</dt>
            <dd>Public athlete URL; cumulative iframe optional</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>
              {state.phase === "ready"
                ? formatTimestamp(state.updatedAt)
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt>Visitor loading</dt>
            <dd>Consent required</dd>
          </div>
        </dl>

        {state.phase === "ready" && state.embedStatus === "available" ? (
          <p className={styles.statusGuidance}>
            The cumulative Move feed passed the anonymous frame check. Its
            iframe remains blocked until a visitor chooses to load it.
          </p>
        ) : state.phase === "ready" ? (
          <p className={styles.statusGuidance}>
            The Move stream uses the public profile link because the saved
            widget redirected, rejected framing, or was omitted.
          </p>
        ) : state.phase === "error" ? (
          <p className={styles.statusGuidance}>{state.message}</p>
        ) : (
          <p className={styles.statusGuidance}>
            Add the public athlete URL. A generated profile feed or weekly
            summary iframe is optional; no Strava API token is used.
          </p>
        )}

        {state.phase === "ready" ? (
          <div className={styles.currentConfig}>
            <span>Stored public profile</span>
            <code>{state.profileUrl}</code>
            {state.embedUrl ? <code>{state.embedUrl}</code> : null}
          </div>
        ) : null}

        {showForm && state.phase !== "loading" ? (
          <form
            className={styles.credentialForm}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className={styles.formField} htmlFor="strava-profile">
              <span>Public athlete profile</span>
              <input
                id="strava-profile"
                value={profileUrl}
                maxLength={2048}
                inputMode="url"
                spellCheck={false}
                onChange={(event) => setProfileUrl(event.target.value)}
                placeholder="https://www.strava.com/athletes/37597587"
                required
              />
            </label>
            <label className={styles.formField} htmlFor="strava-embed">
              <span>Cumulative feed or summary iframe (optional)</span>
              <textarea
                id="strava-embed"
                value={embed}
                maxLength={8192}
                rows={3}
                spellCheck={false}
                onChange={(event) => setEmbed(event.target.value)}
                placeholder={'<iframe src="https://www.strava.com/athletes/…/latest-rides/…"></iframe>'}
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" disabled={pending !== null}>
                {pending === "save"
                  ? "Checking and saving…"
                  : "Save Strava settings"}
              </button>
              {state.phase === "ready" ? (
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setEmbed("");
                    setProfileUrl(state.profileUrl);
                    setShowForm(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : state.phase === "ready" ? (
          <div className={styles.actionRow}>
            <button
              className={styles.quietButton}
              type="button"
              disabled={pending !== null}
              onClick={() => {
                setMessage(null);
                setProfileUrl(state.profileUrl);
                setEmbed(state.embedUrl ?? "");
                setShowForm(true);
              }}
            >
              Replace settings
            </button>
            <button
              className={styles.quietButton}
              type="button"
              disabled={pending !== null}
              onClick={() => void disconnect()}
            >
              {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : null}

        <p className={styles.recoveryText}>
          <strong>Use only Strava-generated values</strong>
          Copy the athlete profile URL. If Strava offers a recent-activity feed
          or weekly-summary embed, paste the complete iframe too. Studio stores
          the exact tokenized widget URL, checks it anonymously without following
          redirects, and publishes it only when framing is allowed. A failed
          widget stays available for owner recovery while visitors receive the
          profile link. Private-share parameters, credentials, and unrelated
          hosts are rejected.
        </p>

        {message ? (
          <p className={styles.formMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
