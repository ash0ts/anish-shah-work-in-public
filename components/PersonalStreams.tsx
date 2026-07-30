"use client";

import { useEffect, useState } from "react";

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
  username: string | null;
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

type ConnectorState<T> =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; payload: T; fetchedAt: string; stale: boolean };

function syncLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sync date unavailable";
  return `Synced ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function officialStravaEmbed(value: string | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "strava-embeds.com"
    ) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function PersonalStreams() {
  const [mal, setMal] = useState<ConnectorState<MalPayload>>({
    status: "loading",
  });
  const [hardcover, setHardcover] = useState<ConnectorState<HardcoverPayload>>({
    status: "loading",
  });
  const [steam, setSteam] = useState<ConnectorState<SteamPayload>>({
    status: "loading",
  });
  const [showStrava, setShowStrava] = useState(false);
  const stravaEmbed = officialStravaEmbed(
    process.env.NEXT_PUBLIC_STRAVA_EMBED_URL,
  );

  useEffect(() => {
    let cancelled = false;
    const load = async <T,>(
      provider: "myanimelist" | "hardcover" | "steam",
      setter: (state: ConnectorState<T>) => void,
    ) => {
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
        if (cancelled) return;
        if (!response.ok || body.status !== "ready" || !body.payload) {
          setter({
            status: "unavailable",
            message:
              body.message ??
              "This stream has not been published from the owner studio yet.",
          });
          return;
        }
        setter({
          status: "ready",
          payload: body.payload,
          fetchedAt: body.fetchedAt ?? "",
          stale: Boolean(body.stale),
        });
      } catch {
        if (!cancelled) {
          setter({
            status: "unavailable",
            message: "The last public snapshot is temporarily unavailable.",
          });
        }
      }
    };

    void load<MalPayload>("myanimelist", setMal);
    void load<HardcoverPayload>("hardcover", setHardcover);
    void load<SteamPayload>("steam", setSteam);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="personal-streams">
      <noscript>
        <style>{`.stream-loading { display: none !important; }`}</style>
        <div className="stream-noscript">
          <strong>Personal snapshots are optional.</strong>
          <p>
            JavaScript is off, so no connector request or third-party embed has
            been made. The four stream descriptions remain available below.
          </p>
        </div>
      </noscript>
      <section className="culture-stream anime-stream" aria-labelledby="anime-title">
        <header>
          <div>
            <span className="stream-number">01</span>
            <p className="utility-label">MyAnimeList · watch states</p>
          </div>
          <h2 id="anime-title">What’s in the queue?</h2>
        </header>

        {mal.status === "ready" ? (
          <>
            <div className="anime-status-ribbon">
              {mal.payload.status.map((entry) => (
                <span key={entry.label}>
                  <b>{entry.count}</b>
                  <i>{entry.label}</i>
                </span>
              ))}
            </div>
            <div className="anime-stream-body">
              <div>
                <p className="utility-label">Recent activity</p>
                <ol className="recent-list">
                  {mal.payload.recent.slice(0, 7).map((entry, index) => (
                    <li key={entry.id}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{entry.title}</strong>
                      <i>{entry.status}</i>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="utility-label">Genre gravity</p>
                <div className="genre-orbits">
                  {mal.payload.genres.slice(0, 6).map((entry, index) => (
                    <span
                      key={entry.label}
                      style={{
                        width: `${72 + index * 23}px`,
                        height: `${72 + index * 23}px`,
                      }}
                    >
                      <i>
                        {entry.label} · {entry.count}
                      </i>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <StreamStatus
              stale={mal.stale}
              syncedAt={mal.payload.syncedAt || mal.fetchedAt}
              profileUrl={mal.payload.profileUrl}
            />
          </>
        ) : (
          <StreamEmpty
            loading={mal.status === "loading"}
            message={mal.status === "unavailable" ? mal.message : undefined}
          />
        )}
      </section>

      <section
        className="culture-stream reading-stream"
        aria-labelledby="reading-title"
      >
        <header>
          <div>
            <span className="stream-number">02</span>
            <p className="utility-label">Hardcover · reading states</p>
          </div>
          <h2 id="reading-title">A shelf with a pulse.</h2>
        </header>

        {hardcover.status === "ready" ? (
          <>
            <div className="book-shelf" aria-label="Recently updated books">
              {hardcover.payload.recent.slice(0, 9).map((book, index) => (
                <span className={`book-spine book-spine-${(index % 4) + 1}`} key={book.id}>
                  <strong>{book.title}</strong>
                  <i>{book.rating ? `${book.rating}/5` : book.status}</i>
                </span>
              ))}
            </div>
            <div className="reading-counts">
              {hardcover.payload.status.map((entry) => (
                <span key={entry.label}>
                  <b>{entry.count}</b>
                  <i>{entry.label}</i>
                </span>
              ))}
            </div>
            <StreamStatus
              stale={hardcover.stale}
              syncedAt={hardcover.payload.syncedAt || hardcover.fetchedAt}
              profileUrl={hardcover.payload.profileUrl}
            />
          </>
        ) : (
          <StreamEmpty
            loading={hardcover.status === "loading"}
            message={
              hardcover.status === "unavailable" ? hardcover.message : undefined
            }
          />
        )}
      </section>

      <section
        className="culture-stream steam-stream"
        aria-labelledby="steam-title"
      >
        <header>
          <div>
            <span className="stream-number">03</span>
            <p className="utility-label">Steam · public game details</p>
          </div>
          <h2 id="steam-title">Play, over time.</h2>
        </header>

        {steam.status === "ready" ? (
          <>
            <div className="reading-counts">
              <span>
                <b>{steam.payload.totals.publicGameCount}</b>
                <i>Public games returned</i>
              </span>
              <span>
                <b>{steam.payload.totals.playedGameCount}</b>
                <i>With public playtime</i>
              </span>
              <span>
                <b>
                  {steam.payload.totals.totalHoursRounded.toLocaleString()}
                </b>
                <i>Rounded public hours</i>
              </span>
            </div>
            <div className="anime-stream-body">
              <div>
                <p className="utility-label">Most played · public</p>
                <ol className="recent-list">
                  {steam.payload.topPlayed.map((game, index) => (
                    <li key={game.appId}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{game.title}</strong>
                      <i>{game.hoursRounded.toLocaleString()}h</i>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="utility-label">Recently played · public</p>
                <ol className="recent-list">
                  {steam.payload.recent.map((game, index) => (
                    <li key={game.appId}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{game.title}</strong>
                      <i>{game.recentHoursRounded.toLocaleString()}h recent</i>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <StreamStatus
              stale={steam.stale}
              syncedAt={steam.payload.syncedAt || steam.fetchedAt}
              profileUrl={steam.payload.profileUrl}
            />
          </>
        ) : (
          <StreamEmpty
            loading={steam.status === "loading"}
            message={steam.status === "unavailable" ? steam.message : undefined}
          />
        )}
      </section>

      <section
        className="culture-stream movement-stream"
        aria-labelledby="movement-title"
      >
        <header>
          <div>
            <span className="stream-number">04</span>
            <p className="utility-label">Strava · official public embed</p>
          </div>
          <h2 id="movement-title">Outside, on purpose.</h2>
        </header>
        <div className="movement-stage">
          {showStrava && stravaEmbed ? (
            <iframe
              title="Anish Shah’s public Strava activity"
              src={stravaEmbed}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          ) : (
            <>
              <div className="route-mark" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="movement-consent">
                <p>
                  Strava stays outside this site until you choose to load its
                  official public embed.
                </p>
                {stravaEmbed ? (
                  <button type="button" onClick={() => setShowStrava(true)}>
                    Load public Strava activity ↗
                  </button>
                ) : (
                  <span>The owner has not published a Strava embed yet.</span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="stream-status">
          <span>
            <i /> Third-party content blocked by default
          </span>
          <span>Loads only after interaction</span>
        </div>
      </section>
    </div>
  );
}

function StreamEmpty({
  loading,
  message,
}: {
  loading: boolean;
  message?: string;
}) {
  return (
    <div
      className={`stream-empty${loading ? " stream-loading" : ""}`}
      aria-live="polite"
    >
      <span aria-hidden="true">{loading ? "···" : "○"}</span>
      <p>
        {loading
          ? "Loading the last public snapshot…"
          : message ?? "This stream has not been published yet."}
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
    <div className="stream-status">
      <span>
        <i />
        {stale ? "Last-known-good snapshot" : "Current public snapshot"}
      </span>
      <span>{syncLabel(syncedAt)}</span>
      {profileUrl ? (
        <a href={profileUrl} rel="noreferrer" target="_blank">
          Open profile ↗
        </a>
      ) : null}
    </div>
  );
}
