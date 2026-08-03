"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./SpotifyStream.module.css";
import { SpotifyFallback, SpotifyMessage } from "./spotify/SpotifyFallback";
import { SpotifyRankedGroove } from "./spotify/SpotifyRankedGroove";
import {
  loadSpotify,
  loadSpotifyFixture,
  type SpotifyState,
} from "./spotify/model";
import type { PreviewFixtureScenario } from "./play/connector-model";

export function SpotifyStream({
  active = true,
  initialState,
  serverFallback,
  fixture,
}: {
  active?: boolean;
  initialState?: SpotifyState;
  serverFallback?: ReactNode;
  fixture?: PreviewFixtureScenario;
}) {
  const [state, setState] = useState<SpotifyState>(
    initialState ?? { status: "loading" },
  );
  const requested = useRef(initialState !== undefined);

  useEffect(() => {
    if (!active || requested.current) return;
    requested.current = true;
    const controller = new AbortController();
    let completed = false;
    const request = fixture
      ? loadSpotifyFixture(controller.signal, fixture)
      : loadSpotify(controller.signal);
    void request
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
  }, [active, fixture]);

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
