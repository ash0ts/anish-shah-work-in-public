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

export function ConnectorControls({
  connector,
  steamStorageCountries,
}: Props & { steamStorageCountries: string | null }) {
  const [secret, setSecret] = useState("");
  const [steamId, setSteamId] = useState("");
  const [pending, setPending] = useState<
    "save" | "refresh" | "disconnect" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);

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
                  ? { apiKey: secret, steamId }
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
      setMessage(
        action === "save"
          ? "Credential encrypted and saved. You can sync now."
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
      window.setTimeout(() => window.location.reload(), 700);
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
          {connector.status.replaceAll("_", " ")}
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

      {!connector.configured ? (
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
              ? "OAuth access token"
              : connector.provider === "hardcover"
                ? "API authorization token"
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
              disabled={
                pending !== null ||
                (connector.provider === "steam" &&
                  !steamStorageCountries)
              }
            >
              {pending === "save" ? "Saving…" : "Connect"}
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
            ) : (
              <>
                Stored with AES-256-GCM. The public API receives only the
                normalized snapshot.
              </>
            )}
          </p>
        </form>
      ) : (
        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={
              pending !== null ||
              (connector.provider === "steam" &&
                !steamStorageCountries)
            }
            onClick={() => void request("refresh")}
          >
            {pending === "refresh" ? "Syncing…" : "Refresh now"}
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
