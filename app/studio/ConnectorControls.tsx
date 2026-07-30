"use client";

import { useState } from "react";
import type { ConnectorHealth } from "@/lib/server/connectors/repository";
import styles from "./studio.module.css";

type Props = {
  connector: ConnectorHealth;
};

const providerNames = {
  myanimelist: "MyAnimeList",
  hardcover: "Hardcover",
  steam: "Steam",
} as const;

const statusLabels: Record<ConnectorHealth["status"], string> = {
  setup_required: "Setup required",
  never_synced: "Ready to sync",
  healthy: "Current",
  stale: "Refresh due",
  syncing: "Syncing",
  visibility_required: "Visibility required",
  error: "Needs attention",
};

function statusGuidance(
  connector: ConnectorHealth,
  encryptionConfigured: boolean,
  steamStorageCountries: string | null,
): string {
  if (!encryptionConfigured) {
    return "Set CONNECTOR_ENCRYPTION_KEY and redeploy before connecting or refreshing this provider.";
  }
  if (connector.provider === "steam" && !steamStorageCountries) {
    return "Set the truthful Steam storage-country disclosure and redeploy before connecting or refreshing.";
  }

  const preservedSnapshot =
    connector.itemCount === null
      ? ""
      : connector.provider === "steam"
        ? " The latest eligible snapshot remains available for up to 72 hours."
        : " The last successful snapshot remains public.";

  if (connector.status === "setup_required") {
    return connector.configured
      ? "A site release gate is incomplete. Resolve the notice above before refreshing."
      : "Add the owner credential below, then run the first refresh.";
  }
  if (connector.status === "never_synced") {
    return "The credential is encrypted and stored. Run Refresh now to publish the first sanitized snapshot.";
  }
  if (connector.status === "healthy") {
    return "The public snapshot is current. Visitor-triggered refreshes are limited to once every 12 hours.";
  }
  if (connector.status === "stale") {
    return `Run Refresh now to update this stream.${preservedSnapshot}`;
  }
  if (connector.status === "syncing") {
    return "A refresh is already running. This page will show its result after completion.";
  }
  if (connector.status === "visibility_required") {
    return "Set both the Steam profile and Game details to Public, then run Refresh now. The previous Steam snapshot is unpublished.";
  }
  if (
    connector.lastErrorCode === "credential_expired" ||
    connector.lastErrorCode === "credential_invalid" ||
    connector.lastErrorCode === "credential_missing"
  ) {
    return `Replace the credential, then run Refresh now.${preservedSnapshot}`;
  }
  if (connector.lastErrorCode === "rate_limited") {
    return `The provider rate-limited the last request. Wait, then try Refresh now.${preservedSnapshot}`;
  }
  return `The last refresh failed. Try Refresh now; replace the credential if the error continues.${preservedSnapshot}`;
}

export function ConnectorControls({
  connector,
  encryptionConfigured,
  steamStorageCountries,
}: Props & {
  encryptionConfigured: boolean;
  steamStorageCountries: string | null;
}) {
  const [secret, setSecret] = useState("");
  const [steamId, setSteamId] = useState("");
  const [showCredentialForm, setShowCredentialForm] = useState(
    !connector.configured,
  );
  const [pending, setPending] = useState<
    "save" | "refresh" | "disconnect" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const connectorBlocked =
    !encryptionConfigured ||
    (connector.provider === "steam" && !steamStorageCountries);

  async function request(
    action: "save" | "refresh" | "disconnect",
  ): Promise<void> {
    if (
      action === "disconnect" &&
      !window.confirm(
        connector.provider === "steam"
          ? "Disconnect Steam? The encrypted key, every stored Steam snapshot, and Steam sync history will be deleted and unpublished."
          : `Disconnect ${providerNames[connector.provider]}? The encrypted credential will be deleted, while the last public snapshot remains published.`,
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
        method:
          action === "disconnect"
            ? "DELETE"
            : "POST",
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
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        status?: string;
        itemCount?: number;
      };
      if (!response.ok) {
        setMessage(result.error ?? `Request failed (${response.status}).`);
        return;
      }

      setSecret("");
      setSteamId("");
      if (action === "save") setShowCredentialForm(false);
      setMessage(
        action === "save"
          ? connector.configured
            ? "Credential encrypted and replaced. Run Refresh now to verify and publish it."
            : "Credential encrypted and saved. Run Refresh now to publish the first snapshot."
          : action === "disconnect"
            ? connector.provider === "steam"
              ? "Steam disconnected. Every stored Steam snapshot and Steam sync-history record was deleted."
              : "Credential removed. The last public snapshot was preserved."
            : result.status === "already_running"
              ? "A sync is already running."
              : result.status === "withheld"
                ? result.message ??
                  "Steam game details are not public, so the stream was unpublished."
              : `Sync complete${typeof result.itemCount === "number" ? ` · ${result.itemCount} items` : ""}.`,
      );
      window.setTimeout(() => window.location.reload(), 1_100);
    } catch {
      setMessage("The request could not be completed. Try again.");
    } finally {
      setPending(null);
    }
  }

  const providerName = providerNames[connector.provider];

  return (
    <section className={styles.connectorCard} aria-labelledby={`${connector.provider}-title`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.eyebrow}>Personal stream</p>
          <h3 id={`${connector.provider}-title`}>{providerName}</h3>
        </div>
        <span
          className={`${styles.statusPill} ${styles[`status_${connector.status}`]}`}
        >
          {statusLabels[connector.status]}
        </span>
      </div>

      <dl className={styles.connectorFacts}>
        <div>
          <dt>Last successful sync</dt>
          <dd>
            {connector.lastSyncedAt
              ? new Intl.DateTimeFormat("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(connector.lastSyncedAt))
              : "Not yet synced"}
          </dd>
        </div>
        <div>
          <dt>Published snapshot</dt>
          <dd>
            {connector.itemCount === null
              ? "None"
              : `${connector.itemCount.toLocaleString()} items`}
          </dd>
        </div>
      </dl>

      <p className={styles.statusGuidance}>
        {statusGuidance(
          connector,
          encryptionConfigured,
          steamStorageCountries,
        )}
      </p>

      {showCredentialForm ? (
        <form
          className={styles.credentialForm}
          onSubmit={(event) => {
            event.preventDefault();
            void request("save");
          }}
        >
          {connector.provider === "steam" ? (
            <>
              <label htmlFor="steam-id">SteamID64</label>
              <input
                className={styles.fullInput}
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
                placeholder="17-digit public SteamID64"
                required
              />
            </>
          ) : null}
          <label htmlFor={`${connector.provider}-secret`}>
            {connector.provider === "myanimelist"
              ? "OAuth access token · manual renewal"
              : connector.provider === "hardcover"
                ? "API token · Bearer optional"
                : "Web API key"}
          </label>
          <div className={styles.inputRow}>
            <input
              id={`${connector.provider}-secret`}
              type="password"
              value={secret}
              minLength={connector.provider === "steam" ? 32 : 8}
              maxLength={connector.provider === "steam" ? 32 : 8192}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste once; it will not be shown again"
              required
            />
            <button
              type="submit"
              disabled={pending !== null || connectorBlocked}
            >
              {pending === "save"
                ? "Saving…"
                : connector.configured
                  ? "Replace credential"
                  : "Connect"}
            </button>
          </div>
          <p>
            {connector.provider === "steam" ? (
              <>
                Requires a Public Steam profile and Public Game details.
                Connecting authorizes automatic public-only refreshes no more
                than every 12 hours; the owner can refresh manually. Read the{" "}
                <a href="/privacy">data and retention policy</a>.
                {steamStorageCountries
                  ? ` Sanitized snapshots are disclosed as stored in ${steamStorageCountries}.`
                  : " Connecting is disabled until the storage-country release gate is configured."}
              </>
            ) : connector.provider === "myanimelist" ? (
              <>
                Paste the current owner access token. It is stored with
                AES-256-GCM and is not renewed automatically; use Replace
                credential when it expires.
              </>
            ) : (
              <>
                Paste the owner API token with or without the{" "}
                <code>Bearer</code> prefix. It is normalized before encrypted
                storage.
              </>
            )}
          </p>
          {connector.configured ? (
            <button
              className={styles.textButton}
              disabled={pending !== null}
              onClick={() => {
                setSecret("");
                setSteamId("");
                setShowCredentialForm(false);
              }}
              type="button"
            >
              Cancel replacement
            </button>
          ) : null}
        </form>
      ) : (
        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={pending !== null || connectorBlocked}
            onClick={() => void request("refresh")}
          >
            {pending === "refresh" ? "Syncing…" : "Refresh now"}
          </button>
          <button
            className={styles.quietButton}
            type="button"
            disabled={pending !== null}
            onClick={() => {
              setMessage(null);
              setShowCredentialForm(true);
            }}
          >
            Replace credential
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

      {message ? (
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
