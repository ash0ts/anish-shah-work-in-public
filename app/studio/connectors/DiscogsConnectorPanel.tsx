"use client";

import { useEffect, useState } from "react";
import styles from "../studio.module.css";
import { ApiConnectorPanel } from "./ApiConnectorPanel";
import { formatTimestamp, responseJson } from "./helpers";
import type {
  DiscogsPresentationConfig,
  Environment,
  ProviderMeta,
  ProviderPanelProps,
} from "./model";

const meta: ProviderMeta = {
  stream: "Collect",
  title: "Discogs",
  requirement: "Consumer key + consumer secret",
  sources: [
    { href: "https://www.discogs.com/settings/developers", label: "Open developer settings" },
    { href: "https://www.discogs.com/developers/", label: "Read API documentation" },
    { href: "https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use", label: "Review API terms" },
  ],
  summary:
    "Authorize the owner collection, synchronize physical releases, then make a separate decision about public display.",
  recovery:
    "A 401 requires reauthorization. Retry rate limits only after their wait period. Failed refreshes preserve the accepted catalog.",
};

type Props = ProviderPanelProps & { callbackUrl: string | null };

export function DiscogsConnectorPanel({ callbackUrl, ...props }: Props) {
  const presentationMode =
    props.view.primaryAction === "publish"
      ? "publish"
      : props.view.presentation.status === "published"
        ? "advanced"
        : null;
  return (
    <ApiConnectorPanel
      {...props}
      meta={meta}
      oauth={{
        provider: "discogs",
        title: "Discogs",
        startPath: "/api/studio/connectors/discogs/oauth/start",
        callbackUrl,
        credentialShape: {
          idLabel: "Consumer key",
          secretLabel: "Consumer secret",
          requestKeys: { id: "consumerKey", secret: "consumerSecret" },
          showsAccessTokenExpiry: false,
        },
      }}
      advancedChildren={
        presentationMode === "advanced" ? (
          <DiscogsPresentationControls
            key={`advanced:${props.connector.lastSyncedAt ?? "never"}`}
            configured={props.connector.configured}
            environment={props.environment}
            mode="advanced"
            lastSyncedAt={props.connector.lastSyncedAt}
            onUpdated={props.onPermissionUpdated}
          />
        ) : null
      }
    >
      {presentationMode === "publish" ? (
        <DiscogsPresentationControls
          key={`publish:${props.connector.lastSyncedAt ?? "never"}`}
          configured={props.connector.configured}
          environment={props.environment}
          mode="publish"
          lastSyncedAt={props.connector.lastSyncedAt}
          onUpdated={props.onPermissionUpdated}
        />
      ) : null}
    </ApiConnectorPanel>
  );
}

type ConfigState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; config: DiscogsPresentationConfig };

function DiscogsPresentationControls({
  configured,
  environment,
  mode,
  lastSyncedAt,
  onUpdated,
}: {
  configured: boolean;
  environment: Environment;
  mode: "publish" | "advanced";
  lastSyncedAt: string | null;
  onUpdated: (message?: string) => Promise<void>;
}) {
  const [state, setState] = useState<ConfigState>({ phase: "loading" });
  const [publishCollection, setPublishCollection] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/studio/connectors/discogs/config", { cache: "no-store" })
      .then(async (response) => {
        const result = await responseJson(response);
        if (!active) return;
        if (response.ok && result.config && "publishCollection" in result.config) {
          const config = result.config as DiscogsPresentationConfig;
          setState({ phase: "ready", config });
          setPublishCollection(config.publishCollection);
          return;
        }
        setState({ phase: "error", message: result.error ?? "Discogs display settings could not be checked." });
      })
      .catch(() => {
        if (active) setState({ phase: "error", message: "Discogs display settings could not be checked." });
      });
    return () => { active = false; };
  }, []);

  async function save(nextPublishCollection = publishCollection) {
    if (nextPublishCollection && !configured) {
      setMessage("Authorize and refresh Discogs before publishing the catalog.");
      return;
    }
    if (mode === "publish" && nextPublishCollection && !acknowledged) {
      setMessage("Acknowledge the personal, noncommercial public display before publishing.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/studio/connectors/discogs/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publishCollection: nextPublishCollection,
          acknowledgeNoncommercial:
            mode === "publish" && nextPublishCollection
              ? acknowledged
              : false,
        }),
      });
      const result = await responseJson(response);
      if (!response.ok || !result.config || !("publishCollection" in result.config)) {
        setMessage(result.error ?? "Discogs display settings could not be saved.");
        return;
      }
      const config = result.config as DiscogsPresentationConfig;
      setState({ phase: "ready", config });
      setPublishCollection(config.publishCollection);
      setAcknowledged(false);
      const success = config.publishCollection
        ? environment === "local"
          ? "Visible in the local sandbox only."
          : "The physical collection is published."
        : "The Discogs collection is private.";
      setMessage(success);
      await onUpdated(success);
    } catch {
      setMessage("Discogs display settings could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <p className={styles.configStatus} role="status">
        Checking display settings…
      </p>
    );
  }
  if (state.phase === "error") {
    return (
      <p className={styles.formMessage} role="alert">
        {state.message}
      </p>
    );
  }

  return (
    <section className={styles.spotifyPublication} aria-labelledby="discogs-display-title">
      <div className={styles.spotifyPublicationLead}>
        <div>
          <p className={styles.spotifyPublicationLabel}>Public display</p>
          <h4 id="discogs-display-title">Choose what leaves Studio.</h4>
        </div>
        <dl>
          <div><dt>Collection</dt><dd>{state.config.publishCollection ? "Published" : "Private"}</dd></div>
          <div><dt>Last review</dt><dd>{state.config.reviewedAt ? formatTimestamp(state.config.reviewedAt) : "Not yet reviewed"}</dd></div>
          <div><dt>Updated</dt><dd>{formatTimestamp(lastSyncedAt)}</dd></div>
        </dl>
      </div>
      <form className={styles.spotifyPublicationForm} onSubmit={(event) => { event.preventDefault(); void save(mode === "publish" ? true : publishCollection); }}>
        {mode === "publish" ? (
          <label className={styles.publicationAcknowledgement}>
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            Publish this sanitized collection as a personal, noncommercial display.
          </label>
        ) : null}
        {mode === "publish" ? (
          <button
            type="submit"
            data-studio-primary-action
            disabled={pending}
          >
            {pending ? "Saving…" : "Publish"}
          </button>
        ) : state.config.publishCollection ? (
          <button
            type="button"
            className={styles.quietButton}
            disabled={pending}
            onClick={() => void save(false)}
          >
            {pending ? "Saving…" : "Make collection private"}
          </button>
        ) : null}
        {message ? <p role="status" className={styles.formMessage}>{message}</p> : null}
      </form>
    </section>
  );
}
