"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../studio.module.css";
import {
  callbackResultMessages,
  formatTimestamp,
  responseJson,
  safeAuthorizationUrl,
  spotifyReauthorizationDate,
  statusGuidance,
} from "./helpers";
import type { ApiConnectorPanelProps } from "./model";
import {
  connectorMutationShouldReconcile,
  type ConnectorMutationAction,
} from "./mutation-policy";
import { retryDeadlineState } from "./retry-deadline";
import { ConnectorPermissionControl } from "./ConnectorPermissionControl";
import { studioConnectorActionLabel } from "./action-label";

const publicStateLabel = {
  live: "Live",
  private: "Private",
  needs_action: "Needs action",
  not_connected: "Not connected",
} as const;

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
  view,
  approvalOverview,
  expanded,
  onExpandedChange,
  onPermissionUpdated,
  environment,
  encryptionConfigured,
  meta,
  oauth,
  steamStorageCountries = null,
  children,
  advancedChildren,
}: ApiConnectorPanelProps) {
  const router = useRouter();
  const isSpotify = connector.provider === "spotify";
  const isOAuthProvider = Boolean(oauth);
  const oauthProvider = oauth?.provider ?? "myanimelist";
  const oauthProviderTitle = oauth?.title ?? "MyAnimeList";
  const oauthCredentialShape =
    oauth?.credentialShape ?? defaultOAuthCredentialShape;
  const [secret, setSecret] = useState("");
  const [credentialId, setCredentialId] = useState("");
  const [steamId, setSteamId] = useState("");
  const [showCredentialForm, setShowCredentialForm] = useState(
    !connector.configured &&
      (view.primaryAction === "connect" ||
        (view.primaryAction === "continue_authorization" &&
          !connector.canReuseOAuthClient)),
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
  const panelRef = useRef<HTMLElement>(null);
  const focusAfterMutation = useRef<"credential" | "primary" | null>(null);
  const focusAfterAction = useRef<
    ApiConnectorPanelProps["view"]["primaryAction"] | null
  >(null);
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
        router.refresh();
      },
      Math.min(retryTimestamp - Date.now() + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [retryTimestamp, router]);

  useEffect(() => {
    if (!isOAuthProvider) return;
    const query = new URLSearchParams(window.location.search);
    if (query.get("connector") !== oauthProvider) return;
    const result = query.get("result");
    const resultMessageFactory = result
      ? callbackResultMessages[result]
      : null;
    const resultMessage =
      result === "connected"
        ? `${oauthProviderTitle} connection saved. Allow public use next.`
        : resultMessageFactory
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
    window.history.replaceState(
      window.history.state,
      "",
      `${cleaned.pathname}${cleaned.search}${cleaned.hash}`,
    );
    return () => {
      if (updateTimer !== null) window.clearTimeout(updateTimer);
    };
  }, [connector.configured, isOAuthProvider, oauthProvider, oauthProviderTitle]);

  useEffect(() => {
    if (pending !== null || focusAfterMutation.current === null) return;
    if (
      focusAfterMutation.current === "primary" &&
      focusAfterAction.current === view.primaryAction
    ) {
      return;
    }
    const target =
      focusAfterMutation.current === "primary"
        ? panelRef.current?.querySelector<HTMLElement>(
            "[data-studio-primary-action]:not(:disabled)",
          ) ?? panelRef.current?.querySelector<HTMLElement>("summary") ?? null
        : firstCredentialField.current;
    if (!target) return;
    focusAfterMutation.current = null;
    focusAfterAction.current = null;
    target.focus();
  }, [pending, showCredentialForm, view.primaryAction]);

  async function copyCallback(): Promise<void> {
    if (!registeredCallback) {
      setMessage("SITE_URL does not match this origin. Correct it, then restart Studio.");
      return;
    }
    setPending("copy");
    try {
      await navigator.clipboard.writeText(registeredCallback);
      setMessage("Callback URL copied.");
    } catch {
      setMessage(
        "The callback could not be copied. Select the URL and copy it manually.",
      );
    } finally {
      setPending(null);
    }
  }

  async function authorizeOAuthProvider(reuseStored: boolean): Promise<void> {
    if (!oauth || !registeredCallback) {
      setMessage("SITE_URL does not match this origin. Correct it, then restart Studio.");
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
                replaceExisting: true,
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
          "The authorization destination was invalid. Nothing opened; check the provider setup.",
        );
        return;
      }
      setSecret("");
      setAuthorizationDestination(destination);
      setMessage(
        `${oauthProviderTitle} authorization is ready. If it stays here, select Continue to ${oauthProviderTitle}.`,
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
    action: ConnectorMutationAction,
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
          : `Disconnect ${meta.title}? Its encrypted credentials, snapshots, pending authorization, and sync history will be deleted${environment === "local" ? " from this local sandbox." : " and the collection will be unpublished."}`,
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
            ? `Discogs rate-limited the refresh. Try again after ${formatTimestamp(responseRetryNotBefore)}. No new snapshot was saved; the previous snapshot is unchanged.`
            : result.error ?? `Request failed (${response.status}).`,
        );
        if (
          connectorMutationShouldReconcile(action, result.status)
        ) {
          focusAfterMutation.current = "primary";
          focusAfterAction.current = view.primaryAction;
          router.refresh();
        }
        return;
      }

      if (action === "refresh" && result.status === "not_due") {
        const responseRetryNotBefore =
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
            ? `The collection is not due, so no provider request was made. Refresh after ${formatTimestamp(responseRetryNotBefore)}; the saved snapshot remains published.`
            : "The collection is not due, so no provider request was made. The saved snapshot remains published.",
        );
        focusAfterMutation.current = "primary";
        focusAfterAction.current = view.primaryAction;
        router.refresh();
        return;
      }

      setSecret("");
      setSteamId("");
      if (
        action === "refresh" &&
        (result.status === "complete" || result.status === "withheld")
      ) {
        setLocalRetryNotBefore(null);
      }
      if (action === "save") {
        focusAfterMutation.current = "primary";
        focusAfterAction.current = view.primaryAction;
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
          ? "Connected. Allow public use next."
          : action === "disconnect"
            ? cancellingPendingAuthorization
              ? `${oauthProviderTitle} authorization cancelled. The pending transaction was deleted.`
              : `${meta.title} disconnected. Credentials, snapshots, and sync history were deleted${environment === "local" ? " from this sandbox." : "."}`
            : result.status === "already_running"
              ? "A refresh is already running. Check again in a moment."
              : result.status === "withheld"
                ? result.message ??
                  "Steam game details are not public, so Play was unpublished."
                : `${environment === "local" ? "Local snapshot updated" : "Snapshot updated"}${typeof result.itemCount === "number" ? ` · ${result.itemCount} items` : ""}.`,
      );
      if (
        action === "refresh" &&
        result.status === "complete" &&
        view.primaryAction !== "refresh"
      ) {
        focusAfterMutation.current = "primary";
        focusAfterAction.current = view.primaryAction;
      }
      if (connectorMutationShouldReconcile(action, result.status)) {
        router.refresh();
      }
    } catch {
      setMessage(
        action === "refresh"
          ? "The refresh request could not be completed. No new snapshot was saved; any previously accepted snapshot remains unchanged."
          : "The request could not be completed. Try again.",
      );
    } finally {
      setPending(null);
    }
  }

  const publicState = publicStateLabel[view.publicState];
  const actionLabel =
    retryBlocked && retryNotBefore
      ? `Retry after ${formatTimestamp(retryNotBefore)}`
      : view.primaryAction === "wait_retry"
        ? "Try again"
        : studioConnectorActionLabel(view);
  const guidesConnection =
    view.primaryAction === "connect" ||
    view.primaryAction === "continue_authorization" ||
    view.primaryAction === "reauthorize" ||
    view.primaryAction === "replace_credential";
  const guidesRefresh =
    view.primaryAction === "sync" ||
    view.primaryAction === "refresh" ||
    view.primaryAction === "retry" ||
    view.primaryAction === "wait_retry";
  const needsCredentialForm =
    showCredentialForm ||
    (view.primaryAction === "continue_authorization" &&
      !connector.canReuseOAuthClient) ||
    view.primaryAction === "replace_credential" ||
    (view.primaryAction === "reauthorize" && !connector.canReuseOAuthClient);
  const approvalEntry = approvalOverview.providers.find(
    (entry) => entry.provider === connector.provider,
  );
  const guidance =
    view.primaryAction === "record_public_permission"
      ? view.publicState === "live"
        ? "This collection remains live during setup. Add its public permission before finishing setup."
        : "The connection is saved. Add public permission before syncing."
      : view.primaryAction === "publish"
        ? "The saved collection is private. Review the display terms, then publish below."
        : view.primaryAction === "continue_authorization" &&
            !connector.canReuseOAuthClient
          ? `${oauthProviderTitle} authorization did not finish. Re-enter the app credentials to replace the single-use request, or cancel it below.`
          : statusGuidance(
              {
                ...connector,
                retryNotBefore: retryBlocked ? retryNotBefore : null,
              },
              environment,
              encryptionConfigured,
              steamStorageCountries,
            );

  return (
    <section
      ref={panelRef}
      className={styles.connectorPanel}
      aria-labelledby={`${connector.provider}-title`}
      data-provider={connector.provider}
    >
      <details
        className={styles.connectorDisclosure}
        open={expanded}
        onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      >
        <summary className={styles.connectorSummary}>
          <span className={styles.connectorSummaryIdentity}>
            <span>{view.stream}</span>
            <strong id={`${connector.provider}-title`}>{view.label}</strong>
          </span>
          <span className={styles.connectorSummaryMeta}>
            <span
              className={`${styles.statusPill} ${
                publicState === "Live"
                  ? styles.status_healthy
                  : publicState === "Needs action"
                    ? styles.status_error
                    : styles.status_setup_required
              }`}
            >
              {publicState}
            </span>
            <span>
              {view.snapshot.itemCount === null
                ? "No saved items"
                : `${view.snapshot.itemCount.toLocaleString()} saved items`}
            </span>
            <span>
              {view.snapshot.lastSyncedAt
                ? `Updated ${formatTimestamp(view.snapshot.lastSyncedAt)}`
                : "Not updated"}
            </span>
          </span>
          <span className={styles.connectorPrimaryAction}>{actionLabel}</span>
        </summary>

        <div className={`${styles.connectorMain} ${styles.connectorDetails}`}>
        <p className={styles.statusGuidance} role="status">
          {guidance}
        </p>

        {connector.lastErrorCode && connector.itemCount !== null ? (
          <p className={styles.savedSnapshotNotice}>
            <strong>Saved snapshot</strong>
            <span>{connector.itemCount.toLocaleString()} items</span>
            <span>Updated {formatTimestamp(connector.lastSyncedAt)}</span>
          </p>
        ) : null}

        {view.primaryAction === "record_public_permission" ? (
          <ConnectorPermissionControl
            provider={connector.provider}
            providerLabel={meta.title}
            configurationRevision={view.configurationRevision}
            approval={approvalEntry?.approval ?? view.permission.approval}
            missingScopes={approvalEntry?.missingScopes ?? view.permission.missingScopes}
            onUpdated={onPermissionUpdated}
          />
        ) : null}

        {needsCredentialForm ? (
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
                data-studio-primary-action={
                  view.primaryAction === "connect" ||
                  view.primaryAction === "continue_authorization" ||
                  view.primaryAction === "reauthorize" ||
                  view.primaryAction === "replace_credential"
                    ? ""
                    : undefined
                }
                disabled={pending !== null || connectorBlocked}
              >
                {pending === "authorize"
                  ? "Opening authorization…"
                  : pending === "save"
                    ? "Saving…"
                    : isOAuthProvider
                      ? view.primaryAction === "continue_authorization"
                        ? "Restart authorization"
                        : `Authorize with ${oauthProviderTitle}`
                      : view.primaryAction === "replace_credential"
                        ? "Replace credential"
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
        ) : guidesRefresh || guidesConnection ? (
          <div className={styles.actionRow}>
            {guidesRefresh ? (
              <button
                ref={refreshButton}
                data-studio-primary-action
                type="button"
                disabled={pending !== null || connectorBlocked || retryBlocked}
                onClick={() => void request("refresh")}
              >
                {pending === "refresh"
                  ? "Refreshing…"
                  : actionLabel}
              </button>
            ) : null}
            {isOAuthProvider &&
            connector.canReuseOAuthClient &&
            (view.primaryAction === "continue_authorization" ||
              view.primaryAction === "reauthorize") ? (
              <button
                data-studio-primary-action
                className={styles.quietButton}
                type="button"
                disabled={pending !== null || connectorBlocked}
                onClick={() => void authorizeOAuthProvider(true)}
              >
                {pending === "authorize"
                  ? "Opening…"
                  : view.primaryAction === "continue_authorization"
                    ? "Continue authorization"
                    : "Authorize again"}
              </button>
            ) : null}
          </div>
        ) : null}

        {view.primaryAction === "publish" ? children : null}

        <details className={styles.connectorAdvanced}>
          <summary>Advanced / recovery</summary>
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
              <dt>Required</dt>
              <dd>{meta.requirement}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{formatTimestamp(connector.lastSyncedAt)}</dd>
            </div>
            <div>
              <dt>Saved snapshot</dt>
              <dd>
                {connector.itemCount === null
                  ? "None"
                  : `${connector.itemCount.toLocaleString()} items`}
              </dd>
            </div>
            <div>
              <dt>
                {connector.provider === "discogs"
                  ? "Manual refresh available"
                  : "Fresh through"}
              </dt>
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
              <div>
                <dt>Reauthorize by</dt>
                <dd>{formatTimestamp(spotifyReauthorizationDate(connector.authorizedAt))}</dd>
              </div>
            ) : null}
          </dl>
          {isOAuthProvider ? (
            <div className={styles.callbackBlock}>
              <span>
                Callback URL for this {environment === "local" ? "local client" : "production client"}
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
                Register this exact URL in {oauthProviderTitle}. Keep local and production applications separate.
                {isSpotify && environment === "local"
                  ? " Spotify rejects localhost redirects, so this callback uses the explicit 127.0.0.1 loopback address."
                  : ""}
              </p>
            </div>
          ) : null}
          {connector.configured && view.primaryAction !== "record_public_permission" ? (
            <ConnectorPermissionControl
              provider={connector.provider}
              providerLabel={meta.title}
              configurationRevision={view.configurationRevision}
              approval={approvalEntry?.approval ?? view.permission.approval}
              missingScopes={approvalEntry?.missingScopes ?? view.permission.missingScopes}
              onUpdated={onPermissionUpdated}
            />
          ) : null}
          {connector.configured ? (
            <div className={styles.actionRow}>
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
          ) : null}
          {advancedChildren}
          <p className={styles.recoveryText}>
            <strong>Recovery</strong>
            {meta.recovery}
          </p>
        </details>

        <p
          className={styles.formMessage}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {message ?? ""}
        </p>
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
      </details>
    </section>
  );
}
