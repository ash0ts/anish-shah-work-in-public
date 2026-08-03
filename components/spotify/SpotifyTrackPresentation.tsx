"use client";

import Image from "next/image";
import { type MouseEvent, type RefObject, useState } from "react";
import styles from "../SpotifyStream.module.css";
import {
  artistLabel,
  durationLabel,
  spotifyEmbedUrl,
  spotifyTrackUrl,
  type SpotifyTrackSummary,
} from "./model";

export function TrackInspector({
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
export function CoverGallery({
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

export function SpotifyArtwork({ track }: { track: SpotifyTrackSummary }) {
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

export function SpotifyTrackConsent({
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

export function SpotifyPlayer({
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
