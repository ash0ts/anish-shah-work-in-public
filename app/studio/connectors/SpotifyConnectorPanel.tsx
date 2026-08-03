"use client";

import { useEffect, useState } from "react";
import styles from "../studio.module.css";
import { ApiConnectorPanel } from "./ApiConnectorPanel";
import { formatTimestamp, responseJson } from "./helpers";
import type {
  Environment,
  ProviderMeta,
  ProviderPanelProps,
  SpotifyPresentationConfig,
} from "./model";

const meta: ProviderMeta = {
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
};

type Props = ProviderPanelProps & {
  callbackUrl: string | null;
};

export function SpotifyConnectorPanel({ callbackUrl, ...props }: Props) {
  return (
    <ApiConnectorPanel
      {...props}
      meta={meta}
      oauth={{
        provider: "spotify",
        title: "Spotify",
        startPath: "/api/studio/connectors/spotify/oauth/start",
        callbackUrl,
      }}
    >
      <SpotifyPresentationControls
        configured={props.connector.configured}
        environment={props.environment}
      />
    </ApiConnectorPanel>
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
        if (
          response.ok &&
          result.config &&
          "publishTopTracks" in result.config
        ) {
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
      setMessage(
        "Acknowledge the public-display qualification before publishing.",
      );
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
      if (
        !response.ok ||
        !result.config ||
        !("publishTopTracks" in result.config)
      ) {
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
    <section
      className={styles.spotifyPublication}
      aria-labelledby="spotify-display-title"
    >
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
              <dd>
                {config.fallbackEmbed
                  ? `Official ${config.fallbackEmbed.kind}`
                  : "None"}
              </dd>
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
        <p className={styles.formMessage} role="status">
          {message}
        </p>
      ) : null}
      <p className={styles.spotifyIsolationNote}>
        {environment === "local"
          ? "Local authorization, snapshots, fallback, and publication choice stay on this machine. None are included in the production handoff."
          : "This production decision is independent of local Studio and can be revoked without disconnecting the app."}
      </p>
    </section>
  );
}
