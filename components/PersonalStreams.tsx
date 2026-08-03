"use client";

import { type KeyboardEvent, type ReactNode, useState } from "react";
import { CollectionStream } from "./play/CollectionStream";
import { DiscogsStream } from "./play/DiscogsStream";
import { MovementStream } from "./play/MovementStream";
import styles from "./PersonalStreams.module.css";
import { SpotifyStream } from "./SpotifyStream";
import type { PreviewFixtureScenario, StreamId } from "./play/connector-model";

const streams = [
  {
    id: "watch",
    label: "Watch",
    provider: "MyAnimeList",
    fallback: "Public watch states, genre patterns, eras, and recent activity.",
  },
  {
    id: "read",
    label: "Read",
    provider: "Hardcover",
    fallback: "Reading states, ratings, and a public shelf.",
  },
  {
    id: "listen",
    label: "Listen",
    provider: "Spotify",
    fallback:
      "Spotify-calculated Top Tracks across three time windows, shown as an ordinal ranked groove rather than play counts.",
  },
  {
    id: "collect",
    label: "Collect",
    provider: "Discogs",
    fallback:
      "A public physical-media catalog, with copies and distinct releases kept separate. The interactive shelf loads only after Collect is selected.",
  },
  {
    id: "play",
    label: "Play",
    provider: "Steam",
    fallback: "Rounded library and playtime patterns.",
  },
  {
    id: "move",
    label: "Move",
    provider: "Strava",
    fallback: "An official public embed, loaded only after consent.",
  },
] as const satisfies ReadonlyArray<{
  id: StreamId;
  label: string;
  provider: string;
  fallback: string;
}>;

export function PersonalStreams({
  spotifyNoScript,
  fixture,
}: {
  spotifyNoScript?: ReactNode;
  fixture?: PreviewFixtureScenario;
}) {
  const [active, setActive] = useState<StreamId>("watch");
  const [showStrava, setShowStrava] = useState(false);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = streams.findIndex((stream) => stream.id === active);
    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (current + 1) % streams.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (current - 1 + streams.length) % streams.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = streams.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = streams[next];
    setActive(target.id);
    document.getElementById(`stream-tab-${target.id}`)?.focus();
  };

  return (
    <section className={styles.streams} aria-label="Personal public streams">
      <noscript>
        <style>{`.${styles.enhanced}{display:none!important}`}</style>
        <div className={styles.noScript}>
          {streams.map((stream, index) => (
            <details key={stream.id} open={index === 0}>
              <summary>
                {stream.label} · {stream.provider}
              </summary>
              {stream.id === "listen" && spotifyNoScript ? (
                spotifyNoScript
              ) : (
                <p>{stream.fallback}</p>
              )}
            </details>
          ))}
        </div>
      </noscript>

      <div className={styles.enhanced}>
        <div className={styles.tabs} role="tablist" aria-label="Choose a stream">
          {streams.map((stream) => (
            <button
              aria-controls={`stream-panel-${stream.id}`}
              aria-selected={active === stream.id}
              className={active === stream.id ? styles.activeTab : undefined}
              id={`stream-tab-${stream.id}`}
              key={stream.id}
              onClick={() => setActive(stream.id)}
              onKeyDown={onTabKeyDown}
              role="tab"
              tabIndex={active === stream.id ? 0 : -1}
              type="button"
            >
              <span>{stream.label}</span>
              <small>{stream.provider}</small>
            </button>
          ))}
        </div>

        <div
          aria-labelledby="stream-tab-watch"
          className={styles.panel}
          hidden={active !== "watch"}
          id="stream-panel-watch"
          role="tabpanel"
          tabIndex={0}
        >
          {active === "watch" ? <CollectionStream provider="myanimelist" fixture={fixture} /> : null}
        </div>
        <div
          aria-labelledby="stream-tab-read"
          className={styles.panel}
          hidden={active !== "read"}
          id="stream-panel-read"
          role="tabpanel"
          tabIndex={0}
        >
          {active === "read" ? <CollectionStream provider="hardcover" fixture={fixture} /> : null}
        </div>
        <div
          aria-labelledby="stream-tab-listen"
          className={styles.panel}
          hidden={active !== "listen"}
          id="stream-panel-listen"
          role="tabpanel"
          tabIndex={0}
        >
          <SpotifyStream active={active === "listen"} serverFallback={spotifyNoScript} fixture={fixture} />
        </div>
        <div
          aria-labelledby="stream-tab-collect"
          className={styles.panel}
          hidden={active !== "collect"}
          id="stream-panel-collect"
          role="tabpanel"
          tabIndex={0}
        >
          {active === "collect" ? <DiscogsStream /> : null}
        </div>
        <div
          aria-labelledby="stream-tab-play"
          className={styles.panel}
          hidden={active !== "play"}
          id="stream-panel-play"
          role="tabpanel"
          tabIndex={0}
        >
          {active === "play" ? <CollectionStream provider="steam" fixture={fixture} /> : null}
        </div>
        <div
          aria-labelledby="stream-tab-move"
          className={styles.panel}
          hidden={active !== "move"}
          id="stream-panel-move"
          role="tabpanel"
          tabIndex={0}
        >
          {active === "move" ? (
            <MovementStream
              show={showStrava}
              onShow={() => setShowStrava(true)}
              fixture={fixture}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
