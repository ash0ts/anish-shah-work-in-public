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
    {
      href: "https://www.discogs.com/settings/developers",
      label: "Open developer settings",
    },
    {
      href: "https://www.discogs.com/developers/",
      label: "Read API documentation",
    },
    {
      href: "https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use",
      label: "Review API terms",
    },
  ],
  summary:
    "Authorize the owner collection, synchronize physical releases, then make a separate decision about public display. Copies and distinct releases remain separate.",
  recovery:
    "If Discogs denies authorization, start again from this panel. A 401 requires reauthorization; a rate limit should be retried only after its wait period. The public catalog expires six hours after its last successful synchronization.",
};

type Props = ProviderPanelProps & {
  callbackUrl: string | null;
};

export function DiscogsConnectorPanel({ callbackUrl, ...props }: Props) {
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
          requestKeys: {
            id: "consumerKey",
            secret: "consumerSecret",
          },
          showsAccessTokenExpiry: false,
        },
      }}
    >
      <DiscogsPresentationControls
        key={[
          props.connector.configured ? "configured" : "disconnected",
          props.connector.status,
          props.connector.lastSyncedAt ?? "never-synced",
        ].join(":")}
        configured={props.connector.configured}
        environment={props.environment}
        lastSyncedAt={props.connector.lastSyncedAt}
      />
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
  lastSyncedAt,
}: {
  configured: boolean;
  environment: Environment;
  lastSyncedAt: string | null;
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
        if (
          response.ok &&
          result.config &&
          "publishCollection" in result.config
        ) {
          setState({ phase: "ready", config: result.config });
          setPublishCollection(result.config.publishCollection);
          return;
        }
        setState({
          phase: "error",
          message:
            result.error ??
            "Discogs display settings could not be checked. Reload Studio and try again.",
        });
      })
      .catch(() => {
        if (active) {
          setState({
            phase: "error",
            message:
              "Discogs display settings could not be checked. Reload Studio and try again.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(): Promise<void> {
    if (publishCollection && !configured) {
      setMessage("Authorize and refresh Discogs before publishing the catalog.");
      return;
    }
    if (publishCollection && !acknowledged) {
      setMessage(
        "Acknowledge the personal, noncommercial public display before publishing.",
      );
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/studio/connectors/discogs/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publishCollection,
          acknowledgeNoncommercial: publishCollection ? acknowledged : false,
        }),
      });
      const result = await responseJson(response);
      if (
        !response.ok ||
        !result.config ||
        !("publishCollection" in result.config)
      ) {
        setMessage(
          result.error ??
            "Discogs display settings could not be saved. Review the acknowledgement and try again.",
        );
        return;
      }
      setState({ phase: "ready", config: result.config });
      setPublishCollection(result.config.publishCollection);
      setAcknowledged(false);
      setMessage(
        result.config.publishCollection
          ? environment === "local"
            ? "The collection is visible in the local sandbox only. Production still requires separate authorization and review."
            : "The physical collection is published for noncommercial display."
          : "The Discogs collection is private.",
      );
    } catch {
      setMessage("Discogs display settings could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  const config = state.phase === "ready" ? state.config : null;

  return (
    <section
      className={styles.spotifyPublication}
      aria-labelledby="discogs-display-title"
    >
      <div className={styles.spotifyPublicationLead}>
        <div>
          <p className={styles.spotifyPublicationLabel}>Public display</p>
          <h4 id="discogs-display-title">Choose what leaves Studio.</h4>
        </div>
        {config ? (
          <dl>
            <div>
              <dt>Collection</dt>
              <dd>{config.publishCollection ? "Published" : "Private"}</dd>
            </div>
            <div>
              <dt>Last review</dt>
              <dd>
                {config.reviewedAt
                  ? formatTimestamp(config.reviewedAt)
                  : "Not yet reviewed"}
              </dd>
            </div>
            <div>
              <dt>Public cutoff</dt>
              <dd>{formatTimestamp(discogsPublicCutoff(lastSyncedAt))}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {state.phase === "loading" ? (
        <p className={styles.configStatus} role="status">
          Checking display settings…
        </p>
      ) : state.phase === "error" ? (
        <p className={styles.configStatus} role="alert">
          {state.message}
        </p>
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
              checked={publishCollection}
              disabled={pending}
              onChange={(event) => {
                setPublishCollection(event.target.checked);
                setAcknowledged(false);
              }}
            />
            <span>
              <strong>Publish physical collection publicly</strong>
              <small>
                Show sanitized titles, artists, years, formats, copy counts,
                and aggregate patterns. Private collection fields remain
                excluded.
              </small>
            </span>
          </label>

          {publishCollection ? (
            <label className={styles.publicationAcknowledgement}>
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={pending}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I reviewed this as a personal, noncommercial catalog and will
                keep Discogs attribution and non-affiliation wording visible.
              </span>
            </label>
          ) : null}

          <div className={styles.formActions}>
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save Discogs display"}
            </button>
          </div>
        </form>
      )}

      {message ? (
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
      {config?.publishCollection ? (
        <p className={styles.publicStreamLink}>
          <a href="/play/collect" rel="noreferrer" target="_blank">
            View the published Collect stream
          </a>
        </p>
      ) : null}
      <p className={styles.spotifyIsolationNote}>
        {environment === "local"
          ? "Local authorization, snapshots, and publication choice stay on this machine. Discogs is excluded from the production handoff."
          : "This public-display decision is independent of local Studio. Disconnecting deletes the credential, catalog, and publication choice."}
      </p>
    </section>
  );
}

function discogsPublicCutoff(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 6 * 60 * 60 * 1000).toISOString()
    : null;
}
