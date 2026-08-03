"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./SpotifyStream.module.css";
import { SpotifyFallback, SpotifyMessage } from "./spotify/SpotifyFallback";
import { SpotifyRankedGroove } from "./spotify/SpotifyRankedGroove";
import { loadSpotify, type SpotifyState } from "./spotify/model";

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
