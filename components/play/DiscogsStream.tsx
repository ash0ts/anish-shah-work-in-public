"use client";

import { animate, stagger } from "animejs";
import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styles from "../PersonalStreams.module.css";
import {
  type ConnectorState,
  type DiscogsFormat,
  type DiscogsGallery,
  type DiscogsPublicSnapshot,
  type DiscogsQueryState,
  type DiscogsReleaseSummary,
  type PreviewFixtureScenario,
  DEFAULT_DISCOGS_QUERY,
  loadConnector,
} from "./connector-model";
import { PanelHeading, StreamEmpty, StreamStatus } from "./StreamChrome";

type DiscogsView = "pattern" | "gallery";
type PageSize = 12 | 24 | 36;

const formatOrder: DiscogsFormat[] = [
  "Box set",
  "Vinyl",
  "CD",
  "Cassette",
  "Other",
];

export function DiscogsStream({
  initialState,
  initialQuery = DEFAULT_DISCOGS_QUERY,
  routePath,
  fixture,
}: {
  initialState?: ConnectorState<DiscogsPublicSnapshot>;
  initialQuery?: DiscogsQueryState;
  routePath?: "/play/collect";
  fixture?: PreviewFixtureScenario;
} = {}) {
  const [state, setState] = useState<ConnectorState<DiscogsPublicSnapshot>>(
    initialState ?? { status: "idle" },
  );
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<DiscogsView>("pattern");
  const [draftQuery, setDraftQuery] = useState(initialQuery.query);
  const [query, setQuery] = useState(initialQuery.query);
  const [format, setFormat] = useState(initialQuery.format);
  const [decade, setDecade] = useState(initialQuery.decade);
  const [sort, setSort] = useState(initialQuery.sort);
  const [page, setPage] = useState(initialQuery.page);
  const [pageSize, setPageSize] = useState<PageSize>(initialQuery.pageSize);
  const transitionRoot = useRef<HTMLDivElement>(null);
  const skipInitialRequest = useRef(initialState !== undefined);

  const syncRoute = (next: Partial<DiscogsQueryState>) => {
    if (!routePath || typeof window === "undefined") return;
    const resolved = {
      query,
      format,
      decade,
      sort,
      page,
      pageSize,
      ...next,
    };
    const parameters = new URLSearchParams();
    if (resolved.query) parameters.set("q", resolved.query);
    if (resolved.format && resolved.format !== "all") {
      parameters.set("format", resolved.format);
    }
    if (resolved.decade && resolved.decade !== "all") {
      parameters.set("decade", resolved.decade);
    }
    if (resolved.sort) parameters.set("sort", resolved.sort);
    if (resolved.page > 1) parameters.set("page", String(resolved.page));
    if (resolved.pageSize !== 12) {
      parameters.set("pageSize", String(resolved.pageSize));
    }
    if (fixture) parameters.set("fixture", fixture);
    const search = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${routePath}${search ? `?${search}` : ""}`,
    );
  };

  useEffect(() => {
    if (skipInitialRequest.current) {
      skipInitialRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (query) parameters.set("q", query);
    if (format) parameters.set("format", format);
    if (decade) parameters.set("decade", decade);
    if (sort) parameters.set("sort", sort);
    if (fixture) parameters.set("fixture", fixture);

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setBusy(true);
      setState((current) =>
        current.status === "idle" ? { status: "loading" } : current,
      );
      void loadConnector<DiscogsPublicSnapshot>(
        "discogs",
        parameters,
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setState(next);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    });
    return () => controller.abort();
  }, [decade, fixture, format, page, pageSize, query, sort]);

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
    const motion = animate(items.length ? items : root, {
      translateY: ["0.2rem", 0],
      duration: 210,
      delay: items.length ? stagger(8) : 0,
      ease: "out(3)",
    });
    return () => {
      motion.cancel();
    };
  }, [decade, format, gallery?.page, query, sort, view]);

  if (state.status !== "ready" || !payload) {
    return <StreamEmpty state={state} />;
  }

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = draftQuery.trim();
    syncRoute({ query: nextQuery, page: 1 });
    setQuery(nextQuery);
    setPage(1);
  };

  return (
    <>
      <header className={styles.collectionHeader}>
        <PanelHeading
          title="Pressings and releases, kept distinct."
          description={payload.coverage}
        />
        <div
          className={styles.viewSwitch}
          role="group"
          aria-label="Discogs collection view"
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
          <DiscogsPattern payload={payload} />
        ) : gallery?.ready ? (
          <DiscogsGallery
            busy={busy}
            decade={decade || gallery.decade}
            draftQuery={draftQuery}
            fixture={fixture}
            format={format || gallery.format}
            gallery={gallery}
            onDecade={(value) => {
              syncRoute({ decade: value, page: 1 });
              setDecade(value);
              setPage(1);
            }}
            onDraftQuery={setDraftQuery}
            onFormat={(value) => {
              syncRoute({ format: value, page: 1 });
              setFormat(value);
              setPage(1);
            }}
            onPage={(value) => {
              syncRoute({ page: value });
              setPage(value);
            }}
            onPageSize={(value) => {
              syncRoute({ pageSize: value, page: 1 });
              setPageSize(value);
              setPage(1);
            }}
            onSearch={applySearch}
            onSort={(value) => {
              syncRoute({ sort: value, page: 1 });
              setSort(value);
              setPage(1);
            }}
            pageSize={pageSize}
            routePath={routePath}
            sort={sort || gallery.sort}
          />
        ) : (
          <div className={styles.galleryUnavailable} aria-live="polite">
            <strong>The physical catalog is preparing its first index.</strong>
            <p>
              The searchable shelf is not available yet. The pattern view
              remains available.
            </p>
            <button onClick={() => setView("pattern")} type="button">
              Return to pattern
            </button>
          </div>
        )}
      </div>

      <p className={styles.attribution}>
        Data provided by{" "}
        <a href="https://www.discogs.com/" rel="noreferrer" target="_blank">
          Discogs
        </a>
        . This application uses Discogs’ API but is not affiliated with,
        sponsored or endorsed by Discogs. Release links open the corresponding
        Discogs page.
      </p>
      <StreamStatus
        profileUrl={payload.profileUrl}
        stale={state.stale}
        syncedAt={payload.syncedAt || state.fetchedAt}
      />
    </>
  );
}

function DiscogsPattern({ payload }: { payload: DiscogsPublicSnapshot }) {
  const decades = payload.decades.filter((entry) => entry.count > 0);
  const formats = formatOrder.flatMap((format) => {
    const entry = payload.formats.find((candidate) => candidate.label === format);
    return entry && entry.count > 0 ? [entry] : [];
  });

  return (
    <div className={styles.discogsPattern}>
      <div className={styles.discogsTotals} data-stream-item>
        <div>
          <strong>{payload.totals.physicalItems.toLocaleString()}</strong>
          <span>physical items</span>
        </div>
        <div>
          <strong>{payload.totals.distinctReleases.toLocaleString()}</strong>
          <span>distinct releases</span>
        </div>
        <p>
          Multiple copies count once in releases and once each in physical
          items. Every distribution below uses the physical-item count.
        </p>
      </div>
      <DiscogsDistribution title="Physical format" entries={formats} />
      <DiscogsDistribution title="Release decade" entries={decades} />
      <DiscogsMatrix payload={payload} />
    </div>
  );
}

function DiscogsDistribution({
  title,
  entries,
}: {
  title: string;
  entries: Array<{ label: string; count: number }>;
}) {
  const maximum = Math.max(...entries.map((entry) => entry.count), 1);
  return (
    <figure className={styles.discogsDistribution} data-stream-item>
      <figcaption>{title}</figcaption>
      <ol>
        {entries.map((entry) => (
          <li key={entry.label}>
            <span>{entry.label}</span>
            <i aria-hidden="true">
              <b
                style={
                  {
                    "--share": String((entry.count / maximum) * 100) + "%",
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

function DiscogsMatrix({ payload }: { payload: DiscogsPublicSnapshot }) {
  const formats = formatOrder.filter((format) =>
    payload.formats.some((entry) => entry.label === format && entry.count > 0),
  );
  const decades = payload.decades
    .filter((entry) => entry.count > 0)
    .map((entry) => entry.label);
  const matrix = new Map(
    payload.formatDecadeMatrix.map((entry) => [
      [entry.format, entry.decade].join(":"),
      entry.count,
    ]),
  );

  return (
    <section className={styles.discogsMatrix} data-stream-item>
      <div className={styles.discogsMatrixHeading}>
        <div>
          <span>Pressing matrix</span>
          <h3 id="discogs-matrix-title">Format × release decade</h3>
        </div>
        <p>Counts reconcile to physical items, including multiple copies.</p>
      </div>
      <div
        aria-labelledby="discogs-matrix-title"
        className={styles.discogsMatrixScroll}
        role="region"
        tabIndex={0}
      >
        <table>
          <caption className={styles.visuallyHidden}>
            Physical item counts by format and release decade
          </caption>
          <thead>
            <tr>
              <th scope="col">Format</th>
              {decades.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {formats.map((format) => (
              <tr key={format}>
                <th scope="row">{format}</th>
                {decades.map((label) => (
                  <td key={label}>
                    {(
                      matrix.get([format, label].join(":")) ?? 0
                    ).toLocaleString()}
                  </td>
                ))}
                <td>
                  {(
                    payload.formats.find((entry) => entry.label === format)
                      ?.count ?? 0
                  ).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              {decades.map((label) => (
                <td key={label}>
                  {(
                    payload.decades.find((entry) => entry.label === label)
                      ?.count ?? 0
                  ).toLocaleString()}
                </td>
              ))}
              <td>{payload.totals.physicalItems.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function DiscogsGallery({
  gallery,
  busy,
  decade,
  draftQuery,
  fixture,
  format,
  pageSize,
  sort,
  onDraftQuery,
  onSearch,
  onFormat,
  onDecade,
  onSort,
  onPageSize,
  onPage,
  routePath,
}: {
  gallery: DiscogsGallery;
  busy: boolean;
  decade: string;
  draftQuery: string;
  fixture?: PreviewFixtureScenario;
  format: string;
  pageSize: PageSize;
  sort: string;
  onDraftQuery: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onFormat: (value: string) => void;
  onDecade: (value: string) => void;
  onSort: (value: string) => void;
  onPageSize: (value: PageSize) => void;
  onPage: (value: number) => void;
  routePath?: "/play/collect";
}) {
  const start = gallery.totalItems
    ? (gallery.page - 1) * gallery.pageSize + 1
    : 0;
  const end = Math.min(
    gallery.page * gallery.pageSize,
    gallery.totalItems,
  );

  return (
    <div className={styles.gallery}>
      <form
        action={routePath}
        className={styles.galleryTools + " " + styles.discogsTools}
        method="get"
        onSubmit={onSearch}
      >
        {fixture ? <input name="fixture" type="hidden" value={fixture} /> : null}
        <div className={styles.gallerySearch}>
          <label htmlFor="discogs-gallery-search">Find a title or artist</label>
          <span>
            <input
              id="discogs-gallery-search"
              maxLength={80}
              name="q"
              onChange={(event) => onDraftQuery(event.target.value)}
              placeholder="Search the record shelf"
              type="search"
              value={draftQuery}
            />
            <button type="submit">Search</button>
          </span>
        </div>
        <DiscogsSelect
          label="Format"
          name="format"
          onChange={onFormat}
          options={gallery.formats.map((entry) => ({
            value: entry.id,
            label: entry.label + " · " + entry.count,
          }))}
          value={format}
        />
        <DiscogsSelect
          label="Decade"
          name="decade"
          onChange={onDecade}
          options={gallery.decades.map((entry) => ({
            value: entry.id,
            label: entry.label + " · " + entry.count,
          }))}
          value={decade}
        />
        <DiscogsSelect
          label="Sort"
          name="sort"
          onChange={onSort}
          options={gallery.sorts.map((entry) => ({
            value: entry.id,
            label:
              entry.id === "artist"
                ? "Artist · A–Z"
                : entry.id === "title"
                  ? "Title · A–Z"
                  : "Year · newest",
          }))}
          value={sort}
        />
        <DiscogsSelect
          label="Per page"
          name="pageSize"
          onChange={(value) => onPageSize(Number(value) as PageSize)}
          options={[12, 24, 36].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          value={String(pageSize)}
        />
      </form>

      <div className={styles.gallerySummary} aria-live="polite">
        <span>
          {start}—{end} of {gallery.totalItems.toLocaleString()} releases
        </span>
        <span>{busy ? "Updating shelf…" : "Public physical-media snapshot"}</span>
      </div>

      {gallery.items.length ? (
        <ol className={styles.discogsShelf} role="list" start={start || 1}>
          {gallery.items.map((release, index) => (
            <DiscogsReleaseRow
              index={start + index}
              key={release.releaseId}
              release={release}
            />
          ))}
        </ol>
      ) : (
        <div className={styles.noResults} data-stream-item>
          <strong>No releases match this view.</strong>
          <p>Change the title, artist, format, or decade to widen the shelf.</p>
        </div>
      )}

      <nav className={styles.galleryPagination} aria-label="Discogs catalog pages">
        {routePath ? (
          <a
            aria-disabled={gallery.page <= 1 || busy}
            href={
              gallery.page <= 1
                ? undefined
                : discogsPageUrl(
                    routePath,
                    gallery,
                    gallery.page - 1,
                    fixture,
                  )
            }
            onClick={(event) => {
              event.preventDefault();
              if (gallery.page > 1 && !busy) onPage(gallery.page - 1);
            }}
          >
            ← Previous
          </a>
        ) : (
          <button
            disabled={gallery.page <= 1 || busy}
            onClick={() => onPage(gallery.page - 1)}
            type="button"
          >
            ← Previous
          </button>
        )}
        <span>
          Page {gallery.page} of {gallery.totalPages}
        </span>
        {routePath ? (
          <a
            aria-disabled={gallery.page >= gallery.totalPages || busy}
            href={
              gallery.page >= gallery.totalPages
                ? undefined
                : discogsPageUrl(
                    routePath,
                    gallery,
                    gallery.page + 1,
                    fixture,
                  )
            }
            onClick={(event) => {
              event.preventDefault();
              if (gallery.page < gallery.totalPages && !busy) {
                onPage(gallery.page + 1);
              }
            }}
          >
            Next →
          </a>
        ) : (
          <button
            disabled={gallery.page >= gallery.totalPages || busy}
            onClick={() => onPage(gallery.page + 1)}
            type="button"
          >
            Next →
          </button>
        )}
      </nav>
    </div>
  );
}

function DiscogsSelect({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.gallerySelect}>
      <span>{label}</span>
      <select
        name={name}
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

function discogsPageUrl(
  routePath: "/play/collect",
  gallery: DiscogsGallery,
  page: number,
  fixture?: PreviewFixtureScenario,
) {
  const parameters = new URLSearchParams({
    page: String(page),
    pageSize: String(gallery.pageSize),
  });
  if (gallery.query) parameters.set("q", gallery.query);
  if (gallery.format && gallery.format !== "all") {
    parameters.set("format", gallery.format);
  }
  if (gallery.decade && gallery.decade !== "all") {
    parameters.set("decade", gallery.decade);
  }
  if (gallery.sort) parameters.set("sort", gallery.sort);
  if (fixture) parameters.set("fixture", fixture);
  return `${routePath}?${parameters.toString()}`;
}

function DiscogsReleaseRow({
  release,
  index,
}: {
  release: DiscogsReleaseSummary;
  index: number;
}) {
  const validReleaseId = /^\d+$/.test(release.releaseId);
  const content = (
    <>
      <span className={styles.discogsIndex}>
        {String(index).padStart(2, "0")}
      </span>
      <span className={styles.discogsTitle}>
        <strong>{release.title}</strong>
        <small>{release.artists.join(", ")}</small>
      </span>
      <span className={styles.discogsMeta}>
        <span>{release.format}</span>
        <span>{release.releaseYear ?? "Undated"}</span>
        <span>
          {release.copyCount.toLocaleString()}{" "}
          {release.copyCount === 1 ? "copy" : "copies"}
        </span>
      </span>
      {validReleaseId ? <b aria-hidden="true">↗</b> : null}
    </>
  );

  return (
    <li data-stream-item>
      {validReleaseId ? (
        <a
          href={
            "https://www.discogs.com/release/" +
            encodeURIComponent(release.releaseId)
          }
          rel="noreferrer"
          target="_blank"
        >
          {content}
        </a>
      ) : (
        <div>{content}</div>
      )}
    </li>
  );
}
