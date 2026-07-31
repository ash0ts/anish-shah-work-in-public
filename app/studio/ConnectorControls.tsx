"use client";

import { useEffect, useState } from "react";
import type { ConnectorHealth } from "@/lib/server/connectors/repository";
import styles from "./studio.module.css";

type Environment = "local" | "hosted";

type Props = {
  connector: ConnectorHealth;
  environment: Environment;
  encryptionConfigured: boolean;
  steamStorageCountries: string | null;
};

type ApiResult = {
  authorizationUrl?: string;
  callbackUrl?: string;
  embedUrl?: string;
  error?: string;
  expiresAt?: string;
  itemCount?: number;
  message?: string;
  status?: string;
  updatedAt?: string;
};

const productionOrigin =
  "https://anish-shah-work-in-public.coreweave-en-7694.chatgpt.site";

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

const callbackResultMessages: Record<string, string> = {
  connected:
    "MyAnimeList authorization is complete. Select Refresh now to verify the connection and create the sanitized snapshot.",
  denied:
    "MyAnimeList authorization was denied. Nothing was connected; start authorization again when ready.",
  expired:
    "The authorization attempt expired after ten minutes. Start a new authorization.",
  invalid_state:
    "The authorization response could not be verified. Start again from this Studio tab.",
  provider_unavailable:
    "MyAnimeList is temporarily unavailable. Wait a few minutes, then start authorization again.",
  rate_limited:
    "MyAnimeList rate-limited the authorization request. Wait before starting it again.",
  token_exchange_failed:
    "MyAnimeList did not issue usable tokens. If the app registration changed, check its secret and exact callback; otherwise start again.",
  setup_required:
    "Studio could not finish authorization because encryption or the database is not ready. Resolve the setup notice and try again.",
  forbidden:
    "The authorization response was not associated with the allowlisted owner. Sign in with the owner account and start again.",
};

function callbackUrl(environment: Environment): string {
  const origin =
    environment === "local" ? "http://localhost:3000" : productionOrigin;
  return `${origin}/api/connectors/myanimelist/oauth/callback`;
}

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
    return connector.provider === "myanimelist"
      ? connector.canReuseOAuthClient
        ? `Authorize the owner account again, then refresh.${preservedSnapshot}`
        : `This legacy token cannot be renewed automatically. Enter the app client ID and secret, authorize, then refresh.${preservedSnapshot}`
      : `Replace the credential, then refresh.${preservedSnapshot}`;
  }
  if (connector.status === "authorization_required") {
    return "Complete the open MyAnimeList authorization. If that tab was closed, start authorization again.";
  }
  if (connector.status === "setup_required") {
    return connector.configured
      ? "A release gate is incomplete. Resolve the setup notice before refreshing."
      : connector.provider === "myanimelist"
        ? "Enter the app credentials, then authorize the owner account."
        : "Enter the owner credential, then run the first refresh.";
  }
  if (connector.status === "never_synced") {
    return environment === "local"
      ? "Connected in local D1. Run Refresh now to create the first local sanitized snapshot."
      : "Connected. Run Refresh now to publish the first sanitized snapshot.";
  }
  if (connector.status === "healthy") {
    return environment === "local"
      ? "The local snapshot is current. It has not been copied to production."
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
  }).format(date);
}

async function responseJson(response: Response): Promise<ApiResult> {
  try {
    return (await response.json()) as ApiResult;
  } catch {
    return {};
  }
}

function safeAuthorizationUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://myanimelist.net" &&
      url.pathname === "/v1/oauth2/authorize"
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
  steamStorageCountries,
}: Props) {
  const meta = providerMeta[connector.provider];
  const isMyAnimeList = connector.provider === "myanimelist";
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
  const connectorBlocked =
    !encryptionConfigured ||
    (connector.provider === "steam" && !steamStorageCountries);
  const registeredCallback = callbackUrl(environment);

  useEffect(() => {
    if (!isMyAnimeList) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("connector") !== "myanimelist") return;
    const result = query.get("result");
    const resultMessage = result ? callbackResultMessages[result] : null;
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
  }, [connector.configured, isMyAnimeList]);

  async function copyCallback(): Promise<void> {
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

  async function authorizeMyAnimeList(reuseStored: boolean): Promise<void> {
    if (!reuseStored && (!clientId.trim() || !secret)) {
      setMessage("Enter both the MyAnimeList client ID and client secret.");
      return;
    }
    setPending("authorize");
    setMessage(null);
    try {
      const response = await fetch(
        "/api/connectors/myanimelist/oauth/start",
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
            `MyAnimeList authorization could not start (${response.status}).`,
        );
        return;
      }
      if (result.callbackUrl !== registeredCallback) {
        setMessage(
          `Studio expected ${registeredCallback}, but the server reported a different callback. Check SITE_URL before authorizing.`,
        );
        return;
      }
      const destination = safeAuthorizationUrl(result.authorizationUrl);
      if (!destination) {
        setMessage(
          "Studio received an invalid authorization destination. Nothing was opened.",
        );
        return;
      }
      setSecret("");
      setMessage("Opening MyAnimeList authorization…");
      window.location.assign(destination);
    } catch {
      setMessage("MyAnimeList authorization could not start. Try again.");
    } finally {
      setPending(null);
    }
  }

  async function request(
    action: "save" | "refresh" | "disconnect",
  ): Promise<void> {
    const cancellingPendingAuthorization =
      action === "disconnect" &&
      isMyAnimeList &&
      !connector.configured &&
      connector.status === "authorization_required";
    if (
      action === "disconnect" &&
      !window.confirm(
        cancellingPendingAuthorization
          ? `Cancel the pending MyAnimeList authorization? Its encrypted, single-use transaction will be deleted${environment === "local" ? " from this local sandbox." : "."}`
          : `Disconnect ${meta.title}? Its encrypted credentials, snapshots, pending authorization, and sync history will be deleted${environment === "local" ? " from this local sandbox." : " and the stream will be unpublished."}`,
      )
    ) {
      return;
    }

    setPending(action);
    setMessage(null);
    const path =
      action === "refresh"
        ? `/api/connectors/${connector.provider}/refresh`
        : `/api/connectors/${connector.provider}/credentials`;

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
            : "Credential encrypted and saved. Run Refresh now to verify and publish it."
          : action === "disconnect"
            ? cancellingPendingAuthorization
              ? "Pending MyAnimeList authorization cancelled."
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
              {environment === "local" ? "Local snapshot" : "Published snapshot"}
            </dt>
            <dd>
              {connector.itemCount === null
                ? "None"
                : `${connector.itemCount.toLocaleString()} items`}
            </dd>
          </div>
        </dl>

        <p className={styles.statusGuidance}>{statusGuidance(
          connector,
          environment,
          encryptionConfigured,
          steamStorageCountries,
        )}</p>

        {isMyAnimeList ? (
          <div className={styles.callbackBlock}>
            <span>Callback URL for this {environment === "local" ? "local client" : "production client"}</span>
            <div>
              <code>{registeredCallback}</code>
              <button
                className={styles.copyButton}
                type="button"
                disabled={pending !== null}
                onClick={() => void copyCallback()}
              >
                {pending === "copy" ? "Copying…" : "Copy"}
              </button>
            </div>
            <p>
              Register this exact URL in MyAnimeList. Use a separate API client
              for local and production.
            </p>
          </div>
        ) : null}

        {showCredentialForm ? (
          <form
            className={styles.credentialForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (isMyAnimeList) void authorizeMyAnimeList(false);
              else void request("save");
            }}
          >
            {isMyAnimeList ? (
              <div className={styles.fieldPair}>
                <label className={styles.formField} htmlFor="myanimelist-client-id">
                  <span>Client ID</span>
                  <input
                    id="myanimelist-client-id"
                    type="text"
                    value={clientId}
                    minLength={8}
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="From MyAnimeList API settings"
                    required
                  />
                </label>
                <label className={styles.formField} htmlFor="myanimelist-client-secret">
                  <span>Client secret</span>
                  <input
                    id="myanimelist-client-secret"
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
                    : isMyAnimeList
                      ? "Authorize with MyAnimeList"
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
              {isMyAnimeList &&
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
            {isMyAnimeList && connector.canReuseOAuthClient ? (
              <button
                className={styles.quietButton}
                type="button"
                disabled={pending !== null || connectorBlocked}
                onClick={() => void authorizeMyAnimeList(true)}
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
              {isMyAnimeList ? "Replace app credentials" : "Replace credential"}
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

        {message ? (
          <p className={styles.formMessage} role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

type StravaState =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "error"; message: string }
  | { phase: "ready"; embedUrl: string; updatedAt: string | null };

export function StravaConnectorControls({
  environment,
}: {
  environment: Environment;
}) {
  const [state, setState] = useState<StravaState>({ phase: "loading" });
  const [embed, setEmbed] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<"save" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/connectors/strava", { cache: "no-store" })
      .then(async (response) => {
        const result = (await responseJson(response)) as ApiResult & {
          payload?: {
            embedUrl?: string;
            updatedAt?: string;
          };
        };
        if (!active) return;
        if (response.ok && result.payload?.embedUrl) {
          setState({
            phase: "ready",
            embedUrl: result.payload.embedUrl,
            updatedAt: result.payload.updatedAt ?? null,
          });
          setShowForm(false);
        } else if (response.status === 404) {
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
    if (!embed.trim()) {
      setMessage("Paste an official Strava embed URL or iframe snippet.");
      return;
    }
    setPending("save");
    setMessage(null);
    try {
      const response = await fetch("/api/connectors/strava/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ embed }),
      });
      const result = await responseJson(response);
      if (!response.ok || !result.embedUrl) {
        setMessage(
          result.error ??
            "Paste the complete HTTPS embed that Strava generated.",
        );
        return;
      }
      setState({
        phase: "ready",
        embedUrl: result.embedUrl,
        updatedAt: result.updatedAt ?? null,
      });
      setEmbed("");
      setShowForm(false);
      const profileFeed = result.embedUrl.startsWith(
        "https://www.strava.com/athletes/",
      );
      setMessage(
        profileFeed
          ? "Strava’s profile-feed URL was accepted. Verify it on Play: if Strava shows a login page, replace it with a current activity or route embed from strava-embeds.com."
          : environment === "local"
            ? "Strava embed saved in local D1. Open the local Play page and grant consent to verify it."
            : "Strava embed published. Visitors must still grant consent before it loads.",
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
      const response = await fetch("/api/connectors/strava/config", {
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
        ? "Current"
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
            Publish one official public activity, route, or feed embed. The site
            stores only its embed URL and loads Strava only after visitor
            consent.
          </p>
          <a
            href="https://support.strava.com/en-us/articles/15402053-sharing-your-activities-and-routes-with-a-strava-embed"
            rel="noreferrer"
            target="_blank"
          >
            Open Strava embed guide
          </a>
        </div>

        <dl className={styles.connectorFacts}>
          <div>
            <dt>You need</dt>
            <dd>Official embed URL or iframe</dd>
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

        {state.phase === "ready" ? (
          <p className={styles.statusGuidance}>
            The Move stream is published. Its iframe remains blocked until a
            visitor explicitly chooses to load it.
          </p>
        ) : state.phase === "error" ? (
          <p className={styles.statusGuidance}>{state.message}</p>
        ) : (
          <p className={styles.statusGuidance}>
            Paste an official embed below. No Strava API key or OAuth token is
            used.
          </p>
        )}

        {state.phase === "ready" ? (
          <div className={styles.currentConfig}>
            <span>Stored public embed</span>
            <code>{state.embedUrl}</code>
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
            <label className={styles.formField} htmlFor="strava-embed">
              <span>Embed URL or iframe snippet</span>
              <textarea
                id="strava-embed"
                value={embed}
                maxLength={8192}
                rows={3}
                spellCheck={false}
                onChange={(event) => setEmbed(event.target.value)}
                placeholder={'https://strava-embeds.com/... or Strava’s complete <iframe ...>'}
                required
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" disabled={pending !== null}>
                {pending === "save" ? "Saving…" : "Save Strava embed"}
              </button>
              {state.phase === "ready" ? (
                <button
                  className={styles.textButton}
                  type="button"
                  disabled={pending !== null}
                  onClick={() => {
                    setEmbed("");
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
                setShowForm(true);
              }}
            >
              Replace embed
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
          <strong>If it needs attention</strong>
          Paste the exact embed generated by Strava. Activity and route embeds
          use <code>strava-embeds.com</code>; profile feeds may use an exact{" "}
          <code>www.strava.com/athletes/…/latest-rides/…</code> URL. Scripts,
          unrelated Strava pages, credentials, ports, and multi-element snippets
          are rejected. If a profile feed opens a Strava login page, replace it
          with a newly generated activity or route embed.
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
