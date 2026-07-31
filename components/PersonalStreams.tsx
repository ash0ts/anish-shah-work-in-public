"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import styles from "./PersonalStreams.module.css";

type StatusCount = { label: string; count: number };

type MalPayload = {
  provider: "myanimelist";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  genres: StatusCount[];
  eras: StatusCount[];
  recent: Array<{
    id: string;
    title: string;
    status: string;
    score: number | null;
    episodesWatched: number | null;
    updatedAt: string | null;
  }>;
  syncedAt: string;
  freshUntil: string;
};

type HardcoverPayload = {
  provider: "hardcover";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  recent: Array<{
    id: string;
    title: string;
    slug: string | null;
    status: string;
    rating: number | null;
    updatedAt: string | null;
  }>;
  syncedAt: string;
  freshUntil: string;
};

type SteamPayload = {
  provider: "steam";
  profileUrl: string;
  coverage: string;
  totals: {
    publicGameCount: number;
    playedGameCount: number;
    totalHoursRounded: number;
  };
  topPlayed: Array<{
    appId: string;
    title: string;
    hoursRounded: number;
  }>;
  recent: Array<{
    appId: string;
    title: string;
    recentHoursRounded: number;
    totalHoursRounded: number;
  }>;
  syncedAt: string;
  freshUntil: string;
};

type StravaPayload = {
  provider: "strava";
  embedUrl: string;
  coverage: string;
  updatedAt: string;
};

type ConnectorState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; payload: T; fetchedAt: string; stale: boolean };

type StreamId = "watch" | "read" | "play" | "move";
type ConnectorProvider =
  | "myanimelist"
  | "hardcover"
  | "steam"
  | "strava";

const streams = [
  {
    id: "watch",
    label: "Watch",
    provider: "MyAnimeList",
    fallback: "Public watch states, recent activity, and genre patterns.",
  },
  {
    id: "read",
    label: "Read",
    provider: "Hardcover",
    fallback: "Reading states and recently updated books.",
  },
  {
    id: "play",
    label: "Play",
    provider: "Steam",
    fallback: "Rounded public library and playtime summaries.",
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

function syncLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sync date unavailable";
  return `Synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function publishedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Publish date unavailable";
  return `Published ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

async function loadConnector<T>(
  provider: ConnectorProvider,
): Promise<ConnectorState<T>> {
  try {
    const response = await fetch(`/api/connectors/${provider}`, {
      headers: { Accept: "application/json" },
    });
    const body = (await response.json()) as {
      status: string;
      message?: string;
      payload?: T;
      fetchedAt?: string;
      stale?: boolean;
    };
    if (!response.ok || body.status !== "ready" || !body.payload) {
      return {
        status: "unavailable",
        message:
          body.message ??
          "This stream has not been published from the owner studio yet.",
      };
    }
    return {
      status: "ready",
      payload: body.payload,
      fetchedAt: body.fetchedAt ?? "",
      stale: Boolean(body.stale),
    };
  } catch {
    return {
      status: "unavailable",
      message: "The last public snapshot is temporarily unavailable.",
    };
  }
}

export function PersonalStreams() {
  const [active, setActive] = useState<StreamId>("watch");
  const [mal, setMal] = useState<ConnectorState<MalPayload>>({
    status: "idle",
  });
  const [hardcover, setHardcover] = useState<ConnectorState<HardcoverPayload>>({
    status: "idle",
  });
  const [steam, setSteam] = useState<ConnectorState<SteamPayload>>({
    status: "idle",
  });
  const [strava, setStrava] = useState<ConnectorState<StravaPayload>>({
    status: "idle",
  });
  const [showStrava, setShowStrava] = useState(false);
  const requestedProviders = useRef(new Set<ConnectorProvider>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const provider: ConnectorProvider | null =
      active === "watch"
        ? "myanimelist"
        : active === "read"
          ? "hardcover"
          : active === "play"
            ? "steam"
            : "strava";
    if (requestedProviders.current.has(provider)) return;
    requestedProviders.current.add(provider);

    if (provider === "myanimelist") {
      void loadConnector<MalPayload>(provider).then((state) => {
        if (state.status !== "ready") {
          requestedProviders.current.delete(provider);
        }
        if (mounted.current) setMal(state);
      });
    } else if (provider === "hardcover") {
      void loadConnector<HardcoverPayload>(provider).then((state) => {
        if (state.status !== "ready") {
          requestedProviders.current.delete(provider);
        }
        if (mounted.current) setHardcover(state);
      });
    } else if (provider === "steam") {
      void loadConnector<SteamPayload>(provider).then((state) => {
        if (state.status !== "ready") {
          requestedProviders.current.delete(provider);
        }
        if (mounted.current) setSteam(state);
      });
    } else {
      void loadConnector<StravaPayload>(provider).then((state) => {
        if (state.status !== "ready") {
          requestedProviders.current.delete(provider);
        }
        if (mounted.current) setStrava(state);
      });
    }
  }, [active]);

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
  const compactPanel =
    (active === "watch" && mal.status !== "ready") ||
    (active === "read" && hardcover.status !== "ready") ||
    (active === "play" && steam.status !== "ready") ||
    (active === "move" && strava.status !== "ready");

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
              <p>{stream.fallback}</p>
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
          aria-labelledby={`stream-tab-${active}`}
          className={`${styles.panel}${compactPanel ? ` ${styles.compactPanel}` : ""}`}
          id={`stream-panel-${active}`}
          role="tabpanel"
          tabIndex={0}
        >
          {active === "watch" ? <WatchStream state={mal} /> : null}
          {active === "read" ? <ReadStream state={hardcover} /> : null}
          {active === "play" ? <SteamStream state={steam} /> : null}
          {active === "move" ? (
            <MovementStream
              state={strava}
              show={showStrava}
              onShow={() => setShowStrava(true)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function WatchStream({ state }: { state: ConnectorState<MalPayload> }) {
  if (state.status !== "ready") return <StreamEmpty state={state} />;
  return (
    <>
      <PanelHeading
        title="Watch states, not a ranking."
        description={state.payload.coverage}
      />
      <div className={styles.counts}>
        {state.payload.status.slice(0, 5).map((entry) => (
          <span key={entry.label}>
            <b>{entry.count}</b>
            <small>{entry.label}</small>
          </span>
        ))}
      </div>
      <div className={styles.split}>
        <CompactList
          label="Recently updated"
          entries={state.payload.recent.slice(0, 6).map((entry) => ({
            id: entry.id,
            title: entry.title,
            meta: entry.status,
          }))}
        />
        <div>
          <p className={styles.listLabel}>Recurring genres</p>
          <div className={styles.tags}>
            {state.payload.genres.slice(0, 8).map((entry) => (
              <span key={entry.label}>
                {entry.label} <b>{entry.count}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      <StreamStatus
        profileUrl={state.payload.profileUrl}
        stale={state.stale}
        syncedAt={state.payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}

function ReadStream({ state }: { state: ConnectorState<HardcoverPayload> }) {
  if (state.status !== "ready") return <StreamEmpty state={state} />;
  return (
    <>
      <PanelHeading title="A shelf in motion." description={state.payload.coverage} />
      <div className={styles.counts}>
        {state.payload.status.slice(0, 5).map((entry) => (
          <span key={entry.label}>
            <b>{entry.count}</b>
            <small>{entry.label}</small>
          </span>
        ))}
      </div>
      <CompactList
        label="Recently updated"
        entries={state.payload.recent.slice(0, 6).map((entry) => ({
          id: entry.id,
          title: entry.title,
          meta: entry.rating ? `${entry.rating}/5` : entry.status,
        }))}
      />
      <StreamStatus
        profileUrl={state.payload.profileUrl}
        stale={state.stale}
        syncedAt={state.payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}

function SteamStream({ state }: { state: ConnectorState<SteamPayload> }) {
  if (state.status !== "ready") return <StreamEmpty state={state} />;
  return (
    <>
      <PanelHeading
        title="A public library snapshot."
        description={state.payload.coverage}
      />
      <div className={styles.counts}>
        <span>
          <b>{state.payload.totals.publicGameCount}</b>
          <small>Public games returned</small>
        </span>
        <span>
          <b>{state.payload.totals.playedGameCount}</b>
          <small>With public playtime</small>
        </span>
        <span>
          <b>{state.payload.totals.totalHoursRounded.toLocaleString()}h</b>
          <small>Rounded public hours</small>
        </span>
      </div>
      <div className={styles.split}>
        <CompactList
          label="Most played"
          entries={state.payload.topPlayed.slice(0, 5).map((game) => ({
            id: game.appId,
            title: game.title,
            meta: `${game.hoursRounded.toLocaleString()}h`,
          }))}
        />
        <CompactList
          label="Recently played"
          entries={state.payload.recent.slice(0, 5).map((game) => ({
            id: game.appId,
            title: game.title,
            meta: `${game.recentHoursRounded.toLocaleString()}h recent`,
          }))}
        />
      </div>
      <p className={styles.attribution}>
        Data provided by Steam. This independent site is not affiliated with{" "}
        <a href="https://www.valvesoftware.com/" rel="noreferrer" target="_blank">
          Valve
        </a>
        . Public data is shown as available.
      </p>
      <StreamStatus
        profileUrl={state.payload.profileUrl}
        stale={state.stale}
        syncedAt={state.payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}

function MovementStream({
  state,
  show,
  onShow,
}: {
  state: ConnectorState<StravaPayload>;
  show: boolean;
  onShow: () => void;
}) {
  if (state.status !== "ready") return <StreamEmpty state={state} />;

  return (
    <>
      <PanelHeading
        title="Outside, on purpose."
        description={state.payload.coverage}
      />
      {show ? (
        <div className={styles.embed}>
          <iframe
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={state.payload.embedUrl}
            title="Anish Shah’s public Strava activity"
          />
        </div>
      ) : (
        <div className={styles.consent}>
          <span>Third-party content is blocked by default.</span>
          <button onClick={onShow} type="button">
            Load public Strava activity
          </button>
        </div>
      )}
      <div className={styles.status}>
        <span>Loads only after interaction</span>
        <span>{publishedLabel(state.payload.updatedAt)}</span>
      </div>
    </>
  );
}

function PanelHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className={styles.panelHeading}>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function CompactList({
  label,
  entries,
}: {
  label: string;
  entries: Array<{ id: string; title: string; meta: string }>;
}) {
  return (
    <div>
      <p className={styles.listLabel}>{label}</p>
      <ol className={styles.list}>
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{entry.title}</strong>
            <small>{entry.meta}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StreamEmpty<T>({ state }: { state: ConnectorState<T> }) {
  const loading = state.status === "idle" || state.status === "loading";
  return (
    <div className={styles.empty} aria-live="polite">
      <span aria-hidden="true">{loading ? "···" : "○"}</span>
      <p>
        {loading
          ? "Loading the last public snapshot…"
          : state.status === "unavailable"
            ? state.message
            : "This stream has not been published yet."}
      </p>
    </div>
  );
}

function StreamStatus({
  stale,
  syncedAt,
  profileUrl,
}: {
  stale: boolean;
  syncedAt: string;
  profileUrl: string | null;
}) {
  return (
    <div className={styles.status}>
      <span>{stale ? "Last-known-good snapshot" : "Current public snapshot"}</span>
      <span>{syncLabel(syncedAt)}</span>
      {profileUrl ? (
        <a href={profileUrl} rel="noreferrer" target="_blank">
          Open profile
        </a>
      ) : null}
    </div>
  );
}
