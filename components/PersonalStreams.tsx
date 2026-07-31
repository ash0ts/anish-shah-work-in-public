"use client";

import { animate, stagger } from "animejs";
import Image from "next/image";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "./PersonalStreams.module.css";

type StatusCount = { label: string; count: number };
type GalleryFilter = StatusCount & { id: string };
type GallerySort = { id: string; label: string };
type PublicArtwork = {
  src: `/api/connector-artwork/${string}/${string}`;
  aspect: "poster" | "square";
};

type PublicGallery<Item> = {
  ready: boolean;
  items: Item[];
  page: number;
  pageSize: 12 | 24 | 36;
  totalItems: number;
  libraryTotal: number;
  totalPages: number;
  query: string;
  filter: string;
  sort: string;
  filters: GalleryFilter[];
  sorts: GallerySort[];
};

type MalGalleryItem = {
  id: string;
  title: string;
  status: string;
  score: number | null;
  episodesWatched: number | null;
  updatedAt: string | null;
  releaseYear?: number | null;
  genres?: string[];
  artwork?: PublicArtwork;
};

type HardcoverGalleryItem = {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  rating: number | null;
  updatedAt: string | null;
  artwork?: PublicArtwork;
};

type SteamGalleryItem = {
  appId: string;
  title: string;
  played: boolean;
  recentlyPlayed: boolean;
  totalHoursRounded: number;
  recentHoursRounded: number;
  artwork?: PublicArtwork;
};

type MalPayload = {
  provider: "myanimelist";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  genres: StatusCount[];
  eras: StatusCount[];
  scores?: StatusCount[];
  recent: MalGalleryItem[];
  gallery?: PublicGallery<MalGalleryItem>;
  syncedAt: string;
  freshUntil: string;
};

type HardcoverPayload = {
  provider: "hardcover";
  profileUrl: string | null;
  coverage: string;
  status: StatusCount[];
  ratings?: StatusCount[];
  recent: HardcoverGalleryItem[];
  gallery?: PublicGallery<HardcoverGalleryItem>;
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
  recent: SteamGalleryItem[];
  playtime?: StatusCount[];
  gallery?: PublicGallery<SteamGalleryItem>;
  syncedAt: string;
  freshUntil: string;
};

type CollectionPayload = MalPayload | HardcoverPayload | SteamPayload;
type GalleryItem = MalGalleryItem | HardcoverGalleryItem | SteamGalleryItem;

type StravaPayload = {
  provider: "strava";
  profileUrl: string;
  embed: {
    kind: "profile_feed" | "profile_summary" | "activity" | "route";
    embedUrl: string;
    checkedAt: string;
  } | null;
  embedStatus: "available" | "unavailable";
  updatedAt: string;
};

type ConnectorState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; payload: T; fetchedAt: string; stale: boolean };

type StreamId = "watch" | "read" | "play" | "move";
type CollectionProvider = "myanimelist" | "hardcover" | "steam";
type ConnectorProvider = CollectionProvider | "strava";
type CollectionView = "pattern" | "gallery";

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

const providerTitles: Record<CollectionProvider, string> = {
  myanimelist: "Watch states, not a ranking.",
  hardcover: "A shelf in motion.",
  steam: "A public library snapshot.",
};

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
  parameters = new URLSearchParams(),
  signal?: AbortSignal,
): Promise<ConnectorState<T>> {
  try {
    const suffix = parameters.size ? `?${parameters.toString()}` : "";
    const response = await fetch(`/api/connectors/${provider}${suffix}`, {
      headers: { Accept: "application/json" },
      signal,
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
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "unavailable",
      message: "The last public snapshot is temporarily unavailable.",
    };
  }
}

export function PersonalStreams() {
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
          className={styles.panel}
          id={`stream-panel-${active}`}
          role="tabpanel"
          tabIndex={0}
        >
          {active === "watch" ? (
            <CollectionStream provider="myanimelist" />
          ) : null}
          {active === "read" ? (
            <CollectionStream provider="hardcover" />
          ) : null}
          {active === "play" ? <CollectionStream provider="steam" /> : null}
          {active === "move" ? (
            <MovementProvider
              show={showStrava}
              onShow={() => setShowStrava(true)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CollectionStream({ provider }: { provider: CollectionProvider }) {
  const [state, setState] = useState<ConnectorState<CollectionPayload>>({
    status: "idle",
  });
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<CollectionView>("gallery");
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<12 | 24 | 36>(12);
  const transitionRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) parameters.set("q", query);
    if (filter) parameters.set("filter", filter);
    if (sort) parameters.set("sort", sort);

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setBusy(true);
      setState((current) =>
        current.status === "idle" ? { status: "loading" } : current,
      );
      void loadConnector<CollectionPayload>(
        provider,
        parameters,
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setState(next);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    });
    return () => controller.abort();
  }, [filter, page, pageSize, provider, query, sort]);

  const payload = state.status === "ready" ? state.payload : null;
  const gallery = payload?.gallery;

  useLayoutEffect(() => {
    const root = transitionRoot.current;
    if (
      !root ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const items = root.querySelectorAll<HTMLElement>("[data-stream-item]");
    const targets = items.length ? items : root;
    const motion = animate(targets, {
      opacity: [0.72, 1],
      translateY: ["0.25rem", 0],
      duration: 220,
      delay: items.length ? stagger(9) : 0,
      ease: "out(3)",
    });
    return () => {
      motion.cancel();
    };
  }, [gallery?.page, gallery?.sort, gallery?.filter, provider, view]);

  if (state.status !== "ready" || !payload) {
    return <StreamEmpty state={state} />;
  }

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(draftQuery.trim());
    setPage(1);
  };

  return (
    <>
      <header className={styles.collectionHeader}>
        <PanelHeading
          title={providerTitles[provider]}
          description={payload.coverage}
        />
        <div
          className={styles.viewSwitch}
          role="group"
          aria-label="Collection view"
        >
          <button
            aria-pressed={view === "pattern"}
            onClick={() => setView("pattern")}
            type="button"
          >
            Pattern
          </button>
          <button
            aria-pressed={view === "gallery"}
            onClick={() => setView("gallery")}
            type="button"
          >
            Gallery
          </button>
        </div>
      </header>

      <div
        aria-busy={busy}
        className={styles.collectionBody}
        ref={transitionRoot}
      >
        {view === "pattern" ? (
          <PatternView payload={payload} provider={provider} />
        ) : gallery?.ready ? (
          <GalleryView
            busy={busy}
            draftQuery={draftQuery}
            gallery={gallery}
            onDraftQuery={setDraftQuery}
            onFilter={(value) => {
              setFilter(value);
              setPage(1);
            }}
            onPage={setPage}
            onPageSize={(value) => {
              setPageSize(value);
              setPage(1);
            }}
            onSearch={applySearch}
            onSort={(value) => {
              setSort(value);
              setPage(1);
            }}
            provider={provider}
          />
        ) : (
          <div className={styles.galleryUnavailable} aria-live="polite">
            <strong>The full collection is preparing its first index.</strong>
            <p>
              The pattern view remains available. Refresh this provider once
              from Studio to publish the searchable gallery.
            </p>
            <button onClick={() => setView("pattern")} type="button">
              Return to pattern
            </button>
          </div>
        )}
      </div>

      {provider === "steam" ? (
        <p className={styles.attribution}>
          Data provided by Steam. This independent site is not affiliated with{" "}
          <a
            href="https://www.valvesoftware.com/"
            rel="noreferrer"
            target="_blank"
          >
            Valve
          </a>
          . Public data is shown as available.
        </p>
      ) : null}
      <StreamStatus
        profileUrl={payload.profileUrl}
        stale={state.stale}
        syncedAt={payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}

function PatternView({
  provider,
  payload,
}: {
  provider: CollectionProvider;
  payload: CollectionPayload;
}) {
  if (provider === "myanimelist" && payload.provider === "myanimelist") {
    const total =
      payload.gallery?.libraryTotal ??
      payload.status.reduce((sum, entry) => sum + entry.count, 0);
    return (
      <div className={styles.pattern}>
        <PatternLead
          value={total.toLocaleString()}
          label="titles in the public watch library"
        />
        <Distribution title="Watch state" entries={payload.status} />
        <Distribution title="Recurring genres" entries={payload.genres} />
        <Distribution title="Release eras" entries={payload.eras} />
        {payload.scores?.length ? (
          <Distribution title="Score distribution" entries={payload.scores} />
        ) : null}
      </div>
    );
  }

  if (provider === "hardcover" && payload.provider === "hardcover") {
    const total =
      payload.gallery?.libraryTotal ??
      payload.status.reduce((sum, entry) => sum + entry.count, 0);
    return (
      <div className={styles.pattern}>
        <PatternLead
          value={total.toLocaleString()}
          label="books in the public shelf"
        />
        <Distribution title="Reading state" entries={payload.status} />
        {payload.ratings?.length ? (
          <Distribution title="Rating distribution" entries={payload.ratings} />
        ) : null}
        <RecentIndex
          entries={payload.recent.slice(0, 8).map((entry) => ({
            id: entry.id,
            title: entry.title,
            meta: entry.rating ? `${entry.rating}/5` : entry.status,
          }))}
          label="Recently updated"
        />
      </div>
    );
  }

  if (payload.provider !== "steam") return null;
  return (
    <div className={styles.pattern}>
      <PatternLead
        value={payload.totals.publicGameCount.toLocaleString()}
        label="games in the public library"
        aside={`${payload.totals.totalHoursRounded.toLocaleString()} rounded hours`}
      />
      {payload.playtime?.length ? (
        <Distribution title="Lifetime playtime" entries={payload.playtime} />
      ) : (
        <Distribution
          title="Library state"
          entries={[
            {
              label: "Played",
              count: payload.totals.playedGameCount,
            },
            {
              label: "Unplayed",
              count: Math.max(
                payload.totals.publicGameCount -
                  payload.totals.playedGameCount,
                0,
              ),
            },
          ]}
        />
      )}
      <RecentIndex
        entries={payload.topPlayed.slice(0, 8).map((entry) => ({
          id: entry.appId,
          title: entry.title,
          meta: `${entry.hoursRounded.toLocaleString()}h`,
        }))}
        label="Most played"
      />
    </div>
  );
}

function PatternLead({
  value,
  label,
  aside,
}: {
  value: string;
  label: string;
  aside?: string;
}) {
  return (
    <div className={styles.patternLead} data-stream-item>
      <strong>{value}</strong>
      <span>{label}</span>
      {aside ? <small>{aside}</small> : null}
    </div>
  );
}

function Distribution({
  title,
  entries,
}: {
  title: string;
  entries: StatusCount[];
}) {
  const visible = entries.filter((entry) => entry.count > 0).slice(0, 10);
  const maximum = Math.max(...visible.map((entry) => entry.count), 1);
  return (
    <figure className={styles.distribution} data-stream-item>
      <figcaption>{title}</figcaption>
      <ol>
        {visible.map((entry) => (
          <li
            aria-label={`${entry.label}: ${entry.count.toLocaleString()}`}
            key={entry.label}
          >
            <span>{entry.label}</span>
            <i aria-hidden="true">
              <b
                style={
                  {
                    "--share": `${(entry.count / maximum) * 100}%`,
                  } as CSSProperties
                }
              />
            </i>
            <strong>{entry.count.toLocaleString()}</strong>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function RecentIndex({
  label,
  entries,
}: {
  label: string;
  entries: Array<{ id: string; title: string; meta: string }>;
}) {
  return (
    <section className={styles.recentIndex} data-stream-item>
      <h3>{label}</h3>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{entry.title}</strong>
            <small>{entry.meta}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GalleryView({
  provider,
  gallery,
  busy,
  draftQuery,
  onDraftQuery,
  onSearch,
  onFilter,
  onSort,
  onPageSize,
  onPage,
}: {
  provider: CollectionProvider;
  gallery: PublicGallery<GalleryItem>;
  busy: boolean;
  draftQuery: string;
  onDraftQuery: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onFilter: (value: string) => void;
  onSort: (value: string) => void;
  onPageSize: (value: 12 | 24 | 36) => void;
  onPage: (value: number) => void;
}) {
  const start = gallery.totalItems
    ? (gallery.page - 1) * gallery.pageSize + 1
    : 0;
  const end = Math.min(
    gallery.page * gallery.pageSize,
    gallery.totalItems,
  );
  const steamMaximum =
    provider === "steam"
      ? Math.max(
          ...gallery.items.map((item) =>
            "totalHoursRounded" in item ? item.totalHoursRounded : 0,
          ),
          1,
        )
      : 1;

  return (
    <div className={styles.gallery}>
      <form className={styles.galleryTools} onSubmit={onSearch}>
        <label className={styles.gallerySearch}>
          <span>Find a title</span>
          <span>
            <input
              maxLength={80}
              onChange={(event) => onDraftQuery(event.target.value)}
              placeholder="Search this collection"
              type="search"
              value={draftQuery}
            />
            <button type="submit">Search</button>
          </span>
        </label>
        <GallerySelect
          label="Filter"
          onChange={onFilter}
          options={gallery.filters.map((entry) => ({
            value: entry.id,
            label: `${entry.label} · ${entry.count}`,
          }))}
          value={gallery.filter}
        />
        <GallerySelect
          label="Sort"
          onChange={onSort}
          options={gallery.sorts.map((entry) => ({
            value: entry.id,
            label: entry.label,
          }))}
          value={gallery.sort}
        />
        <GallerySelect
          label="Per page"
          onChange={(value) => onPageSize(Number(value) as 12 | 24 | 36)}
          options={[12, 24, 36].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          value={String(gallery.pageSize)}
        />
      </form>

      <div className={styles.gallerySummary} aria-live="polite">
        <span>
          {start}—{end} of {gallery.totalItems.toLocaleString()}
        </span>
        <span>{busy ? "Updating view…" : "Public snapshot"}</span>
      </div>

      {gallery.items.length ? (
        <ol className={styles.atlas} data-provider={provider}>
          {gallery.items.map((item, index) => (
            <GalleryTile
              index={start + index}
              item={item}
              key={galleryItemKey(item)}
              provider={provider}
              steamMaximum={steamMaximum}
            />
          ))}
        </ol>
      ) : (
        <div className={styles.noResults} data-stream-item>
          <strong>No titles match this view.</strong>
          <p>Change the search or filter to return to the collection.</p>
        </div>
      )}

      <nav className={styles.galleryPagination} aria-label="Collection pages">
        <button
          disabled={gallery.page <= 1 || busy}
          onClick={() => onPage(gallery.page - 1)}
          type="button"
        >
          ← Previous
        </button>
        <span>
          Page {gallery.page} of {gallery.totalPages}
        </span>
        <button
          disabled={gallery.page >= gallery.totalPages || busy}
          onClick={() => onPage(gallery.page + 1)}
          type="button"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function GallerySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.gallerySelect}>
      <span>{label}</span>
      <select
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function GalleryTile({
  provider,
  item,
  index,
  steamMaximum,
}: {
  provider: CollectionProvider;
  item: GalleryItem;
  index: number;
  steamMaximum: number;
}) {
  const presentation = galleryItemPresentation(provider, item, steamMaximum);
  const content = (
    <>
      <span className={styles.artwork} data-aspect={item.artwork?.aspect ?? (provider === "steam" ? "square" : "poster")}>
        <span aria-hidden="true" className={styles.artworkFallback}>
          {provider === "steam" ? "PLAY" : provider === "hardcover" ? "READ" : "WATCH"}
        </span>
        {item.artwork ? (
          <Image
            alt=""
            decoding="async"
            height={item.artwork.aspect === "square" ? 480 : 720}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
            src={item.artwork.src}
            unoptimized
            width={480}
          />
        ) : null}
      </span>
      <span className={styles.tileNumber}>{String(index).padStart(2, "0")}</span>
      <strong>{item.title}</strong>
      <span className={styles.tileMeta}>{presentation.meta}</span>
      <span className={styles.measure} aria-label={presentation.measureLabel}>
        <i
          aria-hidden="true"
          style={
            {
              "--measure": `${presentation.measure * 100}%`,
            } as CSSProperties
          }
        />
      </span>
      <small>{presentation.measureLabel}</small>
      {presentation.href ? <b aria-hidden="true">↗</b> : null}
    </>
  );

  return (
    <li data-stream-item>
      {presentation.href ? (
        <a href={presentation.href} rel="noreferrer" target="_blank">
          {content}
        </a>
      ) : (
        <article>{content}</article>
      )}
    </li>
  );
}

function galleryItemPresentation(
  provider: CollectionProvider,
  item: GalleryItem,
  steamMaximum: number,
) {
  if (provider === "myanimelist" && "status" in item && "score" in item) {
    const score = item.score ?? 0;
    return {
      href: `https://myanimelist.net/anime/${encodeURIComponent(item.id)}`,
      meta: [item.status, item.releaseYear].filter(Boolean).join(" · "),
      measure: score > 0 ? Math.min(score / 10, 1) : 0,
      measureLabel: score > 0 ? `Score ${score}/10` : "Not scored",
    };
  }
  if (provider === "hardcover" && "status" in item && "rating" in item) {
    const rating = item.rating ?? 0;
    return {
      href: item.slug
        ? `https://hardcover.app/books/${encodeURIComponent(item.slug)}`
        : null,
      meta: item.status,
      measure: rating > 0 ? Math.min(rating / 5, 1) : 0,
      measureLabel: rating > 0 ? `Rating ${rating}/5` : "Not rated",
    };
  }
  const game =
    "appId" in item
      ? item
      : {
          appId: "",
          totalHoursRounded: 0,
          recentHoursRounded: 0,
        };
  return {
    href: game.appId
      ? `https://store.steampowered.com/app/${encodeURIComponent(game.appId)}`
      : null,
    meta:
      game.recentHoursRounded > 0
        ? `${game.recentHoursRounded.toLocaleString()}h recent`
        : "Lifetime playtime",
    measure: Math.min(game.totalHoursRounded / steamMaximum, 1),
    measureLabel: `${game.totalHoursRounded.toLocaleString()} rounded hours`,
  };
}

function galleryItemKey(item: GalleryItem) {
  if ("appId" in item) return `steam:${item.appId}`;
  return `${"rating" in item ? "hardcover" : "mal"}:${item.id}`;
}

function MovementProvider({
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

function PanelHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.panelHeading}>
      <h2>{title}</h2>
      <p>{description}</p>
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
