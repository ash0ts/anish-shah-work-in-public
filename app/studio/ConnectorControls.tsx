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
} as const;

export function ConnectorControls({ connector }: Props) {
  const [secret, setSecret] = useState("");
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
        `Disconnect ${providerNames[connector.provider]}? The encrypted credential will be deleted, while the last public snapshot remains published.`,
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
        body: action === "save" ? JSON.stringify({ secret }) : undefined,
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
        itemCount?: number;
      };
      if (!response.ok) {
        setMessage(result.error ?? `Request failed (${response.status}).`);
        return;
      }

      setSecret("");
      setMessage(
        action === "save"
          ? "Credential encrypted and saved. You can sync now."
          : action === "disconnect"
            ? "Credential removed. The last public snapshot was preserved."
            : result.status === "already_running"
              ? "A sync is already running."
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
          <label htmlFor={`${connector.provider}-secret`}>
            {connector.provider === "myanimelist"
              ? "OAuth access token"
              : "API authorization token"}
          </label>
          <div className={styles.inputRow}>
            <input
              id={`${connector.provider}-secret`}
              type="password"
              value={secret}
              minLength={8}
              maxLength={8192}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="Paste once; it will not be shown again"
              required
            />
            <button type="submit" disabled={pending !== null}>
              {pending === "save" ? "Saving…" : "Connect"}
            </button>
          </div>
          <p>
            Stored with AES-256-GCM. The public API receives only the normalized
            snapshot.
          </p>
        </form>
      ) : (
        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={pending !== null}
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
