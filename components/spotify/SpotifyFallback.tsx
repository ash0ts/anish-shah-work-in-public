"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "../SpotifyStream.module.css";
import { spotifyEmbedUrl, type SpotifyEmbedReference } from "./model";

export function SpotifyFallback({
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
export function SpotifyMessage({
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

export function SpotifyAttribution() {
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
