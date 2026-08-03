"use client";

import { animate } from "animejs";
import Image from "next/image";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./SpotifyStream.module.css";

type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";

type PublicArtwork = {
  src: `/api/connector-artwork/${string}/${string}`;
  aspect: "poster" | "square";
};

type SpotifyTrackSummary = {
  id: string;
  position: number;
  title: string;
  artists: Array<{ id: string; name: string }>;
  album: {
    id: string;
    title: string;
    releaseYear: number | null;
    artwork: PublicArtwork | null;
  };
  durationMs: number;
  explicit: boolean;
};

type SpotifyEmbedReference = {
  kind: "track" | "album" | "playlist";
  spotifyId: string;
};

type SpotifyPublicSnapshot = {
  provider: "spotify";
  profileUrl: string;
  coverage: "Spotify-calculated affinity; not play counts" | string;
  windows: Record<
    SpotifyTimeRange,
    {
      tracks: SpotifyTrackSummary[];
    }
  >;
  syncedAt: string;
  freshUntil: string;
};

type SpotifyState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | {
      status: "fallback";
      message: string;
      profileUrl: string | null;
      fallbackEmbed: SpotifyEmbedReference | null;
    }
  | {
      status: "ready";
      payload: SpotifyPublicSnapshot;
      fetchedAt: string;
      stale: boolean;
    };

type SpotifyView = "groove" | "covers";
type RankSurface = "groove" | "rail";

const timeRanges: ReadonlyArray<{
  id: SpotifyTimeRange;
  label: string;
  shortLabel: string;
}> = [
  { id: "short_term", label: "Last approximately 4 weeks", shortLabel: "~4 weeks" },
  { id: "medium_term", label: "Last approximately 6 months", shortLabel: "~6 months" },
  { id: "long_term", label: "About 1 year", shortLabel: "~1 year" },
];

const grooveCenter = 210;
const grooveRadius = 154;

async function loadSpotify(signal: AbortSignal): Promise<SpotifyState> {
  try {
    const response = await fetch("/api/connectors/spotify", {
      headers: { Accept: "application/json" },
      signal,
    });
    const body = (await response.json()) as {
      status?: string;
      message?: string;
      payload?: SpotifyPublicSnapshot;
      fetchedAt?: string;
      stale?: boolean;
      profileUrl?: string | null;
      fallbackEmbed?: SpotifyEmbedReference | null;
    };

    if (response.ok && body.status === "ready" && body.payload) {
      return {
        status: "ready",
        payload: body.payload,
        fetchedAt: body.fetchedAt ?? "",
        stale: Boolean(body.stale),
      };
    }

    if (response.ok && body.status === "fallback") {
      return {
        status: "fallback",
        message:
          body.message ??
          "Top Tracks are not published, so only the owner-selected Spotify reference is available.",
        profileUrl: body.profileUrl ?? null,
        fallbackEmbed: body.fallbackEmbed ?? null,
      };
    }

    return {
      status: "unavailable",
      message:
        body.message ??
        "This Spotify stream has not been published from the owner studio yet.",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      status: "unavailable",
      message: "The last public Spotify snapshot is temporarily unavailable.",
    };
  }
}

export function SpotifyStream({
  active = true,
  serverFallback,
}: {
  active?: boolean;
  serverFallback?: ReactNode;
}) {
  const [state, setState] = useState<SpotifyState>({ status: "loading" });
  const requested = useRef(false);

  useEffect(() => {
    if (!active || requested.current) return;
    requested.current = true;
    const controller = new AbortController();
    let completed = false;
    void loadSpotify(controller.signal)
      .then((next) => {
        completed = true;
        if (!controller.signal.aborted) setState(next);
      })
      .catch(() => {
        // An inactive tab cancels the request without surfacing an error.
      });
    return () => {
      controller.abort();
      if (!completed) requested.current = false;
    };
  }, [active]);

  if (state.status === "loading") {
    return serverFallback ? (
      <div className={styles.serverFoundation}>{serverFallback}</div>
    ) : (
      <SpotifyMessage loading message="Loading the last public snapshot…" />
    );
  }

  if (state.status === "unavailable") {
    return <SpotifyMessage message={state.message} />;
  }

  if (state.status === "fallback") {
    return (
      <SpotifyFallback
        embed={state.fallbackEmbed}
        message={state.message}
        profileUrl={state.profileUrl}
      />
    );
  }

  return (
    <SpotifyRankedGroove
      fetchedAt={state.fetchedAt}
      payload={state.payload}
      stale={state.stale}
    />
  );
}

function SpotifyRankedGroove({
  payload,
  fetchedAt,
  stale,
}: {
  payload: SpotifyPublicSnapshot;
  fetchedAt: string;
  stale: boolean;
}) {
  const [range, setRange] = useState<SpotifyTimeRange>("short_term");
  const [view, setView] = useState<SpotifyView>("groove");
  const initialTracks = payload.windows.short_term?.tracks.slice(0, 12) ?? [];
  const [selectedId, setSelectedId] = useState(initialTracks[0]?.id ?? "");
  const [playerTrackId, setPlayerTrackId] = useState<string | null>(null);
  const [playerConsent, setPlayerConsent] = useState(false);
  const playerInvoker = useRef<HTMLElement | null>(null);
  const playerRegion = useRef<HTMLElement | null>(null);
  const needle = useRef<SVGGElement | null>(null);
  const selectionRule = useRef<HTMLSpanElement | null>(null);
  const previousAngle = useRef(0);
  const grooveMarks = useRef<Array<HTMLButtonElement | null>>([]);
  const railButtons = useRef<Array<HTMLButtonElement | null>>([]);

  const tracks = (payload.windows[range]?.tracks ?? []).slice(0, 12);
  const selectedIndex = Math.max(
    tracks.findIndex((track) => track.id === selectedId),
    0,
  );
  const selectedTrack = tracks[selectedIndex] ?? null;
  const selectedAngle = tracks.length
    ? (selectedIndex / tracks.length) * 360
    : 0;
  const playerTrack = tracks.find((track) => track.id === playerTrackId) ?? null;

  useLayoutEffect(() => {
    const needleElement = needle.current;
    const ruleElement = selectionRule.current;
    if (!needleElement) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startAngle = previousAngle.current;
    const normalizedStart = ((startAngle % 360) + 360) % 360;
    const shortestDelta =
      ((((selectedAngle - normalizedStart) % 360) + 540) % 360) - 180;
    const targetAngle = startAngle + shortestDelta;
    if (reduced) {
      needleElement.style.transform = `rotate(${selectedAngle}deg)`;
      if (ruleElement) {
        ruleElement.style.opacity = "1";
        ruleElement.style.transform = "scaleX(1)";
      }
      previousAngle.current = selectedAngle;
      return;
    }

    const needleMotion = animate(needleElement, {
      rotate: [`${startAngle}deg`, `${targetAngle}deg`],
      duration: 220,
      ease: "out(3)",
    });
    const ruleMotion = ruleElement
      ? animate(ruleElement, {
          opacity: [0.45, 1],
          scaleX: [0.12, 1],
          duration: 180,
          ease: "out(3)",
        })
      : null;
    previousAngle.current = targetAngle;

    return () => {
      needleMotion.cancel();
      ruleMotion?.cancel();
      needleElement.style.transform = `rotate(${targetAngle}deg)`;
      if (ruleElement) {
        ruleElement.style.opacity = "1";
        ruleElement.style.transform = "scaleX(1)";
      }
    };
  }, [selectedAngle]);

  useEffect(() => {
    if (playerTrack) {
      requestAnimationFrame(() => playerRegion.current?.focus());
    }
  }, [playerConsent, playerTrack]);

  const closePlayer = (restoreFocus: boolean) => {
    setPlayerTrackId(null);
    setPlayerConsent(false);
    if (restoreFocus) {
      requestAnimationFrame(() => playerInvoker.current?.focus());
    }
  };

  const selectTrack = (track: SpotifyTrackSummary) => {
    setSelectedId(track.id);
    if (playerTrackId && playerTrackId !== track.id) closePlayer(false);
  };

  const selectRange = (next: SpotifyTimeRange) => {
    const nextTracks = (payload.windows[next]?.tracks ?? []).slice(0, 12);
    setRange(next);
    setSelectedId(nextTracks[0]?.id ?? "");
    closePlayer(false);
  };

  const selectView = (next: SpotifyView) => {
    closePlayer(false);
    setView(next);
  };

  const listenHere = (
    track: SpotifyTrackSummary,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    playerInvoker.current = event.currentTarget;
    setSelectedId(track.id);
    setPlayerTrackId(track.id);
    setPlayerConsent(false);
  };

  const onRankKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    surface: RankSurface,
  ) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % tracks.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + tracks.length) % tracks.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tracks.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectTrack(tracks[next]);
    const targets = surface === "groove" ? grooveMarks.current : railButtons.current;
    requestAnimationFrame(() => targets[next]?.focus());
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2>Top Tracks, in returned order.</h2>
          <p>{payload.coverage}</p>
        </div>
        <div className={styles.viewSwitch} role="group" aria-label="Spotify view">
          <button
            aria-pressed={view === "groove"}
            onClick={() => selectView("groove")}
            type="button"
          >
            Groove
          </button>
          <button
            aria-pressed={view === "covers"}
            onClick={() => selectView("covers")}
            type="button"
          >
            Covers
          </button>
        </div>
      </header>

      <div className={styles.rangeBar} role="group" aria-label="Spotify Top Tracks time window">
        <span>Window</span>
        {timeRanges.map((entry) => (
          <button
            aria-label={entry.label}
            aria-pressed={range === entry.id}
            key={entry.id}
            onClick={() => selectRange(entry.id)}
            type="button"
          >
            {entry.shortLabel}
          </button>
        ))}
      </div>

      <p className={styles.rangeStatus} aria-live="polite">
        Showing {tracks.length} Spotify Top Track{tracks.length === 1 ? "" : "s"} for{" "}
        {timeRanges.find((entry) => entry.id === range)?.label.toLowerCase()}.
      </p>

      {tracks.length ? (
        view === "groove" ? (
          <div className={styles.grooveLayout}>
            <div className={styles.grooveStage}>
              <div className={styles.grooveDisc}>
                <svg
                  aria-hidden="true"
                  className={styles.groove}
                  focusable="false"
                  viewBox="0 0 420 420"
                >
                  <circle className={styles.grooveOuter} cx="210" cy="210" r="190" />
                  {[70, 100, 130, 160].map((radius) => (
                    <circle
                      className={styles.grooveLine}
                      cx="210"
                      cy="210"
                      key={radius}
                      r={radius}
                    />
                  ))}
                  <g
                    className={styles.needle}
                    ref={needle}
                    style={{ transform: `rotate(${selectedAngle}deg)` }}
                  >
                    <line x1="210" x2="210" y1="210" y2="66" />
                    <circle cx="210" cy="210" r="8" />
                  </g>
                </svg>
                <ol
                  className={styles.grooveControls}
                  aria-label="Spotify Top Tracks in returned order"
                >
                {tracks.map((track, index) => {
                  const point = groovePoint(index, tracks.length);
                  const selected = track.id === selectedTrack?.id;
                  return (
                    <li
                      key={`${track.id}:${track.position}`}
                      style={{
                        left: `${(point.x / 420) * 100}%`,
                        top: `${(point.y / 420) * 100}%`,
                      }}
                    >
                      <button
                        aria-label={`Rank ${track.position}, ${track.title} by ${artistLabel(track)}`}
                        aria-pressed={selected}
                        onClick={() => selectTrack(track)}
                        onKeyDown={(event) => onRankKeyDown(event, index, "groove")}
                        ref={(element) => {
                          grooveMarks.current[index] = element;
                        }}
                        tabIndex={selected ? 0 : -1}
                        type="button"
                      >
                        {track.position}
                      </button>
                    </li>
                  );
                })}
                </ol>
              </div>

              <ol className={styles.rankRail} aria-label="Spotify Top Tracks in returned order">
                {tracks.map((track, index) => {
                  const selected = track.id === selectedTrack?.id;
                  return (
                    <li key={`${track.id}:${track.position}`}>
                      <button
                        aria-label={`Rank ${track.position}, ${track.title} by ${artistLabel(track)}`}
                        aria-pressed={selected}
                        onClick={() => selectTrack(track)}
                        onKeyDown={(event) => onRankKeyDown(event, index, "rail")}
                        ref={(element) => {
                          railButtons.current[index] = element;
                        }}
                        tabIndex={selected ? 0 : -1}
                        type="button"
                      >
                        <span>{String(track.position).padStart(2, "0")}</span>
                        <strong>{track.title}</strong>
                        <small>{artistLabel(track)}</small>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {selectedTrack ? (
              <TrackInspector
                listenHere={listenHere}
                ruleRef={selectionRule}
                track={selectedTrack}
              />
            ) : null}
          </div>
        ) : (
          <CoverGallery listenHere={listenHere} tracks={tracks} />
        )
      ) : (
        <SpotifyMessage message="Spotify returned no Top Tracks for this time window." />
      )}

      {playerTrack ? (
        playerConsent ? (
          <SpotifyPlayer
            onClose={() => closePlayer(true)}
            playerRef={playerRegion}
            track={playerTrack}
          />
        ) : (
          <SpotifyTrackConsent
            onCancel={() => closePlayer(true)}
            onConfirm={() => setPlayerConsent(true)}
            playerRef={playerRegion}
            track={playerTrack}
          />
        )
      ) : null}

      <SpotifyAttribution />
      <div className={styles.status}>
        <span>{stale ? "Last-known-good snapshot" : "Current public snapshot"}</span>
        <span>{syncLabel(payload.syncedAt || fetchedAt)}</span>
        <a href={payload.profileUrl} rel="noreferrer" target="_blank">
          Open Spotify profile
        </a>
      </div>
    </>
  );
}

function TrackInspector({
  track,
  listenHere,
  ruleRef,
}: {
  track: SpotifyTrackSummary;
  listenHere: (
    track: SpotifyTrackSummary,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  ruleRef: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <article className={styles.inspector}>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles.selectionAnnouncement}
      >
        Rank {track.position}, {track.title} by {artistLabel(track)} selected.
      </p>
      <span aria-hidden="true" className={styles.selectionRule} ref={ruleRef} />
      <div className={styles.inspectorRank}>
        <span>Returned rank</span>
        <strong>{String(track.position).padStart(2, "0")}</strong>
      </div>
      <a
        aria-label={`${track.title} by ${artistLabel(track)} — open on Spotify`}
        className={styles.inspectorArtworkLink}
        href={spotifyTrackUrl(track.id)}
        rel="noreferrer"
        target="_blank"
      >
        <SpotifyArtwork track={track} />
      </a>
      <div className={styles.inspectorCopy}>
        <h3>
          <a href={spotifyTrackUrl(track.id)} rel="noreferrer" target="_blank">
            {track.title}
          </a>
        </h3>
        <p>{artistLabel(track)}</p>
        <dl>
          <div>
            <dt>Album</dt>
            <dd>{track.album.title}</dd>
          </div>
          <div>
            <dt>Released</dt>
            <dd>{track.album.releaseYear ?? "—"}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{durationLabel(track.durationMs)}</dd>
          </div>
          {track.explicit ? (
            <div>
              <dt>Content</dt>
              <dd>Explicit</dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className={styles.trackActions}>
        <a href={spotifyTrackUrl(track.id)} rel="noreferrer" target="_blank">
          Listen on Spotify ↗
        </a>
        <button onClick={(event) => listenHere(track, event)} type="button">
          Listen here
        </button>
        <small>Opens a consent step before loading Spotify’s official player.</small>
      </div>
    </article>
  );
}

function CoverGallery({
  tracks,
  listenHere,
}: {
  tracks: SpotifyTrackSummary[];
  listenHere: (
    track: SpotifyTrackSummary,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  return (
    <div className={styles.covers}>
      <p className={styles.coverNote}>
        Album artwork is shown as supplied. “Listen here” opens a consent step
        for one official Spotify player.
      </p>
      <ol aria-label="Spotify Top Tracks cover gallery">
        {tracks.map((track) => (
          <li key={`${track.id}:${track.position}`}>
            <article>
              <a
                aria-label={`Rank ${track.position}, ${track.title} by ${artistLabel(track)} — open on Spotify`}
                className={styles.coverLink}
                href={spotifyTrackUrl(track.id)}
                rel="noreferrer"
                target="_blank"
              >
                <SpotifyArtwork track={track} />
                <span className={styles.coverRank}>
                  {String(track.position).padStart(2, "0")}
                </span>
                <strong>{track.title}</strong>
                <small>{artistLabel(track)}</small>
                <span>
                  {[track.album.title, track.album.releaseYear]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </a>
              <button onClick={(event) => listenHere(track, event)} type="button">
                Listen here
              </button>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SpotifyArtwork({ track }: { track: SpotifyTrackSummary }) {
  const artworkSrc = track.album.artwork?.src ?? null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <span className={styles.artwork}>
      {artworkSrc && artworkSrc !== failedSrc ? (
        <Image
          alt=""
          decoding="async"
          height={640}
          loading="lazy"
          onError={() => setFailedSrc(artworkSrc)}
          src={artworkSrc}
          unoptimized
          width={640}
        />
      ) : (
        <span aria-hidden="true">LISTEN</span>
      )}
    </span>
  );
}

function SpotifyTrackConsent({
  track,
  playerRef,
  onCancel,
  onConfirm,
}: {
  track: SpotifyTrackSummary;
  playerRef: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      aria-label={`Load Spotify player for ${track.title}`}
      className={styles.consent}
      ref={playerRef}
      tabIndex={-1}
    >
      <span>
        <strong>Spotify content is blocked by default.</strong>
        <small>
          Loading shares the usual request information with Spotify. Playback
          does not start automatically.
        </small>
      </span>
      <div className={styles.consentActions}>
        <button onClick={onConfirm} type="button">
          Load Spotify player
        </button>
        <button onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </section>
  );
}

function SpotifyPlayer({
  track,
  playerRef,
  onClose,
}: {
  track: SpotifyTrackSummary;
  playerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`Spotify player for ${track.title}`}
      className={styles.player}
      ref={playerRef}
      tabIndex={-1}
    >
      <header>
        <span>
          <small>Official Spotify player</small>
          <strong>{track.title}</strong>
        </span>
        <button onClick={onClose} type="button">
          Close player
        </button>
      </header>
      <iframe
        allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={spotifyEmbedUrl("track", track.id)}
        title={`Listen to ${track.title} by ${artistLabel(track)} on Spotify`}
      />
    </section>
  );
}

function SpotifyFallback({
  message,
  profileUrl,
  embed,
}: {
  message: string;
  profileUrl: string | null;
  embed: SpotifyEmbedReference | null;
}) {
  const [showEmbed, setShowEmbed] = useState(false);
  const loadButton = useRef<HTMLButtonElement | null>(null);
  const embedRegion = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (showEmbed) requestAnimationFrame(() => embedRegion.current?.focus());
  }, [showEmbed]);

  const fallbackUrl = embed
    ? `https://open.spotify.com/${embed.kind}/${encodeURIComponent(embed.spotifyId)}`
    : null;

  return (
    <>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2>Listen, by reference.</h2>
          <p>{message}</p>
        </div>
      </header>
      {embed ? (
        showEmbed ? (
          <section
            aria-label="Owner-selected Spotify player"
            className={styles.player}
            data-embed-kind={embed.kind}
            ref={embedRegion}
            tabIndex={-1}
          >
            <header>
              <span>
                <small>Official Spotify player</small>
                <strong>Owner-selected {embed.kind}</strong>
              </span>
              <button
                onClick={() => {
                  setShowEmbed(false);
                  requestAnimationFrame(() => loadButton.current?.focus());
                }}
                type="button"
              >
                Close player
              </button>
            </header>
            <iframe
              allow="clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={spotifyEmbedUrl(embed.kind, embed.spotifyId)}
              title={`Owner-selected Spotify ${embed.kind}`}
            />
          </section>
        ) : (
          <div className={styles.consent}>
            <span>
              <strong>Spotify content is blocked by default.</strong>
              <small>Loading shares the usual request information with Spotify.</small>
            </span>
            <button
              onClick={() => setShowEmbed(true)}
              ref={loadButton}
              type="button"
            >
              Load Spotify player
            </button>
          </div>
        )
      ) : (
        <SpotifyMessage message="No owner-selected player is published right now." />
      )}
      {fallbackUrl ? (
        <div className={styles.status}>
          <span>Owner-selected {embed?.kind}</span>
          <a href={fallbackUrl} rel="noreferrer" target="_blank">
            Listen on Spotify
          </a>
        </div>
      ) : null}
      <SpotifyAttribution />
      {profileUrl ? (
        <div className={styles.status}>
          <span>Profile-link fallback</span>
          <a href={profileUrl} rel="noreferrer" target="_blank">
            Open Spotify profile
          </a>
        </div>
      ) : null}
    </>
  );
}

function SpotifyMessage({
  message,
  loading = false,
}: {
  message: string;
  loading?: boolean;
}) {
  return (
    <div className={styles.message} aria-live="polite">
      <span aria-hidden="true">{loading ? "···" : "○"}</span>
      <p>{message}</p>
    </div>
  );
}

function SpotifyAttribution() {
  return (
    <div className={styles.attribution}>
      <a
        aria-label="Data and playback provided by Spotify"
        href="https://www.spotify.com/"
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt="Spotify"
          height={44}
          src="/spotify-full-logo-black.svg"
          unoptimized
          width={144}
        />
      </a>
      <span>Top Tracks are Spotify-calculated affinity, not play counts.</span>
    </div>
  );
}

function groovePoint(index: number, total: number) {
  const angle = total ? (index / total) * Math.PI * 2 : 0;
  return {
    x: grooveCenter + Math.sin(angle) * grooveRadius,
    y: grooveCenter - Math.cos(angle) * grooveRadius,
  };
}

function artistLabel(track: SpotifyTrackSummary) {
  return track.artists.map((artist) => artist.name).join(", ");
}

function durationLabel(durationMs: number) {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function spotifyTrackUrl(id: string) {
  return `https://open.spotify.com/track/${encodeURIComponent(id)}`;
}

function spotifyEmbedUrl(
  kind: SpotifyEmbedReference["kind"],
  id: string,
) {
  return `https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}`;
}

function syncLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sync date unavailable";
  return `Synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}
