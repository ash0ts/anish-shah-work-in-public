"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../studio.module.css";
import {
  callbackResultMessages,
  connectorStatusClass,
  connectorStatusLabel,
  formatTimestamp,
  responseJson,
  safeAuthorizationUrl,
  spotifyPublicCutoff,
  spotifyReauthorizationDate,
  statusGuidance,
} from "./helpers";
import type { ApiConnectorPanelProps } from "./model";
import { retryDeadlineState } from "./retry-deadline";

const defaultOAuthCredentialShape = {
  idLabel: "Client ID",
  secretLabel: "Client secret",
  requestKeys: {
    id: "clientId",
    secret: "clientSecret",
  },
  showsAccessTokenExpiry: true,
} as const;

export function ApiConnectorPanel({
  connector,
  environment,
  encryptionConfigured,
  meta,
  oauth,
  steamStorageCountries = null,
  children,
}: ApiConnectorPanelProps) {
  const router = useRouter();
  const isSpotify = connector.provider === "spotify";
  const isPublicationGated =
    isSpotify || connector.provider === "discogs";
  const isOAuthProvider = Boolean(oauth);
  const oauthProvider = oauth?.provider ?? "myanimelist";
  const oauthProviderTitle = oauth?.title ?? "MyAnimeList";
  const oauthCredentialShape =
    oauth?.credentialShape ?? defaultOAuthCredentialShape;
  const [secret, setSecret] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [steamId, setSteamId] = useState("");
  const [showCredentialForm, setShowCredentialForm] = useState(
    !connector.configured,
  );
  const [pending, setPending] = useState<
    "save" | "authorize" | "refresh" | "disconnect" | "copy" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localRetryNotBefore, setLocalRetryNotBefore] = useState<string | null>(
    null,
  );
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const [authorizationDestination, setAuthorizationDestination] = useState<
    string | null
  >(null);
  const focusAfterMutation = useRef<"credential" | "refresh" | null>(null);
  const firstCredentialField = useRef<HTMLInputElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const connectorBlocked =
    !encryptionConfigured ||
    (isOAuthProvider && !oauth?.callbackUrl) ||
    (connector.provider === "steam" && !steamStorageCountries);
  const registeredCallback = oauth?.callbackUrl ?? null;
  const retryDeadline = retryDeadlineState(
    connector.retryNotBefore,
    localRetryNotBefore,
    retryClock,
  );
  const { retryNotBefore, retryTimestamp } = retryDeadline;
  const retryBlocked = connector.provider === "discogs" && retryDeadline.blocked;

  useEffect(() => {
    if (!Number.isFinite(retryTimestamp) || retryTimestamp <= Date.now()) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        setRetryClock(Date.now());
        setLocalRetryNotBefore(null);
      },
      Math.min(retryTimestamp - Date.now() + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [retryTimestamp]);

  useEffect(() => {
    if (!isOAuthProvider) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("connector") !== oauthProvider) return;
    const result = query.get("result");
    const resultMessageFactory = result
      ? callbackResultMessages[result]
      : null;
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

  useEffect(() => {
    if (pending !== null || focusAfterMutation.current === null) return;
    const target =
      focusAfterMutation.current === "refresh"
        ? refreshButton.current
        : firstCredentialField.current;
    if (!target) return;
    focusAfterMutation.current = null;
    target.focus();
  }, [pending, showCredentialForm]);

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
      setMessage(
        "Copy was unavailable. Select the callback URL and copy it manually.",
      );
    } finally {
      setPending(null);
    }
  }

  async function authorizeOAuthProvider(reuseStored: boolean): Promise<void> {
    if (!oauth || !registeredCallback) {
      setMessage("Set SITE_URL to the exact origin and restart Studio first.");
      return;
    }
    if (!reuseStored && (!credentialId.trim() || !secret)) {
      setMessage(
        `Enter both the ${oauthProviderTitle} ${oauthCredentialShape.idLabel.toLowerCase()} and ${oauthCredentialShape.secretLabel.toLowerCase()}.`,
      );
      return;
    }
    setPending("authorize");
    setMessage(null);
    setAuthorizationDestination(null);
    try {
      const response = await fetch(oauth.startPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          reuseStored
            ? {}
            : {
                [oauthCredentialShape.requestKeys.id]: credentialId.trim(),
                [oauthCredentialShape.requestKeys.secret]: secret,
              },
        ),
      });
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
        oauth.provider,
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
      setMessage(
        `${oauthProviderTitle} authorization could not start. Try again.`,
      );
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
          action === "save"
            ? { "content-type": "application/json" }
            : undefined,
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
        const responseRetryNotBefore =
          connector.provider === "discogs" &&
          typeof result.retryNotBefore === "string" &&
          Number.isFinite(Date.parse(result.retryNotBefore))
            ? result.retryNotBefore
            : null;
        if (responseRetryNotBefore) {
          setLocalRetryNotBefore(responseRetryNotBefore);
          setRetryClock(Date.now());
        }
        setMessage(
          responseRetryNotBefore
            ? `Discogs is rate-limiting synchronization. Refresh becomes available after ${formatTimestamp(responseRetryNotBefore)}. No snapshot was published.`
            : result.error ?? `Request failed (${response.status}).`,
        );
        return;
      }

      setSecret("");
      setSteamId("");
      if (action === "refresh") setLocalRetryNotBefore(null);
      if (action === "save") {
        focusAfterMutation.current = "refresh";
        setShowCredentialForm(false);
      }
      if (action === "disconnect") {
        focusAfterMutation.current = "credential";
        setCredentialId("");
        setAuthorizationDestination(null);
        setShowCredentialForm(true);
      }
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
      router.refresh();
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
                : isPublicationGated
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
          {retryBlocked ? (
            <div>
              <dt>Provider retry available</dt>
              <dd>{formatTimestamp(retryNotBefore)}</dd>
            </div>
          ) : null}
          {isOAuthProvider && oauthCredentialShape.showsAccessTokenExpiry ? (
            <div>
              <dt>Access token refresh</dt>
              <dd>{formatTimestamp(connector.credentialExpiresAt)}</dd>
            </div>
          ) : null}
          {isSpotify ? (
            <>
              <div>
                <dt>Public cutoff</dt>
                <dd>
                  {formatTimestamp(
                    spotifyPublicCutoff(connector.lastSyncedAt),
                  )}
                </dd>
              </div>
              <div>
                <dt>Reauthorize by</dt>
                <dd>
                  {formatTimestamp(
                    spotifyReauthorizationDate(connector.authorizedAt),
                  )}
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        <p className={styles.statusGuidance}>
          {statusGuidance(
            {
              ...connector,
              retryNotBefore: retryBlocked ? retryNotBefore : null,
            },
            environment,
            encryptionConfigured,
            steamStorageCountries,
          )}
        </p>

        {isOAuthProvider ? (
          <div className={styles.callbackBlock}>
            <span>
              Callback URL for this{" "}
              {environment === "local" ? "local client" : "production client"}
            </span>
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
                <label
                  className={styles.formField}
                  htmlFor={`${oauthProvider}-${oauthCredentialShape.requestKeys.id}`}
                >
                  <span>{oauthCredentialShape.idLabel}</span>
                  <input
                    id={`${oauthProvider}-${oauthCredentialShape.requestKeys.id}`}
                    ref={firstCredentialField}
                    type="text"
                    value={credentialId}
                    minLength={8}
                    maxLength={256}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setCredentialId(event.target.value)}
                    placeholder={`From ${oauthProviderTitle} developer settings`}
                    required
                  />
                </label>
                <label
                  className={styles.formField}
                  htmlFor={`${oauthProvider}-${oauthCredentialShape.requestKeys.secret}`}
                >
                  <span>{oauthCredentialShape.secretLabel}</span>
                  <input
                    id={`${oauthProvider}-${oauthCredentialShape.requestKeys.secret}`}
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
                    ref={firstCredentialField}
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
                  ref={firstCredentialField}
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
                    setCredentialId("");
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
              ref={refreshButton}
              type="button"
              disabled={pending !== null || connectorBlocked || retryBlocked}
              onClick={() => void request("refresh")}
            >
              {pending === "refresh"
                ? "Refreshing…"
                : retryBlocked
                  ? `Retry after ${formatTimestamp(retryNotBefore)}`
                  : "Refresh now"}
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
              {isOAuthProvider
                ? "Replace app credentials"
                : "Replace credential"}
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

        {children}

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
