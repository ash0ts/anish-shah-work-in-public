"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../PersonalStreams.module.css";
import {
  loadConnector,
  publishedLabel,
  type ConnectorState,
  type StravaPayload,
} from "./connector-model";
import { PanelHeading, StreamEmpty } from "./StreamChrome";

export function MovementStream({
  show,
  onShow,
}: {
  show: boolean;
  onShow: () => void;
}) {
  const [state, setState] = useState<ConnectorState<StravaPayload>>({
    status: "loading",
  });
  const embedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadConnector<StravaPayload>(
      "strava",
      new URLSearchParams(),
      controller.signal,
    ).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (show && state.status === "ready" && state.payload.embed) {
      requestAnimationFrame(() => embedRef.current?.focus());
    }
  }, [show, state]);

  if (state.status !== "ready") {
    if (state.status === "unavailable") {
      return (
        <div className={styles.empty} aria-live="polite">
          <span aria-hidden="true">○</span>
          <p>
            {state.message} The public activity embed may be unpublished or
            being replaced. No third-party content was loaded.
          </p>
        </div>
      );
    }
    return <StreamEmpty state={state} />;
  }

  return (
    <>
      <PanelHeading
        title="Outside, on purpose."
        description="A cumulative public movement feed when Strava permits anonymous embedding, with the athlete profile always available."
      />
      {show && state.payload.embed ? (
        <div className={styles.embed} ref={embedRef} tabIndex={-1}>
          <iframe
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={state.payload.embed.embedUrl}
            title={
              state.payload.embed.kind === "profile_summary"
                ? "Anish Shah’s weekly Strava summary"
                : state.payload.embed.kind === "profile_feed"
                  ? "Anish Shah’s recent Strava activity feed"
                  : "Anish Shah’s public Strava activity"
            }
          />
        </div>
      ) : state.payload.embedStatus === "available" && state.payload.embed ? (
        <div className={styles.consent}>
          <span>
            <strong>Third-party content is blocked by default.</strong>
            <small>
              Loading shares the usual request information with Strava.
            </small>
          </span>
          <button onClick={onShow} type="button">
            Load public Strava feed
          </button>
        </div>
      ) : (
        <div className={styles.stravaFallback}>
          <span>
            <strong>The feed is not anonymously frameable right now.</strong>
            <small>No third-party content was loaded.</small>
          </span>
          <a href={state.payload.profileUrl} rel="noreferrer" target="_blank">
            View the full activity feed on Strava ↗
          </a>
        </div>
      )}
      <div className={styles.status}>
        <span>
          {state.payload.embedStatus === "available"
            ? "Loads only after interaction"
            : "Profile-link fallback"}
        </span>
        <span>{publishedLabel(state.payload.updatedAt)}</span>
        <a href={state.payload.profileUrl} rel="noreferrer" target="_blank">
          Open Strava profile
        </a>
      </div>
    </>
  );
}
