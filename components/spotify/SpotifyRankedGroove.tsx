"use client";

import { animate } from "animejs";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "../SpotifyStream.module.css";
import {
  CoverGallery,
  SpotifyPlayer,
  SpotifyTrackConsent,
  TrackInspector,
} from "./SpotifyTrackPresentation";
import { SpotifyAttribution, SpotifyMessage } from "./SpotifyFallback";
import {
  artistLabel,
  groovePoint,
  syncLabel,
  timeRanges,
  type RankSurface,
  type SpotifyPublicSnapshot,
  type SpotifyTimeRange,
  type SpotifyTrackSummary,
  type SpotifyView,
} from "./model";

export function SpotifyRankedGroove({
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
